// Scattered contents (Card 14e): each orb is one billboard in a single instanced mesh with one shared shader, so every orb costs
// a quad and nothing else. The shader draws the grey cloud (noise-breathing edge), virtual spark pairs that pop and annihilate,
// and a few `?` glyphs on tilted ellipses; the collapse pinch, the flash, a scatter arc and a death pinch are all functions of
// the time uniform and per-instance start times. An undecided orb and a decided-but-unseen one are the same thing here.
// Items (once revealed) and the hourglass (a party member is waiting) are plain sprites over the cloud.
import * as THREE from 'three';

const FT = 1 / 5, MAX = 256, GOLD = '#d8b45a';
const COLLAPSE = 0.9;   // seconds from collapse until the item shows
const VERT = `
attribute vec4 aPos;    // xyz rest position, w seed
attribute vec4 aFrom;   // xyz scatter origin, w start time of the arc
attribute vec4 aState;  // x collapse start (-1 none), y ring (0 none, .5 hover, 1 selected), z death start (-1 none)
uniform float uTime;
varying vec2 vP; varying vec4 vS; varying float vSeed;
void main() {
  float k = clamp((uTime - aFrom.w) / 0.55, 0.0, 1.0);
  vec3 pos = mix(aFrom.xyz, aPos.xyz, k);
  pos.y += 4.0 * k * (1.0 - k) * 0.9;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  mv.xy += position.xy * 1.25;
  gl_Position = projectionMatrix * mv;
  vP = position.xy * 2.0; vSeed = aPos.w;
  vS = vec4(aState.x < 0.0 ? -1.0 : uTime - aState.x, aState.y, aState.z < 0.0 ? -1.0 : uTime - aState.z, k);
}`;
const FRAG = `
precision highp float;
uniform float uTime; uniform sampler2D uGlyph;
varying vec2 vP; varying vec4 vS; varying float vSeed;
float h1(float n) { return fract(sin(n * 127.1 + vSeed * 311.7) * 43758.5453); }
vec2 h2(float n) { return vec2(h1(n), h1(n + 17.3)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h1(i.x + i.y * 57.0), b = h1(i.x + 1.0 + i.y * 57.0), c = h1(i.x + (i.y + 1.0) * 57.0), d = h1(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  float c = vS.x, d = vS.z;
  float pinch = c >= 0.0 ? clamp(c / 0.6, 0.0, 1.0) : 0.0;
  if (d >= 0.0) pinch = max(pinch, clamp(d / 0.5, 0.0, 1.0));
  float sc = 1.0 - pinch * pinch;
  float len = length(vP), ang = atan(vP.y, vP.x);
  float t = uTime;
  vec3 col = vec3(0.0); float a = 0.0;
  if (sc > 0.02) {
    float n = vnoise(vec2(cos(ang), sin(ang)) * 1.7 + t * 0.35) * 0.65 + vnoise(vec2(cos(ang), sin(ang)) * 3.9 - t * 0.6) * 0.35;
    float R = 0.56 * sc * (0.84 + 0.32 * n);
    float g = exp(-pow(len / R, 2.0) * 2.4);
    float core = 0.9 + 0.2 * vnoise(vP * 3.0 + t * 0.5);
    col = vec3(0.60, 0.62, 0.67) * core; a = g * 0.72;
    // virtual pairs: appear from nothing, drift apart, fall back together and vanish
    for (int i = 0; i < 6; i++) {
      float fi = float(i), per = 1.1 + h1(fi) * 0.9, ph = fract(t / per + h1(fi + 9.0)), cyc = floor(t / per + h1(fi + 9.0));
      vec2 ctr = (h2(fi * 7.0 + cyc * 3.1) - 0.5) * 0.7 * sc, dir = normalize(h2(fi * 5.0 + cyc * 1.7) - 0.5 + 0.001);
      float sep = 0.16 * sin(3.14159 * ph), life = sin(3.14159 * ph);
      float s = exp(-pow(length(vP - (ctr + dir * sep)) / 0.035, 2.0)) + exp(-pow(length(vP - (ctr - dir * sep)) / 0.035, 2.0));
      float burst = exp(-pow((ph - 0.97) * 22.0, 2.0)) * exp(-pow(length(vP - ctr) / 0.07, 2.0));
      float sa = (s * life + burst) * sc;
      col = mix(col, vec3(0.93, 0.95, 1.0), clamp(sa, 0.0, 1.0)); a = max(a, clamp(sa, 0.0, 1.0));
    }
  }
  // ? glyphs on tilted ellipses; they fly outward when the orb collapses and shrink away when it dies
  float fly = c >= 0.0 ? c : 0.0, gk = d >= 0.0 ? 1.0 - clamp(d / 0.5, 0.0, 1.0) : 1.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), th = t * (0.7 + 0.25 * h1(fi + 3.0)) * (mod(fi, 2.0) < 1.0 ? 1.0 : -1.0) + h1(fi) * 6.283, tilt = h1(fi + 5.0) * 3.14159;
    vec2 e = vec2(cos(th) * 0.74, sin(th) * 0.26);
    e = vec2(e.x * cos(tilt) - e.y * sin(tilt), e.x * sin(tilt) + e.y * cos(tilt));
    float depth = sin(th) * 0.5 + 0.5;
    e *= 1.0 + fly * 5.0;
    float gs = (0.18 + 0.06 * depth) * gk, alpha = (0.5 + 0.4 * depth) * gk * (1.0 - clamp(fly / 0.7, 0.0, 1.0));
    vec2 uv = (vP - e) / (2.0 * gs) + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && alpha > 0.0) {
      float ga = texture2D(uGlyph, uv).a * alpha;
      col = mix(col, vec3(0.92, 0.9, 0.82), ga); a = max(a, ga);
    }
  }
  if (c >= 0.5) {   // the flash as it pinches shut
    float f = exp(-pow((c - 0.62) * 6.5, 2.0));
    float fl = f * (exp(-pow(len / 0.22, 2.0)) + 0.35 * exp(-pow(len / 0.7, 2.0)));
    col = mix(col, vec3(1.0, 0.97, 0.88), clamp(fl, 0.0, 1.0)); a = max(a, clamp(fl, 0.0, 1.0));
  }
  if (vS.y > 0.0) {   // selection / hover ring
    float ring = exp(-pow((len - 0.72) / 0.035, 2.0)) * vS.y * 0.9 * (c >= 0.0 && c > 0.8 ? 0.0 : 1.0);
    col = mix(col, vec3(0.847, 0.706, 0.353), clamp(ring, 0.0, 1.0)); a = max(a, ring);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

const glyphTex = (draw, w, h) => {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const parse = (c) => [c.charCodeAt(0) - 65, parseInt(c.slice(1), 10) - 1];

export function createOrbs3D(scene) {
  const group = new THREE.Group(); group.name = 'orbs'; scene.add(group);
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position'));
  const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aPos = mk(), aFrom = mk(), aState = mk();
  geo.setAttribute('aPos', aPos); geo.setAttribute('aFrom', aFrom); geo.setAttribute('aState', aState);
  geo.instanceCount = 0;
  const qMark = glyphTex((g, w, h) => { g.fillStyle = '#fff'; g.font = `700 ${h * 0.86}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, h * 0.54); }, 64, 64);
  const hourTex = glyphTex((g, w, h) => {
    g.strokeStyle = GOLD; g.fillStyle = 'rgba(216,180,90,.85)'; g.lineWidth = 5; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(14, 8); g.lineTo(50, 8); g.lineTo(34, 32); g.lineTo(50, 56); g.lineTo(14, 56); g.lineTo(30, 32); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(22, 14); g.lineTo(42, 14); g.lineTo(32, 28); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(20, 54); g.lineTo(44, 54); g.lineTo(32, 40); g.closePath(); g.fill();
  }, 64, 64);
  const uniforms = { uTime: { value: 0 }, uGlyph: { value: qMark } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; group.add(mesh);
  const hourMat = new THREE.SpriteMaterial({ map: hourTex, transparent: true, depthWrite: false });
  const labels = new Map();   // item name -> { mat, aspect }
  const label = (name) => {
    let l = labels.get(name);
    if (l) return l;
    const cv = document.createElement('canvas'), g = cv.getContext('2d'), f = '600 34px "IBM Plex Sans", system-ui, sans-serif';
    g.font = f; const w = Math.ceil(g.measureText(name).width) + 40; cv.width = w; cv.height = 56;
    g.font = f; g.fillStyle = 'rgba(27,26,21,.86)'; g.strokeStyle = GOLD; g.lineWidth = 3;
    g.beginPath(); g.roundRect(3, 3, w - 6, 50, 14); g.fill(); g.stroke();
    g.fillStyle = '#f1ead6'; g.textBaseline = 'middle'; g.fillText(name, 20, 29);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    labels.set(name, l = { mat: new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }), aspect: w / 56 });
    return l;
  };

  const recs = new Map();   // id -> { at, pos, seed, from, t0, col, dead, item, pending, ring, hour, tag }
  const arcs = new Map();   // id -> { from, t0 }: scatter starts that arrived before or after their orb
  const clock0 = performance.now(), now = () => (performance.now() - clock0) / 1000;
  let sig = '', floorFt = () => 0, dirty = true, sel = null, hov = null;

  const cellPos = (cell, jit) => {
    const [x, y] = parse(cell);
    return [x + 0.5 + (jit[0] - 0.5) * 0.3, floorFt(x, y) * FT + 0.5, y + 0.5 + (jit[1] - 0.5) * 0.3];
  };
  const sprite = (mat, sx, sy, p, y) => {
    const s = new THREE.Sprite(mat); s.scale.set(sx, sy, 1); s.position.set(p[0], p[1] + y, p[2]); s.renderOrder = 6; group.add(s); return s;
  };
  const dropSprites = (r) => { for (const k of ['tag', 'hour']) if (r[k]) { group.remove(r[k]); r[k] = null; } };

  function sync(v, floor) {
    floorFt = floor;
    const list = (v.orbs || []).slice(0, MAX), s = JSON.stringify(list.map((o) => [o.id, o.at, o.item && o.item.name, o.item && o.item.qty, !!o.pending]));
    if (s === sig) return;
    sig = s; dirty = true;
    const t = now(), ids = new Set(list.map((o) => o.id));
    for (const [id, r] of recs) if (!ids.has(id) && r.dead < 0) { r.dead = t; dropSprites(r); }
    for (const o of list) {
      let r = recs.get(o.id);
      if (!r) {
        const seed = hash(o.id), a = arcs.get(o.id);
        r = { seed, dead: -1, col: -1, from: a ? a.from : null, t0: a ? a.t0 : -100, ring: 0 };
        recs.set(o.id, r);
      }
      r.dead = -1; r.at = o.at; r.pos = cellPos(o.at, [hash(o.id + 'x'), hash(o.id + 'y')]);
      if (!r.from) r.from = r.pos;
      const it = o.item, key = it ? it.name + (it.qty > 1 ? ' ×' + it.qty : '') : null;
      if (key !== r.key) {
        r.key = key; r.keyAt = t; if (r.tag) { group.remove(r.tag); r.tag = null; }
        if (key) { const l = label(key); r.tag = sprite(l.mat, 0.22 * l.aspect, 0.22, r.pos, -0.2); r.tag.visible = false; }
      }
      if (o.pending && !it) { if (!r.hour) r.hour = sprite(hourMat, 0.34, 0.34, r.pos, 0.95); } else if (r.hour) { group.remove(r.hour); r.hour = null; }
    }
  }

  function write() {
    let n = 0;
    for (const [id, r] of recs) {
      if (n >= MAX) break;
      aPos.setXYZW(n, r.pos[0], r.pos[1], r.pos[2], r.seed * 20);
      aFrom.setXYZW(n, r.from[0], r.from[1], r.from[2], r.t0);
      aState.setXYZW(n, r.col, id === sel ? 1 : id === hov ? 0.5 : 0, r.dead, 0);
      r.slot = n++;
    }
    geo.instanceCount = n;
    aPos.needsUpdate = aFrom.needsUpdate = aState.needsUpdate = true;
    dirty = false;
  }

  function step() {
    const t = uniforms.uTime.value = now();
    for (const [id, r] of recs) {
      if (r.dead >= 0 && t - r.dead > 0.7) { dropSprites(r); recs.delete(id); arcs.delete(id); dirty = true; sig += '|'; continue; }
      if (r.key && r.col < 0 && t - r.keyAt > 0.15) { r.col = t - 100; dirty = true; }   // revealed before this page saw it: no cloud
      const resting = t - r.t0 > 0.55 && (r.col < 0 || t - r.col > COLLAPSE);
      if (r.tag) r.tag.visible = resting;
      if (r.hour) { r.hour.visible = t - r.t0 > 0.55; r.hour.position.y = r.pos[1] + 0.95 + Math.sin(t * 2.2 + r.seed * 9) * 0.04; }
    }
    if (dirty) write();
  }
  // Orbs puff out of the container's square to their own (a short arc). Works before or after the orbs reach `sync`.
  function scatter(from, ids) {
    const [x, y] = parse(from), p = [x + 0.5, floorFt(x, y) * FT + 0.6, y + 0.5], t = now();
    for (const id of ids) {
      arcs.set(id, { from: p, t0: t });
      const r = recs.get(id); if (r) { r.from = p; r.t0 = t; dirty = true; }
    }
  }
  // The cloud pinches to a point with a flash and the item shows after COLLAPSE seconds. Returns the delay.
  function collapse(id) {
    const r = recs.get(id); if (!r) return 0;
    r.col = now(); dirty = true; if (r.tag) r.tag.visible = false;
    return COLLAPSE;
  }
  // The orb under the ray (terrain nearer than `terrainDist` wins): { id, distance } | null
  function pick(ray, terrainDist = Infinity) {
    let best = null; const c = new THREE.Vector3(), hit = new THREE.Vector3(), sph = new THREE.Sphere(c, 0.42);
    for (const [id, r] of recs) {
      if (r.dead >= 0 || (r.col >= 0 && !r.tag)) continue;
      c.set(r.pos[0], r.pos[1], r.pos[2]);
      if (ray.ray.intersectSphere(sph, hit)) { const d = ray.ray.origin.distanceTo(hit); if (d <= terrainDist + 0.05 && (!best || d < best.distance)) best = { id, distance: d }; }
    }
    return best;
  }
  function highlight(selected, hovered) {
    const s = recs.has(selected) ? selected : null, h = recs.has(hovered) && hovered !== s ? hovered : null;
    if (s !== sel || h !== hov) { sel = s; hov = h; dirty = true; }
  }
  function dispose() {
    scene.remove(group);
    geo.dispose(); quad.dispose(); mat.dispose(); qMark.dispose(); hourTex.dispose(); hourMat.dispose();
    for (const l of labels.values()) { l.mat.map.dispose(); l.mat.dispose(); }
    labels.clear(); recs.clear();
  }
  return { sync, step, scatter, collapse, pick, highlight, has: (id) => { const r = recs.get(id); return !!r && r.dead < 0; }, dispose };
}
