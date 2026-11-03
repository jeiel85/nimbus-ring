import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, farHeight, CABLE_PEAK, SPIRES, smoothstep } from './terrain.js';
import * as S from './shaders.js';

export const SUN_DIR = new THREE.Vector3(0.16, -0.035, -1).normalize();
export const RING = { r: 19, R: 28 };
export const STATION = new THREE.Vector3(86, 0, 0);

// Built-in materials fog toward the sky colour of their view direction, so rock melts into the horizon.
const SKY_CONST = S.SKY.replace(
  'uniform vec3 uSunDir;',
  `const vec3 uSunDir = vec3(${SUN_DIR.x.toFixed(5)}, ${SUN_DIR.y.toFixed(5)}, ${SUN_DIR.z.toFixed(5)});`,
);
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex =
  '#ifdef USE_FOG\nvFogDepth = - mvPosition.z;\nvFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogDensity;
varying float vFogDepth;
varying vec3 vFogDir;
${SKY_CONST}
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
gl_FragColor.rgb = mix(gl_FragColor.rgb, skyColor(normalize(vFogDir)), fogFactor);
#endif`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

function canvasTexture(w, h, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function drawConcrete(g, w, h) {
  const rand = rng(7);
  g.fillStyle = '#a9a59d';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + rand() * 90;
    g.fillStyle = `rgba(${v},${v - 3},${v - 8},${0.05 + rand() * 0.08})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
  }
  for (let i = 0; i < 14; i++) {
    const x = rand() * w;
    const grad = g.createLinearGradient(x, 0, x, h);
    grad.addColorStop(0, 'rgba(40,38,36,0.10)');
    grad.addColorStop(1, 'rgba(40,38,36,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 6 + rand() * 18, h);
  }
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
}

function drawWindows(g, w, h) {
  const rand = rng(21);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, w, h);
  const pane = 32;
  for (let x = 0; x < w; x += pane) {
    const lit = rand() > 0.18;
    const k = lit ? 0.55 + rand() * 0.45 : 0.06;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(255,${170 + 40 * k},${90 + 30 * k},${k * 0.75})`);
    grad.addColorStop(0.8, `rgba(255,150,70,${k})`);
    grad.addColorStop(1, `rgba(255,130,60,${k * 0.6})`);
    g.fillStyle = grad;
    g.fillRect(x + 3, 4, pane - 6, h - 8);
  }
}

function drawCeiling(g, w, h) {
  g.fillStyle = '#9a6034';
  g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) {
    g.fillStyle = '#e8b07a';
    g.fillRect(x, 0, 5, h);
  }
  g.fillStyle = '#fff1d8';
  g.fillRect(0, h * 0.1, w, h * 0.05);
  g.fillRect(0, h * 0.85, w, h * 0.05);
}

// Each consecutive pair of profile points becomes its own band, so edges stay crisp.
// Profiles run counter-clockwise in (radius, y) so normals face outward.
function latheBands(points, segments) {
  const geos = [];
  for (let i = 0; i < points.length - 1; i++) {
    geos.push(
      new THREE.LatheGeometry(
        [new THREE.Vector2(...points[i]), new THREE.Vector2(...points[i + 1])],
        segments,
      ),
    );
  }
  return mergeGeometries(geos);
}

function placeOnRing(dummy, radius, angle, y, yaw = 0) {
  dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  dummy.rotation.set(0, -angle + yaw, 0);
  dummy.updateMatrix();
  return dummy.matrix;
}

function buildTerrainMesh(size, seg, heightFn, cutY, material, seed) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)));
  const index = g.index.array;
  const kept = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (Math.max(pos.getY(a), pos.getY(b), pos.getY(c)) > cutY) kept.push(a, b, c);
  }
  g.setIndex(kept);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const rand = rng(seed);
  const rock = lin(0.07, 0.064, 0.058);
  const rockLight = lin(0.16, 0.145, 0.13);
  const snow = lin(0.62, 0.68, 0.82);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const y = pos.getY(i);
    const jitter = (rand() - 0.5) * 0.22 + Math.sin(pos.getX(i) * 0.21 + pos.getZ(i) * 0.17) * 0.06;
    const s = smoothstep(0.3, 0.62, ny + jitter * 1.6) * smoothstep(cutY - 10, cutY + 30, y);
    c.copy(rock).lerp(rockLight, rand() * 0.6).lerp(snow, s);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(g, material);
}

export function createWorld(renderer, quality) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(lin(0.15, 0.16, 0.31), 0.00016);
  const rand = rng(1234);
  const tickers = [];

  // ---------- sky ----------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN_DIR } },
    vertexShader: S.skyVertex,
    fragmentShader: S.skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 64, 32), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
  scene.environmentIntensity = 0.8;
  pmrem.dispose();

  // ---------- light ----------
  const sun = new THREE.DirectionalLight(0xff8048, 1.1);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x5a6cb8, 0x101220, 0.7));

  // ---------- sea of clouds ----------
  const cloudSeg = quality.cloudSeg;
  const cloudGeo = new THREE.PlaneGeometry(2, 2, cloudSeg, cloudSeg);
  cloudGeo.rotateX(-Math.PI / 2);
  {
    const p = cloudGeo.attributes.position;
    const warp = (u) => Math.sign(u) * (0.035 * Math.abs(u) + 0.965 * Math.abs(u) ** 3) * 9000;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, warp(p.getX(i)), 0, warp(p.getZ(i)));
  }
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR },
      uWarmPos: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: S.cloudVertex,
    fragmentShader: S.cloudFragment,
  });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.frustumCulled = false;
  scene.add(clouds);

  // ---------- rock ----------
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93 });
  scene.add(buildTerrainMesh(900, quality.terrainSeg, terrainHeight, -80, rockMat, 3));
  scene.add(buildTerrainMesh(18000, quality.farSeg, farHeight, -75, rockMat, 4));

  // ---------- materials ----------
  const concreteMap = canvasTexture(512, 512, drawConcrete, { repeat: [44, 1] });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd6d2ca, map: concreteMap, roughness: 0.86 });
  const concreteBox = new THREE.MeshStandardMaterial({
    color: 0xd6d2ca,
    map: canvasTexture(512, 512, drawConcrete, { repeat: [4, 1] }),
    roughness: 0.88,
  });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x67625c, map: concreteMap, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.7, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c1824,
    metalness: 0.05,
    roughness: 0.04,
    transparent: true,
    opacity: 0.2,
    envMapIntensity: 1.8,
    depthWrite: false,
  });
  const glassInner = glass.clone();
  glassInner.side = THREE.BackSide;
  const led = new THREE.MeshBasicMaterial({ color: lin(5.0, 2.7, 1.25) });
  const windowsTex = canvasTexture(512, 64, drawWindows, { repeat: [10, 1] });

  // ---------- the halo ----------
  const { r, R } = RING;
  const ring = new THREE.Group();
  scene.add(ring);
  const segs = 220;

  ring.add(
    new THREE.Mesh(
      latheBands(
        [[R + 0.9, 0], [r - 0.3, 0], [r - 0.3, -0.9], [r + 2.0, -2.6], [R - 1.5, -2.6], [R + 0.9, -0.7], [R + 0.9, 0]],
        segs,
      ),
      concrete,
    ),
  );
  ring.add(
    new THREE.Mesh(
      latheBands([[R + 0.9, 4.4], [R + 0.9, 5.6], [r - 0.5, 5.6], [r - 0.5, 4.4], [r + 0.3, 4.4]], segs),
      concrete,
    ),
  );
  ring.add(new THREE.Mesh(latheBands([[R - 0.3, 4.4], [R + 0.9, 4.4]], segs), concrete));

  const ceilingMap = canvasTexture(256, 64, drawCeiling, { repeat: [90, 1] });
  ring.add(
    new THREE.Mesh(
      latheBands([[r + 0.3, 4.39], [R - 0.3, 4.39]], segs),
      new THREE.MeshBasicMaterial({ map: ceilingMap, color: lin(1.5, 1.35, 1.2) }),
    ),
  );
  ring.add(
    new THREE.Mesh(
      latheBands([[R - 0.3, 0.02], [r + 0.3, 0.02]], segs),
      new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.5, metalness: 0.05 }),
    ),
  );

  for (const [rad, y] of [[R + 0.95, 4.42], [r - 0.55, 4.42], [R + 0.93, -0.66], [R + 0.95, 5.6]]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(rad, y > 5 ? 0.03 : 0.05, 6, 320), led);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    ring.add(t);
  }

  const outerGlass = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.3, R - 0.3, 4.4, segs, 1, true), glass);
  outerGlass.position.y = 2.2;
  outerGlass.renderOrder = 2;
  ring.add(outerGlass);
  const innerGlass = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 4.4, segs, 1, true), glassInner);
  innerGlass.position.y = 2.2;
  innerGlass.renderOrder = 2;
  ring.add(innerGlass);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.75, R + 0.75, 1.1, segs, 1, true), glass);
  rail.position.y = 6.15;
  rail.renderOrder = 3;
  ring.add(rail);
  const handrail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.75, 0.04, 6, 320), metal);
  handrail.rotation.x = Math.PI / 2;
  handrail.position.y = 6.7;
  ring.add(handrail);

  const dummy = new THREE.Object3D();
  const instanced = (geo, mat, list) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    ring.add(m);
    return m;
  };

  {
    const outerM = [];
    const innerM = [];
    for (let i = 0; i < 80; i++) outerM.push(placeOnRing(dummy, R - 0.3, (i / 80) * Math.PI * 2, 2.2).clone());
    for (let i = 0; i < 54; i++) innerM.push(placeOnRing(dummy, r + 0.3, (i / 54) * Math.PI * 2, 2.2).clone());
    instanced(new THREE.BoxGeometry(0.16, 4.4, 0.09), metal, outerM.concat(innerM));
  }

  // dining room: two rows of tables, chairs, guests, candles, pendants
  const tableGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.55, 0.55, 0.05, 20).translate(0, 0.76, 0),
    new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8).translate(0, 0.37, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16).translate(0, 0.015, 0),
  ]);
  const chairGeo = mergeGeometries([
    new THREE.BoxGeometry(0.46, 0.06, 0.46).translate(0, 0.46, 0),
    new THREE.BoxGeometry(0.46, 0.55, 0.05).translate(0, 0.76, -0.22),
    new THREE.BoxGeometry(0.04, 0.44, 0.04).translate(0, 0.22, 0),
  ]);
  const guestGeo = mergeGeometries([
    new THREE.CapsuleGeometry(0.2, 0.42, 4, 10).translate(0, 0.92, -0.05),
    new THREE.SphereGeometry(0.12, 12, 10).translate(0, 1.42, 0),
  ]);
  const tables = [];
  const chairs = [];
  const guests = [];
  const guestColors = [];
  const candles = [];
  const pendants = [];
  const cords = [];
  const palette = [0x2a2f3a, 0x5b2a2a, 0x1f2b24, 0x3b3540, 0x6b5a48, 0x22262e, 0x8a7a66];
  for (const [rad, count] of [[R - 2.1, 46], [r + 2.1, 36]]) {
    for (let i = 0; i < count; i++) {
      const a = ((i + (rad > 24 ? 0 : 0.5)) / count) * Math.PI * 2;
      tables.push(placeOnRing(dummy, rad, a, 0).clone());
      candles.push(placeOnRing(dummy, rad, a, 0.83).clone());
      pendants.push(placeOnRing(dummy, rad, a, 3.15).clone());
      cords.push(placeOnRing(dummy, rad, a, 3.8).clone());
      for (const side of [-1, 1]) {
        const ca = a + (side * 0.78) / rad;
        chairs.push(placeOnRing(dummy, rad, ca, 0, side > 0 ? Math.PI : 0).clone());
        if (rand() < 0.68) {
          guests.push(placeOnRing(dummy, rad, ca, 0, side > 0 ? Math.PI : 0).clone());
          guestColors.push(new THREE.Color(palette[Math.floor(rand() * palette.length)]));
        }
      }
    }
  }
  instanced(tableGeo, new THREE.MeshStandardMaterial({ color: 0xeee4d2, roughness: 0.75 }), tables);
  instanced(chairGeo, new THREE.MeshStandardMaterial({ color: 0x2e1b12, roughness: 0.6 }), chairs);
  const guestMesh = instanced(guestGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), guests);
  guestColors.forEach((c, i) => guestMesh.setColorAt(i, c));
  const candleMesh = instanced(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial(), candles);
  const candleBase = lin(7.0, 3.0, 0.9);
  for (let i = 0; i < candles.length; i++) candleMesh.setColorAt(i, candleBase);
  instanced(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshBasicMaterial({ color: lin(3.2, 1.55, 0.6) }), pendants);
  instanced(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 4), metal, cords);
  {
    const planters = [];
    const shrubs = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.25) / n) * Math.PI * 2;
      planters.push(placeOnRing(dummy, (r + R) / 2, a, 0.45, Math.PI / 2).clone());
      shrubs.push(placeOnRing(dummy, (r + R) / 2, a, 1.15, Math.PI / 2).clone());
    }
    instanced(new THREE.BoxGeometry(2.6, 0.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.6 }), planters);
    instanced(
      new THREE.IcosahedronGeometry(0.55, 1).scale(2.2, 0.7, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1d2e1c, roughness: 0.9, flatShading: true }),
      shrubs,
    );
  }
  {
    // terrace: bollard lights and a few guests watching the afterglow
    const bollards = [];
    for (let i = 0; i < 64; i++) bollards.push(placeOnRing(dummy, R + 0.35, (i / 64) * Math.PI * 2, 5.72).clone());
    instanced(new THREE.BoxGeometry(0.12, 0.25, 0.12), led, bollards);
    const watchers = [];
    for (let i = 0; i < 18; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 2.6;
      watchers.push(placeOnRing(dummy, R - 0.4 - rand() * 2.5, a, 5.6 - 0.45, Math.PI / 2 + (rand() - 0.5)).clone());
    }
    const w = instanced(guestGeo, new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.8 }), watchers);
    w.scale.set(1, 1.08, 1);
  }

  // interior + accent lights
  for (let i = 0; i < quality.lights; i++) {
    const a = (i / quality.lights) * Math.PI * 2;
    const l = new THREE.PointLight(0xffa860, 45, 20, 2);
    l.position.set(Math.cos(a) * 23.5, 3.7, Math.sin(a) * 23.5);
    ring.add(l);
  }
  for (const a of [0.6, 2.7, 4.6].slice(0, quality.lights > 6 ? 3 : 1)) {
    const l = new THREE.PointLight(0xff9a55, 260, 55, 2);
    l.position.set(Math.cos(a) * 24, -9, Math.sin(a) * 24);
    scene.add(l);
  }

  // legs down to the two fangs
  const legs = [];
  const fangs = [SPIRES[0], SPIRES[1]];
  for (const [fang, angles] of [[fangs[0], [2.85, 3.45]], [fangs[1], [5.45, 5.95]]]) {
    for (const a of angles) {
      const top = new THREE.Vector3(Math.cos(a) * (R - 3), -2.4, Math.sin(a) * (R - 3));
      const bx = fang.x + (top.x - fang.x) * 0.3;
      const bz = fang.z + (top.z - fang.z) * 0.3;
      const base = new THREE.Vector3(bx, terrainHeight(bx, bz) - 3, bz);
      const dir = base.clone().sub(top);
      const len = dir.length();
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.3, len, 12), darkConcrete);
      leg.position.copy(top).addScaledVector(dir, 0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      scene.add(leg);
      legs.push({ top, base });
    }
  }

  // bridge + cliff station
  {
    const x0 = R + 0.6;
    const x1 = STATION.x - 8;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      scene.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(L, 0.7, 5), concreteBox, cx, -0.35, 0);
    add(new THREE.BoxGeometry(L, 0.5, 5), concreteBox, cx, 3.95, 0);
    add(new THREE.BoxGeometry(L, 1.3, 1.4), darkConcrete, cx, -1.3, 0);
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x080a0e,
      emissive: 0xffffff,
      emissiveMap: windowsTex,
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.4,
    });
    for (const side of [-1, 1]) {
      const p = add(new THREE.PlaneGeometry(L, 3.4), winMat, cx, 1.95, side * 2.45);
      if (side < 0) p.rotation.y = Math.PI;
    }
    add(new THREE.BoxGeometry(16, 10, 14), concreteBox, STATION.x, 5, 0);
    add(new THREE.BoxGeometry(13, 70, 11), darkConcrete, STATION.x + 1, -35.2, 0);
    const stationWin = winMat.clone();
    stationWin.emissiveMap = windowsTex.clone();
    stationWin.emissiveMap.repeat.set(4, 1);
    for (const [x, z, ry, w] of [[STATION.x, 7.02, 0, 15], [STATION.x, -7.02, Math.PI, 15], [STATION.x + 8.02, 0, Math.PI / 2, 13]]) {
      const p = add(new THREE.PlaneGeometry(w, 2.6), stationWin, x, 6.6, z);
      p.rotation.y = ry;
      const q = add(new THREE.PlaneGeometry(w, 2.2), stationWin, x, 2.4, z);
      q.rotation.y = ry;
    }
    const l = new THREE.PointLight(0xffa060, 160, 45, 2);
    l.position.set(STATION.x - 4, 13, 9);
    scene.add(l);
  }

  // cable car
  const cableA = new THREE.Vector3(STATION.x + 8.4, 8.6, 0);
  const cableB = new THREE.Vector3(CABLE_PEAK.x, farHeight(CABLE_PEAK.x, CABLE_PEAK.z) + 4, CABLE_PEAK.z);
  const SAG = 70;
  const cablePoint = (s, out = new THREE.Vector3()) =>
    out.lerpVectors(cableA, cableB, s).setY(THREE.MathUtils.lerp(cableA.y, cableB.y, s) - SAG * 4 * s * (1 - s));
  const cableDir = cableB.clone().sub(cableA).setY(0).normalize();
  const cableSide = new THREE.Vector3(-cableDir.z, 0, cableDir.x);
  {
    const ropeMat = new THREE.MeshBasicMaterial({ color: lin(0.03, 0.03, 0.035) });
    for (const off of [-1.2, 1.2]) {
      const pts = [];
      for (let i = 0; i <= 200; i++) pts.push(cablePoint(i / 200).addScaledVector(cableSide, off));
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.055, 4), ropeMat));
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 12), concreteBox);
    top.position.copy(cableB).add(new THREE.Vector3(0, -1.5, 0));
    scene.add(top);
    const topWin = new THREE.Mesh(new THREE.BoxGeometry(14.1, 1.6, 12.1), new THREE.MeshBasicMaterial({ color: lin(2.2, 1.0, 0.4) }));
    topWin.position.copy(top.position).add(new THREE.Vector3(0, 0.6, 0));
    scene.add(topWin);
  }
  const gondola = new THREE.Group();
  {
    const paint = new THREE.MeshStandardMaterial({ color: 0xa8241e, roughness: 0.4, metalness: 0.35 });
    const gondolaWin = windowsTex.clone();
    gondolaWin.repeat.set(0.4, 1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.5, 2.4), paint);
    gondola.add(body);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(3.64, 0.95, 2.44),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xffffff, emissiveMap: gondolaWin, emissiveIntensity: 1.7, roughness: 0.1 }),
    );
    band.position.y = 0.3;
    gondola.add(band);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.3, 2.0), metal);
    cap.position.y = 1.4;
    gondola.add(cap);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), metal);
    hanger.position.y = 3.0;
    gondola.add(hanger);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 2.8), metal);
    grip.position.y = 4.6;
    gondola.add(grip);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: lin(8, 0.4, 0.2) }));
    tail.position.set(-1.82, -0.9, 0);
    gondola.add(tail);
    gondola.rotation.y = -Math.atan2(cableDir.z, cableDir.x);
    scene.add(gondola);
  }
  const gondolaS = (t) => 0.5 + 0.47 * Math.cos(0.012 * t + 1.789);
  const gondolaAt = (t, out = new THREE.Vector3()) => cablePoint(gondolaS(t), out).add(new THREE.Vector3(0, -4.7, 0));

  // the tooth's aviation beacon
  const toothTop = (() => {
    const s = SPIRES[3];
    let best = new THREE.Vector3(s.x, -1e9, s.z);
    for (let dx = -20; dx <= 20; dx += 1) for (let dz = -20; dz <= 20; dz += 1) {
      const h = terrainHeight(s.x + dx, s.z + dz);
      if (h > best.y) best.set(s.x + dx, h, s.z + dz);
    }
    return best;
  })();
  const beaconMat = new THREE.MeshBasicMaterial({ color: lin(9, 0.5, 0.25) });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), beaconMat);
  beacon.position.copy(toothTop).add(new THREE.Vector3(0, 1.2, 0));
  scene.add(beacon);

  // sky lanterns released from the terrace
  const LANTERNS = quality.lanterns;
  const lanternMesh = new THREE.InstancedMesh(
    mergeGeometries([
      new THREE.CylinderGeometry(0.3, 0.22, 0.6, 10).translate(0, 0.3, 0),
      new THREE.SphereGeometry(0.29, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.6, 0),
    ]),
    new THREE.MeshBasicMaterial(),
    LANTERNS,
  );
  lanternMesh.frustumCulled = false;
  const lanternSeeds = Array.from({ length: LANTERNS }, () => ({
    phase: rand() * 80,
    angle: rand() * Math.PI * 2,
    radius: R - 0.5 - rand() * 3,
    sway: rand() * 10,
    speed: 1.1 + rand() * 0.6,
    flick: rand() * 50,
  }));
  scene.add(lanternMesh);
  const lanternColor = new THREE.Color();
  tickers.push((t) => {
    lanternSeeds.forEach((s, i) => {
      const age = (t + s.phase) % 80;
      const grow = smoothstep(0, 2.2, age) * (1 - smoothstep(72, 80, age));
      dummy.position.set(
        Math.cos(s.angle) * s.radius + age * 0.5 + Math.sin(age * 0.31 + s.sway) * 1.4,
        5.7 + age * s.speed,
        Math.sin(s.angle) * s.radius - age * 0.85 + Math.cos(age * 0.23 + s.sway) * 1.4,
      );
      dummy.rotation.set(Math.sin(age * 0.7 + s.sway) * 0.12, age * 0.2, Math.cos(age * 0.5 + s.sway) * 0.12);
      dummy.scale.setScalar(Math.max(grow, 0.0001));
      dummy.updateMatrix();
      lanternMesh.setMatrixAt(i, dummy.matrix);
      const f = 0.85 + 0.15 * Math.sin(t * 9.0 + s.flick) * Math.sin(t * 5.3 + s.flick * 2.0);
      lanternColor.setRGB(3.4 * f, 1.45 * f, 0.42 * f, THREE.LinearSRGBColorSpace);
      lanternMesh.setColorAt(i, lanternColor);
    });
    lanternMesh.instanceMatrix.needsUpdate = true;
    lanternMesh.instanceColor.needsUpdate = true;
  });

  // snow
  const snowGeo = new THREE.BufferGeometry();
  {
    const n = quality.snow;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = rand();
    snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  }
  const snowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1000 } },
    vertexShader: S.snowVertex,
    fragmentShader: S.snowFragment,
    transparent: true,
    depthWrite: false,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  scene.add(snow);

  // mist puffs
  const mistGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  {
    const n = quality.mist;
    const data = new Float32Array(n * 4);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = 30 + Math.sqrt(rand()) * 650;
      data.set([Math.cos(a) * d, -21 + rand() * 12, Math.sin(a) * d, 50 + rand() * 120], i * 4);
      seed[i] = rand();
    }
    mistGeo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    mistGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    mistGeo.instanceCount = n;
  }
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSunDir: { value: SUN_DIR } },
    vertexShader: S.mistVertex,
    fragmentShader: S.mistFragment,
    transparent: true,
    depthWrite: false,
  });
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 5;
  scene.add(mist);

  const gpos = new THREE.Vector3();
  function update(t, camera, viewportHeight) {
    sky.position.copy(camera.position);
    skyMat.uniforms.uTime.value = t;
    cloudMat.uniforms.uTime.value = t;
    mistMat.uniforms.uTime.value = t;
    snowMat.uniforms.uTime.value = t;
    snowMat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const tick of tickers) tick(t);

    gondolaAt(t, gpos);
    gondola.position.copy(gpos);
    gondola.rotation.z = Math.sin(t * 0.8) * 0.012;
    gondola.rotation.x = Math.sin(t * 0.6 + 1) * 0.01;

    beaconMat.color.setRGB(t % 2.2 < 0.25 ? 9 : 0.05, t % 2.2 < 0.25 ? 0.5 : 0.0, 0.25 * (t % 2.2 < 0.25), THREE.LinearSRGBColorSpace);

    for (let i = 0; i < candles.length; i++) {
      const f = 0.8 + 0.2 * Math.sin(t * 11.0 + i * 3.7) * Math.sin(t * 6.3 + i * 1.3);
      lanternColor.copy(candleBase).multiplyScalar(f);
      candleMesh.setColorAt(i, lanternColor);
    }
    candleMesh.instanceColor.needsUpdate = true;
  }

  return { scene, update, gondolaAt, cableDir, cableSide, cablePoint, legs, toothTop, STATION };
}
