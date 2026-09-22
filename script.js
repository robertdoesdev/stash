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
        free: { label: 'Free', maxDocuments: 50, maxStorageMB: 2048, ocrPerDay: 5 },
        pro: { label: 'Pro', maxDocuments: null, maxStorageMB: 20480, ocrPerDay: null }
      },
      upload: {
        maxFileSizeMB: 10,
        acceptedTypes: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
        acceptedExtensions: ['.pdf', '.jpg', '.jpeg', '.png'],
        maxOcrPdfPages: 5
      },
      categories: [
        { id: 'Receipts', label: 'Receipts / Invoices', badge: 'RCT', color: 'accent', keywords: ['receipt', 'payment', 'paid', 'invoice', 'fee'] },
        { id: 'ClassPDFs', label: 'Class PDFs', badge: 'PDF', color: 'accent-2', keywords: ['lecture', 'syllabus', 'course outline'] },
        { id: 'Images', label: 'Images', badge: 'IMG', color: 'accent-3', keywords: ['photo', 'scan'] }
      ],
      categoryMigration: { Receipt: 'Receipts', Docket: 'ClassPDFs', Admin: 'Images' },
      levels: ['100L', '200L', '300L', '400L', '500L'],
      semesters: ['First', 'Second'],
      referenceTypes: ['RRR', 'Receipt No.', 'Invoice No.', 'Reference No.', 'Other'],
      extraction: {
        institutionMarkers: ['university', 'polytechnic', 'college', 'institute'],
        referenceKeywords: [{ match: 'reference no', type: 'Reference No.' }],
        studentIdKeywords: ['matric no', 'student id', 'reg no'],
        semesterKeywords: { First: ['first semester'], Second: ['second semester'] }
      },
      clearanceRequirements: [],
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
  },
  ocrPerDay(user) { return this.limits(user).ocrPerDay; }
};

/* =========================================================
   DOCUMENT CONTENT EXTRACTION
   Pulls real, searchable text out of an uploaded file (native PDF
   text first, OCR only when there's no text layer), then applies
   deterministic pattern-matching — no AI, no guessing — to surface
   metadata like amount, date, reference number, institution, etc.
   Anything that isn't confidently found is left blank rather than
   invented.
   ========================================================= */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const PDF_MIN_TEXT_LENGTH = 25; // below this, treat the PDF as having no usable text layer

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') return { text: '', pdf: null };
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  const pageCount = Math.min(pdf.numPages, 15); // cap for performance on huge files
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return { text: text.trim(), pdf };
}

// Runs Tesseract with settings tuned for document/receipt text (a single
// uniform block, rather than the default multi-column-aware mode), using
// the explicit worker API so the page-segmentation mode actually applies.
async function runTesseractOCR(image) {
  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' }); // assume a single uniform block of text
    const { data } = await worker.recognize(image);
    return (data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

// Basic, dependency-free preprocessing to help Tesseract on photographed
// receipts: upscale small images (more pixels for the recognizer to work
// with), convert to grayscale, and stretch contrast so faint text stands
// out — without the aggressive thresholding that destroys thin strokes.
// Drawing through <img>/canvas already respects EXIF orientation in
// current browsers, so no separate rotation step is needed here.
function preprocessImageForOCR(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const { width, height } = img;
        const minDimension = 1200; // upscale small photos for better recognition
        const maxDimension = 3000; // cap so a huge photo can't hang the browser
        let scale = 1;
        if (Math.max(width, height) < minDimension) scale = minDimension / Math.max(width, height);
        if (Math.max(width, height) * scale > maxDimension) scale = maxDimension / Math.max(width, height);

        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        const d = imageData.data;
        let min = 255, max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = gray;
          if (gray < min) min = gray;
          if (gray > max) max = gray;
        }
        const range = Math.max(1, max - min); // avoid divide-by-zero on a flat/blank image
        for (let i = 0; i < d.length; i += 4) {
          const stretched = ((d[i] - min) / range) * 255;
          d[i] = d[i + 1] = d[i + 2] = stretched;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not load image for preprocessing')); };
    img.src = objectUrl;
  });
}

// OCRs a scanned PDF (no usable text layer) page by page, up to a
// configurable limit so a huge document can't freeze the browser or
// silently consume unbounded OCR resources. Pages are combined in order;
// if the document has more pages than the limit, that's reported back
// rather than silently pretending the whole thing was processed.
async function ocrScannedPdf(pdf, maxPages) {
  const pageCount = Math.min(pdf.numPages, maxPages);
  const parts = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const pageText = await runTesseractOCR(canvas);
    if (pageText) parts.push(pageText);
  }
  return {
    text: parts.join('\n\n').trim(),
    pagesProcessed: pageCount,
    totalPages: pdf.numPages,
    truncated: pdf.numPages > pageCount
  };
}

// Renders a PDF's pages as stacked canvases inside the given pane — an
// in-app preview using the existing pdf.js library, instead of handing
// the file off to the browser's native PDF viewer (which navigates away
// or triggers a download depending on the browser).
async function renderPdfIntoPane(pane, blob) {
  if (typeof pdfjsLib === 'undefined') {
    pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>PDF preview engine unavailable offline.</p></div>`;
    renderIcons(pane);
    return;
  }
  pane.innerHTML = `<div class="pdf-preview-scroll" id="pdfPreviewScroll"></div>`;
  const scrollEl = document.getElementById('pdfPreviewScroll');
  try {
    const buf = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageCount = Math.min(pdf.numPages, 30); // sane cap so a huge PDF can't hang the preview
    const targetWidth = Math.max(200, scrollEl.clientWidth || 380);

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, targetWidth / unscaled.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      scrollEl.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (pdf.numPages > pageCount) {
      const note = document.createElement('p');
      note.className = 'muted pdf-preview-note';
      note.textContent = `Showing the first ${pageCount} of ${pdf.numPages} pages. Download to view all.`;
      scrollEl.appendChild(note);
    }
  } catch (e) {
    pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Couldn't render this PDF for preview. You can still download it below.</p></div>`;
    renderIcons(pane);
  }
}

const Extractor = {
  // Finds a currency amount, but only when there's real contextual evidence
  // — a currency symbol/code, or an explicit label like "Amount"/"Total".
  // A bare number is never treated as an amount, since that's how phone
  // numbers, student IDs and reference numbers get misread as money.
  findAmount(text) {
    // Unambiguous currency markers — safe to trust directly.
    const strongMatch = text.match(/(?:\u20a6|NGN|\$|USD|\u00a3|GBP|\u20ac|EUR)\s?([\d,]{3,12}(?:\.\d{1,2})?)/i);
    if (strongMatch) { const v = this._cleanAmount(strongMatch[1]); if (v) return v; }

    // Bare "N" for Naira is ambiguous (collides with room numbers, IDs,
    // footnotes) — only trust it when it's comma-grouped or has decimals,
    // which is how real amounts are actually written.
    const shorthandMatch = text.match(/\bN\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})\b/);
    if (shorthandMatch) { const v = this._cleanAmount(shorthandMatch[1]); if (v) return v; }

    // Explicit wording near a number.
    const wordMatch = text.match(/(?:amount|total|sum paid|amount paid|fee)s?\s*(?:paid|due)?\s*[:\-]?\s*(?:\u20a6|N|\$|\u00a3|\u20ac)?\s?([\d,]{3,12}(?:\.\d{1,2})?)/i);
    if (wordMatch) { const v = this._cleanAmount(wordMatch[1]); if (v) return v; }

    return '';
  },
  _cleanAmount(raw) {
    const cleaned = String(raw || '').replace(/,/g, '');
    const num = Number(cleaned);
    if (!cleaned || isNaN(num) || num <= 0) return '';
    return cleaned;
  },

  // Finds a date and normalizes it to yyyy-mm-dd, but only when it passes
  // a real calendar-validity check (correct month/day range, a plausible
  // year). This stops random number sequences from being read as dates.
  findDate(text) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthWordMatch = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\b/i)
      || text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (monthWordMatch) {
      let day, monthWord, year;
      if (/^\d/.test(monthWordMatch[0])) { [, day, monthWord, year] = monthWordMatch; }
      else { [, monthWord, day, year] = monthWordMatch; }
      const mIdx = months.findIndex(m => m.startsWith(monthWord.toLowerCase().slice(0, 3)));
      if (mIdx > -1 && this._isValidDate(year, mIdx + 1, day)) {
        return `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (isoMatch && this._isValidDate(isoMatch[1], isoMatch[2], isoMatch[3])) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    const numericMatch = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (numericMatch) {
      let [, a, b, y] = numericMatch;
      if (y.length === 2) y = '20' + y;
      // Try day/month first (common outside the US); fall back to month/day.
      if (this._isValidDate(y, b, a)) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
      if (this._isValidDate(y, a, b)) return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    return '';
  },
  _isValidDate(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!y || !m || !d) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    if (y < 1990 || y > 2100) return false; // sane range for academic documents
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  },

  // Reference number ONLY when a real label ("Receipt No", "RRR", etc.) is
  // found nearby. No blind digit-pattern fallback — a grouped-digit string
  // with no label is exactly as likely to be a phone or account number.
  findReference(text, config) {
    const lower = text.toLowerCase();
    for (const { match, type } of (config.referenceKeywords || [])) {
      const idx = lower.indexOf(match);
      if (idx === -1) continue;
      const after = text.slice(idx + match.length, idx + match.length + 40);
      const codeMatch = after.match(/^[:\-\s]*([A-Za-z0-9][A-Za-z0-9\/\- ]{2,24})/);
      if (!codeMatch) continue;
      const raw = codeMatch[1].trim().split(/\s{2,}/)[0]; // stop at an accidental run into the next word
      const digitsOnlyLen = raw.replace(/[^A-Za-z0-9]/g, '').length;
      if (/\d/.test(raw) && digitsOnlyLen >= 5 && digitsOnlyLen <= 20) {
        return { referenceNumber: raw, referenceType: type };
      }
    }
    return { referenceNumber: '', referenceType: '' };
  },

  // A line is only treated as an institution name when it contains a
  // recognizable institution-type word AND is more than a single stray word.
  findInstitution(text, markers) {
    const lines = text.split(/\n|(?<=\.)\s+/).map(l => l.trim()).filter(Boolean);
    const lower = markers.map(m => m.toLowerCase());
    const hit = lines.find(line => {
      const l = line.toLowerCase();
      return lower.some(m => l.includes(m)) && line.split(/\s+/).length >= 2;
    });
    return hit ? hit.slice(0, 80) : '';
  },

  findStudentId(text, keywords) {
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx === -1) continue;
      const after = text.slice(idx + kw.length, idx + kw.length + 30);
      const codeMatch = after.match(/[:\-\s]*([A-Za-z0-9\/\-]{4,20})/);
      if (codeMatch) return codeMatch[1].trim();
    }
    return '';
  },

  // Two consecutive years (e.g. "2023/2024") — but only when the second
  // year is genuinely the first plus one, so two unrelated 4-digit numbers
  // separated by a slash don't get read as an academic session.
  findAcademicSession(text) {
    const m = text.match(/\b(20\d{2})\s?[\/\-]\s?(20\d{2})\b/);
    if (!m) return '';
    if (Number(m[2]) !== Number(m[1]) + 1) return '';
    return `${m[1]}/${m[2]}`;
  },

  findSemester(text, semesterKeywords) {
    const lower = text.toLowerCase();
    for (const [semester, phrases] of Object.entries(semesterKeywords || {})) {
      if (phrases.some(p => lower.includes(p))) return semester;
    }
    return '';
  },

  // Only a direct match against a configured level string (in either
  // "200L" or "200 Level" form). No numeric "Year N" guessing — a stray
  // "2" near the word "year" is not credible evidence of academic level.
  findLevel(text, levels) {
    for (const lvl of levels) {
      const digits = String(lvl).match(/\d+/);
      if (digits) {
        const re = new RegExp(`\\b${digits[0]}\\s?(?:level|l)\\b`, 'i');
        if (re.test(text)) return lvl;
      } else if (text.toLowerCase().includes(String(lvl).toLowerCase())) {
        return lvl;
      }
    }
    return '';
  },

  // Looks for a short, confident-looking document title near the top of
  // the extracted text, using a confidence score rather than a rigid
  // casing rule — position near the top, short length, title-like
  // casing, and document-title vocabulary ("receipt", "form", etc.) all
  // add confidence; things that look like a labeled field, address,
  // date, phone/reference number, or body prose are excluded outright.
  // Returns '' when nothing clears the confidence threshold — this only
  // ever feeds a filename suggestion, never a forced rename on weak
  // evidence.
  findHeading(text) {
    const smallWords = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'a', 'an', 'to']);
    const titleVocabulary = ['receipt', 'invoice', 'certificate', 'letter', 'form', 'registration', 'statement', 'transcript', 'admission', 'clearance', 'confirmation', 'notice', 'slip', 'record', 'report', 'card', 'schedule', 'result', 'syllabus', 'outline'];
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 12);

    let best = '', bestScore = 0;

    lines.forEach((line, idx) => {
      if (line.length < 6 || line.length > 60) return;
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length < 2 || words.length > 9) return;
      if (!/[A-Za-z]/.test(line)) return;

      // Hard exclusions — these disqualify a line outright regardless of score.
      if (/\d{4,}/.test(line)) return;                       // reference/account/phone-shaped
      if (/^\d/.test(line)) return;                           // starts with a digit — date/address/reference
      if (/@|https?:\/\/|www\./i.test(line)) return;          // email/url
      if (/:\s*\S/.test(line) && /\d/.test(line)) return;     // a labeled field, e.g. "Date: 12/03/2024"
      if (/\b(street|st\.?|road|rd\.?|avenue|ave\.?|close|crescent|drive|lane)\b/i.test(line)) return; // address
      if (/^[A-Z][a-zA-Z'-]*,\s*[A-Z]/.test(line) && words.length <= 4) return; // "City, State" style locale line
      if ((line.match(/\d/g) || []).length > 3) return;       // too many stray digits for a clean title
      if (/[.!?]\s+[A-Z]/.test(line)) return;                  // multiple sentences — prose, not a title
      if (!words.some(w => w.replace(/[^A-Za-z]/g, '').length >= 5)) return; // needs at least one real word, not just short abbreviations

      const alpha = line.replace(/[^A-Za-z]/g, '');
      if (alpha.length < 5) return; // not enough letters to judge casing confidently
      const upper = alpha.replace(/[^A-Z]/g, '');
      const isMostlyUpper = (upper.length / alpha.length) > 0.7;

      const significantWords = words.filter(w => !smallWords.has(w.toLowerCase()));
      const capitalizedWords = significantWords.filter(w => /^[A-Z]/.test(w));
      const isTitleCase = significantWords.length > 0 && capitalizedWords.length >= Math.ceil(significantWords.length * 0.7);

      // Casing is a hard requirement, not just a scoring input — otherwise
      // vocabulary + position alone could let plain lowercase prose (e.g.
      // "this receipt confirms that payment has been received") through.
      // The score below only ranks among lines that already look like a
      // real heading, choosing the best candidate rather than just the
      // first line that happens to match.
      if (!isMostlyUpper && !isTitleCase) return;

      let score = 0;
      score += Math.max(0, 4 - idx);          // position near the top is a strong signal
      if (words.length <= 6) score += 2;       // short, title-length lines
      else score += 1;                          // still plausible up to 9 words, just less confident
      if (isMostlyUpper) score += 3;
      if (isTitleCase) score += 3;
      if (titleVocabulary.some(v => line.toLowerCase().includes(v))) score += 2; // document-title vocabulary

      if (score > bestScore) { bestScore = score; best = line; }
    });

    return bestScore >= 6 ? best : '';
  },

  // A category is only suggested when one category clearly leads on
  // keyword evidence — at least two distinct keyword hits, and not tied
  // with the runner-up. A single incidental word is not enough evidence.
  // Category priority: (1) strong Receipts/Invoices evidence — either
  // multiple keyword hits, or one strong signal (an amount and a
  // reference number together, or a keyword hit alongside either) —
  // (2) strong Class PDFs evidence, where being a PDF itself counts as a
  // supporting signal alongside at least one content keyword, (3) a
  // plain image with no stronger evidence falls back to Images, (4)
  // otherwise left blank. The three category IDs are referenced directly
  // because this priority logic is specific to what each of Stash's
  // three categories means; the keyword word-lists themselves stay fully
  // configurable via data.json.
  guessCategory(text, categories, { amount, referenceNumber, isPdf, isImage } = {}) {
    const lower = (text || '').toLowerCase();
    const scoreFor = id => {
      const cat = categories.find(c => c.id === id);
      if (!cat) return 0;
      return (cat.keywords || []).reduce((s, k) => s + (lower.includes(k.toLowerCase()) ? 1 : 0), 0);
    };

    const receiptScore = scoreFor('Receipts');
    const classScore = scoreFor('ClassPDFs');

    const strongReceipt = receiptScore >= 2 || (receiptScore >= 1 && (amount || referenceNumber)) || (amount && referenceNumber);
    if (strongReceipt) return 'Receipts';

    const strongClass = classScore >= 2 || (isPdf && classScore >= 1);
    if (strongClass) return 'ClassPDFs';

    if (isImage) return 'Images';

    return '';
  },

  // Runs every extractor against a block of text and returns only the
  // fields it found reasonable evidence for. Anything not found comes
  // back as '' rather than a guess — never invented. Category is the one
  // field that can still get a value with no text at all (a plain image
  // file falls back to "Images" on file type alone).
  analyze(text, fileType) {
    const cfg = CONFIG.extraction || {};
    const hasText = !!(text && text.trim());
    const ref = hasText ? this.findReference(text, cfg) : { referenceNumber: '', referenceType: '' };

    const result = {
      amount: hasText ? this.findAmount(text) : '',
      date: hasText ? this.findDate(text) : '',
      referenceNumber: ref.referenceNumber,
      referenceType: ref.referenceType,
      institution: hasText ? this.findInstitution(text, cfg.institutionMarkers || []) : '',
      studentId: hasText ? this.findStudentId(text, cfg.studentIdKeywords || []) : '',
      academicSession: hasText ? this.findAcademicSession(text) : '',
      semester: hasText ? this.findSemester(text, cfg.semesterKeywords || {}) : '',
      level: hasText ? this.findLevel(text, CONFIG.levels || []) : ''
    };
    result.category = this.guessCategory(hasText ? text : '', CONFIG.categories || [], {
      amount: result.amount,
      referenceNumber: result.referenceNumber,
      isPdf: fileType === 'application/pdf',
      isImage: (fileType || '').startsWith('image/')
    });
    return result;
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

    // Migrate documents saved under the old category names (Receipt /
    // Docket / Admin) to the current category IDs. Old documents keep
    // their category — the meaning is preserved, only the ID changes.
    const catMap = CONFIG.categoryMigration || {};
    const needsCatMigration = docs.filter(d => d.category && catMap[d.category]);
    if (needsCatMigration.length) {
      needsCatMigration.forEach(d => { d.category = catMap[d.category]; });
      await this.saveDocuments(userId, docs);
    }

    // Safe in-memory defaults for documents saved before this correction
    // pass, so older records don't break new UI that expects these fields.
    return docs.map(d => ({
      originalFilename: d.name,
      autoFilled: [],
      ...d
    }));
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

  todayKey() { return new Date().toISOString().slice(0, 10); },

  // Usage is tracked per calendar day and rolls over automatically —
  // if the stored date isn't today, the count is treated as 0.
  async usageToday(userId, kind) {
    const users = await this.getUsers();
    const usage = users[userId] && users[userId].usage && users[userId].usage[kind];
    if (!usage || usage.date !== this.todayKey()) return 0;
    return usage.count || 0;
  },
  async incrementUsage(userId, kind) {
    const users = await this.getUsers();
    if (!users[userId]) return 0;
    const today = this.todayKey();
    const current = users[userId].usage && users[userId].usage[kind];
    const count = (current && current.date === today) ? current.count + 1 : 1;
    users[userId].usage = { ...(users[userId].usage || {}), [kind]: { date: today, count } };
    await this.saveUsers(users);
    return count;
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

function formatMB(mb) {
  if (!mb) return '0 MB';
  if (mb < 100) return `${mb.toFixed(2)} MB`;
  return `${Math.round(mb)} MB`;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function sanitizeSuggestedName(str) {
  return str
    .replace(/[\\/:*?"<>|]/g, '') // filesystem/browser-unsafe characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
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
      values.map(v => {
        const value = (v && typeof v === 'object') ? v.value : v;
        const label = (v && typeof v === 'object') ? v.label : v;
        return `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;
      }).join('');
  },

  populateStaticSelects() {
    const levels = CONFIG.levels;
    const semesters = CONFIG.semesters;
    const categories = CONFIG.categories.map(c => ({ value: c.id, label: c.label }));

    this.populateSelect(document.getElementById('suLevel'), levels);
    this.populateSelect(document.getElementById('editLevel'), levels, { withEmpty: true, emptyLabel: '\u2014 Not set \u2014' });
    this.populateSelect(document.getElementById('editSemester'), semesters, { withEmpty: true, emptyLabel: '\u2014 Not set \u2014' });
    this.populateSelect(document.getElementById('editCategory'), categories, { withEmpty: true, emptyLabel: '\u2014 Not set \u2014' });
    this.populateSelect(document.getElementById('editReferenceType'), CONFIG.referenceTypes || ['Reference'], { withEmpty: true, emptyLabel: '\u2014 Not set \u2014' });
    this.populateSelect(document.getElementById('pLevel'), levels);

    this.populateSelect(document.getElementById('fLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('fSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
    this.populateSelect(document.getElementById('fCategory'), categories, { withEmpty: true, emptyLabel: 'All categories' });
    this.populateSelect(document.getElementById('ceLevel'), levels, { withEmpty: true, emptyLabel: 'All levels' });
    this.populateSelect(document.getElementById('ceSemester'), semesters, { withEmpty: true, emptyLabel: 'All semesters' });
  },

  categoryMeta(id) {
    return CONFIG.categories.find(c => c.id === id) || { id: '', label: 'Uncategorized', badge: '\u2014', color: 'muted' };
  },

  async storageStats(userId) {
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(userId);
    const limits = Plans.limits(user);

    // The stored file size is the source of truth. If a document's
    // recorded size is missing or zero but the file actually exists in
    // IndexedDB, verify against the real blob size instead of silently
    // counting it as zero.
    const sizes = await Promise.all(docs.map(async d => {
      if (d.size) return d.size;
      if (d.hasFile) {
        const blob = await FileStore.get(d.id).catch(() => null);
        return blob ? blob.size : 0;
      }
      return 0;
    }));
    const usedBytes = sizes.reduce((a, b) => a + b, 0);
    const usedMB = usedBytes / (1024 * 1024);
    const quotaMB = limits.maxStorageMB;

    // Keep real precision. Rounding a genuinely tiny-but-real usage to a
    // flat integer percentage would make a real 5MB upload show as "0%".
    const rawPct = quotaMB ? Math.min(100, (usedMB / quotaMB) * 100) : 0;
    const pct = usedBytes === 0 ? 0 : Math.max(0.1, Math.round(rawPct * 10) / 10);

    return {
      docs, usedBytes,
      usedMB: Math.round(usedMB * 100) / 100,
      quotaMB, pct,
      docCount: docs.length,
      maxDocuments: limits.maxDocuments,
      remainingMB: quotaMB ? Math.max(0, Math.round((quotaMB - usedMB) * 100) / 100) : Infinity,
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
      return `<div><i class="dot dot-${c.color}"></i>${escapeHTML(c.label)} <span>${count}</span></div>`;
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

  // Shared by search and the Clearance Assistant, so "what counts as
  // evidence for this document" is defined in exactly one place.
  buildHaystack(d) {
    const catLabel = this.categoryMeta(d.category).label;
    return [
      d.name, d.course, d.category, catLabel, d.referenceNumber, d.referenceType,
      d.amount ? String(d.amount) : '', d.amount ? Number(d.amount).toLocaleString() : '',
      d.date, d.uploadedAt ? d.uploadedAt.slice(0, 10) : '',
      d.level, d.semester, d.ocrText, d.institution, d.extractedStudentId, d.academicSession
    ].filter(Boolean).join(' ').toLowerCase();
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
      return this.buildHaystack(d).includes(q);
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
      const storagePart = remainingMB === Infinity ? 'Unlimited storage' : `${formatMB(remainingMB)} of ${quotaMB >= 1024 ? (quotaMB / 1024).toFixed(1) + 'GB' : quotaMB + 'MB'} left`;
      const docsPart = remainingDocs === Infinity ? 'unlimited documents' : `${remainingDocs} document${remainingDocs === 1 ? '' : 's'} remaining`;
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

    const evalResult = ClearanceAssistant.evaluate(docs, level, sem);
    const pctEl = document.getElementById('reqPct');
    if (pctEl) pctEl.textContent = `${evalResult.pct}% complete`;
    const barFill = document.getElementById('reqBarFill');
    if (barFill) barFill.style.width = evalResult.pct + '%';
    const reqList = document.getElementById('requirementsList');
    if (reqList) {
      reqList.innerHTML = evalResult.results.length
        ? evalResult.results.map(r => `
            <div class="req-row ${r.complete ? 'req-complete' : 'req-missing'}">
              <div class="req-info">
                <p class="req-name">${escapeHTML(r.req.name)}</p>
                <p class="req-reason">${escapeHTML(r.reason)}</p>
              </div>
              <span class="req-badge ${r.complete ? 'req-badge-complete' : 'req-badge-missing'}">${r.complete ? 'Complete' : 'Missing'}</span>
            </div>`).join('')
        : '<p class="muted">No clearance requirements configured for this level/semester.</p>';
    }

    // Not limited to receipts any more — a clearance packet can include
    // admin letters and dockets too, matching the requirement categories.
    const list = docs.filter(d => (!level || d.level === level) && (!sem || d.semester === sem));
    PacketBuilder.pruneToVisible(list.map(d => d.id));

    document.getElementById('clearanceList').innerHTML = list.length ? list.map(d => {
      const cat = this.categoryMeta(d.category);
      return `
        <label class="check-row">
          <input type="checkbox" class="ce-check" value="${d.id}" ${PacketBuilder.order.includes(d.id) ? 'checked' : ''}>
          <div class="doc-info"><p class="doc-name">${escapeHTML(d.name)}</p><p class="doc-meta">${cat.label} &middot; ${d.level} &middot; ${d.semester} sem${d.course ? ' &middot; ' + escapeHTML(d.course) : ''}</p></div>
          <div class="doc-amount">${d.amount ? '\u20a6' + Number(d.amount).toLocaleString() : '\u2014'}</div>
        </label>`;
    }).join('') : '<p class="muted">No documents match this filter yet.</p>';

    document.querySelectorAll('#clearanceList .ce-check').forEach(cb => {
      cb.addEventListener('change', () => PacketBuilder.toggle(cb.value, cb.checked));
    });
    this.updateCeCount();
    await PacketBuilder.renderOrderPanel();
  },

  updateCeCount() {
    const el = document.getElementById('ceCount');
    if (el) el.textContent = `${PacketBuilder.order.length} selected`;
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
      ? `${pct}% used \u00b7 ${formatMB(usedMB)} of ${(quotaMB / 1024).toFixed(1)}GB \u00b7 ${docCount}${maxDocuments ? '/' + maxDocuments : ''} documents`
      : `${pct}% used \u00b7 ${formatMB(usedMB)} of ${quotaMB}MB \u00b7 ${docCount}${maxDocuments ? '/' + maxDocuments : ''} documents`;
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
  _historyPushed: false,

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
      if ((doc.fileType || '').startsWith('image/')) {
        const url = await FileStore.getObjectURL(id).catch(() => null);
        pane.innerHTML = url
          ? `<img src="${url}" alt="${escapeHTML(doc.name)}">`
          : `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Could not load the image.</p></div>`;
      } else if (doc.fileType === 'application/pdf') {
        const blob = await FileStore.get(id).catch(() => null);
        if (blob) {
          await renderPdfIntoPane(pane, blob);
        } else {
          pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Could not load the file.</p></div>`;
        }
      } else {
        pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>No preview available for this file type.</p></div>`;
      }
    } else {
      pane.innerHTML = `<div class="doc-preview-placeholder"><i data-ic="file"></i><p>Original file isn't available on this device.</p></div>`;
    }
    renderIcons(pane);

    document.getElementById('editName').value = doc.name || '';
    document.getElementById('editReferenceType').value = doc.referenceType || '';
    document.getElementById('editReferenceNumber').value = doc.referenceNumber || '';
    document.getElementById('editAmount').value = doc.amount || '';
    document.getElementById('editDate').value = doc.date || '';
    document.getElementById('editCategory').value = doc.category || '';
    document.getElementById('editLevel').value = doc.level || '';
    document.getElementById('editSemester').value = doc.semester || '';
    document.getElementById('editCourse').value = doc.course || '';

    // "Detected"/"suggested" tags — only shown for fields the extractor
    // actually found real evidence for, never for default fallback values.
    const autoFilled = doc.autoFilled || [];
    document.querySelectorAll('.detected-tag').forEach(tag => {
      tag.classList.toggle('hidden', !autoFilled.includes(tag.dataset.tag));
    });

    const originalName = (doc.originalFilename || '').replace(/\.[^.]+$/, '');
    const useOriginalBtn = document.getElementById('useOriginalNameBtn');
    if (useOriginalBtn) {
      const suggested = autoFilled.includes('name') && originalName && originalName !== doc.name;
      useOriginalBtn.classList.toggle('hidden', !suggested);
    }

    const metaLine = document.getElementById('docModalMeta');
    if (metaLine) {
      const uploaded = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '\u2014';
      const modified = doc.modifiedAt ? new Date(doc.modifiedAt).toLocaleDateString() : uploaded;
      const originalNote = (doc.originalFilename && doc.originalFilename !== doc.name) ? ` \u00b7 Originally "${doc.originalFilename}"` : '';
      metaLine.textContent = `${doc.size ? formatFileSize(doc.size) : 'Unknown size'} \u00b7 Uploaded ${uploaded} \u00b7 Modified ${modified}${originalNote}`;
      metaLine.dataset.originalBase = originalName;
    }

    const detectedLine = document.getElementById('docDetectedInfo');
    if (detectedLine) {
      const detected = [];
      if (doc.institution) detected.push(`Institution: ${doc.institution}`);
      if (doc.extractedStudentId) detected.push(`Student ID on document: ${doc.extractedStudentId}`);
      if (doc.academicSession) detected.push(`Session: ${doc.academicSession}`);
      if (detected.length) {
        detectedLine.textContent = 'Detected from document \u2014 ' + detected.join(' \u00b7 ');
        detectedLine.classList.remove('hidden');
      } else {
        detectedLine.classList.add('hidden');
      }
    }

    const downloadBtn = document.getElementById('downloadDocBtn');
    if (downloadBtn) downloadBtn.classList.toggle('hidden', !doc.hasFile);

    const ocrBox = document.getElementById('ocrTextBox');
    const rerunBtn = document.getElementById('rerunOcrBtn');
    const copyBtn = document.getElementById('copyOcrTextBtn');
    const ocrTextarea = document.getElementById('ocrTextContent');
    const statusLabel = document.getElementById('ocrStatusLabel');

    if (doc.hasFile) {
      ocrBox.classList.remove('hidden');
      // The textarea is the editable, persisted value — never overwrite it
      // with explanatory prose. Status/explanation is shown in the label.
      ocrTextarea.value = doc.ocrText || '';
      if (doc.ocrStatus === 'native') statusLabel.textContent = 'Text extracted from PDF (no scan needed)';
      else if (doc.ocrStatus === 'done') statusLabel.textContent = 'Text detected on scan \u2014 may not be perfectly accurate';
      else if (doc.ocrStatus === 'failed') statusLabel.textContent = 'Scan didn\u2019t find readable text \u2014 you can type it in manually below';
      else statusLabel.textContent = doc.ocrText ? 'Edited text' : 'No text extracted yet';
    } else {
      ocrBox.classList.add('hidden');
    }

    const canRerun = doc.hasFile && doc.ocrStatus !== 'native';
    if (rerunBtn) rerunBtn.classList.toggle('hidden', !canRerun);
    if (copyBtn) copyBtn.classList.toggle('hidden', !doc.ocrText);

    UI.openModal('docModal');
    if (!this._historyPushed) {
      history.pushState({ stashModal: 'doc' }, '');
      this._historyPushed = true;
    }
  },

  close() {
    UI.closeModal('docModal');
    this.currentId = null;
    if (this._historyPushed) {
      this._historyPushed = false;
      if (history.state && history.state.stashModal === 'doc') history.back();
    }
  },

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
      ocrText: document.getElementById('ocrTextContent').value,
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
  },

  async rerunOcr() {
    if (!this.currentId) return;
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const idx = docs.findIndex(d => d.id === this.currentId);
    if (idx === -1) return;
    const doc = docs[idx];
    if (!doc.hasFile) { UI.toast('Original file isn\u2019t available on this device'); return; }
    if (doc.ocrText && doc.ocrText.trim()) {
      if (!confirm('Rerunning OCR will replace the current text with a fresh scan. Continue?')) return;
    }

    const rerunBtn = document.getElementById('rerunOcrBtn');
    const resetBtn = () => { if (rerunBtn) { rerunBtn.disabled = false; rerunBtn.textContent = 'Rerun OCR'; } };
    if (rerunBtn) { rerunBtn.disabled = true; rerunBtn.textContent = 'Scanning\u2026'; }

    const checkOcrQuota = async () => {
      const limit = Plans.ocrPerDay(user);
      const used = await DB.usageToday(user.id, 'ocr');
      if (limit != null && used >= limit) {
        return { ok: false, message: `You've used all ${limit} free OCR scans today. Try again tomorrow or upgrade to Pro.` };
      }
      return { ok: true };
    };

    let text = '', status = 'failed', source = doc.textSource, rerunPageNote = '';
    try {
      const blob = await FileStore.get(doc.id);
      if (!blob) { resetBtn(); UI.toast('Could not load the original file'); return; }

      if (doc.fileType === 'application/pdf') {
        const { text: nativeText, pdf } = await extractPdfText(blob);
        if (nativeText.length >= PDF_MIN_TEXT_LENGTH) {
          text = nativeText; status = 'native'; source = 'pdf';
        } else if (pdf) {
          const quota = await checkOcrQuota();
          if (!quota.ok) { resetBtn(); UI.toast(quota.message); return; }
          if (typeof Tesseract === 'undefined') { resetBtn(); UI.toast('OCR engine unavailable offline'); return; }
          const maxPages = CONFIG.upload.maxOcrPdfPages || 5;
          const scanned = await ocrScannedPdf(pdf, maxPages);
          text = scanned.text;
          if (scanned.truncated) rerunPageNote = `Scanned first ${scanned.pagesProcessed} of ${scanned.totalPages} pages`;
          await DB.incrementUsage(user.id, 'ocr').catch(() => {});
          status = text ? 'done' : 'failed';
          source = text ? 'ocr' : source;
        }
      } else {
        const quota = await checkOcrQuota();
        if (!quota.ok) { resetBtn(); UI.toast(quota.message); return; }
        if (typeof Tesseract === 'undefined') { resetBtn(); UI.toast('OCR engine unavailable offline'); return; }
        const prepped = await preprocessImageForOCR(blob).catch(() => blob);
        text = await runTesseractOCR(prepped);
        await DB.incrementUsage(user.id, 'ocr').catch(() => {});
        status = text ? 'done' : 'failed';
        source = text ? 'ocr' : source;
      }
    } catch (e) {
      status = 'failed';
    }

    // Only backfill fields the document doesn't already have — rerunning
    // OCR shouldn't overwrite something the student already reviewed/edited.
    const found = Extractor.analyze(text, doc.fileType);
    const patch = { ocrText: text, ocrStatus: status, textSource: source, modifiedAt: new Date().toISOString() };
    const newlyDetected = [];
    if (!doc.referenceNumber && found.referenceNumber) { patch.referenceNumber = found.referenceNumber; patch.referenceType = found.referenceType || doc.referenceType; newlyDetected.push('referenceNumber'); }
    if (!doc.amount && found.amount) { patch.amount = Number(found.amount) || 0; newlyDetected.push('amount'); }
    if (!doc.date && found.date) { patch.date = found.date; newlyDetected.push('date'); }
    if (!doc.institution && found.institution) { patch.institution = found.institution; newlyDetected.push('institution'); }
    if (!doc.extractedStudentId && found.studentId) { patch.extractedStudentId = found.studentId; newlyDetected.push('extractedStudentId'); }
    if (!doc.academicSession && found.academicSession) { patch.academicSession = found.academicSession; newlyDetected.push('academicSession'); }
    if (!doc.level && found.level) { patch.level = found.level; newlyDetected.push('level'); }
    if (!doc.semester && found.semester) { patch.semester = found.semester; newlyDetected.push('semester'); }
    if (!doc.category && found.category) { patch.category = found.category; newlyDetected.push('category'); }
    if (newlyDetected.length) patch.autoFilled = [...new Set([...(doc.autoFilled || []), ...newlyDetected])];

    docs[idx] = { ...doc, ...patch };
    try {
      await DB.saveDocuments(user.id, docs);
    } catch (err) {
      resetBtn();
      UI.toast(err.message || 'Could not save the scan result');
      return;
    }

    resetBtn();
    UI.toast(text ? `Scan complete${rerunPageNote ? ' \u2014 ' + rerunPageNote : ''}` : 'Scan didn\u2019t find readable text');
    await this.open(this.currentId);
    await Views.filterDocuments();
  },

  copyOcrText() {
    const text = document.getElementById('ocrTextContent').value;
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => UI.toast('Text copied')).catch(() => UI.toast('Copy manually \u2014 clipboard blocked'));
  },

  useOriginalName() {
    const original = document.getElementById('docModalMeta').dataset.originalBase;
    // Fallback: recompute from the currently-open doc if the dataset wasn't set.
    if (original) {
      document.getElementById('editName').value = original;
      return;
    }
  }
};

/* =========================================================
   DOCUMENTS: multi-file upload w/ OCR, clearance, cafe PIN
   ========================================================= */
/* =========================================================
   CLEARANCE ASSISTANT
   Evaluates configurable requirements (from data.json) against the
   student's documents using the same haystack the search box uses —
   category, level/semester tagging, and keyword matches in extracted
   text. Nothing here is guessed: a requirement is only "complete"
   when an actual document matches it.
   ========================================================= */
const ClearanceAssistant = {
  // A requirement applies to the current filter unless the filter is
  // "All" (in which case every requirement in the template is shown)
  // or the requirement itself has no level/semester restriction.
  applicableRequirements(filterLevel, filterSem) {
    return (CONFIG.clearanceRequirements || []).filter(r =>
      (!filterLevel || !r.level || r.level === filterLevel) &&
      (!filterSem || !r.semester || r.semester === filterSem)
    );
  },

  matchDoc(req, doc, filterLevel, filterSem) {
    if (req.category && doc.category !== req.category) return false;
    if (filterLevel && doc.level !== filterLevel) return false;
    if (filterSem && doc.semester !== filterSem) return false;
    if (req.keywords && req.keywords.length) {
      const hay = Views.buildHaystack(doc);
      return req.keywords.some(k => hay.includes(k.toLowerCase()));
    }
    return true;
  },

  evaluate(docs, filterLevel, filterSem) {
    const reqs = this.applicableRequirements(filterLevel, filterSem);
    const results = reqs.map(req => {
      const match = docs.find(d => this.matchDoc(req, d, filterLevel, filterSem));
      let reason;
      if (match) {
        const hay = Views.buildHaystack(match);
        const hitKeyword = (req.keywords || []).find(k => hay.includes(k.toLowerCase()));
        reason = hitKeyword ? `Matched "${match.name}" \u2014 mentions "${hitKeyword}"` : `Matched "${match.name}"`;
      } else {
        reason = (req.keywords && req.keywords.length)
          ? `No ${req.category ? req.category.toLowerCase() + ' ' : ''}document found mentioning: ${req.keywords.join(', ')}`
          : `No ${req.category || 'matching'} document found`;
      }
      return { req, complete: !!match, doc: match || null, reason };
    });
    const completedCount = results.filter(r => r.complete).length;
    return {
      results,
      completedCount,
      total: results.length,
      pct: results.length ? Math.round((completedCount / results.length) * 100) : 100
    };
  }
};

/* =========================================================
   PACKET BUILDER
   Ordered selection of vault documents for the clearance packet.
   Separate from Vault's bulk-select Set because order matters here.
   ========================================================= */
const PacketBuilder = {
  order: [],

  toggle(id, checked) {
    if (checked) {
      if (!this.order.includes(id)) this.order.push(id);
    } else {
      this.order = this.order.filter(x => x !== id);
    }
    Documents.updateCeCount();
    this.renderOrderPanel();
  },

  // Called whenever the level/semester filter changes so a selection
  // that's no longer visible doesn't silently stay "selected" forever.
  pruneToVisible(visibleIds) {
    this.order = this.order.filter(id => visibleIds.includes(id));
  },

  move(id, dir) {
    const idx = this.order.indexOf(id);
    if (idx === -1) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= this.order.length) return;
    [this.order[idx], this.order[swapWith]] = [this.order[swapWith], this.order[idx]];
    this.renderOrderPanel();
  },

  remove(id) {
    this.order = this.order.filter(x => x !== id);
    const cb = document.querySelector(`#clearanceList .ce-check[value="${id}"]`);
    if (cb) cb.checked = false;
    Documents.updateCeCount();
    this.renderOrderPanel();
  },

  async renderOrderPanel() {
    const panel = document.getElementById('packetOrderPanel');
    const list = document.getElementById('packetOrderList');
    if (!panel || !list) return;
    if (!this.order.length) { panel.classList.add('hidden'); list.innerHTML = ''; return; }

    panel.classList.remove('hidden');
    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    list.innerHTML = this.order.map((id, i) => {
      const d = docs.find(x => x.id === id);
      if (!d) return '';
      return `
        <div class="packet-order-row">
          <span class="packet-order-index">${i + 1}</span>
          <span class="packet-order-name">${escapeHTML(d.name)}</span>
          <div class="packet-order-actions">
            <button type="button" class="icon-btn" data-move="up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">\u2191</button>
            <button type="button" class="icon-btn" data-move="down" data-id="${id}" ${i === this.order.length - 1 ? 'disabled' : ''} aria-label="Move down">\u2193</button>
            <button type="button" class="icon-btn" data-remove="${id}" aria-label="Remove">\u00d7</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-move]').forEach(btn => {
      btn.addEventListener('click', () => this.move(btn.dataset.id, btn.dataset.move === 'up' ? -1 : 1));
    });
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => this.remove(btn.dataset.remove));
    });
  }
};

const Documents = {
  init() {
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');

    document.getElementById('chooseFileBtn').addEventListener('click', () => input.click());
    document.getElementById('scanCameraBtn').addEventListener('click', () => cameraInput.click());
    dz.addEventListener('click', e => { if (!e.target.closest('button')) input.click(); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { const files = Array.from(e.dataTransfer.files || []); if (files.length) this.handleFiles(files); });
    input.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      input.value = '';
      if (files.length) this.handleFiles(files);
    });
    // Camera capture feeds the exact same ingestion pipeline as a normal
    // upload — same validation, same extraction, same storage. On desktop
    // browsers `capture` is simply ignored and this opens a normal file
    // picker instead, which is the correct fallback behavior.
    cameraInput.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      cameraInput.value = '';
      if (files.length) this.handleFiles(files);
    });

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
    const limits = Plans.limits(user);
    const maxFileBytes = (CONFIG.upload.maxFileSizeMB || 10) * 1024 * 1024;
    const quotaBytes = limits.maxStorageMB ? limits.maxStorageMB * 1024 * 1024 : Infinity;
    const ocrLimit = Plans.ocrPerDay(user);
    let ocrUsed = await DB.usageToday(user.id, 'ocr');
    let ocrLimitHit = false;

    const queuePanel = document.getElementById('uploadQueue');
    const queueList = document.getElementById('uploadQueueList');
    queuePanel.classList.remove('hidden');
    queueList.innerHTML = files.map((f, i) => {
      const ext = (f.name.split('.').pop() || '').toUpperCase();
      return `<div class="queue-item" id="queueItem${i}">
        <span class="queue-filename">${escapeHTML(f.name)}</span>
        <span class="queue-filemeta">${ext} \u00b7 ${formatFileSize(f.size)}</span>
        <span class="queue-status">Waiting\u2026</span>
      </div>`;
    }).join('');

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

      const isPdf = file.type === 'application/pdf';
      const isImage = file.type.startsWith('image/');
      const canRunOcr = () => ocrLimit == null || ocrUsed < ocrLimit;
      const useOcr = async (source) => {
        if (!canRunOcr()) { ocrLimitHit = true; return null; }
        ocrUsed++;
        await DB.incrementUsage(user.id, 'ocr').catch(() => {});
        return source();
      };

      let extractedText = '', ocrStatus = 'skipped', textSource = 'none', ocrPageNote = '';

      if (isPdf) {
        setStatus('Reading PDF text\u2026');
        try {
          const { text, pdf } = await extractPdfText(file);
          if (text.length >= PDF_MIN_TEXT_LENGTH) {
            extractedText = text;
            ocrStatus = 'native';
            textSource = 'pdf';
          } else if (settings.ocrAutofill && typeof Tesseract !== 'undefined' && pdf) {
            setStatus('Scanning\u2026');
            const maxPages = CONFIG.upload.maxOcrPdfPages || 5;
            const scanned = await useOcr(() => ocrScannedPdf(pdf, maxPages));
            if (scanned != null) {
              extractedText = scanned.text;
              ocrStatus = scanned.text ? 'done' : 'failed';
              textSource = scanned.text ? 'ocr' : 'none';
              if (scanned.truncated) {
                ocrPageNote = `Scanned first ${scanned.pagesProcessed} of ${scanned.totalPages} pages`;
              }
            }
          }
        } catch (e) { ocrStatus = 'failed'; }
      } else if (isImage && settings.ocrAutofill && typeof Tesseract !== 'undefined') {
        setStatus('Scanning\u2026');
        const scanned = await useOcr(async () => {
          try {
            const prepped = await preprocessImageForOCR(file).catch(() => file); // fall back to the raw file if preprocessing fails
            return await runTesseractOCR(prepped);
          } catch (e) { return ''; }
        });
        if (scanned != null) {
          extractedText = scanned;
          ocrStatus = scanned ? 'done' : 'failed';
          textSource = scanned ? 'ocr' : 'none';
        }
      }

      const found = Extractor.analyze(extractedText, file.type);
      const heading = extractedText ? Extractor.findHeading(extractedText) : '';
      const suggestedName = heading ? sanitizeSuggestedName(toTitleCase(heading)) : '';
      const originalBaseName = file.name.replace(/\.[^.]+$/, '');

      const autoFilled = [];
      if (found.category) autoFilled.push('category');
      if (found.level) autoFilled.push('level');
      if (found.semester) autoFilled.push('semester');
      if (found.referenceNumber) autoFilled.push('referenceNumber');
      if (found.amount) autoFilled.push('amount');
      if (found.date) autoFilled.push('date');
      if (found.institution) autoFilled.push('institution');
      if (found.studentId) autoFilled.push('extractedStudentId');
      if (found.academicSession) autoFilled.push('academicSession');
      if (suggestedName) autoFilled.push('name');

      const now = new Date().toISOString();
      docs.unshift({
        id,
        name: suggestedName || originalBaseName,
        originalFilename: file.name,
        category: found.category || '',
        level: found.level || '',
        semester: found.semester || '',
        course: '',
        referenceType: found.referenceType || '',
        referenceNumber: found.referenceNumber || '',
        amount: Number(found.amount) || 0,
        date: found.date || '',
        size: file.size,
        fileType: file.type,
        uploadedAt: now,
        modifiedAt: now,
        hasFile: true,
        ocrText: extractedText,
        ocrStatus,
        textSource,
        institution: found.institution || '',
        extractedStudentId: found.studentId || '',
        academicSession: found.academicSession || '',
        autoFilled
      });
      newIds.push(id);
      usedBytes += file.size;
      docCount++;
      addedCount++;
      const savedLabel = ocrStatus === 'native' ? 'Saved \u00b7 text found' : (ocrStatus === 'done' ? 'Saved \u00b7 scanned' : 'Saved');
      setStatus(ocrPageNote ? `${savedLabel} \u00b7 ${ocrPageNote}` : savedLabel, 'status-ok');
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
      if (ocrLimitHit) UI.toast(`Daily OCR limit reached \u2014 some files were saved without a text scan`);
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
    const ids = PacketBuilder.order;
    if (!ids.length) { UI.toast('Select at least one document first'); return; }

    const user = await Auth.currentUser();
    const docs = await DB.getDocuments(user.id);
    const profile = await DB.getProfile(user.id);
    const selected = ids.map(id => docs.find(d => d.id === id)).filter(Boolean);
    if (!selected.length) { UI.toast('Select at least one document first'); return; }

    const level = document.getElementById('ceLevel').value;
    const sem = document.getElementById('ceSemester').value;
    const evalResult = ClearanceAssistant.evaluate(docs, level, sem);

    if (typeof window.jspdf === 'undefined') { UI.toast('PDF engine unavailable offline'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();

    // --- Cover page ---
    pdf.setFontSize(18);
    pdf.text('Clearance Packet', 14, 20);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toLocaleDateString()}`, 14, 27);

    pdf.setFontSize(12);
    pdf.text('Student', 14, 40);
    pdf.setFontSize(9);
    pdf.text(`${profile.name || 'Student'}${profile.matric ? '  \u00b7  ' + profile.matric : ''}`, 14, 47);
    pdf.text(`${profile.email || ''}`, 14, 53);
    pdf.text(`${profile.department || ''}${level ? '  \u00b7  ' + level : ''}${sem ? '  \u00b7  ' + sem + ' semester' : ''}`, 14, 59);

    pdf.setFontSize(12);
    pdf.text(`Requirements (${evalResult.pct}% complete)`, 14, 72);
    let ry = 79;
    if (evalResult.results.length) {
      evalResult.results.forEach(r => {
        pdf.setFontSize(9);
        pdf.text(`${r.complete ? '[x]' : '[ ]'} ${r.req.name} \u2014 ${r.complete ? 'Complete' : 'Missing'}`, 14, ry);
        ry += 6;
      });
    } else {
      pdf.setFontSize(9);
      pdf.text('No clearance requirements configured for this level/semester.', 14, ry);
      ry += 6;
    }

    pdf.setFontSize(12);
    pdf.text(`Included documents (${selected.length})`, 14, ry + 10);

    // --- Document detail ---
    pdf.addPage();
    let y = 20;
    selected.forEach((d, i) => {
      if (y > 265) { pdf.addPage(); y = 20; }
      pdf.setFontSize(12);
      pdf.text(`${i + 1}. ${d.name}`, 14, y);
      pdf.setFontSize(9);
      pdf.text(`${d.level} \u00b7 ${d.semester} semester${d.course ? ' \u00b7 ' + d.course : ''}${d.institution ? ' \u00b7 ' + d.institution : ''}`, 14, y + 6);
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
  document.getElementById('docModalBackBtn').addEventListener('click', () => DocModal.close());
  document.getElementById('docModal').addEventListener('click', e => { if (e.target.id === 'docModal') DocModal.close(); });
  document.getElementById('docEditForm').addEventListener('submit', e => DocModal.save(e));
  document.getElementById('deleteDocBtn').addEventListener('click', () => DocModal.delete());
  document.getElementById('printDocBtn').addEventListener('click', () => DocModal.print());
  document.getElementById('downloadDocBtn').addEventListener('click', () => DocModal.download());
  document.getElementById('rerunOcrBtn').addEventListener('click', () => DocModal.rerunOcr());
  document.getElementById('copyOcrTextBtn').addEventListener('click', () => DocModal.copyOcrText());
  document.getElementById('useOriginalNameBtn').addEventListener('click', () => DocModal.useOriginalName());
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

  // If the document modal is open and the user hits the browser/hardware
  // back button, close it instead of leaving the app on a stale view.
  // The entry was already popped by the browser, so we just clean up —
  // no further history manipulation here, which is what avoids stacking
  // up duplicate entries on repeated open/close.
  window.addEventListener('popstate', () => {
    if (DocModal.currentId && !document.getElementById('docModal').classList.contains('hidden')) {
      UI.closeModal('docModal');
      DocModal.currentId = null;
      DocModal._historyPushed = false;
    }
  });

  await router();
});