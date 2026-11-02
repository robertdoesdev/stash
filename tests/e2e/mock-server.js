/* TEST DOUBLE of the Supabase backend (GoTrue + the Stash profile functions).
 * Lives in Node so state survives page reloads and can be shared between
 * browser contexts ("another device"). Mirrors the rules in
 * supabase/migrations/0001_profiles.sql, which are verified separately against
 * real PostgreSQL (tests/db). It is NOT Supabase: see docs/PHASE2_TEST_REPORT.md. */
const crypto = require('crypto');
const uid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(12).toString('hex');
const MATRIC = /^[A-Z0-9][A-Z0-9/_-]{3,23}$/;
const LEVELS = ['100L', '200L', '300L', '400L', '500L'];
const normMatric = v => String(v || '').trim().replace(/\s+/g, '').toUpperCase();

class MockServer {
  constructor() { this.reset(); }
  reset() {
    this.users = new Map(); this.profiles = new Map(); this.codes = new Map();
    this.tokens = new Map(); this.mail = []; this.attempts = new Map();
    this.flags = { confirmDisabled: false, offline: false, rateLimit: false, googleDeny: false, emitRecoveryEvent: false, getUserStatus: 0 };
    this.google = { email: 'gina@gmail.com', name: 'Gina Google' };
    this.log = [];   // every request body, so tests can assert nothing sensitive leaks
  }
  err(code, message, status = 400) { return { error: { code, message, status } }; }
  net() { return this.flags.offline ? { __network: true } : null; }

  // ---- mirrors handle_new_user / apply_signup_metadata (0002): an empty profile is created at sign-up;
  //      the (untrusted) metadata is applied ONLY once the email is verified, and never breaks verification.
  makeProfile(user) {
    this.profiles.set(user.id, { id: user.id, email: user.email, full_name: null, matric_number: null, level: null, institution: 'FULAFIA' });
    if (user.confirmed) this.applyMeta(user);
  }
  applyMeta(user) {
    const meta = user.meta || {}; const p = this.profiles.get(user.id); if (!p) return;
    const name = (meta.full_name || meta.name || '').trim() || null;
    const matric = normMatric(meta.matric_number) || null; const level = meta.level || null;
    const okName = name && name.length >= 2 && name.length <= 80 && !/[\x00-\x1f]/.test(name);
    const okMatric = !matric || (MATRIC.test(matric) && ![...this.profiles.values()].some(x => x.id !== p.id && x.matric_number === matric));
    const okLevel = !level || LEVELS.includes(level);
    if (okName && okMatric && okLevel) { p.full_name = p.full_name || name; p.matric_number = p.matric_number || matric; p.level = p.level || level; }
    else if (okName) p.full_name = p.full_name || name;     // fallback: valid name only
  }
  complete(p) { return !!(p.full_name && p.matric_number && p.level); }
  view(p) { return p && { ...p, profile_complete: this.complete(p) }; }

  newCode(userId, kind) { const code = rand(); this.codes.set(code, { userId, kind, used: false }); return code; }
  publicUser(u) {
    return { id: u.id, email: u.email, email_confirmed_at: u.confirmed ? new Date().toISOString() : null,
      identities: u.providers.map(p => ({ provider: p })), user_metadata: u.meta };
  }
  session(u) {
    const token = 'tok_' + rand(); this.tokens.set(token, u.id);
    return { access_token: token, refresh_token: 'r_' + rand(), expires_at: Math.floor(Date.now() / 1000) + 3600, user: this.publicUser(u) };
  }
  userByToken(t) { const id = this.tokens.get(t); return id ? this.users.get(id) : null; }
  byEmail(email) { return [...this.users.values()].find(u => u.email === String(email).toLowerCase()); }

  handle(op, p) {
    const n = this.net(); if (n) return n;
    this.log.push({ op, p: JSON.parse(JSON.stringify(p || {})) });
    return this['op_' + op](p || {});
  }

  op_signUp({ email, password, meta, redirect }) {
    if (this.flags.rateLimit) return this.err('over_email_send_rate_limit', 'email rate limit exceeded', 429);
    if (!password || password.length < 8) return this.err('weak_password', 'Password should be at least 8 characters.', 422);
    email = String(email).toLowerCase();
    const existing = this.byEmail(email);
    if (existing && existing.confirmed) {
      // real GoTrue: obfuscated success, user with NO identities, no email
      return { user: { id: uid(), email, identities: [], user_metadata: {} }, session: null };
    }
    let u = existing;
    if (!u) {
      u = { id: uid(), email, password, confirmed: false, meta: meta || {}, providers: ['email'] };
      this.users.set(u.id, u); this.makeProfile(u);
    }
    if (this.flags.confirmDisabled) { u.confirmed = true; this.applyMeta(u); return { user: this.publicUser(u), session: this.session(u) }; }
    const code = this.newCode(u.id, 'signup');
    this.mail.push({ to: email, kind: 'signup', link: `${redirect}?code=${code}` });
    return { user: this.publicUser(u), session: null };
  }
  op_resend({ email, redirect }) {
    if (this.flags.rateLimit) return this.err('over_email_send_rate_limit', 'email rate limit exceeded', 429);
    const u = this.byEmail(email);
    if (u && !u.confirmed) this.mail.push({ to: u.email, kind: 'signup', link: `${redirect}?code=${this.newCode(u.id, 'signup')}` });
    return {};
  }
  op_signIn({ email, password }) {
    if (this.flags.rateLimit) return this.err('over_request_rate_limit', 'Too many requests', 429);
    const u = this.byEmail(email);
    if (!u || u.password !== password) return this.err('invalid_credentials', 'Invalid login credentials');
    if (!u.confirmed) return this.err('email_not_confirmed', 'Email not confirmed');
    return { session: this.session(u) };
  }
  op_exchange({ code }) {
    const c = this.codes.get(code);
    if (!c || c.used) return this.err('flow_state_not_found', 'invalid flow state, no valid flow state found', 404);
    c.used = true;
    const u = this.users.get(c.userId);
    if (c.kind === 'signup' && !u.confirmed) { u.confirmed = true; this.applyMeta(u); }
    return { session: this.session(u), kind: c.kind };
  }
  op_oauthStart({ redirect }) {
    if (this.flags.googleDeny) return { url: `${redirect}?error=access_denied&error_code=bad_oauth_callback&error_description=Access+denied` };
    const { email, name } = this.google;
    let u = this.byEmail(email);
    if (!u) {
      u = { id: uid(), email, password: null, confirmed: true, meta: { name, full_name: name }, providers: ['google'] };
      this.users.set(u.id, u); this.makeProfile(u);
    } else if (!u.providers.includes('google')) { u.providers.push('google'); u.confirmed = true; }
    return { url: `${redirect}?code=${this.newCode(u.id, 'oauth')}` };
  }
  op_getUser({ token }) {
    if (this.flags.getUserStatus) return this.err('unexpected_failure', 'upstream error', this.flags.getUserStatus);
    const u = this.userByToken(token);
    if (!u) return this.err('bad_jwt', 'invalid JWT', 401);
    return { user: this.publicUser(u) };
  }
  op_updateUser({ token, password }) {
    const u = this.userByToken(token); if (!u) return this.err('bad_jwt', 'invalid JWT', 401);
    if (password) {
      if (password.length < 8) return this.err('weak_password', 'Password should be at least 8 characters.', 422);
      if (password === u.password) return this.err('same_password', 'New password should be different from the old password.', 422);
      u.password = password; if (!u.providers.includes('email')) u.providers.push('email');
    }
    return { user: this.publicUser(u) };
  }
  op_signOut({ token, scope }) {
    // real GoTrue semantics: local = this session only; others = all but this; global (default) = ALL of the user's sessions
    const id = this.tokens.get(token);
    if (scope === 'others') { for (const [t, uidv] of this.tokens) if (uidv === id && t !== token) this.tokens.delete(t); }
    else if (scope === 'local') this.tokens.delete(token);
    else { for (const [t, uidv] of this.tokens) if (uidv === id) this.tokens.delete(t); }
    return {};
  }
  op_resetPassword({ email, redirect }) {
    if (this.flags.rateLimit) return this.err('over_email_send_rate_limit', 'email rate limit exceeded', 429);
    const u = this.byEmail(email);   // identical response either way
    if (u && u.confirmed) this.mail.push({ to: u.email, kind: 'recovery', link: `${redirect}?code=${this.newCode(u.id, 'recovery')}` });
    return {};
  }
  op_profileGet({ token, id }) {
    const u = this.userByToken(token); if (!u) return this.err('42501', 'permission denied for table profiles', 401);
    return { row: id === u.id ? this.view(this.profiles.get(u.id)) || null : null };   // RLS: own row only
  }
  op_rpc({ token, name, args }) {
    const u = this.userByToken(token);
    if (name === 'delete_my_account') {
      if (!u) return this.err('P0001', 'not_authenticated');
      this.profiles.delete(u.id); this.users.delete(u.id);
      for (const [t, id] of this.tokens) if (id === u.id) this.tokens.delete(t);
      return { data: null };
    }
    if (name !== 'save_my_profile') return this.err('42883', 'function not found', 404);
    if (!u) return this.err('P0001', 'not_authenticated');
    if (!u.confirmed) return this.err('P0001', 'email_not_verified');
    const recent = (this.attempts.get(u.id) || []).filter(t => Date.now() - t < 3600e3);
    if (recent.length >= 5) return { data: { status: 'too_many_attempts' } };
    const nm = String(args.p_full_name || '').trim(); const m = normMatric(args.p_matric);
    if (nm.length < 2 || nm.length > 80 || /[\x00-\x1f]/.test(nm)) return this.err('P0001', 'invalid_name');
    if (!MATRIC.test(m)) return this.err('P0001', 'invalid_matric');
    if (!LEVELS.includes(args.p_level)) return this.err('P0001', 'invalid_level');
    const cur = this.profiles.get(u.id) || { id: u.id, email: u.email, institution: 'FULAFIA' };
    if (cur.matric_number && cur.matric_number !== m) return this.err('P0001', 'matric_locked');
    if ([...this.profiles.values()].some(x => x.id !== u.id && x.matric_number === m)) {
      this.attempts.set(u.id, [...recent, Date.now()]);
      return { data: { status: 'matric_unavailable' } };            // neutral: same answer whatever the reason
    }
    const row = { ...cur, email: u.email, full_name: nm, matric_number: m, level: args.p_level };
    this.profiles.set(u.id, row);
    return { data: { status: 'ok', profile: this.view(row) } };
  }
}
require('./mock-cloud')(MockServer);
module.exports = { MockServer };
