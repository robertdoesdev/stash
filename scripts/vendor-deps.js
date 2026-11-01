#!/usr/bin/env node
/* Vendors the Supabase browser client into ./vendor and pins it by hash.
 *
 *   node scripts/vendor-deps.js --update   (needs internet; run by a developer, then COMMIT vendor/ + vendor.lock.json)
 *   node scripts/vendor-deps.js            (verify only; offline; used by scripts/build.js)
 *
 * Trust model: the first --update trusts the npm registry (TOFU). It checks the tarball against the
 * registry's own sha512 and records both hashes in vendor.lock.json. After that, every build re-hashes
 * vendor/supabase.js and fails on any difference, so the file served to students is the reviewed file.
 * To review it independently, compare tarballIntegrity with `npm view @supabase/supabase-js@<ver> dist.integrity`.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const LOCK = path.join(ROOT, 'vendor.lock.json');
const PKG = '@supabase/supabase-js', VERSION = '2.45.4';
const IN_TAR = 'package/dist/umd/supabase.js', OUT = 'vendor/supabase.js';

const b64 = (algo, buf) => algo + '-' + crypto.createHash(algo).update(buf).digest('base64');

function readLock() { return fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null; }

/** Offline check. Returns {ok, problem}. */
function verify(root = ROOT) {
  const lockPath = path.join(root, 'vendor.lock.json');
  if (!fs.existsSync(lockPath)) return { ok: false, problem: 'vendor.lock.json is missing' };
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lock.fileIntegrity || !lock.tarballIntegrity) return { ok: false, problem: 'vendor.lock.json has not been populated yet (run: node scripts/vendor-deps.js --update, then commit)' };
  const f = path.join(root, lock.file);
  if (!fs.existsSync(f)) return { ok: false, problem: lock.file + ' is missing' };
  const got = b64('sha384', fs.readFileSync(f));
  if (got !== lock.fileIntegrity) return { ok: false, problem: lock.file + ' does not match vendor.lock.json (expected ' + lock.fileIntegrity + ', got ' + got + ')' };
  return { ok: true };
}

/** Minimal tar reader: returns the contents of one named entry. */
function tarEntry(tar, name) {
  for (let off = 0; off + 512 <= tar.length;) {
    const hdr = tar.subarray(off, off + 512);
    if (hdr.every(b => b === 0)) break;
    let n = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = hdr.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    if (prefix) n = prefix + '/' + n;
    const size = parseInt(hdr.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(hdr[156] || 48);
    off += 512;
    if (n === name && (type === '0' || type === '\0')) return tar.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
  }
  return null;
}

async function update({ registry = process.env.STASH_NPM_REGISTRY || 'https://registry.npmjs.org', force = false, root = ROOT } = {}) {
  const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('GET ' + u + ' -> HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
  const meta = JSON.parse((await get(registry.replace(/\/$/, '') + '/' + PKG.replace('/', '%2f') + '/' + VERSION)).toString('utf8'));
  if (meta.version !== VERSION) throw new Error('registry returned version ' + meta.version + ', expected ' + VERSION);
  const claimed = meta.dist && meta.dist.integrity;
  if (!claimed || !/^sha512-/.test(claimed)) throw new Error('registry gave no sha512 integrity for the tarball');
  const tgz = await get(meta.dist.tarball);
  const actual = b64('sha512', tgz);
  if (actual !== claimed) throw new Error('tarball does not match the registry\'s own integrity value (' + actual + ' vs ' + claimed + ')');
  const lockPath = path.join(root, 'vendor.lock.json');
  const prev = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  if (prev && prev.tarballIntegrity && prev.version === VERSION && prev.tarballIntegrity !== actual && !force)
    throw new Error('this version was locked with a DIFFERENT tarball hash (' + prev.tarballIntegrity + '). A published version should never change. Investigate; use --force only if you have confirmed why.');
  const file = tarEntry(zlib.gunzipSync(tgz), IN_TAR);
  if (!file || file.length < 1000) throw new Error(IN_TAR + ' not found in the package (the build output layout may differ for this version)');
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(root, OUT), file);
  const lock = { package: PKG, version: VERSION, file: OUT, sourceInTarball: IN_TAR, tarballIntegrity: actual, fileIntegrity: b64('sha384', file), bytes: file.length };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

module.exports = { verify, update, tarEntry, PKG, VERSION };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--update')) {
    update({ force: args.includes('--force') }).then(l => {
      console.log('Vendored ' + l.package + '@' + l.version + ' -> ' + l.file + ' (' + l.bytes + ' bytes)');
      console.log('tarball ' + l.tarballIntegrity + '\nfile    ' + l.fileIntegrity);
      console.log('Next: compare the tarball hash with `npm view ' + l.package + '@' + l.version + ' dist.integrity`, then commit vendor/ and vendor.lock.json.');
    }).catch(e => { console.error('vendor-deps: ' + e.message); process.exit(1); });
  } else {
    const r = verify(); if (r.ok) console.log('vendor/ matches vendor.lock.json'); else { console.error('vendor-deps: ' + r.problem); process.exit(1); }
  }
}
