// GPU cost per frame for each quality tier, sampled at one moment of every shot.
// Run before/after touching shaders or geometry budgets:  npm run bench
// It drives the capture mode, so the numbers exclude the browser's vsync/rAF throttling.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { serve } from './serve.mjs';

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found — set CHROME_PATH');

const CASES = [
  ['high', 1600, 900],
  ['low', 1600, 900],
  ['low', 412, 915],
];

const server = await serve(0);
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  protocolTimeout: 300000,
});
try {
  for (const [q, w, h] of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?capture=1&q=${q}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__ready === true', { timeout: 300000 });
    const { gpu, perShot } = await page.evaluate(() => {
      const gl = document.getElementById('scene').getContext('webgl2');
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const perShot = [];
      for (const t of [3, 9, 14, 20, 25, 30, 36, 41]) {
        window.__renderAt(t);
        sync();
        const t0 = performance.now();
        for (let i = 0; i < 6; i++) {
          window.__renderAt(t + i / 30);
          sync();
        }
        perShot.push((performance.now() - t0) / 6);
      }
      return { gpu: window.__gpu, perShot };
    });
    const worst = Math.max(...perShot);
    console.log(
      `${q.padEnd(4)} ${`${w}x${h}`.padEnd(9)} worst ${worst.toFixed(1)} ms (${(1000 / worst).toFixed(0)} fps)  per shot: ${perShot.map((m) => m.toFixed(0)).join(' ')}`,
    );
    if (q === CASES[0][0]) console.log(`     GPU: ${gpu}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
