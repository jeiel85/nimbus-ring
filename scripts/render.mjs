// Offline renderer: drives the real page in headless Chrome, steps the film clock frame by frame,
// pipes screenshots into ffmpeg and muxes the procedural soundtrack.
//
//   node scripts/render.mjs                      → media/nimbus-ring.mp4 (1920×1080, 30 fps, 45 s)
//   node scripts/render.mjs --stills 3,9.5,20    → out/stills/*.png only
//   node scripts/render.mjs --fps 24 --width 1280 --height 720 --out out/draft.mp4
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './serve.mjs';
import { renderSoundtrack } from './soundtrack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const FPS = Number(args.fps ?? 30);
const W = Number(args.width ?? 1920);
const H = Number(args.height ?? 1080);
const OUT = path.resolve(ROOT, args.out ?? 'media/nimbus-ring.mp4');
const QUALITY = args.q ?? 'film';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found — set CHROME_PATH');

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

const server = await serve(0);
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: 600000,
});

try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') console.log(`[page ${m.type()}]`, m.text());
  });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?capture=1&q=${QUALITY}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 300000 });
  const { gpu, duration } = await page.evaluate(() => ({ gpu: window.__gpu, duration: window.__duration }));
  console.log(`GPU: ${gpu}`);
  if (/swiftshader|llvmpipe/i.test(gpu)) console.warn('warning: software rendering — this will be slow');

  const shoot = (t) =>
    page.evaluate((x) => window.__renderAt(x), t).then(() =>
      page.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false }),
    );

  if (args.stills) {
    const dir = path.join(ROOT, 'out', 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of String(args.stills).split(',').map(Number)) {
      const png = await shoot(t);
      const file = path.join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`);
      fs.writeFileSync(file, png);
      console.log('still', file);
    }
  } else {
    fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const silent = path.join(ROOT, 'out', 'video-only.mp4');
    const wav = path.join(ROOT, 'out', 'soundtrack.wav');
    const frames = Math.round(Number(args.duration ?? duration) * FPS);
    const ff = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-tune', 'film', silent],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const ffDone = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    });
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const png = await shoot(i / FPS);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % FPS === 0 || i === frames - 1) {
        const el = (Date.now() - started) / 1000;
        const eta = (el / (i + 1)) * (frames - i - 1);
        console.log(`frame ${i + 1}/${frames}  ${(i / FPS).toFixed(1)}s  elapsed ${el.toFixed(0)}s  eta ${eta.toFixed(0)}s`);
      }
    }
    ff.stdin.end();
    await ffDone;

    renderSoundtrack(wav, frames / FPS);
    // master stays in out/; the published file is a web-sized encode (film grain is expensive to keep)
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
      '-maxrate', '6M', '-bufsize', '12M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
      '-shortest', '-movflags', '+faststart', OUT]);
    console.log(`done → ${path.relative(ROOT, OUT)}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
} finally {
  await browser.close();
  server.close();
}
