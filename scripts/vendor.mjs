// Copies the exact three.js files the page imports into vendor/three/, so the live demo
// does not depend on a CDN. Re-run after bumping the three dependency: `npm run vendor`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = path.join(ROOT, 'node_modules', 'three');
const OUT = path.join(ROOT, 'vendor', 'three');
const IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;

const copy = (rel) => {
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(THREE, rel), dst);
};

fs.rmSync(OUT, { recursive: true, force: true });
copy('build/three.module.min.js');
copy('LICENSE');

// entry points: every three/addons/* specifier used by src/
const queue = [];
for (const file of fs.readdirSync(path.join(ROOT, 'src'))) {
  const code = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  for (const [, spec] of code.matchAll(IMPORT_RE)) {
    if (spec.startsWith('three/addons/')) queue.push(`examples/jsm/${spec.slice('three/addons/'.length)}`);
  }
}

const seen = new Set();
while (queue.length) {
  const rel = queue.pop();
  if (seen.has(rel)) continue;
  seen.add(rel);
  copy(rel);
  const code = fs.readFileSync(path.join(THREE, rel), 'utf8');
  for (const [, spec] of code.matchAll(IMPORT_RE)) {
    if (spec.startsWith('.')) queue.push(path.posix.join(path.posix.dirname(rel), spec));
  }
}

const { version } = JSON.parse(fs.readFileSync(path.join(THREE, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'VERSION'), `${version}\n`);
console.log(`vendored three ${version}: ${seen.size} addon files → ${path.relative(ROOT, OUT)}`);
