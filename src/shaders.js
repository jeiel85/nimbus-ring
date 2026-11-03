// GLSL chunks shared by the sky dome, the sea of clouds and the drifting mist.
// Everything is driven by uniforms (uTime, uSunDir) so a frame is a pure function of time.

// 2D simplex noise — Ian McEwan / Ashima Arts (MIT), github.com/ashima/webgl-noise
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Blue-hour sky: deep indigo zenith, an ember band where the sun has just set.
export const SKY = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec2 az = normalize(d.xz + 1e-5);
  float sunAz = max(dot(az, normalize(uSunDir.xz)), 0.0);
  vec3 zenith = vec3(0.008, 0.012, 0.045);
  vec3 mid = vec3(0.035, 0.05, 0.135);
  vec3 horizCool = vec3(0.15, 0.16, 0.31);
  vec3 horizWarm = vec3(1.05, 0.34, 0.11);
  vec3 horiz = mix(horizCool, horizWarm, pow(sunAz, 3.0));
  horiz = mix(horiz, vec3(0.5, 0.22, 0.26), pow(sunAz, 1.2) * 0.3 * (1.0 - pow(sunAz, 6.0)));
  vec3 col = mix(horiz, mid, smoothstep(0.0, 0.16, h));
  col = mix(col, zenith, smoothstep(0.18, 0.85, h));
  col = mix(col, horizCool * 0.55, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.36, 0.12) * pow(sd, 6.0) * 0.4;
  col += vec3(1.0, 0.6, 0.3) * pow(sd, 40.0) * 0.5 * smoothstep(-0.06, 0.02, h);
  return col;
}
`;

// Billowy cloud-sea height field. abs(noise) makes rounded heads with sharp creases.
export const CLOUD = /* glsl */ `
uniform float uTime;
const float CLOUD_BASE = -50.0;
const float CLOUD_AMP = 33.0;
float cloudField(vec2 p, int oct) {
  float s = 0.0, a = 0.5, norm = 0.0;
  vec2 q = p / 330.0;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    vec2 drift = uTime * vec2(0.010, 0.0042) * (1.0 + float(i) * 0.45);
    s += a * abs(snoise(q + drift + float(i) * 11.7));
    norm += a;
    q = rot * q * 2.07;
    a *= 0.46;
  }
  return s / norm;
}
float cloudHeight(vec2 p, int oct) {
  float swell = snoise(p / 1400.0 + uTime * 0.0015) * 0.5 + 0.5;
  return CLOUD_BASE + CLOUD_AMP * 1.35 * cloudField(p, oct) * (0.55 + 0.6 * swell);
}
`;

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragment = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
${NOISE}
${SKY}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  vec2 az = normalize(d.xz + 1e-5);
  float sunAz = max(dot(az, normalize(uSunDir.xz)), 0.0);
  float density = 0.0;
  if (d.y > -0.02) {
    // high stratus bands, projected onto a virtual ceiling
    vec2 q = d.xz / (d.y + 0.1) * 1.4 + vec2(uTime * 0.0045, uTime * 0.0017);
    q *= vec2(1.0, 2.4);
    float n = 0.0, a = 0.55;
    for (int i = 0; i < 5; i++) { n += a * snoise(q); q = q * 2.13 + 3.1; a *= 0.5; }
    density = smoothstep(0.02, 0.5, n) * smoothstep(0.015, 0.16, d.y);
    vec3 cloudCol = vec3(0.035, 0.04, 0.09);
    float under = 1.0 - smoothstep(0.0, 0.45, d.y);
    cloudCol += vec3(1.1, 0.38, 0.16) * pow(sunAz, 3.5) * under * (0.6 + 0.6 * smoothstep(0.3, 0.0, n));
    cloudCol += vec3(0.22, 0.14, 0.26) * under * 0.35;
    col = mix(col, cloudCol, density * 0.92);
  }
  // stars
  vec3 sp = d * 380.0;
  vec3 cell = floor(sp);
  float hs = hash13(cell);
  if (hs > 0.9955) {
    float s = smoothstep(0.32, 0.0, length(fract(sp) - 0.5));
    float tw = 0.65 + 0.35 * sin(uTime * 2.7 + hs * 400.0);
    col += vec3(0.85, 0.9, 1.0) * s * tw * smoothstep(0.12, 0.55, d.y) * (1.0 - density) * 2.2;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const cloudVertex = /* glsl */ `
${NOISE}
${CLOUD}
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = cloudHeight(wp.xz, 4);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const cloudFragment = /* glsl */ `
${NOISE}
${CLOUD}
${SKY}
uniform vec3 uWarmPos;
varying vec3 vWorld;
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  int oct = dist < 380.0 ? 7 : (dist < 1400.0 ? 5 : 4);
  float e = clamp(dist * 0.004, 0.7, 30.0);
  vec2 p = vWorld.xz;
  float h = cloudHeight(p, oct);
  float hx = cloudHeight(p + vec2(e, 0.0), oct);
  float hz = cloudHeight(p + vec2(0.0, e), oct);
  vec3 n = normalize(vec3(h - hx, e, h - hz));
  float hn = clamp((h - CLOUD_BASE) / (CLOUD_AMP * 1.15), 0.0, 1.0);
  float ao = mix(0.18, 1.0, smoothstep(0.02, 0.75, hn));
  vec3 L = uSunDir;

  vec3 col = vec3(0.07, 0.092, 0.2) * (0.45 + 0.55 * n.y) * ao;
  float ndl = clamp((dot(n, L) + 0.3) / 1.3, 0.0, 1.0);
  col += vec3(1.0, 0.45, 0.22) * ndl * 0.26 * smoothstep(0.3, 0.95, hn);
  col += vec3(0.45, 0.55, 0.9) * pow(max(n.y, 0.0), 5.0) * 0.1 * hn;
  // silver lining when looking into the afterglow
  float fwd = pow(max(dot(-V, L), 0.0), 4.0);
  float edge = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += vec3(1.0, 0.5, 0.25) * fwd * edge * (0.3 + hn) * 0.55;
  // warm spill from the restaurant above
  float rd = length(vWorld.xz - uWarmPos.xz);
  col += vec3(1.0, 0.5, 0.2) * 0.42 * exp(-rd / 34.0) * (0.35 + 0.65 * hn);

  float fog = 1.0 - exp(-pow(dist * 0.00021, 1.25));
  col = mix(col, skyColor(-V), fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Camera-facing mist puffs drifting over the cloud tops.
export const mistVertex = /* glsl */ `
uniform float uTime;
attribute vec4 aData; // xyz = anchor, w = size
attribute float aSeed;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vec3 c = aData.xyz;
  c.x = mod(c.x + uTime * 2.6 + 700.0, 1400.0) - 700.0;
  c.y += sin(uTime * 0.11 + aSeed * 40.0) * 2.0;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = c + (right * position.x + up * position.y * 0.55) * aData.w;
  vWorld = wp;
  float d = distance(cameraPosition, c);
  vFade = smoothstep(aData.w * 0.35, aData.w * 1.2, d) * (1.0 - smoothstep(900.0, 1400.0, abs(c.x)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const mistFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying vec3 vWorld;
${NOISE}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c * vec2(1.0, 1.4));
  float n = snoise(vUv * 3.0 + vSeed * 13.0 + uTime * 0.02) * 0.5
          + snoise(vUv * 7.0 - vSeed * 7.0 + uTime * 0.03) * 0.25;
  float a = smoothstep(0.5, 0.05, r + n * 0.18) * vFade * 0.42;
  if (a < 0.003) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  vec3 col = mix(vec3(0.12, 0.15, 0.3), vec3(0.8, 0.4, 0.22), fwd * 0.5);
  gl_FragColor = vec4(col, a);
}
`;

// Falling snow, positions are a function of seed + time (deterministic).
export const snowVertex = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 p = aSeed.xyz * vec3(260.0, 130.0, 260.0) - vec3(130.0, 50.0, 130.0);
  p.y = mod(p.y - uTime * (1.1 + aSeed.w * 0.9), 130.0) - 50.0;
  p.x += sin(uTime * 0.6 + aSeed.w * 30.0) * 1.6 + uTime * 1.4;
  p.x = mod(p.x + 130.0, 260.0) - 130.0;
  p.z += cos(uTime * 0.5 + aSeed.w * 21.0) * 1.6;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  gl_PointSize = uScale * (0.05 + aSeed.w * 0.05) / max(d, 0.1);
  vAlpha = smoothstep(0.8, 4.0, d) * (1.0 - smoothstep(90.0, 160.0, d));
  gl_Position = projectionMatrix * mv;
}
`;

export const snowFragment = /* glsl */ `
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r) * vAlpha * 0.8;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.82, 0.86, 1.0), a);
}
`;

// Final grade: split toning, lens aberration, vignette, grain, letterbox, fades.
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFade: { value: 0 },
    uWhite: { value: 0 },
    uBars: { value: 0 },
    uRes: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFade, uWhite, uBars;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.0065;
      vec3 col = vec3(
        texture2D(tDiffuse, uv - off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv + off).b
      );
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.9, 1.0, 1.14), (1.0 - l) * 0.3);
      col = mix(col, col * vec3(1.07, 1.0, 0.9), smoothstep(0.35, 1.0, l) * 0.35);
      col = (col - 0.5) * 1.05 + 0.5;
      float aspect = uRes.x / uRes.y;
      float vig = length(c * vec2(aspect / 1.6, 1.0));
      col *= mix(1.0, 0.62, smoothstep(0.32, 0.85, vig));
      float g = hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      col += g * 0.03;
      col = mix(col, vec3(0.88, 0.9, 0.97), uWhite);
      col *= 1.0 - uFade;
      if (uv.y < uBars || uv.y > 1.0 - uBars) col = vec3(0.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
