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
      app: { name: 'Stash', tagline: 'Your school papers, sorted', storageQuotaMB: 2048, cafePinExpiryMinutes: 10 },
      categories: [
        { id: 'Receipt', label: 'Receipt', badge: 'RCT', color: 'accent' },
        { id: 'Docket', label: 'Docket', badge: 'DKT', color: 'accent-2' },
        { id: 'Admin', label: 'Admin', badge: 'ADM', color: 'accent-3' }
      ],
      levels: ['100L', '200L', '300L', '400L', '500L'],
      semesters: ['First', 'Second'],
      defaultProfile: { name: '', matric: '', email: '', department: '', level: '100L', avatar: null },
      defaultSettings: { theme: 'dark', offlineAccess: true, ocrAutofill: true },
      pricingPlans: [],
      faqs: []
    };
  }
  return CONFIG;
}

/* =========================================================
   DATA LAYER (localStorage today, Supabase-shaped for tomorrow)
   ========================================================= */
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
    const user = { id, name, matric, email, password, profile, settings, documents: [] };
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

  async getDocuments(userId) {
    const users = await this.getUsers();
    return (users[userId] && users[userId].documents) || [];
  },
  async saveDocuments(userId, docs) {
    const users = await this.getUsers();
    if (!users[userId]) return [];
    users[userId].documents = docs;
    await this.saveUsers(users);
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
    if (route === 'upload') { /* nothing to pre-render */ }
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
    this.populateSelect(document.getElementById('pLevel'), levels);

    this.populateSelect(document.getElementById('fLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('fSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
    this.populateSelect(document.getElementById('fCategory'), categories, { withEmpty: true, emptyLabel: 'All categories' });
    this.populateSelect(document.getElementById('ceLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('ceSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
  },

  categoryMeta(id) { return CONFIG.categories.find(c => c.id === id) || CONFIG.categories[0]; },

  async storageStats(userId) {
    const docs = await DB.getDocuments(userId);
    const quotaMB = CONFIG.app.storageQuotaMB;
    const usedMB = Math.min(docs.length * 4, quotaMB);
    const pct = Math.round((usedMB / quotaMB) * 100);
    return { docs, usedMB, quotaMB, pct };
  },

  docCardHTML(d) {
    const cat = this.categoryMeta(d.category);
    const amount = d.amount ? `\u20a6${Number(d.amount).toLocaleString()}` : '\u2014';
    const thumb = d.fileData && (d.fileType || '').startsWith('image/')
      ? `<div class="doc-thumb" style="background-image:url('${d.fileData}')"></div>`
      : `<div class="doc-badge badge-${cat.color}">${cat.badge}</div>`;
    return `
      <div class="doc-card" data-id="${d.id}">
        <label class="doc-check" onclick="event.stopPropagation()">
          <input type="checkbox" class="ce-check" value="${d.id}">
        </label>
        ${thumb}
        <div class="doc-info">
          <p class="doc-name">${d.name}</p>
          <p class="doc-meta">${cat.label}${d.course ? ' &middot; ' + d.course : ''} &middot; ${d.level} &middot; ${d.semester} sem</p>
        </div>
        <div class="doc-amount">${amount}</div>
        <div class="doc-date">${d.date || '\u2014'}</div>
      </div>`;
  },

  async renderDashboard() {
    const user = await Auth.currentUser();
    if (!user) return;
    const profile = await DB.getProfile(user.id);
    document.getElementById('greeting').textContent = `Good to see you, ${(profile.name || 'there').split(' ')[0]}`;

    const { docs, pct } = await this.storageStats(user.id);
    setRing(pct);

    document.getElementById('statTotal').textContent = docs.length;
    const thisMonth = docs.filter(d => (d.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
    document.getElementById('statMonth').textContent = thisMonth;
    document.getElementById('statFlagged').textContent = 0;

    const legend = document.getElementById('ringLegend');
    legend.innerHTML = CONFIG.categories.map(c => {
      const count = docs.filter(d => d.category === c.id).length;
      return `<div><i class="dot dot-${c.color}"></i>${c.label}s <span>${count}</span></div>`;
    }).join('');

    document.getElementById('recentList').innerHTML = docs.length
      ? docs.slice(0, 5).map(d => this.docCardHTML(d)).join('')
      : '<p class="muted">No documents yet \u2014 head to Scan &amp; Upload to add your first one.</p>';

    document.getElementById('sidebarStorageFill').style.width = pct + '%';
    document.getElementById('sidebarStorageText').textContent = `${pct}% of ${(CONFIG.app.storageQuotaMB / 1024).toFixed(1)}GB used`;

    this.bindDocCardClicks(document.getElementById('recentList'));
  },

  async renderDocuments() { await this.filterDocuments(); },

  async filterDocuments() {
    const user = await Auth.currentUser();
    if (!user) return;
    const docs = await DB.getDocuments(user.id);

    const q = (document.getElementById('globalSearch').value || '').toLowerCase();
    const level = document.getElementById('fLevel').value;
    const sem = document.getElementById('fSemester').value;
    const cat = document.getElementById('fCategory').value;

    const list = docs.filter(d =>
      (!level || d.level === level) &&
      (!sem || d.semester === sem) &&
      (!cat || d.category === cat) &&
      (!q || (d.name + ' ' + (d.course || '') + ' ' + d.category).toLowerCase().includes(q))
    );

    const container = document.getElementById('docList');
    const empty = document.getElementById('docEmpty');
    const emptyTitle = document.getElementById('emptyStateTitle');

    if (!docs.length) {
      container.innerHTML = '';
      emptyTitle.textContent = 'Your Stash Vault is empty';
      empty.querySelector('p').textContent = 'Click below to upload your first document.';
      empty.classList.remove('hidden');
      return;
    }
    if (!list.length) {
      container.innerHTML = '';
      emptyTitle.textContent = 'Nothing matches those filters';
      empty.querySelector('p').textContent = 'Try clearing a filter or search term.';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = list.map(d => this.docCardHTML(d)).join('');
    this.bindDocCardClicks(container);
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

    const { pct, usedMB, quotaMB } = await this.storageStats(user.id);
    document.getElementById('profileStorageFill').style.width = pct + '%';
    document.getElementById('storageDetailText').textContent = `${pct}% used \u00b7 ${usedMB}MB of ${(quotaMB / 1024).toFixed(1)}GB`;
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
    if (doc.fileData && (doc.fileType || '').startsWith('image/')) {
      pane.innerHTML = `<img src="${doc.fileData}" alt="${doc.name}">`;
    } else if (doc.fileData && doc.fileType === 'application/pdf') {
      pane.innerHTML = `<embed src="${doc.fileData}" type="application/pdf">`;
    } else {
      pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>No preview available for this file type.</p></div>`;
    }
    renderIcons(pane);

    document.getElementById('editName').value = doc.name || '';
    document.getElementById('editRRR').value = doc.rrr || '';
    document.getElementById('editAmount').value = doc.amount || '';
    document.getElementById('editDate').value = doc.date || '';
    document.getElementById('editCategory').value = doc.category || 'Receipt';
    document.getElementById('editLevel').value = doc.level || '100L';
    document.getElementById('editSemester').value = doc.semester || 'First';
    document.getElementById('editCourse').value = doc.course || '';

    const ocrBox = document.getElementById('ocrTextBox');
    if (doc.ocrText) {
      ocrBox.classList.remove('hidden');
      document.getElementById('ocrTextContent').textContent = doc.ocrText;
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
      rrr: document.getElementById('editRRR').value.trim(),
      amount: Number(document.getElementById('editAmount').value) || 0,
      date: document.getElementById('editDate').value,
      category: document.getElementById('editCategory').value,
      level: document.getElementById('editLevel').value,
      semester: document.getElementById('editSemester').value,
      course: document.getElementById('editCourse').value.trim()
    };

    await DB.saveDocuments(user.id, docs);
    this.close();
    UI.toast('Document updated');
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
  },

  async delete() {
    if (!this.currentId) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const user = await Auth.currentUser();
    let docs = await DB.getDocuments(user.id);
    docs = docs.filter(d => d.id !== this.currentId);
    await DB.saveDocuments(user.id, docs);
    this.close();
    UI.toast('Document deleted');
    await Views.filterDocuments();
    if (currentRoute() === 'dashboard') await Views.renderDashboard();
  },

  async print() {
    if (!this.currentId) return;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === this.currentId);
    if (!doc) return;
    Documents.renderPrintArea(doc);
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

    ['fLevel', 'fSemester', 'fCategory', 'globalSearch'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => Views.filterDocuments());
    });
    ['ceLevel', 'ceSemester'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => Views.renderClearance());
    });

    document.getElementById('generatePinBtn').addEventListener('click', () => this.generatePinForSelected());
    document.getElementById('copyPinLinkBtn').addEventListener('click', () => this.copyPinLink());
  },

  async handleFiles(fileList) {
    const user = await Auth.currentUser();
    if (!user) return;
    const files = Array.from(fileList);
    const settings = await DB.getSettings(user.id);
    const profile = await DB.getProfile(user.id);

    const queuePanel = document.getElementById('uploadQueue');
    const queueList = document.getElementById('uploadQueueList');
    queuePanel.classList.remove('hidden');
    queueList.innerHTML = files.map((f, i) => `<div class="queue-item" id="queueItem${i}"><span>${f.name}</span><span class="queue-status">Reading\u2026</span></div>`).join('');

    const docs = await DB.getDocuments(user.id);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const statusEl = document.querySelector(`#queueItem${i} .queue-status`);
      const isImage = file.type.startsWith('image/');
      let fileData = null;
      try { fileData = await fileToDataURL(file); } catch (e) { /* ignore */ }

      let ocrText = '', rrr = '', amount = '', date = '';
      if (isImage && settings.ocrAutofill && typeof Tesseract !== 'undefined' && fileData) {
        if (statusEl) statusEl.textContent = 'Scanning\u2026';
        try {
          const { data } = await Tesseract.recognize(fileData, 'eng');
          ocrText = (data.text || '').trim();
          const rrrMatch = ocrText.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{3,4})\b/);
          const amountMatch = ocrText.match(/(?:\u20a6|N|NGN)\s?([\d,]{3,12})/i);
          const dateMatch = ocrText.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
          if (rrrMatch) rrr = rrrMatch[1];
          if (amountMatch) amount = amountMatch[1].replace(/,/g, '');
          if (dateMatch) date = this.normalizeDate(dateMatch[1]);
        } catch (e) { /* OCR failed silently, still keep the file */ }
      }

      const doc = {
        id: 'd_' + Date.now().toString(36) + i,
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'Receipt',
        level: profile.level || '100L',
        semester: CONFIG.semesters[0],
        course: '',
        rrr, amount: Number(amount) || 0, date,
        fileData, fileType: file.type, ocrText
      };
      docs.unshift(doc);
      if (statusEl) statusEl.textContent = 'Saved';
    }

    await DB.saveDocuments(user.id, docs);
    UI.toast(`${files.length} file${files.length === 1 ? '' : 's'} added to your vault`);
    setTimeout(() => { queuePanel.classList.add('hidden'); queueList.innerHTML = ''; }, 900);
    window.location.hash = '#documents';
    await Views.filterDocuments();
  },

  normalizeDate(str) {
    const parts = str.split(/[\/\-.]/);
    if (parts.length !== 3) return '';
    let [a, b, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  },

  openPreview(id) { DocModal.open(id); },

  renderPrintArea(doc) {
    const cat = Views.categoryMeta(doc.category);
    document.getElementById('printArea').innerHTML = `
      <h1>${doc.name}</h1>
      <p>${cat.label} &middot; ${doc.level} &middot; ${doc.semester} semester${doc.course ? ' &middot; ' + doc.course : ''}</p>
      <p>RRR: ${doc.rrr || '\u2014'}</p>
      <p>Amount: ${doc.amount ? '\u20a6' + Number(doc.amount).toLocaleString() : '\u2014'}</p>
      <p>Date: ${doc.date || '\u2014'}</p>
      ${doc.fileData && (doc.fileType || '').startsWith('image/') ? `<img src="${doc.fileData}" style="max-width:100%;margin-top:12px;">` : ''}`;
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
      pdf.text(`RRR: ${d.rrr || '\u2014'}    Amount: ${d.amount ? '\u20a6' + d.amount.toLocaleString() : '\u2014'}    Date: ${d.date || '\u2014'}`, 14, y + 12);
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
      <h3>${doc.name}</h3>
      <p>${cat.label} &middot; ${doc.level} &middot; ${doc.semester} semester${doc.course ? ' &middot; ' + doc.course : ''}</p>
      <p>RRR: ${doc.rrr || '\u2014'}</p>
      <p>Amount: ${doc.amount ? '\u20a6' + Number(doc.amount).toLocaleString() : '\u2014'}</p>`;
    Documents.renderPrintArea(doc);
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
    UI.toast('Signed in with Google');
  });
  document.getElementById('googleSignupBtn').addEventListener('click', async () => {
    await Auth.loginWithGoogle();
    window.location.hash = '#dashboard';
    UI.toast('Signed up with Google');
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
    if (password !== confirmPw) { UI.showFieldError('signupError'); return; }

    const result = await Auth.signup({
      name: document.getElementById('suName').value.trim() || 'Student',
      matric: document.getElementById('suMatric').value.trim(),
      email: document.getElementById('suEmail').value.trim(),
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
  Documents.init();
  CafePrint.init();

  window.addEventListener('hashchange', router);
  await router();
});