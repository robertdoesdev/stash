/* ============ ICONS ============ */
const ICONS = {
  home:'<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  folder:'<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  upload:'<path d="M12 16V6M12 6l-4 4M12 6l4 4"/><path d="M5 18h14"/>',
  stack:'<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  pin:'<circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 1.7-2.3 3.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  camera:'<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  grid:'<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  chevron:'<path d="M6 9l6 6 6-6"/>'
};
function renderIcons(){
  document.querySelectorAll('i[data-ic]').forEach(el=>{
    const name = el.getAttribute('data-ic');
    if(!ICONS[name] || el.dataset.done) return;
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    el.dataset.done = '1';
  });
}

/* ============ MOCK STORE (in-memory, no backend) ============ */
const Store = (() => {
  let docs = [
    {id:1, name:'ACC 102 Course Fee', category:'Receipt', level:'300L', semester:'First', course:'ACC 102', rrr:'2904 7712 5501', amount:8500, date:'2026-01-14'},
    {id:2, name:'AMS 104 Practical Docket', category:'Docket', level:'300L', semester:'First', course:'AMS 104', rrr:'', amount:0, date:'2026-01-20'},
    {id:3, name:'Hostel Accommodation', category:'Receipt', level:'300L', semester:'First', course:'', rrr:'1188 3345 9902', amount:45000, date:'2026-01-10'},
    {id:4, name:'Departmental Clearance Form', category:'Admin', level:'300L', semester:'First', course:'', rrr:'', amount:0, date:'2026-01-22'},
    {id:5, name:'Library Fine Receipt', category:'Receipt', level:'200L', semester:'Second', course:'', rrr:'0071 5523 4410', amount:1200, date:'2025-09-02'},
  ];
  let nextId = 6;
  return {
    all: () => docs,
    add: (doc) => { doc.id = nextId++; docs.unshift(doc); return doc; },
    byId: (id) => docs.find(d => d.id === Number(id)),
    clearAll: () => {
      if(!confirm('Remove all documents stored in this session? This cannot be undone.')) return;
      docs = []; Views.refreshAll(); UI.toast('Local vault cleared');
    }
  };
})();

/* ============ UI HELPERS ============ */
const UI = {
  toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(()=>t.classList.remove('show'), 2600);
  },
  openSidebar(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('show'); },
  closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); },
  toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    this.setTheme(cur === 'light' ? 'dark' : 'light');
  },
  setTheme(mode){
    document.documentElement.setAttribute('data-theme', mode);
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
  },
  toggleFaq(btn){ btn.parentElement.classList.toggle('open'); },
  dismissUpgrade(){ document.getElementById('upgradeCard').style.display = 'none'; },
  navigate(view){
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    this.closeSidebar();
    if(view === 'documents') Views.filterDocuments();
    if(view === 'clearance') Views.renderClearanceList();
    if(view === 'cafepin') Views.populateCafeSelect();
    window.scrollTo(0,0);
  }
};

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if(!nav) return;
  UI.navigate(nav.dataset.view);
  if(nav.dataset.cat && nav.dataset.view === 'documents'){
    setTimeout(() => {
      document.getElementById('fCategory').value = nav.dataset.cat;
      Views.filterDocuments();
    }, 0);
  }
});

/* ============ AUTH ============ */
const Auth = {
  showSignup(){ document.getElementById('loginForm').classList.add('hidden'); document.getElementById('signupForm').classList.remove('hidden'); },
  showLogin(){ document.getElementById('signupForm').classList.add('hidden'); document.getElementById('loginForm').classList.remove('hidden'); },
  login(){ this.enter('Adaeze Okafor'); },
  signup(){
    const name = document.getElementById('suName').value.trim() || 'Student';
    this.enter(name);
  },
  enter(name){
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    const first = name.split(' ')[0];
    document.getElementById('greeting').textContent = `Good to see you, ${first}`;
    const initial = name.trim()[0]?.toUpperCase() || 'S';
    document.getElementById('topAvatar').textContent = initial;
    document.getElementById('profileAvatar').textContent = initial;
    document.getElementById('sidebarAvatar').textContent = initial;
    document.getElementById('sidebarName').textContent = name;
    renderIcons();
    Views.refreshAll();
    UI.toast('Welcome to Dockit');
  },
  logout(){
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  }
};

/* ============ VIEWS / RENDERING ============ */
const Views = {
  docMode: 'list',
  setDocMode(mode){
    this.docMode = mode;
    document.querySelectorAll('.vt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    this.filterDocuments();
  },
  iconFor(cat){ return cat === 'Receipt' ? 'receipt' : cat === 'Docket' ? 'docket' : 'admin'; },
  glyphFor(cat){ return cat === 'Receipt' ? '₦' : cat === 'Docket' ? 'D' : 'A'; },

  rowHTML(d){
    const amt = d.amount ? `₦${Number(d.amount).toLocaleString()}` : '';
    return `<div class="doc-row">
      <div class="doc-icon ${this.iconFor(d.category)}">${this.glyphFor(d.category)}</div>
      <div class="doc-meta"><strong>${d.name}</strong><span>${d.category}${d.course ? ' · ' + d.course : ''} · ${d.date || 'No date'}</span></div>
      <div class="doc-tags"><span class="tag">${d.level}</span><span class="tag">${d.semester} sem</span></div>
      <div class="doc-amount">${amt}</div>
    </div>`;
  },

  fileTypeAbbr(cat){ return cat === 'Receipt' ? 'RCT' : cat === 'Docket' ? 'DKT' : 'ADM'; },

  tableRowHTML(d){
    return `<tr>
      <td class="col-check"><input type="checkbox"></td>
      <td>
        <div class="file-name-cell">
          <span class="file-type-icon ${this.iconFor(d.category)}">${this.fileTypeAbbr(d.category)}</span>
          <div><p class="file-name">${d.name}</p><p class="file-meta">${d.course || d.category}</p></div>
        </div>
        <div class="file-meta-row"><span>${d.date || '—'}</span><span>${d.amount ? '₦'+Number(d.amount).toLocaleString() : ''}</span></div>
      </td>
      <td>${d.date || '—'}</td>
      <td class="tags-cell"><span class="tag">${d.level}</span><span class="tag">${d.semester} sem</span></td>
    </tr>`;
  },

  refreshAll(){
    const docs = Store.all();
    const receipts = docs.filter(d=>d.category==='Receipt');
    const dockets = docs.filter(d=>d.category==='Docket');
    const admin = docs.filter(d=>d.category==='Admin');

    document.getElementById('navBadgeTotal').textContent = docs.length;
    document.getElementById('folderReceiptMeta').textContent = `${receipts.length} file${receipts.length===1?'':'s'}`;
    document.getElementById('folderDocketMeta').textContent = `${dockets.length} file${dockets.length===1?'':'s'}`;
    document.getElementById('folderAdminMeta').textContent = `${admin.length} file${admin.length===1?'':'s'}`;

    document.getElementById('storageLegend').innerHTML = `
      <li><span class="legend-dot dot-a"></span>Receipts <span>${receipts.length}</span></li>
      <li><span class="legend-dot dot-b"></span>Dockets <span>${dockets.length}</span></li>
      <li><span class="legend-dot dot-c"></span>Admin <span>${admin.length}</span></li>`;

    const catFilter = document.getElementById('dashCategoryFilter')?.value || '';
    const tableDocs = catFilter ? docs.filter(d=>d.category===catFilter) : docs;
    document.getElementById('filesCount').textContent = `${docs.length} total`;
    document.getElementById('filesTableBody').innerHTML = tableDocs.map(d=>this.tableRowHTML(d)).join('');
    document.getElementById('filesTableEmpty').classList.toggle('hidden', tableDocs.length > 0);

    const activities = [
      {type:'up', label:`Uploaded ${docs[0] ? '"'+docs[0].name+'"' : 'a document'}`, date:docs[0]?.date || 'Just now'},
      {type:'pin', label:'Generated a cafe quick-print PIN', date:'2 days ago'},
      {type:'up', label:`Scanned ${receipts.length} receipt${receipts.length===1?'':'s'} this term`, date:'Jan 2026'},
      {type:'del', label:'Removed a duplicate scan', date:'Jan 2026'},
    ];
    document.getElementById('activityList').innerHTML = activities.map(a => `
      <li>
        <span class="activity-icon ${a.type}">${a.type==='up' ? '↑' : a.type==='del' ? '✕' : '#'}</span>
        <div><p class="activity-title">${a.label}</p><p class="activity-date">${a.date}</p></div>
      </li>`).join('');

    document.getElementById('recentList') && (document.getElementById('recentList').innerHTML = docs.slice(0,5).map(d=>this.rowHTML(d)).join('') || '<p class="muted">No documents yet.</p>');

    this.filterDocuments();
  },

  quickSearch(value){
    UI.navigate('documents');
    setTimeout(() => {
      const gs = document.getElementById('globalSearch');
      gs.value = value;
      this.filterDocuments();
    }, 0);
  },

  filterDocuments(){
    const q = (document.getElementById('globalSearch')?.value || '').toLowerCase();
    const level = document.getElementById('fLevel')?.value || '';
    const sem = document.getElementById('fSemester')?.value || '';
    const cat = document.getElementById('fCategory')?.value || '';
    const list = Store.all().filter(d =>
      (!level || d.level === level) &&
      (!sem || d.semester === sem) &&
      (!cat || d.category === cat) &&
      (!q || (d.name + d.course + d.category).toLowerCase().includes(q))
    );
    const container = document.getElementById('docList');
    const empty = document.getElementById('docEmpty');
    container.className = 'doc-list ' + (this.docMode === 'grid' ? 'grid-mode' : '');
    if(!list.length){ container.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    container.innerHTML = list.map(d => this.rowHTML(d)).join('');
  },

  renderClearanceList(){
    const level = document.getElementById('ceLevel').value;
    const sem = document.getElementById('ceSemester').value;
    const list = Store.all().filter(d => d.category === 'Receipt' && (!level || d.level===level) && (!sem || d.semester===sem));
    const el = document.getElementById('clearanceList');
    el.innerHTML = list.map(d => `
      <label class="check-row">
        <input type="checkbox" class="ce-check" value="${d.id}" onchange="Views.updateCeCount()">
        <div class="doc-meta"><strong>${d.name}</strong><span>${d.level} · ${d.semester} sem${d.course ? ' · '+d.course : ''}</span></div>
        <div class="doc-amount">₦${Number(d.amount||0).toLocaleString()}</div>
      </label>`).join('') || '<p class="muted">No receipts match this filter.</p>';
    this.updateCeCount();
  },
  updateCeCount(){
    const n = document.querySelectorAll('.ce-check:checked').length;
    document.getElementById('ceCount').textContent = `${n} selected`;
  },

  populateCafeSelect(){
    const sel = document.getElementById('cafeDocSelect');
    sel.innerHTML = Store.all().map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  }
};

/* ============ UPLOAD & OCR ============ */
const Upload = {
  currentFile: null,
  init(){
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('fileInput');
    dz.addEventListener('click', (e)=>{ if(e.target.closest('button')) return; input.click(); });
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if(e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', e => { if(e.target.files.length) this.handleFile(e.target.files[0]); });
  },
  openCamera(){ document.getElementById('fileInput').click(); },

  handleFile(file){
    this.currentFile = file;
    document.getElementById('ocrPanel').classList.remove('hidden');
    document.getElementById('ocrStatus').classList.remove('hidden');
    document.getElementById('ocrStatus').innerHTML = '<span class="spinner"></span>Reading document…';
    document.getElementById('metaName').value = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('metaRRR').value = '';
    document.getElementById('metaAmount').value = '';
    document.getElementById('metaDate').value = '';

    const isImage = file.type.startsWith('image/');
    const preview = document.getElementById('ocrImagePreview');
    if(isImage){
      const url = URL.createObjectURL(file);
      preview.src = url;
      preview.style.display = 'block';
      this.runOCR(url);
    } else {
      preview.style.display = 'none';
      document.getElementById('ocrStatus').innerHTML = 'PDF received — add details manually below.';
      setTimeout(()=>document.getElementById('ocrStatus').classList.add('hidden'), 1200);
    }
    document.getElementById('ocrPanel').scrollIntoView({behavior:'smooth', block:'center'});
  },

  runOCR(imageUrl){
    if(typeof Tesseract === 'undefined'){
      document.getElementById('ocrStatus').innerHTML = 'OCR unavailable offline — enter details manually.';
      return;
    }
    Tesseract.recognize(imageUrl, 'eng')
      .then(({data}) => {
        const text = data.text || '';
        const rrrMatch = text.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{3,4})\b/);
        const amountMatch = text.match(/(?:₦|N|NGN)\s?([\d,]{3,12})/i);
        const dateMatch = text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
        if(rrrMatch) document.getElementById('metaRRR').value = rrrMatch[1];
        if(amountMatch) document.getElementById('metaAmount').value = amountMatch[1].replace(/,/g,'');
        if(dateMatch) document.getElementById('metaDate').value = this.normalizeDate(dateMatch[1]);
        document.getElementById('ocrStatus').innerHTML = (rrrMatch || amountMatch) ? 'Scan complete — details pre-filled below.' : 'Scan complete — nothing auto-detected, fill in manually.';
        setTimeout(()=>document.getElementById('ocrStatus').classList.add('hidden'), 1500);
      })
      .catch(() => {
        document.getElementById('ocrStatus').innerHTML = "Couldn't read the image — enter details manually.";
      });
  },
  normalizeDate(str){
    const parts = str.split(/[\/\-.]/);
    if(parts.length !== 3) return '';
    let [a,b,y] = parts;
    if(y.length === 2) y = '20' + y;
    return `${y}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;
  },
  cancel(){
    document.getElementById('ocrPanel').classList.add('hidden');
    document.getElementById('fileInput').value = '';
    this.currentFile = null;
  },
  saveDocument(e){
    e.preventDefault();
    const doc = {
      name: document.getElementById('metaName').value.trim() || 'Untitled document',
      rrr: document.getElementById('metaRRR').value.trim(),
      amount: Number(document.getElementById('metaAmount').value) || 0,
      date: document.getElementById('metaDate').value || new Date().toISOString().slice(0,10),
      category: document.getElementById('metaCategory').value,
      level: document.getElementById('metaLevel').value,
      semester: document.getElementById('metaSemester').value,
      course: document.getElementById('metaCourse').value.trim()
    };
    Store.add(doc);
    this.cancel();
    Views.refreshAll();
    UI.toast('Saved to vault');
    UI.navigate('documents');
  }
};

/* ============ EXPORT ALL DATA ============ */
const Vault = {
  exportData(){
    const docs = Store.all();
    const blob = new Blob([JSON.stringify(docs, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dockit-export.json'; a.click();
    URL.revokeObjectURL(url);
    UI.toast('Vault data exported');
  }
};

/* ============ CLEARANCE EXPORT ============ */
const Clearance = {
  compile(){
    const ids = [...document.querySelectorAll('.ce-check:checked')].map(c => Number(c.value));
    if(!ids.length){ UI.toast('Select at least one document first'); return; }
    const docs = ids.map(id => Store.byId(id)).filter(Boolean);

    if(typeof window.jspdf === 'undefined'){ UI.toast('PDF engine unavailable offline'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text('Clearance Packet', 14, 18);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toLocaleDateString()} · ${docs.length} document(s)`, 14, 25);

    let y = 38;
    docs.forEach((d, i) => {
      if(y > 270){ pdf.addPage(); y = 20; }
      pdf.setFontSize(12);
      pdf.text(`${i+1}. ${d.name}`, 14, y);
      pdf.setFontSize(9);
      pdf.text(`${d.level} · ${d.semester} semester${d.course ? ' · ' + d.course : ''}`, 14, y+6);
      pdf.text(`RRR: ${d.rrr || '—'}    Amount: ${d.amount ? '₦'+d.amount.toLocaleString() : '—'}    Date: ${d.date || '—'}`, 14, y+12);
      y += 22;
    });

    pdf.save('clearance-packet.pdf');
    UI.toast('Clearance packet downloaded');
  }
};

/* ============ CAFE QUICK-PRINT PIN ============ */
const CafePin = {
  timerHandle: null,
  generate(){
    const docId = document.getElementById('cafeDocSelect').value;
    const doc = Store.byId(docId);
    if(!doc){ UI.toast('Choose a document first'); return; }
    const pin = String(Math.floor(1000 + Math.random()*9000));
    const shortId = Math.random().toString(36).slice(2,8);
    document.getElementById('pinResult').classList.remove('hidden');
    document.getElementById('pinDisplay').textContent = pin.split('').join(' ');
    document.getElementById('pinLink').value = `dockit.app/p/${shortId}`;

    let seconds = 600;
    clearInterval(this.timerHandle);
    const timerEl = document.getElementById('pinTimer');
    this.timerHandle = setInterval(() => {
      seconds--;
      const m = String(Math.floor(seconds/60)).padStart(2,'0');
      const s = String(seconds%60).padStart(2,'0');
      timerEl.textContent = `${m}:${s}`;
      if(seconds <= 0){
        clearInterval(this.timerHandle);
        document.getElementById('pinResult').classList.add('hidden');
        UI.toast('PIN expired');
      }
    }, 1000);
    UI.toast(`PIN ready for ${doc.name}`);
  },
  copyLink(){
    const input = document.getElementById('pinLink');
    input.select();
    navigator.clipboard?.writeText(input.value).then(()=>UI.toast('Link copied')).catch(()=>UI.toast('Copy manually — clipboard blocked'));
  }
};

/* ============ PROFILE & SUPPORT ============ */
const Profile = {
  save(){
    const name = document.getElementById('pName').value.trim() || 'Student';
    const initial = name[0].toUpperCase();
    document.getElementById('topAvatar').textContent = initial;
    document.getElementById('profileAvatar').textContent = initial;
    document.getElementById('greeting').textContent = `Good to see you, ${name.split(' ')[0]}`;
    UI.toast('Profile updated');
  }
};
const Support = {
  send(e){ e.preventDefault(); document.getElementById('supportMsg').value=''; UI.toast('Message sent — we\'ll reply by email'); }
};

/* ============ RING ANIMATION ============ */
function setRing(pct){
  const circumference = 2 * Math.PI * 50;
  const ring = document.getElementById('storageRing');
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct/100);
  document.getElementById('ringPct').textContent = pct + '%';
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  Upload.init();
  setRing(62);
  UI.setTheme('dark');
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});