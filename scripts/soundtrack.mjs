// Procedural score for the film: slow pad chords, high-altitude wind, a few bell tones.
// Deterministic (seeded) so every render gets the same audio. Writes 16-bit stereo WAV.
import fs from 'node:fs';

const SR = 48000;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// [start, end, notes] — chords overlap by a couple of seconds and crossfade
const CHORDS = [
  [0, 13, [45, 52, 59, 61, 64]], // A add9
  [11, 24, [42, 49, 57, 64, 66]], // F#m add11
  [22, 34, [38, 45, 54, 61, 64]], // D maj9
  [32, 41, [40, 47, 57, 64, 71]], // E sus4
  [39, 45, [45, 52, 61, 64, 69]], // A
];

function reverb(input) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d), i: 0, fb: 0.84, lp: 0 }));
  const allp = [225, 556].map((d) => ({ buf: new Float32Array(d), i: 0 }));
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * 0.6 + c.lp * 0.4;
      c.buf[c.i] = input[n] + c.lp * c.fb;
      c.i = (c.i + 1) % c.buf.length;
      s += y;
    }
    s *= 0.25;
    for (const a of allp) {
      const y = a.buf[a.i];
      a.buf[a.i] = s + y * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      s = y - s * 0.5;
    }
    out[n] = s;
  }
  return out;
}

export function renderSoundtrack(file, duration = 45) {
  const N = Math.round(duration * SR);
  const L = new Float32Array(N);
  const Rr = new Float32Array(N);
  const rand = rng(99);

  // pads
  for (const [start, end, notes] of CHORDS) {
    const env = (t) => smooth(start, start + 2.5, t) * (1 - smooth(end - 2.5, end, t));
    notes.forEach((note, k) => {
      const f = midi(note);
      const amp = (k === 0 ? 0.16 : 0.085) / (1 + k * 0.15);
      const detune = [0.9985, 1, 1.0016];
      const phase = detune.map(() => rand() * Math.PI * 2);
      const n0 = Math.floor(start * SR);
      const n1 = Math.min(N, Math.ceil(end * SR));
      for (let n = n0; n < n1; n++) {
        const t = n / SR;
        const e = env(t) * amp * (0.8 + 0.2 * Math.sin(t * 0.4 + k));
        let l = 0;
        let r = 0;
        for (let d = 0; d < 3; d++) {
          const w = 2 * Math.PI * f * detune[d] * t + phase[d];
          const s = Math.sin(w) + 0.18 * Math.sin(2 * w) + 0.06 * Math.sin(3 * w);
          l += s * (d === 0 ? 0.6 : d === 1 ? 0.5 : 0.25);
          r += s * (d === 2 ? 0.6 : d === 1 ? 0.5 : 0.25);
        }
        L[n] += l * e;
        Rr[n] += r * e;
      }
    });
  }

  // bell tones in the quiet shots
  const bellTimes = [];
  for (let t = 17.8; t < 23; t += 0.7 + rand() * 0.6) bellTimes.push(t);
  for (let t = 38.8; t < 43.5; t += 0.6 + rand() * 0.7) bellTimes.push(t);
  for (const t0 of bellTimes) {
    const chord = CHORDS.filter(([s, e]) => t0 >= s && t0 < e).at(-1)[2];
    const f = midi(chord[2 + Math.floor(rand() * 3)] + 12);
    const pan = rand();
    const n0 = Math.floor(t0 * SR);
    for (let n = n0; n < Math.min(N, n0 + SR * 4); n++) {
      const t = (n - n0) / SR;
      const s = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.4) * 0.07;
      L[n] += s * (1 - pan);
      Rr[n] += s * pan;
    }
  }

  // reverb on the musical layer
  const wetL = reverb(L);
  const wetR = reverb(Rr);
  for (let n = 0; n < N; n++) {
    L[n] = L[n] * 0.75 + wetL[n] * 0.55;
    Rr[n] = Rr[n] * 0.75 + wetR[n] * 0.55;
  }

  // wind: band-limited noise, gusts on the fast shots and the cloud plunge
  let lp1L = 0, lp2L = 0, lp1R = 0, lp2R = 0;
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const gust =
      0.35 +
      0.25 * Math.sin(t * 0.37) +
      1.1 * smooth(6.3, 7.5, t) * (1 - smooth(11.2, 12.2, t)) +
      0.9 * smooth(25.5, 27.9, t) * (1 - smooth(28.1, 29.4, t)) +
      0.4 * smooth(38.5, 41, t);
    const cut = 0.012 + 0.03 * Math.min(1.2, gust);
    lp1L += (rand() * 2 - 1 - lp1L) * cut;
    lp2L += (lp1L - lp2L) * cut;
    lp1R += (rand() * 2 - 1 - lp1R) * cut;
    lp2R += (lp1R - lp2R) * cut;
    L[n] += lp2L * gust * 1.4;
    Rr[n] += lp2R * gust * 1.4;
  }

  // low swells on the title and on the reveal under the halo
  for (const [t0, f] of [[1.0, 41], [28.0, 38], [12.0, 46]]) {
    const n0 = Math.floor(t0 * SR);
    for (let n = n0; n < Math.min(N, n0 + SR * 5); n++) {
      const t = (n - n0) / SR;
      const s = Math.sin(2 * Math.PI * f * t) * Math.min(1, t * 8) * Math.exp(-t * 0.9) * 0.22;
      L[n] += s;
      Rr[n] += s;
    }
  }

  // master: fades, soft clip, normalise
  let peak = 0;
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const g = smooth(0, 1.8, t) * (1 - smooth(duration - 2.8, duration - 0.1, t));
    L[n] = Math.tanh(L[n] * g * 1.2);
    Rr[n] = Math.tanh(Rr[n] * g * 1.2);
    peak = Math.max(peak, Math.abs(L[n]), Math.abs(Rr[n]));
  }
  const norm = 0.89 / peak;
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 4, 40);
  for (let n = 0; n < N; n++) {
    buf.writeInt16LE(Math.round(L[n] * norm * 32767), 44 + n * 4);
    buf.writeInt16LE(Math.round(Rr[n] * norm * 32767), 46 + n * 4);
  }
  fs.writeFileSync(file, buf);
}
