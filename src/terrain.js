// Procedural rock: a few hand-placed spires piercing the cloud sea, plus a far range on the horizon.
// Pure functions of (x, z) so the camera rig and the render script can sample the same ground.
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const perlin = new ImprovedNoise();
const BASE = -170;

// x, z: centre · top: summit height (m) · w: footprint radius
export const SPIRES = [
  { x: -47, z: 5, top: 9, w: 60 }, // west fang — carries two legs
  { x: 39, z: -19, top: -2, w: 56 }, // east fang — carries two legs
  { x: 95, z: 3, top: -7, w: 64 }, // station massif under the bridge
  { x: -140, z: -180, top: 84, w: 80 }, // the tooth, beacon on top
  { x: 160, z: -125, top: 32, w: 86 },
  { x: -70, z: 150, top: -24, w: 60 },
  { x: 215, z: 95, top: 6, w: 72 },
  { x: -240, z: 20, top: 28, w: 92 },
  { x: 40, z: -330, top: 46, w: 110 },
];

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function smax(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

function ridged(x, z, octaves, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let prev = 1;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(perlin.noise(x * f, z * f, seed + i * 7.31));
    n *= n;
    sum += n * amp * prev;
    prev = Math.min(1, n * 1.6);
    amp *= 0.5;
    f *= 2.07;
  }
  return sum;
}

export function terrainHeight(x, z) {
  const wx = x + perlin.noise(x * 0.012, z * 0.012, 3.3) * 7 + perlin.noise(x * 0.05, z * 0.05, 5.5) * 4;
  const wz = z + perlin.noise(x * 0.012, z * 0.012, 8.1) * 7 + perlin.noise(x * 0.05, z * 0.05, 9.9) * 4;
  let peak = BASE;
  for (const s of SPIRES) {
    const d = Math.hypot(wx - s.x, wz - s.z);
    const k = Math.max(0, 1 - d / s.w);
    peak = smax(peak, BASE + (s.top - BASE) * Math.pow(k, 1.4), 10);
  }
  const detail = ridged(x * 0.03, z * 0.03, 5, 1.7);
  const mask = smoothstep(BASE + 20, BASE + 150, peak);
  return peak + (detail - 0.42) * 32 * mask;
}

export const CABLE_PEAK = { x: 1050, z: 720 };

export function farHeight(x, z) {
  const d = Math.hypot(x, z);
  const env = smoothstep(1100, 4300, d);
  const towardSun = -z / (d + 1e-6);
  const sunCut = 1 - 0.6 * smoothstep(0.55, 0.97, towardSun);
  const r = ridged(x * 0.00042, z * 0.00042, 6, 11.3);
  let h = -230 + env * sunCut * r * r * 1500;
  const dg = Math.hypot(x - CABLE_PEAK.x, z - CABLE_PEAK.z);
  h = smax(h, -230 + 360 * Math.pow(Math.max(0, 1 - dg / 300), 1.5), 20);
  return h;
}
