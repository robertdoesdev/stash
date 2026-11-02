/* TEST DOUBLE of the supabase-js browser client (UMD global `supabase`).
 * Thin: forwards to the Node MockServer through window.__srv. Session persistence
 * goes through the storage adapter the app passes in, so remember-me, refresh and
 * sign-out behaviour are exercised for real. */
(function () {
  function createClient(url, key, opts) {
    const A = opts.auth, storage = A.storage, SK = A.storageKey, VK = SK + '-code-verifier';
    const subs = new Set();
    const read = () => { const v = storage.getItem(SK); return v ? JSON.parse(v) : null; };
    const save = s => storage.setItem(SK, JSON.stringify(s));
    const emit = (ev, s) => subs.forEach(cb => cb(ev, s));
    const err = o => (o && o.error) ? Object.assign(new Error(o.error.message), o.error) : null;
    async function srv(op, p) {
      const r = await window.__srv(op, p);
      if (r && r.__network) { const e = new Error('Failed to fetch'); e.name = 'AuthRetryableFetchError'; e.status = 0; throw e; }
      return r;
    }
    const wrap = async fn => { try { return await fn(); } catch (e) { return { data: null, error: e }; } };
    const verifier = () => storage.setItem(VK, 'verifier_' + Math.random());

    const ready = (async () => {
      const q = new URLSearchParams(location.search);
      if (A.detectSessionInUrl && q.has('code')) {
        if (!storage.getItem(VK)) return;                     // PKCE: different browser than the one that asked
        try {
          const r = await srv('exchange', { code: q.get('code') });
          if (r.session) {
            save(r.session); storage.removeItem(VK);
            const ev = (r.kind === 'recovery' && window.__mockEmitRecovery) ? 'PASSWORD_RECOVERY' : 'SIGNED_IN';
            setTimeout(() => emit(ev, r.session), 0);
          }
        } catch (e) { /* swallowed, as supabase-js does during initialization */ }
      }
    })();

    const auth = {
      async getSession() { await ready; return { data: { session: read() }, error: null }; },
      async getUser() {
        return wrap(async () => { const s = read(); if (!s) return { data: { user: null }, error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }) };
          const r = await srv('getUser', { token: s.access_token }); const e = err(r); return e ? { data: { user: null }, error: e } : { data: { user: r.user }, error: null }; });
      },
      onAuthStateChange(cb) { subs.add(cb); ready.then(() => setTimeout(() => cb('INITIAL_SESSION', read()), 0)); return { data: { subscription: { unsubscribe() { subs.delete(cb); } } } }; },
      async signUp({ email, password, options }) {
        return wrap(async () => { verifier(); const r = await srv('signUp', { email, password, meta: options && options.data, redirect: options && options.emailRedirectTo });
          const e = err(r); if (e) return { data: { user: null, session: null }, error: e };
          if (r.session) { save(r.session); setTimeout(() => emit('SIGNED_IN', r.session), 0); }
          return { data: { user: r.user, session: r.session }, error: null }; });
      },
      async resend({ email, options }) { return wrap(async () => { verifier(); const r = await srv('resend', { email, redirect: options && options.emailRedirectTo }); return { data: {}, error: err(r) }; }); },
      async signInWithPassword({ email, password }) {
        return wrap(async () => { const r = await srv('signIn', { email, password }); const e = err(r); if (e) return { data: { user: null, session: null }, error: e };
          save(r.session); setTimeout(() => emit('SIGNED_IN', r.session), 0); return { data: { user: r.session.user, session: r.session }, error: null }; });
      },
      async signInWithOAuth({ provider, options }) {
        return wrap(async () => { verifier(); const r = await srv('oauthStart', { redirect: options.redirectTo });
          window.__lastOAuth = { provider, options };
          window.location.assign(r.url); return { data: { provider, url: r.url }, error: null }; });
      },
      async resetPasswordForEmail(email, o) { return wrap(async () => { verifier(); const r = await srv('resetPassword', { email, redirect: o && o.redirectTo }); return { data: {}, error: err(r) }; }); },
      async updateUser({ password }) {
        return wrap(async () => { const s = read(); if (!s) return { data: { user: null }, error: Object.assign(new Error('Auth session missing!'), { status: 400 }) };
          const r = await srv('updateUser', { token: s.access_token, password }); const e = err(r); return e ? { data: { user: null }, error: e } : { data: { user: r.user }, error: null }; });
      },
      async signOut(o) {
        const scope = (o && o.scope) || 'global'; const s = read();
        if (s) { try { await srv('signOut', { token: s.access_token, scope }); } catch (e) { /* offline */ } }
        if (scope !== 'others') { storage.removeItem(SK); setTimeout(() => emit('SIGNED_OUT', null), 0); }
        return { error: null };
      }
    };
    const b64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
    const unb64 = (s, type) => { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type }); };
    const stRes = r => (r && r.stError) ? { data: null, error: Object.assign(new Error(r.stError.message), r.stError) } : null;
    const cloudStorage = { from: bucket => ({
      upload: (path, blob, o) => wrap(async () => { const s = read(); const r = await srv('stUpload', { token: s && s.access_token, path, b64: await b64(blob), mimetype: (o && o.contentType) || blob.type });
        return stRes(r) || { data: { path }, error: null }; }),
      download: path => wrap(async () => { const s = read(); const r = await srv('stDownload', { token: s && s.access_token, path }); return stRes(r) || { data: unb64(r.b64, r.mimetype), error: null }; }),
      remove: paths => wrap(async () => { const s = read(); const r = await srv('stRemove', { token: s && s.access_token, paths }); return stRes(r) || { data: r.removed.map(name => ({ name })), error: null }; })
    }) };
    const from = table => {
      if (table === 'documents') {
        const q = { status: null }; const b = { select() { return b; }, eq(c, v) { q[c] = v; return b; }, order() { return b; }, range(a, z) { q.from = a; q.to = z; return b; },
          then(res, rej) { return wrap(async () => { const s = read(); const r = await srv('docsList', { token: s && s.access_token, status: q.status }); const e = err(r);
            return e ? { data: null, error: e } : { data: r.rows.slice(q.from || 0, (q.to == null ? r.rows.length : q.to + 1)), error: null }; }).then(res, rej); } };
        return b;
      }
      const q = { id: null };
      const b = { select() { return b; }, eq(col, v) { q[col] = v; return b; },
        async maybeSingle() { return wrap(async () => { const s = read(); const r = await srv('profileGet', { token: s && s.access_token, id: q.id }); const e = err(r); return e ? { data: null, error: e } : { data: r.row, error: null }; }); } };
      return b;
    };
    const rpc = async (name, args) => wrap(async () => { const s = read(); const r = await srv('rpc', { token: s && s.access_token, name, args });
      const e = err(r); return e ? { data: null, error: e } : { data: r.data, error: null }; });
    return { auth, from, rpc, storage: cloudStorage };
  }
  window.supabase = { createClient };
})();
