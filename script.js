/* =========================================================
   ICONS
   ========================================================= */
const ICONS = {
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  folder: '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  upload: '<path d="M12 16V6M12 6l-4 4M12 6l4 4"/><path d="M5 18h14"/>',
  stack: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  pin: '<circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 1.7-2.3 3.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.2-.9"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  file: '<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/>'
};

function renderIcons(root = document) {
  root.querySelectorAll('i[data-ic]').forEach(el => {
    const name = el.getAttribute('data-ic');
    if (!ICONS[name]) return;
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  });
}

/* =========================================================
   CONFIG
   ========================================================= */
let CONFIG = null;

async function loadConfig() {
  try {
    const res = await fetch('data.json');
    CONFIG = await res.json();
  } catch (e) {
    CONFIG = {
      app: { name: 'Stash', tagline: 'Your school papers, sorted', cafePinExpiryMinutes: 10 },
      plans: {
        free: { label: 'Free', maxDocuments: 50, maxStorageMB: 2048 },
        pro: { label: 'Pro', maxDocuments: null, maxStorageMB: 20480 }
      },
      upload: {
        maxFileSizeMB: 10,
        acceptedTypes: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
        acceptedExtensions: ['.pdf', '.jpg', '.jpeg', '.png']
      },
      categories: [
        { id: 'Receipt', label: 'Receipt', badge: 'RCT', color: 'accent' },
        { id: 'Docket', label: 'Docket', badge: 'DKT', color: 'accent-2' },
        { id: 'Admin', label: 'Admin', badge: 'ADM', color: 'accent-3' }
      ],
      levels: ['100L', '200L', '300L', '400L', '500L'],
      semesters: ['First', 'Second'],
      referenceTypes: ['RRR', 'Receipt No.', 'Invoice No.', 'Reference No.', 'Other'],
      defaultProfile: { name: '', matric: '', email: '', department: '', level: '100L', avatar: null },
      defaultSettings: { theme: 'dark', offlineAccess: true, ocrAutofill: true },
      pricingPlans: [],
      faqs: []
    };
  }
  return CONFIG;
}

/* =========================================================
   FILE STORE (IndexedDB) — holds the actual file bytes.
   localStorage (used for everything else) tops out around 5-10MB
   per origin in most browsers, which can't honestly hold even a
   handful of real 10MB uploads, let alone a 2GB/20GB quota. Blobs
   live here; only small metadata lives in the DB/localStorage layer.
   ========================================================= */
const FileStore = {
  _db: null,
  _urlCache: new Map(),

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('stash_files_db', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('files')) {
          req.result.createObjectStore('files');
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error || new Error('Could not open local file storage'));
    });
  },

  async put(id, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Could not save file'));
    });
  },

  async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Could not read file'));
    });
  },

  async delete(id) {
    const db = await this.open();
    const cached = this._urlCache.get(id);
    if (cached) { URL.revokeObjectURL(cached); this._urlCache.delete(id); }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Could not delete file'));
    });
  },

  // Object URLs are cached per document id so repeated preview/thumbnail
  // renders don't keep allocating new blob: URLs.
  async getObjectURL(id) {
    if (this._urlCache.has(id)) return this._urlCache.get(id);
    const blob = await this.get(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this._urlCache.set(id, url);
    return url;
  }
};

/* =========================================================
   PLANS — Free/Pro limits. Billing itself isn't connected yet
   (that lands in a later phase); every account is on 'free' by
   default and these limits are enforced for real regardless.
   ========================================================= */
const Plans = {
  of(user) { return (user && user.plan) || 'free'; },
  limits(user) {
    const id = this.of(user);
    return CONFIG.plans[id] || CONFIG.plans.free;
  }
};


const DB = {
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  _write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

  async getUsers() { return this._read('stash_users', {}); },
  async saveUsers(users) { this._write('stash_users', users); return users; },

  async findUserByIdentifier(identifier) {
    const users = await this.getUsers();
    const id = (identifier || '').toLowerCase();
    return Object.values(users).find(u => u.matric.toLowerCase() === id || u.email.toLowerCase() === id) || null;
  },

  async createUser({ name, matric, email, password, level }) {
    const users = await this.getUsers();
    const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const profile = { ...CONFIG.defaultProfile, name, matric, email, level: level || '100L' };
    const settings = { ...CONFIG.defaultSettings };
    const user = { id, name, matric, email, password, plan: 'free', profile, settings, documents: [] };
    users[id] = user;
    await this.saveUsers(users);
    return user;
  },

  async updateUser(id, patch) {
    const users = await this.getUsers();
    if (!users[id]) return null;
    users[id] = { ...users[id], ...patch };
    await this.saveUsers(users);
    return users[id];
  },

  // Used when editing a profile, to stop two accounts from ending up with
  // the same matric number or email (which would break identifier login).
  async findConflictingUser(matric, email, excludeId) {
    const users = await this.getUsers();
    const m = (matric || '').toLowerCase();
    const e = (email || '').toLowerCase();
    return Object.values(users).find(u =>
      u.id !== excludeId && ((m && u.matric.toLowerCase() === m) || (e && u.email.toLowerCase() === e))
    ) || null;
  },

  async deleteUser(id) {
    const users = await this.getUsers();
    const docs = (users[id] && users[id].documents) || [];
    delete users[id];
    await this.saveUsers(users);
    await Promise.all(docs.map(d => FileStore.delete(d.id).catch(() => {})));
    // Revoke any cafe PINs the deleted account had issued so a stale link
    // can't keep exposing a document after the account is gone.
    const pins = await this.getPins();
    let changed = false;
    Object.keys(pins).forEach(p => {
      if (pins[p].userId === id) { delete pins[p]; changed = true; }
    });
    if (changed) await this.savePins(pins);
  },

  async getDocuments(userId) {
    const users = await this.getUsers();
    const docs = (users[userId] && users[userId].documents) || [];

    // One-time migration: earlier builds embedded files as base64 directly
    // in the document record. Move any of those into FileStore so they
    // don't sit uncounted (or get lost) under the new storage model.
    const legacy = docs.filter(d => d.fileData && !d.hasFile);
    if (legacy.length) {
      for (const d of legacy) {
        try {
          const blob = dataURLtoBlob(d.fileData);
          await FileStore.put(d.id, blob);
          d.hasFile = true;
          d.size = blob.size;
          d.fileType = d.fileType || blob.type;
          d.uploadedAt = d.uploadedAt || new Date().toISOString();
          d.modifiedAt = d.modifiedAt || d.uploadedAt;
          d.referenceNumber = d.referenceNumber || d.rrr || '';
          d.referenceType = d.referenceType || 'RRR';
          d.ocrStatus = d.ocrStatus || (d.ocrText ? 'done' : 'skipped');
          delete d.fileData;
          delete d.rrr;
        } catch (e) { /* leave this one as-is; it'll just show "no preview" */ }
      }
      await this.saveDocuments(userId, docs);
    }
    return docs;
  },
  async saveDocuments(userId, docs) {
    const users = await this.getUsers();
    if (!users[userId]) return [];
    users[userId].documents = docs;
    try {
      await this.saveUsers(users);
    } catch (e) {
      throw new Error('Could not save changes — local storage may be full.');
    }
    return docs;
  },

  async getProfile(userId) {
    const users = await this.getUsers();
    return (users[userId] && users[userId].profile) || { ...CONFIG.defaultProfile };
  },
  async saveProfile(userId, profile) {
    const users = await this.getUsers();
    if (!users[userId]) return profile;
    users[userId].profile = profile;
    // Keep the top-level lookup fields (used for login) in sync with the profile
    // so editing your name/matric/email in Profile doesn't desync from what's
    // shown on the dashboard or used to log back in.
    users[userId].name = profile.name || users[userId].name;
    users[userId].matric = profile.matric || users[userId].matric;
    users[userId].email = profile.email || users[userId].email;
    await this.saveUsers(users);
    return profile;
  },

  async getSettings(userId) {
    const users = await this.getUsers();
    return (users[userId] && users[userId].settings) || { ...CONFIG.defaultSettings };
  },
  async saveSettings(userId, settings) {
    const users = await this.getUsers();
    if (!users[userId]) return settings;
    users[userId].settings = settings;
    await this.saveUsers(users);
    return settings;
  },

  getSession() {
    const local = this._read('stash_session', null);
    if (local) return local;
    try {
      const raw = sessionStorage.getItem('stash_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  setSession(userId, remember) {
    const payload = { userId };
    if (remember) {
      localStorage.setItem('stash_session', JSON.stringify(payload));
      sessionStorage.removeItem('stash_session');
    } else {
      sessionStorage.setItem('stash_session', JSON.stringify(payload));
      localStorage.removeItem('stash_session');
    }
  },
  clearSession() {
    localStorage.removeItem('stash_session');
    sessionStorage.removeItem('stash_session');
  },

  async getPins() { return this._read('stash_cafe_pins', {}); },
  async savePins(pins) { this._write('stash_cafe_pins', pins); return pins; },
  async createPin(userId, doc) {
    const pins = await this.getPins();
    let pin;
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pins[pin]);
    const expiresAt = Date.now() + CONFIG.app.cafePinExpiryMinutes * 60 * 1000;
    pins[pin] = { userId, doc, expiresAt };
    await this.savePins(pins);
    return { pin, expiresAt };
  },
  async consumePin(pin) {
    const pins = await this.getPins();
    const entry = pins[pin];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { delete pins[pin]; await this.savePins(pins); return null; }
    return entry;
  }
};

/* =========================================================
   UI HELPERS
   ========================================================= */
const UI = {
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  },
  openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('scrim').classList.add('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('scrim').classList.remove('show');
  },
  setTheme(mode) {
    document.body.classList.toggle('light-mode', mode === 'light');
    localStorage.setItem('stash_theme', mode);
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
  },
  initTheme() { this.setTheme(localStorage.getItem('stash_theme') || 'dark'); },
  toggleTheme() { this.setTheme(document.body.classList.contains('light-mode') ? 'dark' : 'light'); },
  openModal(id) { document.getElementById(id).classList.remove('hidden'); },
  closeModal(id) { document.getElementById(id).classList.add('hidden'); },
  showFieldError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (message) el.textContent = message;
    el.classList.remove('hidden');
  },
  hideFieldError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
};

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((str || '').trim());
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   ROUTER
   ========================================================= */
const MARKETING = ['landing', 'pricing'];
const AUTH_ONLY = ['login', 'signup'];
const PROTECTED = ['dashboard', 'documents', 'upload', 'clearance', 'cafepin', 'profile', 'settings', 'help'];
const PUBLIC_STANDALONE = ['print-portal'];

function currentRoute() {
  const h = (window.location.hash || '').replace('#', '');
  return h || 'landing';
}

async function router() {
  let route = currentRoute();
  const session = DB.getSession();

  if (PROTECTED.includes(route) && !session) { window.location.hash = '#login'; route = 'login'; }
  else if (AUTH_ONLY.includes(route) && session) { window.location.hash = '#dashboard'; route = 'dashboard'; }
  else if (!MARKETING.includes(route) && !AUTH_ONLY.includes(route) && !PROTECTED.includes(route) && !PUBLIC_STANDALONE.includes(route)) {
    window.location.hash = '#landing'; route = 'landing';
  }

  document.getElementById('marketingShell').classList.toggle('hidden', !MARKETING.includes(route));
  document.getElementById('authShell').classList.toggle('hidden', !AUTH_ONLY.includes(route));
  document.getElementById('appShell').classList.toggle('hidden', !PROTECTED.includes(route));
  document.getElementById('printShell').classList.toggle('hidden', !PUBLIC_STANDALONE.includes(route));

  if (MARKETING.includes(route)) {
    document.getElementById('view-landing').hidden = route !== 'landing';
    document.getElementById('view-pricing').hidden = route !== 'pricing';
    if (route === 'pricing') Views.renderPricing();
    if (route === 'landing') renderIcons(document.getElementById('view-landing'));
  }

  if (AUTH_ONLY.includes(route)) {
    document.getElementById('view-login').hidden = route !== 'login';
    document.getElementById('view-signup').hidden = route !== 'signup';
  }

  if (PROTECTED.includes(route)) {
    PROTECTED.forEach(r => { document.getElementById('view-' + r).hidden = r !== route; });
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === route));
    UI.closeSidebar();

    // Keep the topbar avatar/name correct no matter which protected view we land on.
    const user = await Auth.currentUser();
    if (user) {
      const profile = await DB.getProfile(user.id);
      Views.setAvatarDisplay(profile);
    }

    if (route === 'dashboard') await Views.renderDashboard();
    if (route === 'documents') await Views.renderDocuments();
    if (route === 'upload') await Views.renderUploadCapacity();
    if (route === 'clearance') await Views.renderClearance();
    if (route === 'cafepin') await Views.populateCafeSelect();
    if (route === 'profile') await Views.renderProfile();
    if (route === 'settings') await Views.renderSettings();
    if (route === 'help') Views.renderHelp();
  }

  document.title = ({
    landing: 'Stash — Your school papers, sorted',
    pricing: 'Pricing · Stash',
    login: 'Log in · Stash',
    signup: 'Create your account · Stash',
    dashboard: 'Dashboard · Stash',
    documents: 'My Documents · Stash',
    upload: 'Scan & Upload · Stash',
    clearance: 'Clearance Export · Stash',
    cafepin: 'Cafe Quick-Print · Stash',
    profile: 'Profile · Stash',
    settings: 'Settings · Stash',
    help: 'Help & Support · Stash',
    'print-portal': 'Cafe Print · Stash'
  })[route] || 'Stash';
}

/* =========================================================
   AUTH
   ========================================================= */
const Auth = {
  async login(identifier, password, remember) {
    const user = await DB.findUserByIdentifier(identifier);
    if (!user || user.password !== password) {
      return { ok: false, error: 'That matric number/email and password don\u2019t match.' };
    }
    DB.setSession(user.id, remember);
    return { ok: true, user };
  },

  async loginWithGoogle() {
    const identifier = 'google.demo@school.edu';
    let user = await DB.findUserByIdentifier(identifier);
    if (!user) {
      user = await DB.createUser({ name: 'Google Student', matric: 'GOOGLE-DEMO', email: identifier, password: '__google__', level: '100L' });
    }
    DB.setSession(user.id, true);
    return user;
  },

  async signup({ name, matric, email, password, level }) {
    const existing = (await DB.findUserByIdentifier(matric)) || (await DB.findUserByIdentifier(email));
    if (existing) return { ok: false, error: 'An account with that matric number or email already exists.' };
    const user = await DB.createUser({ name, matric, email, password, level });
    DB.setSession(user.id, true);
    return { ok: true, user };
  },

  logout() { DB.clearSession(); window.location.hash = '#login'; },

  async currentUser() {
    const session = DB.getSession();
    if (!session) return null;
    const users = await DB.getUsers();
    return users[session.userId] || null;
  }
};

/* =========================================================
   VIEWS
   ========================================================= */
const Views = {
  populateSelect(select, values, { withEmpty = false, emptyLabel = 'All' } = {}) {
    if (!select) return;
    select.innerHTML = (withEmpty ? `<option value="">${emptyLabel}</option>` : '') +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
  },

  populateStaticSelects() {
    const levels = CONFIG.levels;
    const semesters = CONFIG.semesters;
    const categories = CONFIG.categories.map(c => c.id);

    this.populateSelect(document.getElementById('suLevel'), levels);
    this.populateSelect(document.getElementById('editLevel'), levels);
    this.populateSelect(document.getElementById('editSemester'), semesters);
    this.populateSelect(document.getElementById('editCategory'), categories);
    this.populateSelect(document.getElementById('editReferenceType'), CONFIG.referenceTypes || ['Reference']);
    this.populateSelect(document.getElementById('pLevel'), levels);

    this.populateSelect(document.getElementById('fLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('fSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
    this.populateSelect(document.getElementById('fCategory'), categories, { withEmpty: true, emptyLabel: 'All categories' });
    this.populateSelect(document.getElementById('ceLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('ceSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
  },

  categoryMeta(id) { return CONFIG.categories.find(c => c.id === id) || CONFIG.categories[0]; },

  async storageStats(userId) {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(userId);
    const limits = Plans.limits(user);
    const usedBytes = docs.reduce((sum, d) => sum + (d.size || 0), 0);
    const usedMB = Math.round((usedBytes / (1024 * 1024)) * 10) / 10;
    const quotaMB = limits.maxStorageMB;
    const pct = quotaMB ? Math.min(100, Math.round((usedMB / quotaMB) * 100)) : 0;
    return {
      docs, usedBytes, usedMB, quotaMB, pct,
      docCount: docs.length,
      maxDocuments: limits.maxDocuments,
      remainingMB: quotaMB ? Math.max(0, Math.round((quotaMB - usedMB) * 10) / 10) : Infinity,
      remainingDocs: limits.maxDocuments ? Math.max(0, limits.maxDocuments - docs.length) : Infinity
    };
  },

  async docCardHTML(d, { selectable = true } = {}) {
    const cat = this.categoryMeta(d.category);
    const amount = d.amount ? `\u20a6${Number(d.amount).toLocaleString()}` : '\u2014';
    let thumb;
    if (d.hasFile && (d.fileType || '').startsWith('image/')) {
      const url = await FileStore.getObjectURL(d.id).catch(() => null);
      thumb = url
        ? `<div class="doc-thumb" style="background-image:url('${url}')"></div>`
        : `<div class="doc-badge badge-${cat.color}">${cat.badge}</div>`;
    } else {
      thumb = `<div class="doc-badge badge-${cat.color}">${cat.badge}</div>`;
    }
    const checkbox = selectable
      ? `<label class="doc-check" onclick="event.stopPropagation()"><input type="checkbox" class="doc-check-input" value="${d.id}"></label>`
      : '';
    return `
      <div class="doc-card" data-id="${d.id}">
        ${checkbox}
        ${thumb}
        <div class="doc-info">
          <p class="doc-name">${escapeHTML(d.name)}</p>
          <p class="doc-meta">${cat.label}${d.course ? ' &middot; ' + escapeHTML(d.course) : ''} &middot; ${d.level} &middot; ${d.semester} sem${d.size ? ' &middot; ' + formatFileSize(d.size) : ''}</p>
        </div>
        <div class="doc-amount">${amount}</div>
        <div class="doc-date">${d.date || (d.uploadedAt ? d.uploadedAt.slice(0, 10) : '\u2014')}</div>
      </div>`;
  },

  async docListHTML(docs, opts = {}) {
    const cards = await Promise.all(docs.map(d => this.docCardHTML(d, opts)));
    return cards.join('');
  },

  async renderDashboard() {
    const user = await Auth.currentUser();
    if (!user) return;
    const profile = await DB.getProfile(user.id);
    document.getElementById('greeting').textContent = `Good to see you, ${(profile.name || 'there').split(' ')[0]}`;

    const { docs, pct, usedMB, quotaMB, docCount, maxDocuments } = await this.storageStats(user.id);
    setRing(pct);
    document.getElementById('ringSubLabel').textContent = `of ${quotaMB >= 1024 ? (quotaMB / 1024).toFixed(1) + ' GB' : quotaMB + ' MB'}`;

    document.getElementById('statTotal').textContent = maxDocuments ? `${docCount}/${maxDocuments}` : docCount;
    const thisMonth = docs.filter(d => (d.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
    document.getElementById('statMonth').textContent = thisMonth;
    document.getElementById('statFlagged').textContent = 0;

    const legend = document.getElementById('ringLegend');
    legend.innerHTML = CONFIG.categories.map(c => {
      const count = docs.filter(d => d.category === c.id).length;
      return `<div><i class="dot dot-${c.color}"></i>${c.label}s <span>${count}</span></div>`;
    }).join('');

    document.getElementById('recentList').innerHTML = docs.length
      ? await this.docListHTML(docs.slice(0, 5), { selectable: false })
      : '<p class="muted">No documents yet \u2014 head to Scan &amp; Upload to add your first one.</p>';

    document.getElementById('sidebarStorageFill').style.width = pct + '%';
    document.getElementById('sidebarStorageText').textContent = quotaMB >= 1024
      ? `${pct}% of ${(quotaMB / 1024).toFixed(1)}GB used`
      : `${pct}% of ${quotaMB}MB used`;

    this.bindDocCardClicks(document.getElementById('recentList'));
  },

  async renderDocuments() {
    Vault.resetSelection();
    await this.filterDocuments();
  },

  async filterDocuments() {
    const user = await Auth.currentUser();
    if (!user) return;
    const docs = await DB.getDocuments(user.id);

    const q = (document.getElementById('globalSearch').value || '').trim().toLowerCase();
    const level = document.getElementById('fLevel').value;
    const sem = document.getElementById('fSemester').value;
    const cat = document.getElementById('fCategory').value;
    const sort = document.getElementById('docSort') ? document.getElementById('docSort').value : 'newest';

    let list = docs.filter(d => {
      if (level && d.level !== level) return false;
      if (sem && d.semester !== sem) return false;
      if (cat && d.category !== cat) return false;
      if (!q) return true;
      const catLabel = this.categoryMeta(d.category).label;
      const haystack = [
        d.name, d.course, d.category, catLabel, d.referenceNumber, d.referenceType,
        d.amount ? String(d.amount) : '', d.date, d.uploadedAt ? d.uploadedAt.slice(0, 10) : '',
        d.level, d.semester, d.ocrText
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });

    const sorters = {
      newest: (a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''),
      oldest: (a, b) => (a.uploadedAt || '').localeCompare(b.uploadedAt || ''),
      name: (a, b) => a.name.localeCompare(b.name),
      amount: (a, b) => (b.amount || 0) - (a.amount || 0)
    };
    list = list.slice().sort(sorters[sort] || sorters.newest);

    const container = document.getElementById('docList');
    const empty = document.getElementById('docEmpty');
    const emptyTitle = document.getElementById('emptyStateTitle');
    const bulkBar = document.getElementById('bulkBar');

    if (!docs.length) {
      container.innerHTML = '';
      if (bulkBar) bulkBar.classList.add('hidden');
      emptyTitle.textContent = 'Your Stash Vault is empty';
      empty.querySelector('p').textContent = 'Click below to upload your first document.';
      empty.classList.remove('hidden');
      return;
    }
    if (!list.length) {
      container.innerHTML = '';
      if (bulkBar) bulkBar.classList.add('hidden');
      emptyTitle.textContent = 'Nothing matches those filters';
      empty.querySelector('p').textContent = 'Try clearing a filter or search term.';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = await this.docListHTML(list, { selectable: true });
    this.bindDocCardClicks(container);
    Vault.bindCheckboxes(container);
  },

  async renderUploadCapacity() {
    const user = await Auth.currentUser();
    if (!user) return;
    const { pct, remainingMB, remainingDocs, maxDocuments, quotaMB } = await this.storageStats(user.id);

    const line = document.getElementById('uploadCapacityLine');
    if (line) {
      const storagePart = remainingMB === Infinity ? 'Unlimited storage' : `${remainingMB}MB of ${quotaMB >= 1024 ? (quotaMB / 1024).toFixed(1) + 'GB' : quotaMB + 'MB'} left`;
      const docsPart = remainingDocs === Infinity ? 'unlimited documents' : `${remainingDocs} document${remainingDocs === 1 ? '' : 's'} left on your plan`;
      line.textContent = `${storagePart} \u00b7 ${docsPart}`;
    }

    const warning = document.getElementById('uploadStorageWarning');
    if (warning) {
      const atDocLimit = maxDocuments && remainingDocs <= 0;
      const atStorageLimit = remainingMB !== Infinity && remainingMB <= 0;
      if (atDocLimit || atStorageLimit) {
        warning.textContent = atDocLimit
          ? `You've reached your ${maxDocuments}-document limit. Delete something or upgrade to Pro to add more.`
          : 'Your vault is full. Delete something or upgrade to Pro to add more.';
        warning.classList.remove('hidden');
      } else if (pct >= 90) {
        warning.textContent = 'Storage is almost full — uploads may start getting rejected soon.';
        warning.classList.remove('hidden');
      } else {
        warning.classList.add('hidden');
      }
    }
  },

  bindDocCardClicks(root) {
    root.querySelectorAll('.doc-card').forEach(card => {
      card.addEventListener('click', () => Documents.openPreview(card.dataset.id));
    });
  },

  async renderClearance() {
    const level = document.getElementById('ceLevel').value;
    const sem = document.getElementById('ceSemester').value;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const list = docs.filter(d => d.category === 'Receipt' && (!level || d.level === level) && (!sem || d.semester === sem));

    document.getElementById('clearanceList').innerHTML = list.length ? list.map(d => `
      <label class="check-row">
        <input type="checkbox" class="ce-check" value="${d.id}">
        <div class="doc-info"><p class="doc-name">${d.name}</p><p class="doc-meta">${d.level} &middot; ${d.semester} sem${d.course ? ' &middot; ' + d.course : ''}</p></div>
        <div class="doc-amount">\u20a6${Number(d.amount || 0).toLocaleString()}</div>
      </label>`).join('') : '<p class="muted">No receipts match this filter.</p>';

    document.querySelectorAll('#clearanceList .ce-check').forEach(cb => cb.addEventListener('change', () => this.updateCeCount()));
    this.updateCeCount();
  },

  updateCeCount() {
    const n = document.querySelectorAll('#clearanceList .ce-check:checked').length;
    const el = document.getElementById('ceCount');
    if (el) el.textContent = `${n} selected`;
  },

  async populateCafeSelect() {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const sel = document.getElementById('cafeDocSelect');
    sel.innerHTML = docs.length
      ? docs.map(d => `<option value="${d.id}">${d.name}</option>`).join('')
      : '<option value="">No documents yet</option>';
  },

  async renderProfile() {
    const user = await Auth.currentUser();
    if (!user) return;
    const profile = await DB.getProfile(user.id);

    document.getElementById('pName').value = profile.name || '';
    document.getElementById('pMatric').value = profile.matric || '';
    document.getElementById('pLevel').value = profile.level || '100L';
    document.getElementById('pDepartment').value = profile.department || '';
    document.getElementById('pEmail').value = profile.email || '';

    this.setAvatarDisplay(profile);

    const { pct, usedMB, quotaMB, docCount, maxDocuments } = await this.storageStats(user.id);
    document.getElementById('profileStorageFill').style.width = pct + '%';
    document.getElementById('storageDetailText').textContent = quotaMB >= 1024
      ? `${pct}% used \u00b7 ${usedMB}MB of ${(quotaMB / 1024).toFixed(1)}GB \u00b7 ${docCount}${maxDocuments ? '/' + maxDocuments : ''} documents`
      : `${pct}% used \u00b7 ${usedMB}MB of ${quotaMB}MB \u00b7 ${docCount}${maxDocuments ? '/' + maxDocuments : ''} documents`;
    const warning = document.getElementById('storageWarning');
    if (warning) {
      if (pct >= 90) {
        warning.classList.remove('hidden');
        warning.textContent = pct >= 100
          ? 'Your vault is full. Delete documents or upgrade to Pro to add more.'
          : 'Storage is almost full. Consider deleting old documents or upgrading to Pro.';
      } else {
        warning.classList.add('hidden');
      }
    }
  },

  setAvatarDisplay(profile) {
    const initial = (profile.name || 'S').trim()[0]?.toUpperCase() || 'S';
    [document.getElementById('profileAvatar'), document.getElementById('topAvatar')].forEach(el => {
      if (!el) return;
      if (profile.avatar) {
        el.style.backgroundImage = `url(${profile.avatar})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = '';
        el.textContent = initial;
      }
    });
  },

  async renderSettings() {
    const user = await Auth.currentUser();
    if (!user) return;
    const settings = await DB.getSettings(user.id);
    document.getElementById('offlineToggle').checked = !!settings.offlineAccess;
    document.getElementById('ocrToggle').checked = !!settings.ocrAutofill;
    const theme = localStorage.getItem('stash_theme') || 'dark';
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  },

  renderHelp() {
    const html = (CONFIG.faqs || []).map((f, i) => `
      <div class="faq-item" data-i="${i}">
        <button type="button" class="faq-q">${f.q} <i data-ic="chevron"></i></button>
        <div class="faq-a">${f.a}</div>
      </div>`).join('');
    document.getElementById('appFaqList').innerHTML = html;
    this.bindFaqToggles(document.getElementById('appFaqList'));
    renderIcons(document.getElementById('appFaqList'));
  },

  renderPricing() {
    const grid = document.getElementById('pricingGrid');
    grid.innerHTML = (CONFIG.pricingPlans || []).map(p => `
      <div class="pricing-card ${p.highlighted ? 'highlighted' : ''}">
        ${p.highlighted ? '<span class="pricing-badge">Most popular</span>' : ''}
        <h3>${p.name}</h3>
        <div class="pricing-price">${p.price}<span>${p.period}</span></div>
        <p class="pricing-storage">${p.storage}</p>
        <ul class="pricing-features">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
        <a class="btn ${p.highlighted ? 'btn-primary' : 'btn-secondary'} btn-block" href="#signup">${p.cta}</a>
      </div>`).join('');

    document.getElementById('landingFaqList').innerHTML = (CONFIG.faqs || []).map((f, i) => `
      <div class="faq-item" data-i="${i}">
        <button type="button" class="faq-q">${f.q} <i data-ic="chevron"></i></button>
        <div class="faq-a">${f.a}</div>
      </div>`).join('');
    this.bindFaqToggles(document.getElementById('landingFaqList'));
    renderIcons(document.getElementById('view-pricing'));
  },

  bindFaqToggles(root) {
    root.querySelectorAll('.faq-q').forEach(btn => {
      btn.addEventListener('click', () => btn.parentElement.classList.toggle('open'));
    });
  }
};

function extensionFor(mime) {
  const map = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' };
  return map[mime] || '';
}
function downloadFilename(doc) {
  const ext = extensionFor(doc.fileType);
  const base = (doc.name || 'document').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document';
  return ext ? `${base}.${ext}` : base;
}
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* =========================================================
   VAULT — multi-select + bulk actions on the Documents view
   ========================================================= */
const Vault = {
  selected: new Set(),

  resetSelection() {
    this.selected.clear();
    this.updateBar();
  },

  bindCheckboxes(root) {
    root.querySelectorAll('.doc-check-input').forEach(cb => {
      cb.checked = this.selected.has(cb.value);
      cb.addEventListener('change', () => {
        if (cb.checked) this.selected.add(cb.value); else this.selected.delete(cb.value);
        this.updateBar();
      });
    });
    const selectAll = document.getElementById('selectAllDocs');
    if (selectAll) selectAll.checked = false;
    this.updateBar();
  },

  updateBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    const n = this.selected.size;
    bar.classList.toggle('hidden', n === 0);
    if (n) document.getElementById('bulkCount').textContent = `${n} selected`;
  },

  selectAll(checked) {
    document.querySelectorAll('#docList .doc-check-input').forEach(cb => {
      cb.checked = checked;
      if (checked) this.selected.add(cb.value); else this.selected.delete(cb.value);
    });
    this.updateBar();
  },

  async bulkDelete() {
    const user = await Auth.currentUser();
    if (!user || !this.selected.size) return;
    const ids = [...this.selected];
    if (!confirm(`Delete ${ids.length} document${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;

    let docs = await DB.getDocuments(user.id);
    docs = docs.filter(d => !ids.includes(d.id));
    try {
      await DB.saveDocuments(user.id, docs);
    } catch (e) {
      UI.toast(e.message || 'Could not delete — please try again');
      return;
    }
    await Promise.all(ids.map(id => FileStore.delete(id).catch(() => {})));
    this.resetSelection();
    UI.toast(`${ids.length} document${ids.length === 1 ? '' : 's'} deleted`);
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
  },

  async bulkDownload() {
    const user = await Auth.currentUser();
    if (!user || !this.selected.size) return;
    const docs = await DB.getDocuments(user.id);
    let count = 0;
    for (const id of this.selected) {
      const doc = docs.find(d => d.id === id);
      if (!doc || !doc.hasFile) continue;
      const url = await FileStore.getObjectURL(id).catch(() => null);
      if (!url) continue;
      triggerDownload(url, downloadFilename(doc));
      count++;
    }
    UI.toast(count ? `Downloading ${count} file${count === 1 ? '' : 's'}` : 'Nothing downloadable in this selection');
  }
};

/* =========================================================
   DOCUMENT PREVIEW / EDIT MODAL
   ========================================================= */
const DocModal = {
  currentId: null,

  async open(id) {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    this.currentId = id;

    const pane = document.getElementById('docPreviewPane');
    pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Loading preview\u2026</p></div>`;
    renderIcons(pane);

    if (doc.hasFile) {
      const url = await FileStore.getObjectURL(id).catch(() => null);
      if (url && (doc.fileType || '').startsWith('image/')) {
        pane.innerHTML = `<img src="${url}" alt="${escapeHTML(doc.name)}">`;
      } else if (url && doc.fileType === 'application/pdf') {
        pane.innerHTML = `<embed src="${url}" type="application/pdf">`;
      } else {
        pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>No preview available for this file type.</p></div>`;
      }
    } else {
      pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Original file isn't available on this device.</p></div>`;
    }
    renderIcons(pane);

    document.getElementById('editName').value = doc.name || '';
    document.getElementById('editReferenceType').value = doc.referenceType || 'RRR';
    document.getElementById('editReferenceNumber').value = doc.referenceNumber || '';
    document.getElementById('editAmount').value = doc.amount || '';
    document.getElementById('editDate').value = doc.date || '';
    document.getElementById('editCategory').value = doc.category || 'Receipt';
    document.getElementById('editLevel').value = doc.level || '100L';
    document.getElementById('editSemester').value = doc.semester || 'First';
    document.getElementById('editCourse').value = doc.course || '';

    const metaLine = document.getElementById('docModalMeta');
    if (metaLine) {
      const uploaded = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '\u2014';
      const modified = doc.modifiedAt ? new Date(doc.modifiedAt).toLocaleDateString() : uploaded;
      metaLine.textContent = `${doc.size ? formatFileSize(doc.size) : 'Unknown size'} \u00b7 Uploaded ${uploaded} \u00b7 Modified ${modified}`;
    }

    const downloadBtn = document.getElementById('downloadDocBtn');
    if (downloadBtn) downloadBtn.classList.toggle('hidden', !doc.hasFile);

    const ocrBox = document.getElementById('ocrTextBox');
    if (doc.ocrStatus === 'done' && doc.ocrText) {
      ocrBox.classList.remove('hidden');
      document.getElementById('ocrTextContent').textContent = doc.ocrText;
      document.getElementById('ocrStatusLabel').textContent = 'Text detected on scan';
    } else if (doc.ocrStatus === 'failed') {
      ocrBox.classList.remove('hidden');
      document.getElementById('ocrTextContent').textContent = 'Scan didn\u2019t return readable text. You can fill in the fields above manually.';
      document.getElementById('ocrStatusLabel').textContent = 'Scan unavailable';
    } else {
      ocrBox.classList.add('hidden');
    }

    UI.openModal('docModal');
  },

  close() { UI.closeModal('docModal'); this.currentId = null; },

  async save(e) {
    e.preventDefault();
    if (!this.currentId) return;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const idx = docs.findIndex(d => d.id === this.currentId);
    if (idx === -1) return;

    docs[idx] = {
      ...docs[idx],
      name: document.getElementById('editName').value.trim() || 'Untitled document',
      referenceType: document.getElementById('editReferenceType').value,
      referenceNumber: document.getElementById('editReferenceNumber').value.trim(),
      amount: Number(document.getElementById('editAmount').value) || 0,
      date: document.getElementById('editDate').value,
      category: document.getElementById('editCategory').value,
      level: document.getElementById('editLevel').value,
      semester: document.getElementById('editSemester').value,
      course: document.getElementById('editCourse').value.trim(),
      modifiedAt: new Date().toISOString()
    };

    try {
      await DB.saveDocuments(user.id, docs);
    } catch (err) {
      UI.toast(err.message || 'Could not save changes');
      return;
    }
    this.close();
    UI.toast('Document updated');
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
  },

  async delete() {
    if (!this.currentId) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const id = this.currentId;
    const user = await Auth.currentUser();
    let docs = await DB.getDocuments(user.id);
    docs = docs.filter(d => d.id !== id);
    try {
      await DB.saveDocuments(user.id, docs);
    } catch (err) {
      UI.toast(err.message || 'Could not delete document');
      return;
    }
    await FileStore.delete(id).catch(() => {});
    this.close();
    UI.toast('Document deleted');
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
  },

  async download() {
    if (!this.currentId) return;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === this.currentId);
    if (!doc || !doc.hasFile) { UI.toast('Original file isn\u2019t available on this device'); return; }
    const url = await FileStore.getObjectURL(doc.id).catch(() => null);
    if (!url) { UI.toast('Could not load the file'); return; }
    triggerDownload(url, downloadFilename(doc));
  },

  async print() {
    if (!this.currentId) return;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === this.currentId);
    if (!doc) return;
    await Documents.renderPrintArea(doc);
    window.print();
  }
};

/* =========================================================
   DOCUMENTS: multi-file upload w/ OCR, clearance, cafe PIN
   ========================================================= */
const Documents = {
  init() {
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('fileInput');

    document.getElementById('chooseFileBtn').addEventListener('click', () => input.click());
    dz.addEventListener('click', e => { if (!e.target.closest('button')) input.click(); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) this.handleFiles(e.dataTransfer.files); });
    input.addEventListener('change', e => { if (e.target.files.length) this.handleFiles(e.target.files); input.value = ''; });

    document.getElementById('compileBtn').addEventListener('click', () => this.compileClearance());

    ['fLevel', 'fSemester', 'fCategory', 'globalSearch', 'docSort'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => Views.filterDocuments());
    });
    ['ceLevel', 'ceSemester'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => Views.renderClearance());
    });

    const selectAll = document.getElementById('selectAllDocs');
    if (selectAll) selectAll.addEventListener('change', () => Vault.selectAll(selectAll.checked));
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', () => Vault.bulkDelete());
    const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');
    if (bulkDownloadBtn) bulkDownloadBtn.addEventListener('click', () => Vault.bulkDownload());
    const bulkClearBtn = document.getElementById('bulkClearBtn');
    if (bulkClearBtn) bulkClearBtn.addEventListener('click', () => { Vault.resetSelection(); Views.filterDocuments(); });

    document.getElementById('generatePinBtn').addEventListener('click', () => this.generatePinForSelected());
    document.getElementById('copyPinLinkBtn').addEventListener('click', () => this.copyPinLink());
  },

  async handleFiles(fileList) {
    const user = await Auth.currentUser();
    if (!user) return;
    const files = Array.from(fileList);
    const settings = await DB.getSettings(user.id);
    const profile = await DB.getProfile(user.id);
    const limits = Plans.limits(user);
    const maxFileBytes = (CONFIG.upload.maxFileSizeMB || 10) * 1024 * 1024;
    const quotaBytes = limits.maxStorageMB ? limits.maxStorageMB * 1024 * 1024 : Infinity;

    const queuePanel = document.getElementById('uploadQueue');
    const queueList = document.getElementById('uploadQueueList');
    queuePanel.classList.remove('hidden');
    queueList.innerHTML = files.map((f, i) =>
      `<div class="queue-item" id="queueItem${i}"><span>${escapeHTML(f.name)}</span><span class="queue-status">Waiting\u2026</span></div>`
    ).join('');

    const docs = await DB.getDocuments(user.id);
    let usedBytes = docs.reduce((s, d) => s + (d.size || 0), 0);
    let docCount = docs.length;
    let addedCount = 0, rejectedCount = 0;
    const newIds = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const statusEl = document.querySelector(`#queueItem${i} .queue-status`);
      const setStatus = (text, cls) => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'queue-status' + (cls ? ' ' + cls : '');
      };

      const extOk = CONFIG.upload.acceptedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
      const typeOk = CONFIG.upload.acceptedTypes.includes(file.type);
      if (!typeOk && !extOk) { setStatus('Rejected — only PDF, JPG or PNG', 'status-error'); rejectedCount++; continue; }

      if (file.size > maxFileBytes) { setStatus(`Rejected — over ${CONFIG.upload.maxFileSizeMB}MB`, 'status-error'); rejectedCount++; continue; }
      if (file.size === 0) { setStatus('Rejected — file is empty', 'status-error'); rejectedCount++; continue; }

      if (limits.maxDocuments && docCount >= limits.maxDocuments) {
        setStatus(`Rejected — ${limits.maxDocuments}-document limit reached`, 'status-error'); rejectedCount++; continue;
      }
      if (usedBytes + file.size > quotaBytes) {
        setStatus('Rejected — not enough storage left', 'status-error'); rejectedCount++; continue;
      }

      const id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      setStatus('Saving\u2026');
      try {
        await FileStore.put(id, file);
      } catch (e) {
        setStatus('Rejected — could not save file', 'status-error'); rejectedCount++; continue;
      }

      const isImage = file.type.startsWith('image/');
      let ocrText = '', referenceNumber = '', amount = '', date = '', ocrStatus = 'skipped';
      if (isImage && settings.ocrAutofill && typeof Tesseract !== 'undefined') {
        setStatus('Scanning\u2026');
        try {
          const { data } = await Tesseract.recognize(file, 'eng');
          ocrText = (data.text || '').trim();
          ocrStatus = ocrText ? 'done' : 'failed';
          const refMatch = ocrText.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{3,4})\b/);
          const amountMatch = ocrText.match(/(?:\u20a6|N|NGN)\s?([\d,]{3,12})/i);
          const dateMatch = ocrText.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
          if (refMatch) referenceNumber = refMatch[1];
          if (amountMatch) amount = amountMatch[1].replace(/,/g, '');
          if (dateMatch) date = this.normalizeDate(dateMatch[1]);
        } catch (e) { ocrStatus = 'failed'; }
      }

      const now = new Date().toISOString();
      docs.unshift({
        id,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'Receipt',
        level: profile.level || CONFIG.levels[0],
        semester: CONFIG.semesters[0],
        course: '',
        referenceType: 'RRR',
        referenceNumber,
        amount: Number(amount) || 0,
        date,
        size: file.size,
        fileType: file.type,
        uploadedAt: now,
        modifiedAt: now,
        hasFile: true,
        ocrText,
        ocrStatus
      });
      newIds.push(id);
      usedBytes += file.size;
      docCount++;
      addedCount++;
      setStatus('Saved', 'status-ok');
    }

    let saveFailed = false;
    if (addedCount) {
      try {
        await DB.saveDocuments(user.id, docs);
      } catch (e) {
        saveFailed = true;
        await Promise.all(newIds.map(id => FileStore.delete(id).catch(() => {})));
        UI.toast(e.message || 'Could not save — local storage may be full. Nothing was added.');
      }
    }

    if (!saveFailed) {
      if (addedCount && rejectedCount) UI.toast(`${addedCount} file${addedCount === 1 ? '' : 's'} added, ${rejectedCount} rejected — see details below`);
      else if (addedCount) UI.toast(`${addedCount} file${addedCount === 1 ? '' : 's'} added to your vault`);
      else if (rejectedCount) UI.toast(`No files added — ${rejectedCount} rejected. See details below.`);
    }

    const keepQueueVisible = rejectedCount > 0 || saveFailed;
    if (!keepQueueVisible) {
      setTimeout(() => { queuePanel.classList.add('hidden'); queueList.innerHTML = ''; }, 900);
    }
    if (addedCount && !saveFailed) window.location.hash = '#documents';
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
    if (currentRoute() === 'upload') await Views.renderUploadCapacity();
  },

  normalizeDate(str) {
    const parts = str.split(/[\/\-.]/);
    if (parts.length !== 3) return '';
    let [a, b, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  },

  openPreview(id) { DocModal.open(id); },

  async renderPrintArea(doc) {
    const cat = Views.categoryMeta(doc.category);
    let imgHTML = '';
    if (doc.hasFile && (doc.fileType || '').startsWith('image/')) {
      const url = await FileStore.getObjectURL(doc.id).catch(() => null);
      if (url) imgHTML = `<img src="${url}" style="max-width:100%;margin-top:12px;">`;
    }
    document.getElementById('printArea').innerHTML = `
      <h1>${escapeHTML(doc.name)}</h1>
      <p>${cat.label} &middot; ${doc.level} &middot; ${doc.semester} semester${doc.course ? ' &middot; ' + escapeHTML(doc.course) : ''}</p>
      <p>${escapeHTML(doc.referenceType || 'Reference')}: ${escapeHTML(doc.referenceNumber) || '\u2014'}</p>
      <p>Amount: ${doc.amount ? '\u20a6' + Number(doc.amount).toLocaleString() : '\u2014'}</p>
      <p>Date: ${doc.date || '\u2014'}</p>
      ${imgHTML}`;
  },

  async generatePinForSelected() {
    const user = await Auth.currentUser();
    const docId = document.getElementById('cafeDocSelect').value;
    if (!docId) { UI.toast('Choose a document first'); return; }
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;

    const { pin } = await DB.createPin(user.id, doc);
    document.getElementById('pinResult').classList.remove('hidden');
    document.getElementById('pinDisplay').textContent = pin.split('').join(' ');
    document.getElementById('pinLink').value = `stash.app/p/${pin}`;
    UI.toast(`PIN ready for ${doc.name}`);

    let seconds = CONFIG.app.cafePinExpiryMinutes * 60;
    const timerEl = document.getElementById('pinTimer');
    clearInterval(this._timerHandle);
    this._timerHandle = setInterval(() => {
      seconds--;
      const m = String(Math.floor(seconds / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
      if (seconds <= 0) { clearInterval(this._timerHandle); document.getElementById('pinResult').classList.add('hidden'); }
    }, 1000);
  },

  copyPinLink() {
    const input = document.getElementById('pinLink');
    input.select();
    navigator.clipboard?.writeText(input.value).then(() => UI.toast('Link copied')).catch(() => UI.toast('Copy manually \u2014 clipboard blocked'));
  },

  async compileClearance() {
    const checks = [...document.querySelectorAll('#clearanceList .ce-check:checked')].map(c => c.value);
    if (!checks.length) { UI.toast('Select at least one document first'); return; }

    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const selected = docs.filter(d => checks.includes(d.id));

    if (typeof window.jspdf === 'undefined') { UI.toast('PDF engine unavailable offline'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text('Clearance Packet', 14, 18);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toLocaleDateString()} \u00b7 ${selected.length} document(s)`, 14, 25);

    let y = 38;
    selected.forEach((d, i) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      pdf.setFontSize(12);
      pdf.text(`${i + 1}. ${d.name}`, 14, y);
      pdf.setFontSize(9);
      pdf.text(`${d.level} \u00b7 ${d.semester} semester${d.course ? ' \u00b7 ' + d.course : ''}`, 14, y + 6);
      pdf.text(`${d.referenceType || 'Reference'}: ${d.referenceNumber || '\u2014'}    Amount: ${d.amount ? '\u20a6' + d.amount.toLocaleString() : '\u2014'}    Date: ${d.date || '\u2014'}`, 14, y + 12);
      y += 22;
    });

    pdf.save('clearance-packet.pdf');
    UI.toast('Clearance packet downloaded');
  }
};

/* =========================================================
   CAFE PRINT PORTAL (public)
   ========================================================= */
const CafePrint = {
  init() {
    document.getElementById('cafePinForm').addEventListener('submit', e => this.openPin(e));
    document.getElementById('cafePrintBtn').addEventListener('click', () => window.print());
  },
  async openPin(e) {
    e.preventDefault();
    const pin = document.getElementById('cafePinInput').value.trim();
    const entry = await DB.consumePin(pin);
    if (!entry) { UI.showFieldError('cafePinError'); document.getElementById('cafeResult').classList.add('hidden'); return; }
    UI.hideFieldError('cafePinError');
    const doc = entry.doc;
    const cat = Views.categoryMeta(doc.category);
    document.getElementById('cafeDocPreview').innerHTML = `
      <h3>${escapeHTML(doc.name)}</h3>
      <p>${cat.label} &middot; ${doc.level} &middot; ${doc.semester} semester${doc.course ? ' &middot; ' + escapeHTML(doc.course) : ''}</p>
      <p>${escapeHTML(doc.referenceType || 'Reference')}: ${escapeHTML(doc.referenceNumber) || '\u2014'}</p>
      <p>Amount: ${doc.amount ? '\u20a6' + Number(doc.amount).toLocaleString() : '\u2014'}</p>`;
    await Documents.renderPrintArea(doc);
    document.getElementById('cafeResult').classList.remove('hidden');
  }
};

/* =========================================================
   RING ANIMATION
   ========================================================= */
function setRing(pct) {
  const circumference = 2 * Math.PI * 50;
  const ring = document.getElementById('storageRing');
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct / 100);
  document.getElementById('ringPct').textContent = pct + '%';
}

/* =========================================================
   WIRE UP
   ========================================================= */
function initPasswordToggles(root = document) {
  root.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const isPw = input.type === 'password';
      input.type = isPw ? 'text' : 'password';
      btn.innerHTML = '';
      const icon = document.createElement('i');
      icon.setAttribute('data-ic', isPw ? 'eyeOff' : 'eye');
      btn.appendChild(icon);
      renderIcons(btn.parentElement);
    });
  });
}

function initAuthForms() {
  document.getElementById('googleLoginBtn').addEventListener('click', async () => {
    await Auth.loginWithGoogle();
    window.location.hash = '#dashboard';
    UI.toast('Signed in with a demo Google account');
  });
  document.getElementById('googleSignupBtn').addEventListener('click', async () => {
    await Auth.loginWithGoogle();
    window.location.hash = '#dashboard';
    UI.toast('Signed in with a demo Google account');
  });

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    UI.hideFieldError('loginError');
    const identifier = document.getElementById('loginId').value.trim();
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('rememberMe').checked;
    const result = await Auth.login(identifier, password, remember);
    if (!result.ok) { UI.showFieldError('loginError', result.error); return; }
    window.location.hash = '#dashboard';
    UI.toast('Welcome back!');
  });

  document.getElementById('signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    UI.hideFieldError('signupError');
    const password = document.getElementById('suPassword').value;
    const confirmPw = document.getElementById('suConfirmPassword').value;
    const email = document.getElementById('suEmail').value.trim();

    if (!isValidEmail(email)) { UI.showFieldError('signupError', 'Enter a valid email address.'); return; }
    if (password.length < 6) { UI.showFieldError('signupError', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPw) { UI.showFieldError('signupError', "Passwords don't match."); return; }

    const result = await Auth.signup({
      name: document.getElementById('suName').value.trim() || 'Student',
      matric: document.getElementById('suMatric').value.trim(),
      email,
      password,
      level: document.getElementById('suLevel').value
    });
    if (!result.ok) { UI.showFieldError('signupError', result.error); return; }
    window.location.hash = '#dashboard';
    UI.toast('Welcome to Stash!');
  });

  document.getElementById('openForgotModal').addEventListener('click', () => UI.openModal('forgotModal'));
  document.getElementById('closeForgotModal').addEventListener('click', () => UI.closeModal('forgotModal'));
  document.getElementById('forgotModal').addEventListener('click', e => { if (e.target.id === 'forgotModal') UI.closeModal('forgotModal'); });
  document.getElementById('forgotForm').addEventListener('submit', e => {
    e.preventDefault();
    document.getElementById('forgotConfirmation').classList.remove('hidden');
    e.target.reset();
  });
}

function initDocModal() {
  document.getElementById('closeDocModal').addEventListener('click', () => DocModal.close());
  document.getElementById('docModal').addEventListener('click', e => { if (e.target.id === 'docModal') DocModal.close(); });
  document.getElementById('docEditForm').addEventListener('submit', e => DocModal.save(e));
  document.getElementById('deleteDocBtn').addEventListener('click', () => DocModal.delete());
  document.getElementById('printDocBtn').addEventListener('click', () => DocModal.print());
  document.getElementById('downloadDocBtn').addEventListener('click', () => DocModal.download());
}

function initAppShellChrome() {
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());
  document.getElementById('openSidebarBtn').addEventListener('click', () => UI.openSidebar());
  document.getElementById('scrim').addEventListener('click', () => UI.closeSidebar());
  document.getElementById('themeToggleBtn').addEventListener('click', () => UI.toggleTheme());

  // Fix: clicking the top avatar goes to Profile.
  document.getElementById('topAvatar').addEventListener('click', () => { window.location.hash = '#profile'; });

  document.getElementById('profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const user = await Auth.currentUser();
    if (!user) return;
    const existing = await DB.getProfile(user.id);
    const profile = {
      name: document.getElementById('pName').value.trim() || 'Student',
      matric: document.getElementById('pMatric').value.trim(),
      level: document.getElementById('pLevel').value,
      department: document.getElementById('pDepartment').value.trim(),
      email: document.getElementById('pEmail').value.trim(),
      avatar: existing.avatar || null
    };

    if (profile.email && !isValidEmail(profile.email)) {
      UI.toast('Enter a valid email address');
      return;
    }
    const conflict = await DB.findConflictingUser(profile.matric, profile.email, user.id);
    if (conflict) {
      UI.toast('That matric number or email is already used by another account');
      return;
    }

    await DB.saveProfile(user.id, profile);
    Views.setAvatarDisplay(profile);
    document.getElementById('greeting') && (document.getElementById('greeting').textContent = `Good to see you, ${profile.name.split(' ')[0]}`);
    UI.toast('Profile updated');
  });

  document.getElementById('avatarInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const user = await Auth.currentUser();
    if (!user) return;
    const dataUrl = await fileToDataURL(file);
    const profile = await DB.getProfile(user.id);
    profile.avatar = dataUrl;
    await DB.saveProfile(user.id, profile);
    Views.setAvatarDisplay(profile);
    UI.toast('Photo updated');
  });

  document.getElementById('segDark').addEventListener('click', () => UI.setTheme('dark'));
  document.getElementById('segLight').addEventListener('click', () => UI.setTheme('light'));

  document.getElementById('offlineToggle').addEventListener('change', async e => {
    const user = await Auth.currentUser();
    if (!user) return;
    const settings = await DB.getSettings(user.id);
    settings.offlineAccess = e.target.checked;
    await DB.saveSettings(user.id, settings);
  });
  document.getElementById('ocrToggle').addEventListener('change', async e => {
    const user = await Auth.currentUser();
    if (!user) return;
    const settings = await DB.getSettings(user.id);
    settings.ocrAutofill = e.target.checked;
    await DB.saveSettings(user.id, settings);
  });
  document.getElementById('clearVaultBtn').addEventListener('click', async () => {
    if (!confirm('Remove all documents stored in this session? This cannot be undone.')) return;
    const user = await Auth.currentUser();
    if (!user) return;
    await DB.saveDocuments(user.id, []);
    UI.toast('Local vault cleared');
    await Views.renderDashboard();
  });

  document.getElementById('supportForm').addEventListener('submit', e => {
    e.preventDefault();
    document.getElementById('supportMsg').value = '';
    UI.toast('Message sent \u2014 we\u2019ll reply by email');
  });
}

function initAccountSecurity() {
  document.getElementById('changePasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    UI.hideFieldError('changePasswordError');
    const user = await Auth.currentUser();
    if (!user) return;

    const current = document.getElementById('cpCurrent').value;
    const next = document.getElementById('cpNew').value;
    const confirm = document.getElementById('cpConfirm').value;

    if (current !== user.password) {
      UI.showFieldError('changePasswordError', 'Current password is incorrect.');
      return;
    }
    if (next.length < 6) {
      UI.showFieldError('changePasswordError', 'New password must be at least 6 characters.');
      return;
    }
    if (next !== confirm) {
      UI.showFieldError('changePasswordError', "New passwords don't match.");
      return;
    }

    await DB.updateUser(user.id, { password: next });
    e.target.reset();
    UI.toast('Password updated');
  });

  document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    document.getElementById('deleteAccountForm').reset();
    UI.hideFieldError('deleteAccountError');
    UI.openModal('deleteAccountModal');
  });
  document.getElementById('closeDeleteAccountModal').addEventListener('click', () => UI.closeModal('deleteAccountModal'));
  document.getElementById('deleteAccountModal').addEventListener('click', e => {
    if (e.target.id === 'deleteAccountModal') UI.closeModal('deleteAccountModal');
  });
  document.getElementById('deleteAccountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const user = await Auth.currentUser();
    if (!user) return;
    const password = document.getElementById('deleteAccountPassword').value;
    if (password !== user.password) {
      UI.showFieldError('deleteAccountError');
      return;
    }
    await DB.deleteUser(user.id);
    DB.clearSession();
    UI.closeModal('deleteAccountModal');
    UI.toast('Account deleted');
    window.location.hash = '#landing';
  });
}

/* =========================================================
   INIT
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  Views.populateStaticSelects();
  renderIcons();
  UI.initTheme();

  initPasswordToggles();
  initAuthForms();
  initDocModal();
  initAppShellChrome();
  initAccountSecurity();
  Documents.init();
  CafePrint.init();

  window.addEventListener('hashchange', router);
  await router();
});