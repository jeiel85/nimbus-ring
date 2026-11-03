// The film: eight drone shots, 45 seconds. Every camera is a pure function of time,
// so the live page and the offline renderer produce the exact same frames.
import * as THREE from 'three';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const ease = {
  linear: (u) => u,
  sine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  cubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: (u) => 1 - Math.pow(1 - u, 3),
  in: (u) => u * u * u,
  drift: (u) => u * 0.75 + (-(Math.cos(Math.PI * u) - 1) / 2) * 0.25,
};

function curve(...points) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return (u) => c.getPoint(clamp01(u));
}

const onRing = (radius, angle, y) => v(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

const skimPos = curve(v(-95, -5, 390), v(-62, -6.5, 280), v(-30, -6, 175), v(-8, -1, 105), v(4, 9, 64));
const skimLook = curve(v(-66, -8, 280), v(-34, -7.5, 172), v(-10, -3, 90), v(0, 3, 10), v(-2, 5, -12));
const underPos = curve(v(-16, -9, 52), v(-10, -8, 43), v(-4, -6.2, 34));
const underLook = curve(v(0, -1, 0), v(2, 1, -8), v(4, 3, -18));

const tmp = new THREE.Vector3();

export const SHOTS = [
  {
    name: 'ESTABLISHING',
    detail: 'ALT 3 650 M · WIND 4 KN',
    dur: 6.5,
    fov: 30,
    ease: ease.drift,
    shake: 0.25,
    pos: ({ e }) => v(lerp(330, 205, e), lerp(96, 60, e), lerp(640, 410, e)),
    look: ({ e }) => v(lerp(14, 0, e), lerp(12, 3, e), 0),
    fx: ({ u }) => ({ fade: 1 - smooth(0, 0.22, u) }),
  },
  {
    name: 'CLOUD SKIM',
    detail: 'ALT 3 290 M · 118 KM/H',
    dur: 5.5,
    fov: ({ e }) => lerp(74, 58, smooth(0.6, 1, e)),
    ease: ease.sine,
    shake: 0.35,
    pos: ({ e }) => skimPos(e),
    look: ({ e }) => skimLook(e),
    roll: ({ e }) => 0.16 * Math.sin(e * Math.PI * 1.3) * (1 - e),
  },
  {
    name: 'THE HALO',
    detail: 'Ø 58 M · 82 TABLES',
    dur: 5.5,
    fov: 42,
    ease: ease.linear,
    shake: 0.12,
    pos: ({ e }) => onRing(lerp(74, 62, e), lerp(0.45, 2.25, e), lerp(15, 23, e)),
    look: ({ e }) => v(0, lerp(1, -1, e), 0),
  },
  {
    name: 'DINING ROOM',
    detail: '17:52 · −12 °C OUTSIDE',
    dur: 5.5,
    fov: 34,
    ease: ease.sine,
    shake: 0.04,
    pos: ({ e }) => onRing(31.6, lerp(1.98, 1.42, e), lerp(2.3, 3.0, e)),
    look: ({ e }) => onRing(23.5, lerp(1.98, 1.42, e) - 0.2, lerp(1.7, 1.9, e)),
  },
  {
    name: 'HALO DROP',
    detail: 'DESCENT 21 M/S',
    dur: 5,
    fov: 52,
    ease: ease.in,
    shake: 0.05,
    pos: ({ e }) => v(0, lerp(96, -10, e), 0.001),
    look: ({ e }) => v(0, lerp(96, -10, e) - 50, 0),
    up: ({ u }) => {
      const a = 0.4 + u * 1.9;
      return v(Math.cos(a), 0, Math.sin(a));
    },
    fx: ({ u }) => ({ white: smooth(0.86, 0.99, u) }),
  },
  {
    name: 'UNDERSIDE',
    detail: '4 LEGS · 2 FANGS',
    dur: 5,
    fov: 56,
    ease: ease.out,
    shake: 0.1,
    pos: ({ e }) => underPos(e),
    look: ({ e }) => underLook(e),
    fx: ({ u }) => ({ white: 1 - smooth(0, 0.16, u) }),
  },
  {
    name: 'LAST CABIN',
    detail: 'CABLE 1.3 KM · 6 M/S',
    dur: 5.5,
    fov: ({ e }) => lerp(40, 34, e),
    ease: ease.sine,
    shake: 0.1,
    pos: ({ e, t, world }) => {
      const g = world.gondolaAt(t, tmp).clone();
      return g
        .addScaledVector(world.cableDir, lerp(19, 13, e))
        .addScaledVector(world.cableSide, lerp(12, 8.5, e))
        .add(v(0, lerp(0.2, 1.8, e), 0));
    },
    look: ({ t, world }) => world.gondolaAt(t, tmp).clone().addScaledVector(world.cableDir, -7).add(v(0, 0.6, 0)),
  },
  {
    name: 'FAREWELL',
    detail: 'ALT 3 650 M ↑',
    dur: 6.5,
    fov: ({ e }) => lerp(42, 30, e),
    ease: ease.cubic,
    shake: 0.15,
    pos: ({ e }) => v(lerp(15, 160, e), lerp(9, 128, e), lerp(36, 590, e)),
    look: ({ e }) => v(lerp(-6, 0, e), lerp(17, 8, e), lerp(-12, -30, e)),
    fx: ({ u }) => ({ fade: smooth(0.72, 0.94, u) }),
  },
];

let acc = 0;
for (const s of SHOTS) {
  s.start = acc;
  acc += s.dur;
}
export const DURATION = acc;

const UP = v(0, 1, 0);

// layered sines: a hand-held drone wobble that is identical on every run
function wobble(t, seed) {
  return (
    Math.sin(t * 1.37 + seed) * 0.5 +
    Math.sin(t * 2.71 + seed * 2.3) * 0.3 +
    Math.sin(t * 5.13 + seed * 4.1) * 0.2
  );
}

export function shotAt(t) {
  let i = SHOTS.length - 1;
  while (i > 0 && t < SHOTS[i].start) i--;
  return i;
}

export function evalFilm(t, camera, world) {
  t = Math.min(Math.max(t, 0), DURATION - 1e-4);
  const index = shotAt(t);
  const shot = SHOTS[index];
  const u = (t - shot.start) / shot.dur;
  const ctx = { t, u, e: shot.ease(u), world };

  camera.position.copy(shot.pos(ctx));
  camera.up.copy(shot.up ? shot.up(ctx) : UP);
  camera.lookAt(shot.look(ctx));
  if (shot.roll) camera.rotateZ(shot.roll(ctx));

  const a = shot.shake ?? 0.1;
  camera.position.add(v(wobble(t, 1) * a, wobble(t, 7) * a * 0.6, wobble(t, 13) * a));
  camera.rotateX(wobble(t * 0.9, 3) * a * 0.004);
  camera.rotateY(wobble(t * 0.8, 5) * a * 0.004);

  camera.fov = typeof shot.fov === 'function' ? shot.fov(ctx) : shot.fov;
  camera.updateProjectionMatrix();

  const fx = shot.fx ? shot.fx(ctx) : {};
  return { index, shot, u, t, fade: fx.fade ?? 0, white: fx.white ?? 0 };
}

