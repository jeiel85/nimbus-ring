import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld } from './world.js';
import { createPost } from './post.js';
import { SHOTS, DURATION, evalFilm } from './shots.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const tier = params.get('q') ?? (CAPTURE ? 'film' : mobile ? 'low' : 'high');
const TIERS = {
  film: { cloudSeg: 820, terrainSeg: 380, farSeg: 340, lights: 12, snow: 7000, mist: 54, lanterns: 90, samples: 4, maxDpr: 1 },
  high: { cloudSeg: 600, terrainSeg: 320, farSeg: 300, lights: 12, snow: 6000, mist: 46, lanterns: 80, samples: 4, maxDpr: 1.5 },
  low: { cloudSeg: 300, terrainSeg: 220, farSeg: 200, lights: 6, snow: 2500, mist: 26, lanterns: 50, samples: 0, maxDpr: 1 },
};
const QUALITY = TIERS[tier];
if (!QUALITY) throw new Error(`unknown quality tier "${tier}" (use film, high or low)`);

if (CAPTURE) document.body.classList.add('capture');

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: CAPTURE,
  });
} catch (err) {
  window.__fail('This browser could not start WebGL 2, so the real-time scene cannot run here.');
  throw err;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.maxDpr));
renderer.setSize(innerWidth, innerHeight, false);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 25000);
const world = createWorld(renderer, QUALITY);
const post = createPost(renderer, world.scene, camera, QUALITY.samples);

// ---------- overlay: titles + shot captions ----------
const $ = (id) => document.getElementById(id);
const titleCard = $('title-card');
const endCard = $('end-card');
const capLeft = $('cap-left');
const capRight = $('cap-right');
const captions = $('captions');
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function letterbox() {
  const aspect = innerWidth / innerHeight;
  return aspect < 1.2 ? 0 : Math.max(0, (1 - aspect / 2.39) / 2);
}

function applyOverlay(state, bars) {
  const { t, shot, index } = state;
  titleCard.style.opacity = smooth(1.0, 2.2, t) * (1 - smooth(4.6, 5.9, t));
  endCard.style.opacity = smooth(42.4, 43.6, t);
  const local = t - shot.start;
  captions.style.opacity = bars > 0.02 ? smooth(0.25, 0.7, local) * (1 - smooth(shot.dur - 0.45, shot.dur - 0.05, local)) : 0;
  const label = `${String(index + 1).padStart(2, '0')} — ${shot.name}`;
  if (capLeft.textContent !== label) capLeft.textContent = label;
  if (capRight.textContent !== shot.detail) capRight.textContent = shot.detail;
  document.documentElement.style.setProperty('--bar', `${(bars * 100).toFixed(3)}vh`);
}

function renderFilmFrame(t) {
  const state = evalFilm(t, camera, world);
  if (camera.aspect < 16 / 9) {
    // narrow screens keep the film's horizontal framing instead of cropping it
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (16 / 9) / camera.aspect);
    camera.fov = Math.min(95, THREE.MathUtils.radToDeg(half * 2));
    camera.updateProjectionMatrix();
  }
  world.update(t, camera, renderer.getDrawingBufferSize(tmpSize).y);
  const bars = letterboxOn ? letterbox() : 0;
  post.grade.uTime.value = t;
  post.grade.uFade.value = state.fade;
  post.grade.uWhite.value = state.white;
  post.grade.uBars.value = bars;
  post.render();
  applyOverlay(state, bars);
  return state;
}
const tmpSize = new THREE.Vector2();
let letterboxOn = true;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.resize();
}
addEventListener('resize', resize);

// the GPU can reclaim the context (driver reset, mobile memory pressure); nothing survives that
canvas.addEventListener('webglcontextlost', (ev) => {
  ev.preventDefault();
  renderer.setAnimationLoop(null);
  window.__fail('The GPU reset the 3D context. Reload the page to start the scene again.', { reload: true });
});

// ---------- offline capture hook (scripts/render.mjs) ----------
if (CAPTURE) {
  window.__duration = DURATION;
  window.__renderAt = (t) => {
    if (window.__failed) throw new Error(window.__failed);
    const { fade, white } = renderFilmFrame(t);
    return { fade, white };
  };
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  window.__gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  document.fonts.ready.then(() => {
    renderer.compile(world.scene, camera);
    renderFilmFrame(0);
    window.__ready = true;
  });
} else {
  startInteractive();
}

// ---------- live page ----------
function startInteractive() {
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 10;
  controls.maxDistance = 1400;
  controls.maxPolarAngle = Math.PI * 0.6;
  controls.target.set(0, 2, 0);

  const timeline = $('timeline');
  const playhead = $('playhead');
  const modeButtons = document.querySelectorAll('[data-mode]');
  const playBtn = $('play');
  for (const [i, s] of SHOTS.entries()) {
    const seg = document.createElement('button');
    seg.className = 'seg';
    seg.style.flexGrow = s.dur;
    seg.title = `${String(i + 1).padStart(2, '0')} ${s.name}`;
    seg.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span>`;
    seg.addEventListener('click', () => {
      setMode('film');
      filmTime = s.start + 0.001;
      playing = true;
    });
    timeline.insertBefore(seg, playhead);
  }
  timeline.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.seg')) return;
    const rect = timeline.getBoundingClientRect();
    filmTime = ((ev.clientX - rect.left) / rect.width) * DURATION;
  });

  let mode = 'film';
  let playing = true;
  let filmTime = 0;
  let worldTime = 0;
  let last = performance.now();

  function setMode(m) {
    mode = m;
    document.body.dataset.mode = m;
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    controls.enabled = m === 'explore';
    letterboxOn = m === 'film';
    if (m === 'explore') {
      worldTime = filmTime;
      titleCard.style.opacity = 0;
      endCard.style.opacity = 0;
      captions.style.opacity = 0;
      document.documentElement.style.setProperty('--bar', '0vh');
      camera.up.set(0, 1, 0);
      camera.fov = 45;
      camera.position.set(72, 26, 96);
      controls.target.set(0, 2, 0);
      controls.update();
    }
  }
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  playBtn.addEventListener('click', () => {
    if (mode !== 'film') setMode('film');
    else playing = !playing;
    playBtn.setAttribute('aria-pressed', String(!playing));
  });
  addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' && mode === 'film') {
      playing = !playing;
      playBtn.setAttribute('aria-pressed', String(!playing));
      ev.preventDefault();
    }
  });

  const dialog = $('film-dialog');
  const video = dialog.querySelector('video');
  $('watch').addEventListener('click', () => {
    playing = false;
    dialog.showModal();
    video.play().catch(() => {});
  });
  dialog.addEventListener('close', () => video.pause());
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });

  // resolution follows the GPU: drop it while the film can't hold ~30 fps, climb back when there is headroom.
  // `ceiling` remembers the last ratio that was too slow so it doesn't oscillate around it.
  const maxPr = Math.min(devicePixelRatio, QUALITY.maxDpr);
  let ceiling = Infinity;
  let slowFrames = 0;
  let fastFrames = 0;
  let sampled = 0;
  function adapt(dt) {
    if (document.hidden || dialog.open) return;
    sampled++;
    if (dt > 1 / 28) slowFrames++;
    if (dt < 1 / 50) fastFrames++;
    if (sampled < 90) return;
    const pr = renderer.getPixelRatio();
    let next = pr;
    if (slowFrames > 60 && pr > 0.6) {
      ceiling = pr;
      next = Math.max(0.6, pr * 0.8);
    } else if (fastFrames > 80 && pr < maxPr) {
      next = Math.max(pr, Math.min(maxPr, pr * 1.15, ceiling * 0.95));
    }
    if (Math.abs(next - pr) > 0.01) {
      renderer.setPixelRatio(next);
      resize();
    }
    sampled = 0;
    slowFrames = 0;
    fastFrames = 0;
  }

  setMode('film');
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    adapt(dt);
    if (mode === 'film') {
      if (playing) filmTime = (filmTime + dt) % DURATION;
      renderFilmFrame(filmTime);
      playhead.style.left = `${(filmTime / DURATION) * 100}%`;
    } else {
      worldTime += dt;
      controls.update();
      camera.updateProjectionMatrix();
      world.update(worldTime, camera, renderer.getDrawingBufferSize(tmpSize).y);
      post.grade.uTime.value = worldTime;
      post.grade.uFade.value = 0;
      post.grade.uWhite.value = 0;
      post.grade.uBars.value = 0;
      post.render();
    }
  });
  document.body.classList.add('ready');
}
