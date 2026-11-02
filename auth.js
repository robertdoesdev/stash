/* =========================================================
   Stash — authentication (Supabase Auth)

   The ONLY module that talks to Supabase Auth. script.js reads
   StashAuth.state and calls the methods below.

   Security notes
   - No passwords, tokens or sessions are ever logged or written by this
     file except through Supabase's own session storage.
   - Authentication state comes from a Supabase session (a signed JWT checked by
     Supabase on every request), never from a flag we set ourselves.
   - Only the public project URL and the anon key are used here. The anon key is
     designed to be public; data access is limited by Row Level Security.
     The service-role key must never appear in this repository or the browser.
   - An account whose email is not verified is NEVER treated as signed in.
   ========================================================= */
(function () {
  'use strict';

  const ENV = window.STASH_ENV || {};
  const REMEMBER_KEY = 'stash_remember';          // '0' = this tab only
  const RECOVERY_MARK = 'stash_recovery_requested'; // timestamp, same browser only
  const OAUTH_MARK = 'stash_oauth_pending';
  const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
  const LEVELS = ['100L', '200L', '300L', '400L', '500L'];

  let client = null;
  const listeners = new Set();

  const state = {
    configured: false,   // env present and Supabase library loaded
    ready: false,        // init() finished
    user: null,          // verified Supabase user, or null
    profile: null,       // row from public.profiles, or null (none yet)
    recovery: false,     // signed in via password-reset link; must set a new password
    notice: null,        // { kind, message } shown on login after a callback problem
    arrivedVia: null     // 'oauth' | 'email-link' | 'recovery' when we just came back from a link
  };

  /* ---------- storage: "remember me" chooses localStorage vs this tab only ---------- */
  // The PKCE code verifier must ALWAYS live in localStorage: the emailed link opens in a NEW tab,
  // which cannot see this tab's sessionStorage. (It is a one-time secret that is useless without
  // the emailed code, and is deleted after the exchange.)
  const isVerifierKey = k => /-code-verifier$/.test(k);
  const storage = {
    _persist(k) { if (isVerifierKey(k)) return true; try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (e) { return true; } },
    getItem(k) {
      try { const v = localStorage.getItem(k); return v !== null ? v : sessionStorage.getItem(k); } catch (e) { return null; }
    },
    setItem(k, v) {
      try {
        const keep = this._persist(k);
        (keep ? localStorage : sessionStorage).setItem(k, v);
        (keep ? sessionStorage : localStorage).removeItem(k);
      } catch (e) { /* storage blocked: session lasts for this page load only */ }
    },
    removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function setRemember(remember) { try { localStorage.setItem(REMEMBER_KEY, remember === false ? '0' : '1'); } catch (e) { /* ignore */ } }

  /* ---------- helpers ---------- */
  const isVerified = u => !!(u && (u.email_confirmed_at || u.confirmed_at));
  const callbackBase = () => window.location.origin + window.location.pathname;

  function isNetworkError(err) {
    if (!err) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const msg = String(err.message || '');
    return err.name === 'AuthRetryableFetchError' || err.status === 0 ||
      /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
  }

  // True only when the server says this session/token is no longer valid (revoked, deleted user,
  // bad token). Rate limits, 5xx errors and connectivity problems must NOT sign the student out.
  function sessionIsInvalid(err) {
    if (!err || isNetworkError(err)) return false;
    const c = err.code || '', st = err.status;
    if (['session_not_found', 'bad_jwt', 'user_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'user_banned'].includes(c)) return true;
    if (st === 401 || st === 403) return true;
    return /auth session missing|invalid jwt|jwt expired/i.test(String(err.message || ''));
  }

  function mapAuthError(err) {
    if (!err) return null;
    if (isNetworkError(err)) return { code: 'network', message: 'We couldn’t reach the server. Check your connection and try again.' };
    const code = err.code || '';
    const msg = String(err.message || '');
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
      return { code: 'invalid_credentials', message: 'That email and password don’t match.' };
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
      return { code: 'email_not_confirmed', message: 'Please confirm your email first. Check your inbox for the link we sent.' };
    }
    if (/rate limit|too many/i.test(msg) || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
      return { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' };
    }
    if (code === 'same_password' || /different from the old password/i.test(msg)) {
      return { code: 'same_password', message: 'Your new password must be different from the current one.' };
    }
    if (code === 'weak_password' || /at least \d+ characters|weak password/i.test(msg)) {
      return { code: 'weak_password', message: 'Choose a stronger password (at least 8 characters).' };
    }
    if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) {
      return { code: 'signup_disabled', message: 'Sign-ups are currently closed.' };
    }
    if (code === 'user_banned') return { code: 'user_banned', message: 'This account is unavailable. Please contact support.' };
    if (code === 'session_not_found' || code === 'bad_jwt' || code === 'refresh_token_not_found' || /invalid jwt|jwt expired|auth session missing/i.test(msg)) {
      return { code: 'session_expired', message: 'Your session has expired. Please log in again.' };
    }
    return { code: 'unknown', message: 'Something went wrong. Please try again.' };
  }

  const PROFILE_ERRORS = {
    not_authenticated: 'Your session has expired. Please log in again.',
    email_not_verified: 'Please verify your email before continuing.',
    invalid_name: 'Enter your full name (2–80 characters).',
    invalid_matric: 'Enter a valid matric number (4–24 letters, numbers, / or -).',
    invalid_level: 'Choose your academic level.',
    matric_unavailable: 'We couldn’t register that matric number. Check it for typos. If it is yours and you keep seeing this message, contact support.',
    too_many_attempts: 'Too many attempts. Please try again in about an hour, or contact support.',
    unknown_save: 'We couldn’t save your details. Please try again.',
    matric_locked: 'Your matric number can’t be changed here. To correct it, contact support.'
  };
  function mapProfileError(err) {
    if (isNetworkError(err)) return { code: 'network', message: 'We couldn’t reach the server. Check your connection and try again.' };
    const msg = String((err && err.message) || '');
    for (const k of Object.keys(PROFILE_ERRORS)) if (msg.indexOf(k) !== -1) return { code: k, message: PROFILE_ERRORS[k] };
    return { code: 'unknown', message: 'We couldn’t save your details. Please try again.' };
  }

  function emit(kind) { listeners.forEach(fn => { try { fn(kind, state); } catch (e) { /* listener errors must not break auth */ } }); }
  const key = () => [state.user ? state.user.id : '-', state.profile && state.profile.profile_complete ? 'c' : 'i', state.recovery ? 'r' : '-'].join(':');

  /* ---------- callback parsing (runs BEFORE the supabase client strips the URL) ---------- */
  function readCallback() {
    const out = { hadCode: false, noticeKind: null };
    const search = new URLSearchParams(window.location.search);
    const hash = (window.location.hash || '').replace(/^#/, '');
    const hashParams = hash.indexOf('=') !== -1 ? new URLSearchParams(hash) : null;

    out.hadCode = search.has('code');
    const err = search.get('error') || (hashParams && hashParams.get('error'));
    const errCode = search.get('error_code') || (hashParams && hashParams.get('error_code')) || '';
    if (err || errCode) {
      out.noticeKind = /expired|otp/i.test(errCode + ' ' + (search.get('error_description') || (hashParams && hashParams.get('error_description')) || ''))
        ? 'link_expired' : (sessionStorage.getItem(OAUTH_MARK) ? 'oauth_failed' : 'link_invalid');
    }
    return out;
  }
  function scrubUrl() {
    const s = new URLSearchParams(window.location.search);
    ['code', 'error', 'error_code', 'error_description'].forEach(k => s.delete(k));
    const q = s.toString();
    const hash = /^#(error|access_token|error_code)=/.test(window.location.hash || '') ? '' : window.location.hash;
    window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + hash);
  }

  /* ---------- session -> state ---------- */
  async function applySession(session) {
    const u = session && session.user;
    if (u && !isVerified(u)) {
      // Never treat an unverified account as signed in.
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
      state.user = null; state.profile = null;
      return;
    }
    state.user = u || null;
    if (!state.user) state.profile = null;
  }

  async function loadProfile() {
    if (!client || !state.user) { state.profile = null; return null; }
    const { data, error } = await client.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (error) { state.profileError = mapProfileError(error); return null; }
    state.profileError = null;
    state.profile = data || null; // null => no row yet => onboarding
    return state.profile;
  }

  async function handleEvent(event, session) {
    const before = key();
    if (event === 'SIGNED_OUT') {
      state.user = null; state.profile = null; state.recovery = false;
    } else if (event === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      state.arrivedVia = 'recovery';
      await applySession(session);
      await loadProfile();
    } else if (session) {
      await applySession(session);
      if (state.user && (!state.profile || state.profile.id !== state.user.id)) await loadProfile();
    }
    if (key() !== before) emit(event);
  }

  /* ---------- public API ---------- */
  const StashAuth = {
    state,
    LEVELS,
    /** Phase 3: the already-configured Supabase client (same session), for storage/database calls. */
    getClient() { return client; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init() {
      const cb = readCallback();
      const oauthPending = !!sessionStorage.getItem(OAUTH_MARK);
      if (cb.noticeKind) state.notice = { kind: cb.noticeKind };

      if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY || !(window.supabase && window.supabase.createClient)) {
        state.configured = false; state.ready = true;
        if (cb.hadCode || cb.noticeKind) scrubUrl();
        return state;
      }
      client = window.supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage, storageKey: 'stash-auth' }
      });
      state.configured = true;
      // Subscribe BEFORE awaiting so a recovery event during initialization is not missed.
      // (Never call auth methods synchronously inside this callback; defer.)
      client.auth.onAuthStateChange((event, session) => { setTimeout(() => { handleEvent(event, session); }, 0); });

      let session = null;
      try { const r = await client.auth.getSession(); session = r.data && r.data.session; } catch (e) { session = null; }
      await applySession(session);

      // Confirm the session with the Supabase server (not just the cached token).
      if (state.user) {
        try {
          const r = await client.auth.getUser();
          if (r.error && sessionIsInvalid(r.error)) {
            try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
            state.user = null; state.profile = null;
          } else if (!r.error && r.data && r.data.user) {
            state.user = r.data.user;
            if (!isVerified(state.user)) { state.user = null; }
          }
        } catch (e) { /* offline: keep the cached session */ }
      }

      // Was this page load the return from an email link or Google?
      if (cb.hadCode) {
        let markTs = 0;
        try { markTs = parseInt(localStorage.getItem(RECOVERY_MARK) || '0', 10); } catch (e) { markTs = 0; }
        const recoveryMarked = markTs && (Date.now() - markTs) < RECOVERY_WINDOW_MS;
        if (state.user) {
          if (state.recovery || (recoveryMarked && !oauthPending)) { state.recovery = true; state.arrivedVia = 'recovery'; }
          else state.arrivedVia = oauthPending ? 'oauth' : 'email-link';
        } else if (!state.notice) {
          // code could not be exchanged (e.g. opened in a different browser than the one that asked for it)
          state.notice = { kind: oauthPending ? 'oauth_failed' : 'link_unusable' };
        }
      }
      try { sessionStorage.removeItem(OAUTH_MARK); } catch (e) { /* ignore */ }
      if (cb.hadCode || cb.noticeKind) scrubUrl();

      if (state.user) await loadProfile();
      state.ready = true;
      return state;
    },

    /* --- sign up with email + password (profile data travels as UNTRUSTED metadata;
           the database validates it and the student can always finish in onboarding) --- */
    async signUp({ fullName, matric, level, email, password }) {
      if (!client) return { ok: false, code: 'not_configured', message: 'Sign-up isn’t available right now.' };
      setRemember(true);
      try { localStorage.removeItem(RECOVERY_MARK); } catch (e) { /* ignore */ }
      const { data, error } = await client.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: callbackBase(),
          data: { full_name: fullName, matric_number: matric, level }
        }
      });
      if (error) return { ok: false, ...mapAuthError(error) };

      if (data && data.session) {
        // A session at sign-up means "Confirm email" is switched OFF in Supabase.
        // We refuse to run without verification.
        try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
        state.user = null; state.profile = null;
        return { ok: false, code: 'verification_disabled', message: 'Sign-up is temporarily unavailable. Please try again later.' };
      }
      // Existing, confirmed email: Supabase returns a user with no identities (and sends no
      // email) so that account existence is not revealed. We show the same screen either way.
      const alreadyRegistered = !!(data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
      return { ok: true, needsVerification: true, alreadyRegistered };
    },

    async resendVerification(email) {
      if (!client) return { ok: false, code: 'not_configured', message: 'Not available right now.' };
      const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackBase() } });
      if (error) return { ok: false, ...mapAuthError(error) };
      return { ok: true };
    },

    async signIn(email, password, remember) {
      if (!client) return { ok: false, code: 'not_configured', message: 'Log in isn’t available right now.' };
      setRemember(remember !== false);
      try { localStorage.removeItem(RECOVERY_MARK); } catch (e) { /* ignore */ }
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, ...mapAuthError(error) };
      await applySession(data.session);
      if (!state.user) return { ok: false, code: 'email_not_confirmed', message: PROFILE_ERRORS.email_not_verified };
      await loadProfile();
      emit('SIGNED_IN');
      return { ok: true, complete: !!(state.profile && state.profile.profile_complete) };
    },

    async signInWithGoogle(remember) {
      if (!client) return { ok: false, code: 'not_configured', message: 'Google sign-in isn’t available right now.' };
      setRemember(remember !== false);
      try { sessionStorage.setItem(OAUTH_MARK, '1'); localStorage.removeItem(RECOVERY_MARK); } catch (e) { /* ignore */ }
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackBase(), queryParams: { prompt: 'select_account' } }
      });
      if (error) { try { sessionStorage.removeItem(OAUTH_MARK); } catch (e) { /* ignore */ } return { ok: false, ...mapAuthError(error) }; }
      return { ok: true }; // the browser is being redirected to Google
    },

    /* Always reports success for well-formed requests so account existence is never revealed.
       Real failures (offline, rate limited) are reported because they are not about the account. */
    async requestPasswordReset(email) {
      if (!client) return { ok: false, code: 'not_configured', message: 'Password reset isn’t available right now.' };
      try { localStorage.setItem(RECOVERY_MARK, String(Date.now())); } catch (e) { /* ignore */ }
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: callbackBase() });
      if (error) {
        const m = mapAuthError(error);
        if (m.code === 'network' || m.code === 'rate_limited') {
          try { localStorage.removeItem(RECOVERY_MARK); } catch (e) { /* ignore */ }
          return { ok: false, ...m };
        }
        // anything else could reveal account state: report the generic success
      }
      return { ok: true };
    },

    async setNewPassword(newPassword) {
      if (!client || !state.user) return { ok: false, code: 'session_expired', message: 'This reset link is no longer valid. Request a new one.' };
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, ...mapAuthError(error) };
      try { localStorage.removeItem(RECOVERY_MARK); } catch (e) { /* ignore */ }
      state.recovery = false;
      try { await client.auth.signOut({ scope: 'others' }); } catch (e) { /* best effort: end other devices' sessions */ }
      emit('PASSWORD_UPDATED');
      return { ok: true };
    },

    /* Re-check the current password (used before changing password / deleting the account). */
    async confirmPassword(password) {
      if (!client || !state.user || !state.user.email) return { ok: false, code: 'session_expired', message: 'Please log in again.' };
      const { error } = await client.auth.signInWithPassword({ email: state.user.email, password });
      if (error) {
        const m = mapAuthError(error);
        return { ok: false, ...m, message: m.code === 'invalid_credentials' ? 'Current password is incorrect.' : m.message };
      }
      return { ok: true };
    },

    async changePassword(newPassword) {
      if (!client || !state.user) return { ok: false, code: 'session_expired', message: 'Please log in again.' };
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, ...mapAuthError(error) };
      return { ok: true };
    },

    hasPassword() {
      const ids = (state.user && state.user.identities) || [];
      return ids.some(i => i.provider === 'email');
    },

    /* Writes name / matric / level through the validated database function. */
    async saveProfile({ fullName, matric, level }) {
      if (!client || !state.user) return { ok: false, code: 'not_authenticated', message: PROFILE_ERRORS.not_authenticated };
      const { data, error } = await client.rpc('save_my_profile', { p_full_name: fullName, p_matric: matric, p_level: level });
      if (error) return { ok: false, ...mapProfileError(error) };
      if (!data || data.status !== 'ok' || !data.profile) {
        const code = (data && data.status) || 'unknown_save';
        return { ok: false, code, message: PROFILE_ERRORS[code] || PROFILE_ERRORS.unknown_save };
      }
      state.profile = data.profile;
      emit('PROFILE_SAVED');
      return { ok: true, profile: data.profile };
    },

    async signOut() {
      if (client) {
        // 'local' ends and revokes THIS device's session only. (supabase-js defaults to 'global',
        // which would silently sign the student out of their phone, laptop and every other device.)
        try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore: storage is cleared below */ }
        try { storage.removeItem('stash-auth'); } catch (e) { /* ignore */ }
      }
      state.user = null; state.profile = null; state.recovery = false;
      emit('SIGNED_OUT');
    },

    async deleteAccount() {
      if (!client || !state.user) return { ok: false, code: 'session_expired', message: 'Please log in again.' };
      const { error } = await client.rpc('delete_my_account');
      if (error) return { ok: false, ...mapAuthError(error) };
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
      state.user = null; state.profile = null; state.recovery = false;
      emit('SIGNED_OUT');
      return { ok: true };
    },

    clearNotice() { state.notice = null; },
    clearArrival() { state.arrivedVia = null; }
  };

  window.StashAuth = StashAuth;
})();
