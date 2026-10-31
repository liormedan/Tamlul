import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'package.json',
  'package-lock.json',
];
const runtimeFile = 'app/server.py';
const check = process.argv[2] === '--check';
const requested = check ? null : process.argv[2]?.replace(/^v/, '');

if (!check && (!requested || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested))) {
  console.error('Usage: node tools/set-version.mjs <X.Y.Z[-prerelease]> | --check');
  process.exit(2);
}

function readLines(file) {
  const buffer = fs.readFileSync(path.join(root, file));
  const text = buffer.toString('utf8');
  return { text, newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function versionIn(file, text) {
  if (file.endsWith('.py')) return text.match(/^APP_VERSION\s*=\s*["']([^"']+)["']/m)?.[1];
  if (file.endsWith('Cargo.lock')) {
    const pkg = text.match(/\[\[package\]\]\r?\nname = "tamlul"\r?\nversion = "([^"]+)"/);
    return pkg?.[1];
  }
  if (file.endsWith('.toml')) return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (file === 'package-lock.json') return JSON.parse(text).packages[''].version;
  return JSON.parse(text).version;
}

function update(file, text, version) {
  if (file.endsWith('.py')) return text.replace(/^(APP_VERSION\s*=\s*)["'][^"']+["']/m, `$1"${version}"`);
  if (file.endsWith('Cargo.lock')) {
    return text.replace(/(\[\[package\]\]\r?\nname = "tamlul"\r?\nversion = ")[^"]+("\r?\n)/, `$1${version}$2`);
  }
  if (file.endsWith('.toml')) return text.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
  if (file === 'package-lock.json') {
    let updated = text.replace(/("version"\s*:\s*")[^"]+("\s*,)/, `$1${version}$2`);
    updated = updated.replace(/(""\s*:\s*\{\s*"name"\s*:\s*"tamlul"\s*,\s*"version"\s*:\s*")[^"]+("\s*,)/, `$1${version}$2`);
    if (versionIn(file, updated) !== version || JSON.parse(updated).packages[''].version !== version) {
      throw new Error('Could not update both package-lock version fields.');
    }
    return updated;
  }
  if (file === 'package.json' || file.endsWith('.json')) {
    return text.replace(/("version"\s*:\s*")[^"]+("(?=\s*[,}]))/, `$1${version}$2`);
  }
  throw new Error(`No version updater for ${file}`);
}

let failed = false;
for (const file of files) {
  const { text, newline } = readLines(file);
  const current = versionIn(file, text);
  if (!current) {
    console.error(`${file}: version not found`);
    failed = true;
    continue;
  }
  if (!check) {
    const updated = update(file, text, requested).replace(/\r?\n/g, newline);
    fs.writeFileSync(path.join(root, file), updated, 'utf8');
    console.log(`${file}: ${current} -> ${requested}`);
  } else {
    console.log(`${file}: ${current}`);
    if (typeof globalThis.expectedVersion === 'undefined') globalThis.expectedVersion = current;
    else if (current !== globalThis.expectedVersion) failed = true;
  }
}

const server = readLines(runtimeFile).text;
if (!/^APP_VERSION\s*=\s*os\.environ\.get\("TAMLUL_VERSION", "dev"\)\s*$/m.test(server)) {
  console.error(`${runtimeFile}: expected TAMLUL_VERSION environment fallback to dev`);
  failed = true;
} else if (check) {
  console.log(`${runtimeFile}: TAMLUL_VERSION (fallback dev)`);
}

if (check && failed) console.error('Version mismatch.');
if (failed) process.exit(1);
