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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.2-.9"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/>'
};

function renderIcons(root = document) {
  root.querySelectorAll('i[data-ic]').forEach(el => {
    const name = el.getAttribute('data-ic');
    if (!ICONS[name]) return;
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  });
}

/* =========================================================
   CONFIG (loaded from data.json)
   ========================================================= */
let CONFIG = null;

async function loadConfig() {
  try {
    const res = await fetch('data.json');
    CONFIG = await res.json();
  } catch (e) {
    // Fallback if data.json can't be fetched (e.g. opened as a local file:// page)
    CONFIG = {
      app: { name: 'Stash', tagline: 'Your school papers, sorted', storageQuotaMB: 2048, cafePinExpiryMinutes: 10 },
      categories: [
        { id: 'Receipt', label: 'Receipt', badge: 'RCT', color: 'accent' },
        { id: 'Docket', label: 'Docket', badge: 'DKT', color: 'accent-2' },
        { id: 'Admin', label: 'Admin', badge: 'ADM', color: 'accent-3' }
      ],
      levels: ['100L', '200L', '300L', '400L', '500L'],
      semesters: ['First', 'Second'],
      defaultProfile: { name: '', matric: '', email: '', department: '', level: '100L', avatar: null }
    };
  }
  return CONFIG;
}

/* =========================================================
   DATA LAYER (localStorage today, Supabase-shaped for tomorrow)
   Every method returns a Promise so swapping the body for a
   real Supabase call later doesn't change any call sites.
   ========================================================= */
const DB = {
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  _write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  // ---- users: { [id]: { id, name, matric, email, password, profile, documents: [] } }
  async getUsers() {
    return this._read('stash_users', {});
  },
  async saveUsers(users) {
    this._write('stash_users', users);
    return users;
  },

  async findUserByIdentifier(identifier) {
    const users = await this.getUsers();
    const match = Object.values(users).find(
      u => u.matric.toLowerCase() === identifier.toLowerCase() || u.email.toLowerCase() === identifier.toLowerCase()
    );
    return match || null;
  },

  async createUser({ name, matric, email, password }) {
    const users = await this.getUsers();
    const id = 'u_' + Date.now().toString(36);
    const profile = { ...CONFIG.defaultProfile, name, matric, email, level: 'level' in users ? '100L' : '100L' };
    const user = { id, name, matric, email, password, profile, documents: [] };
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
    await this.saveUsers(users);
    return profile;
  },

  // ---- session ----
  getSession() {
    const local = this._read('stash_session', null);
    if (local) return local;
    try {
      const raw = sessionStorage.getItem('stash_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
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

  // ---- cafe print PINs: { [pin]: { docId, userId, doc, expiresAt } } ----
  async getPins() {
    return this._read('stash_cafe_pins', {});
  },
  async savePins(pins) {
    this._write('stash_cafe_pins', pins);
    return pins;
  },
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
    if (Date.now() > entry.expiresAt) {
      delete pins[pin];
      await this.savePins(pins);
      return null;
    }
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
  },
  initTheme() {
    const saved = localStorage.getItem('stash_theme') || 'dark';
    this.setTheme(saved);
  },
  toggleTheme() {
    const isLight = document.body.classList.contains('light-mode');
    this.setTheme(isLight ? 'dark' : 'light');
  },
  openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  },
  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  },
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

/* =========================================================
   ROUTER
   Public routes: login, signup, cafe-print
   Protected routes: dashboard, documents, profile
   ========================================================= */
const PROTECTED = ['dashboard', 'documents', 'profile'];
const AUTH_ONLY = ['login', 'signup'];

function currentRoute() {
  return (window.location.hash || '#login').replace('#', '');
}

async function router() {
  let route = currentRoute();
  const session = DB.getSession();

  if (PROTECTED.includes(route) && !session) {
    window.location.hash = '#login';
    route = 'login';
  } else if (AUTH_ONLY.includes(route) && session) {
    window.location.hash = '#dashboard';
    route = 'dashboard';
  }

  const authShell = document.getElementById('authShell');
  const appShell = document.getElementById('appShell');
  const cafeShell = document.getElementById('cafeShell');

  authShell.classList.toggle('hidden', !AUTH_ONLY.includes(route));
  appShell.classList.toggle('hidden', !PROTECTED.includes(route));
  cafeShell.classList.toggle('hidden', route !== 'cafe-print');

  if (AUTH_ONLY.includes(route)) {
    document.getElementById('view-login').hidden = route !== 'login';
    document.getElementById('view-signup').hidden = route !== 'signup';
  }

  if (PROTECTED.includes(route)) {
    ['dashboard', 'documents', 'profile'].forEach(r => {
      document.getElementById('view-' + r).hidden = r !== route;
    });
    document.querySelectorAll('.nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.route === route);
    });
    UI.closeSidebar();
    if (route === 'dashboard') await Views.renderDashboard();
    if (route === 'documents') await Views.renderDocuments();
    if (route === 'profile') await Views.renderProfile();
  }

  document.title = ({
    login: 'Log in · Stash',
    signup: 'Create your account · Stash',
    dashboard: 'Dashboard · Stash',
    documents: 'My Documents · Stash',
    profile: 'Profile · Stash',
    'cafe-print': 'Cafe Print · Stash'
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
    // Demo Google sign-in: find-or-create a stock user, no real OAuth wired up.
    const identifier = 'google.demo@school.edu';
    let user = await DB.findUserByIdentifier(identifier);
    if (!user) {
      user = await DB.createUser({
        name: 'Google Student',
        matric: 'GOOGLE-DEMO',
        email: identifier,
        password: '__google__'
      });
    }
    DB.setSession(user.id, true);
    return user;
  },

  async signup({ name, matric, email, password }) {
    const existing = await DB.findUserByIdentifier(matric) || await DB.findUserByIdentifier(email);
    if (existing) {
      return { ok: false, error: 'An account with that matric number or email already exists.' };
    }
    const user = await DB.createUser({ name, matric, email, password });
    DB.setSession(user.id, true);
    return { ok: true, user };
  },

  logout() {
    DB.clearSession();
    window.location.hash = '#login';
  },

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
  docMode: 'list',

  populateSelect(select, values, { withEmpty = false, emptyLabel = 'All' } = {}) {
    select.innerHTML = (withEmpty ? `<option value="">${emptyLabel}</option>` : '') +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
  },

  populateStaticSelects() {
    const levels = CONFIG.levels;
    const semesters = CONFIG.semesters;
    const categories = CONFIG.categories.map(c => c.id);

    this.populateSelect(document.getElementById('suLevel'), levels);
    this.populateSelect(document.getElementById('metaLevel'), levels);
    this.populateSelect(document.getElementById('metaSemester'), semesters);
    this.populateSelect(document.getElementById('metaCategory'), categories);
    this.populateSelect(document.getElementById('pLevel'), levels);

    this.populateSelect(document.getElementById('fLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('fSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
    this.populateSelect(document.getElementById('fCategory'), categories, { withEmpty: true, emptyLabel: 'All categories' });
  },

  categoryMeta(id) {
    return CONFIG.categories.find(c => c.id === id) || CONFIG.categories[0];
  },

  async storageStats(userId) {
    const docs = await DB.getDocuments(userId);
    const quotaMB = CONFIG.app.storageQuotaMB;
    // Simulated usage: each document estimated at ~4MB (photo/PDF scan average).
    const usedMB = Math.min(docs.length * 4, quotaMB);
    const pct = Math.round((usedMB / quotaMB) * 100);
    return { docs, usedMB, quotaMB, pct };
  },

  docCardHTML(d) {
    const cat = this.categoryMeta(d.category);
    const amount = d.amount ? `\u20a6${Number(d.amount).toLocaleString()}` : '\u2014';
    return `
      <div class="doc-card" data-id="${d.id}">
        <label class="doc-check">
          <input type="checkbox" class="ce-check" value="${d.id}">
        </label>
        <div class="doc-badge badge-${cat.color}">${cat.badge}</div>
        <div class="doc-info">
          <p class="doc-name">${d.name}</p>
          <p class="doc-meta">${cat.label}${d.course ? ' &middot; ' + d.course : ''} &middot; ${d.level} &middot; ${d.semester} sem</p>
        </div>
        <div class="doc-amount">${amount}</div>
        <div class="doc-date">${d.date || '\u2014'}</div>
        <div class="doc-actions">
          <button class="icon-btn sm" title="Print" data-action="print" data-id="${d.id}"><i data-ic="stack"></i></button>
          <button class="icon-btn sm" title="Generate cafe PIN" data-action="pin" data-id="${d.id}"><i data-ic="pin"></i></button>
        </div>
      </div>`;
  },

  async renderDashboard() {
    const user = await Auth.currentUser();
    if (!user) return;
    document.getElementById('greeting').textContent = `Good to see you, ${user.name.split(' ')[0]}`;

    const { docs, pct } = await this.storageStats(user.id);
    setRing(pct);

    document.getElementById('statTotal').textContent = docs.length;
    const thisMonth = docs.filter(d => (d.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
    document.getElementById('statMonth').textContent = thisMonth;
    document.getElementById('statFlagged').textContent = document.querySelectorAll('.ce-check:checked').length;

    const legend = document.getElementById('ringLegend');
    legend.innerHTML = CONFIG.categories.map(c => {
      const count = docs.filter(d => d.category === c.id).length;
      return `<div><i class="dot dot-${c.color}"></i>${c.label}s <span>${count}</span></div>`;
    }).join('');

    document.getElementById('recentList').innerHTML = docs.length
      ? docs.slice(0, 5).map(d => this.docCardHTML(d)).join('')
      : '<p class="muted">No documents yet \u2014 head to My Documents to add your first one.</p>';

    this.updateSidebarStorage(pct);
    renderIcons(document.getElementById('view-dashboard'));
    this.bindDocActions(document.getElementById('view-dashboard'));
  },

  async updateSidebarStorage(pct) {
    document.getElementById('sidebarStorageFill').style.width = pct + '%';
    document.getElementById('sidebarStorageText').textContent = `${pct}% of ${(CONFIG.app.storageQuotaMB / 1024).toFixed(1)}GB used`;
  },

  async renderDocuments() {
    const user = await Auth.currentUser();
    if (!user) return;
    await this.filterDocuments();
    this.updateCeCount();
  },

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
    renderIcons(container);
    this.bindDocActions(container);
  },

  bindDocActions(root) {
    root.querySelectorAll('[data-action="print"]').forEach(btn => {
      btn.addEventListener('click', () => Documents.printDoc(btn.dataset.id));
    });
    root.querySelectorAll('[data-action="pin"]').forEach(btn => {
      btn.addEventListener('click', () => Documents.generatePin(btn.dataset.id));
    });
    root.querySelectorAll('.ce-check').forEach(cb => {
      cb.addEventListener('change', () => this.updateCeCount());
    });
  },

  updateCeCount() {
    const n = document.querySelectorAll('.ce-check:checked').length;
    const el = document.getElementById('ceCount');
    if (el) el.textContent = n;
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
  }
};

/* =========================================================
   DOCUMENTS: upload, print, clearance compile, cafe PIN
   ========================================================= */
const Documents = {
  init() {
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('fileInput');

    document.getElementById('chooseFileBtn').addEventListener('click', () => input.click());
    document.getElementById('emptyUploadBtn').addEventListener('click', () => input.click());

    dz.addEventListener('click', e => { if (!e.target.closest('button')) input.click(); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) this.openMetaForm(e.dataTransfer.files[0]); });
    input.addEventListener('change', e => { if (e.target.files.length) this.openMetaForm(e.target.files[0]); });

    document.getElementById('cancelUploadBtn').addEventListener('click', () => this.closeMetaForm());

    document.getElementById('metaForm').addEventListener('submit', e => this.saveDocument(e));

    document.getElementById('compileBtn').addEventListener('click', () => this.compileClearance());

    ['fLevel', 'fSemester', 'fCategory', 'globalSearch'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => Views.filterDocuments());
    });
  },

  openMetaForm(file) {
    document.getElementById('metaForm').classList.remove('hidden');
    document.getElementById('metaName').value = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('metaForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  closeMetaForm() {
    document.getElementById('metaForm').classList.add('hidden');
    document.getElementById('metaForm').reset();
    document.getElementById('fileInput').value = '';
  },

  async saveDocument(e) {
    e.preventDefault();
    const user = await Auth.currentUser();
    if (!user) return;

    const doc = {
      id: 'd_' + Date.now().toString(36),
      name: document.getElementById('metaName').value.trim() || 'Untitled document',
      rrr: document.getElementById('metaRRR').value.trim(),
      amount: Number(document.getElementById('metaAmount').value) || 0,
      date: document.getElementById('metaDate').value || new Date().toISOString().slice(0, 10),
      category: document.getElementById('metaCategory').value,
      level: document.getElementById('metaLevel').value,
      semester: document.getElementById('metaSemester').value,
      course: document.getElementById('metaCourse').value.trim()
    };

    const docs = await DB.getDocuments(user.id);
    docs.unshift(doc);
    await DB.saveDocuments(user.id, docs);

    this.closeMetaForm();
    UI.toast('Saved to vault');
    await Views.filterDocuments();
    await Views.renderDashboard();
  },

  async printDoc(id) {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    this.renderPrintArea(doc);
    window.print();
  },

  renderPrintArea(doc) {
    const cat = Views.categoryMeta(doc.category);
    document.getElementById('printArea').innerHTML = `
      <h1>${doc.name}</h1>
      <p>${cat.label} &middot; ${doc.level} &middot; ${doc.semester} semester${doc.course ? ' &middot; ' + doc.course : ''}</p>
      <p>RRR: ${doc.rrr || '\u2014'}</p>
      <p>Amount: ${doc.amount ? '\u20a6' + Number(doc.amount).toLocaleString() : '\u2014'}</p>
      <p>Date: ${doc.date || '\u2014'}</p>`;
  },

  async generatePin(id) {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    const { pin } = await DB.createPin(user.id, doc);
    UI.toast(`Cafe PIN for "${doc.name}": ${pin} (valid ${CONFIG.app.cafePinExpiryMinutes} min)`);
  },

  async compileClearance() {
    const checks = [...document.querySelectorAll('.ce-check:checked')].map(c => c.value);
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
   CAFE PRINT PORTAL
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
    if (!entry) {
      UI.showFieldError('cafePinError');
      document.getElementById('cafeResult').classList.add('hidden');
      return;
    }
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
   WIRE UP: password toggles, forms, nav, modal
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
    const confirm = document.getElementById('suConfirmPassword').value;
    if (password !== confirm) { UI.showFieldError('signupError'); return; }

    const result = await Auth.signup({
      name: document.getElementById('suName').value.trim() || 'Student',
      matric: document.getElementById('suMatric').value.trim(),
      email: document.getElementById('suEmail').value.trim(),
      password
    });
    if (!result.ok) { UI.showFieldError('signupError', result.error); return; }
    window.location.hash = '#dashboard';
    UI.toast('Welcome to Stash!');
  });

  document.getElementById('openForgotModal').addEventListener('click', () => UI.openModal('forgotModal'));
  document.getElementById('closeForgotModal').addEventListener('click', () => UI.closeModal('forgotModal'));
  document.getElementById('forgotModal').addEventListener('click', e => {
    if (e.target.id === 'forgotModal') UI.closeModal('forgotModal');
  });
  document.getElementById('forgotForm').addEventListener('submit', e => {
    e.preventDefault();
    document.getElementById('forgotConfirmation').classList.remove('hidden');
    e.target.reset();
  });
}

function initAppShellChrome() {
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());
  document.getElementById('openSidebarBtn').addEventListener('click', () => UI.openSidebar());
  document.getElementById('scrim').addEventListener('click', () => UI.closeSidebar());
  document.getElementById('themeToggleBtn').addEventListener('click', () => UI.toggleTheme());
  document.getElementById('profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const user = await Auth.currentUser();
    if (!user) return;
    const profile = {
      name: document.getElementById('pName').value.trim() || 'Student',
      matric: document.getElementById('pMatric').value.trim(),
      level: document.getElementById('pLevel').value,
      department: document.getElementById('pDepartment').value.trim(),
      email: document.getElementById('pEmail').value.trim(),
      avatar: (await DB.getProfile(user.id)).avatar || null
    };
    await DB.saveProfile(user.id, profile);
    Views.setAvatarDisplay(profile);
    UI.toast('Profile updated');
  });

  document.getElementById('avatarInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const user = await Auth.currentUser();
    if (!user) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const profile = await DB.getProfile(user.id);
      profile.avatar = reader.result;
      await DB.saveProfile(user.id, profile);
      Views.setAvatarDisplay(profile);
      UI.toast('Photo updated');
    };
    reader.readAsDataURL(file);
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
  initAppShellChrome();
  Documents.init();
  CafePrint.init();

  window.addEventListener('hashchange', router);
  await router();
});