// 3D battlemap. Reads the same view the 2D map does (/api/state) and draws it with three.js:
// one textured column per cell at its floor height, props on top, walls along grid lines,
// tokens as standees. One world unit is one 5-ft square; y is up; cell (x, y) sits at
// world x..x+1, z = y..y+1.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as TX from './textures.js';
import { buildBarracksProp } from './barracks-props.js';
import { createMarks, STEM_W } from './marks3d.js';
import { createProps3D } from './props3d.js';

const FT = 1 / 5;
const VARIANTS = 4;
const SIDE_COLOR = { party: '#4fb3a4', enemy: '#cf6a4c', neutral: '#a59f8e' };
const SECRET = '#a98bd6';
const GOLD = '#d8b45a';
const WALL_FT = { wall: 8, door: 7, window: 8, low: 3 };

// Floors are the mockup's flat checkerboard: two shades per terrain, alternating by (x + y) % 2, no texture. Flip TEXTURED to
// bring the painted textures back (that path is untouched). A bare string is one flat tone with no checker.
const TEXTURED = false;
const FLOOR_TONES = {
  flagstone: ['#3d382e', '#37332a'], dirt: ['#403628', '#3a3023'], grass: ['#363b2a', '#313625'], planks: ['#4d3b25', '#46351f'],
  water: ['#27414a', '#233b44'], oil: ['#2a2622', '#25221e'], rubble: ['#4a4338', '#433c32'], chasm: '#16130f',
};
// Walls are checkered too, in 5-ft blocks that line up with the floor grid (and alternate up the height).
const WALL_TONES = ['#575043', '#4d473b'];

// Bodies: deliberately simple (capsule, head, base disc). Armor shows on the torso; the table is the one place to retune it.
const ARMOR_LOOK = {
  none: { color: '#8a806c', roughness: 0.95, metalness: 0 },
  light: { color: '#7b5231', roughness: 0.42, metalness: 0.05 },
  medium: { color: '#7c8087', roughness: 0.6, metalness: 0.55 },
  heavy: { color: '#c5ccd6', roughness: 0.26, metalness: 0.9 },
};
const SKIN = '#d8c7a8';

// Highlight (mockup HL0): a fresnel rim, a floor halo and a gold floor ring. Retune here.
const HL = { fre: true, halo: true, gfx: true, apC: '#d8b45a', apInt: 0.35, gamma: 2.2, range: 3, full: 1,
  pkC: '#ffe08a', pkInt: 1.3, snap: 100, over: true, frePow: 2.5, freBias: 0, grow: true, growCurve: 1.3 };
const HOVER_PAD = 6, HOVER_MIN = 12, STICKY = 0.8;
const DEBUG = /[?&]debug\b/.test(location.search);

// ---------- textures & materials (cached for the page's lifetime) ----------
const texCache = new Map();
function tex(name, variant = 0) {
  const key = `${name}:${variant}`;
  if (!texCache.has(key)) {
    const t = new THREE.CanvasTexture(TX.GENERATORS[name](TX.hash(variant + 1, name.length, name.charCodeAt(0))));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return texCache.get(key);
}
const matCache = new Map();
// dim: remembered (out of sight) cells are drawn darker, like the 2D map's fog.
function mat(name, variant = 0, { dim = false, rough = 0.9, metal = 0, opacity = 1, tint = null, emissive = null } = {}) {
  const key = [name, variant, dim, rough, metal, opacity, tint, emissive].join('|');
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ map: tex(name, variant), roughness: rough, metalness: metal });
    const c = new THREE.Color(tint || '#ffffff');
    if (dim) c.multiplyScalar(0.38);
    m.color = c;
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.35; }
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function wallTone(i, dim, { tint = null, opacity = 1 } = {}) {
  const key = ['wall', i & 1, dim, tint, opacity].join('|');
  if (!flatCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color: WALL_TONES[i & 1], roughness: 0.9 });
    if (tint) m.color.lerp(new THREE.Color(tint), 0.5);
    if (dim) m.color.multiplyScalar(0.38);
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    flatCache.set(key, m);
  }
  return flatCache.get(key);
}
// A flat floor material for a square: the terrain's tone, the checker shade by parity. Untextured.
const flatCache = new Map();
function floorMat(name, x, y, dim, { rough = 0.85, metal = 0, opacity = 1 } = {}) {
  const tone = FLOOR_TONES[name] || FLOOR_TONES.flagstone, col = typeof tone === 'string' ? tone : tone[(x + y) % 2];
  const key = [col, dim, rough, metal, opacity].join('|');
  if (!flatCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal });
    if (dim) m.color.multiplyScalar(0.38);
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    flatCache.set(key, m);
  }
  return flatCache.get(key);
}

// A box whose texture keeps its real-world scale on every face (1 tile per world unit), so tall
// columns show more strata instead of stretched ones. `v0` shifts side faces so strata line up
// between neighbouring columns that share a base.
function box(w, h, d, v0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // px nx py ny pz nz
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * faces[f][0], uv.getY(k) * faces[f][1] + (f === 2 || f === 3 ? 0 : v0));
  }
  return g;
}

const SIDE_FOR = { grass: 'dirt', dirt: 'dirt', flagstone: 'rock', oil: 'rock', water: 'rock', rock: 'rock', planks: 'planks', chasm: 'rock' };

export function createMap3D(container, { onSelect, onCell, onSurface, onHover, onFps } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14130f');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 3;
  controls.maxDistance = 80;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; // LMB is our ground drag (below)
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

  scene.add(new THREE.HemisphereLight('#d4dbe6', '#3b3122', 1.1));
  const sun = new THREE.DirectionalLight('#ffe6c4', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const terrain = new THREE.Group();
  const tokens = new THREE.Group();
  const fx = new THREE.Group();
  const cursorG = new THREE.Group();
  const spectral = new THREE.Group(); // spell tokens (Spiritual Weapon): not creatures, never picked
  scene.add(terrain, tokens, fx, cursorG, spectral);
  const props = createProps3D(scene);   // pick boxes for props and wall faces (Cards 14c/14d)
  let propHover = null;

  let built = null;          // signature of the terrain currently built
  const flames = [], lights = [], waters = new Set();   // flame sprites and their lights (all chunks); water materials
  let framed = false, wallsLow = false;
  let lastState = null, lastSelected = null, hoveredId = null; // hoveredId: set from outside (a portrait); ptrHover: under the pointer
  let ptrHover = null, marks = null, hoverKey = null, pickedCell = null, lastCursorCell = null;
  const mouse = { x: -1e4, y: -1e4, btn: 0 };
  let turnKey = null, follow = true, followYielded = false, speed = 1;
  const glides = new Map(); // creature id -> resolve, for glides still walking
  const tokenObjs = new Map();
  let trail = null;
  let cursorKey = null;
  const pings = [];

  // ---------- terrain ----------
  // The ground is built in CHUNK x CHUNK blocks of squares. A chunk merges its pieces into one mesh per material (flat-coloured
  // pieces share one vertex-coloured material), so a map is a few dozen draw calls, and only chunks whose squares changed are
  // rebuilt. Sight is not geometry: one fog field (a small texture over the grid, linearly filtered) dims remembered ground and
  // fades the edge of the known in the shader, so a change of what the party sees only rewrites that texture (updateFog).
  const CHUNK = 8;
  const chunks = new Map();   // "cx,cy" -> { sig, group, pick, fades, walls, wallMats, geos, flames, lights }
  let globalSig = null, globalObjs = [], fogPlane = null, gridW = 0, cur = null;
  let abyss = { regionOf: new Int32Array(0), regions: [] };   // chasm regions: a region id per square (-1: none), kept for falls later
  function cellElev(v, x, y) {
    const c = v.cells[y] && v.cells[y][x];
    if (!c || c.fog === 'unknown') return 0;
    return (c.h || 0) + (c.obj && c.obj.stand ? c.obj.height : 0);
  }

  // The fog field: per texel (FOG_S per square, FOG_PAD squares of margin) R = light on the terrain (1 seen, .38 remembered,
  // darker toward the unknown), G = cover of the uncharted plane, B = how dark that plane is (deep in the unknown, or beside a chasm),
  // A = how close to what is seen now (the plane is dimmer beside remembered ground). Shared by every terrain material.
  const FOG_S = 4, FOG_PAD = 4;
  const fogU = { uFogTex: { value: null }, uFogXf: { value: new THREE.Vector4(0, 0, 1, 1) }, uMapWH: { value: new THREE.Vector2(1, 1) } };
  let fogTex = null, fogBuilt = null;
  const pitCache = {};
  // Terrain shading: the fog field darkens what the shader lights (side faces read the square they face). fade 1/2: the
  // opaque and see-through passes of a fadeable wall batch, split per vertex by aFade (see fadeOccludingWalls).
  function terrainShader(m, fade = 0) {
    if (m.userData.fogFade === fade) return m;
    m.userData.fogFade = fade;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fogU);
      sh.vertexShader = 'varying vec3 vFogW; varying vec3 vFogN;\n' + (fade ? 'attribute float aFade; varying float vFade;\n' : '') +
        sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFogN = mat3(modelMatrix) * objectNormal;' + (fade ? ' vFade = aFade;' : ''));
      sh.fragmentShader = 'uniform sampler2D uFogTex; uniform vec4 uFogXf; varying vec3 vFogW; varying vec3 vFogN;\n' + (fade ? 'varying float vFade;\n' : '') + sh.fragmentShader
        .replace('void main() {', 'void main() {\n' + (fade === 1 ? '  if (vFade < 0.995) discard;\n' : fade === 2 ? '  if (vFade >= 0.995) discard;\n' : ''))
        .replace('#include <opaque_fragment>', 'outgoingLight *= texture2D(uFogTex, (vFogW.xz + normalize(vFogN).xz * 0.3 - uFogXf.xy) * uFogXf.zw).r;\n' +
          (fade === 2 ? 'diffuseColor.a *= vFade;\n' : '') + '#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'terrain' + fade;
    m.needsUpdate = true;
    return m;
  }

  // Squared Euclidean distance transform (Felzenszwalb): for each texel, the distance in texels to the nearest set texel.
  function edt(mask, w, h) {
    const INF = 1e20, n = Math.max(w, h), g = new Float64Array(w * h), f = new Float64Array(n), d = new Float64Array(n), vv = new Int32Array(n), z = new Float64Array(n + 1);
    for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
    const pass = (len) => {
      let k = 0; vv[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]); }
        k++; vv[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - vv[k]) * (q - vv[k]) + f[vv[k]]; }
    };
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; pass(w); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
    return g;
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const fogOf = (v, x, y) => { const c = v.cells[y] && v.cells[y][x]; return c ? c.fog : 'unknown'; };
  function fogSignature(v) {
    return v.width + 'x' + v.height + ':' + v.cells.map((r) => r.map((c) => (c.fog === 'visible' ? 2 : c.fog === 'remembered' ? 1 : 0)).join('')).join('/');
  }
  function updateFog(v) {
    const W = v.width, H = v.height, S = FOG_S, P = FOG_PAD, tw = (W + 2 * P) * S, th = (H + 2 * P) * S, n = tw * th;
    if (!fogTex || fogTex.image.width !== tw || fogTex.image.height !== th) {
      if (fogTex) fogTex.dispose();
      fogTex = new THREE.DataTexture(new Uint8Array(n * 4), tw, th);
      fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
      fogU.uFogTex.value = fogTex;
      fogU.uFogXf.value.set(-P, -P, 1 / (W + 2 * P), 1 / (H + 2 * P));
      fogU.uMapWH.value.set(W, H);
    }
    const known = new Uint8Array(n), unknown = new Uint8Array(n), vis = new Uint8Array(n), pit = pitCache.abyss !== abyss || pitCache.n !== n ? new Uint8Array(n) : null;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const x = Math.floor(i / S) - P, y = Math.floor(j / S) - P, f = fogOf(v, x, y), t = j * tw + i;
      known[t] = f !== 'unknown'; unknown[t] = !known[t]; vis[t] = f === 'visible';
      if (pit) pit[t] = abyss.regionOf.length && x >= 0 && y >= 0 && x < W && y < H && abyss.regionOf[y * W + x] >= 0;
    }
    if (pit) Object.assign(pitCache, { abyss, n, d: edt(pit, tw, th) });   // the chasms only change with the terrain
    const dK = edt(known, tw, th), dU = edt(unknown, tw, th), dV = edt(vis, tw, th), dP = pitCache.d, out = fogTex.image.data;
    for (let t = 0; t < n; t++) {
      const s = known[t] ? (dU[t] - 0.5) / S : -(dK[t] - 0.5) / S;   // signed distance to the edge of the known, in squares
      const seen = 1 - sstep(0, 0.9, (dV[t] - 0.5) / S);
      const light = (0.38 + 0.62 * seen) * (0.4 + 0.6 * sstep(-0.3, 1.1, s));
      out[t * 4] = Math.round(255 * light);
      out[t * 4 + 1] = Math.round(255 * (1 - sstep(-0.45, 0.1, s)));
      // darker deeper into the unknown, and over unknown ground beside a chasm (it most likely falls away too)
      out[t * 4 + 2] = Math.round(255 * Math.max(sstep(0, 4, -s), 0.85 * (1 - sstep(0.5, 2.5, (dP[t] - 0.5) / S))));
      out[t * 4 + 3] = Math.round(255 * seen);
    }
    fogTex.needsUpdate = true;
    // Fires burn bright only where the party can see them.
    for (const ch of chunks.values()) {
      for (const s of ch.flames) s.material.opacity = fogOf(v, s.userData.cx, s.userData.cy) === 'visible' ? 0.95 : 0.25;
      for (const l of ch.lights) l.userData.on = fogOf(v, l.userData.cx, l.userData.cy) === 'visible' ? 1 : 0;
    }
  }

  // Ground you can't make out: one plane under the whole map and far past it. The fog field gives it its cover (none over the
  // known, so chasms show), its darkening into the unknown, and a soft dissolve into the backdrop past the map's edge.
  const UNCHARTED = '#26221c';
  function ensureFogPlane(W, H) {
    const key = W + 'x' + H;
    if (fogPlane && fogPlane.userData.key === key) return;
    if (fogPlane) { terrain.remove(fogPlane); fogPlane.geometry.dispose(); fogPlane.material.dispose(); }
    const E = 100, g = new THREE.PlaneGeometry(W + 2 * E, H + 2 * E).rotateX(-Math.PI / 2).translate(W / 2, -0.03, H / 2);
    const m = new THREE.MeshStandardMaterial({ color: UNCHARTED, roughness: 1, metalness: 0, transparent: true, depthWrite: false, dithering: true });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fogU);
      sh.vertexShader = 'varying vec3 vFogW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `uniform sampler2D uFogTex; uniform vec4 uFogXf; uniform vec2 uMapWH; varying vec3 vFogW;
        float fogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fogNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fogHash(i), fogHash(i + vec2(1.0, 0.0)), f.x), mix(fogHash(i + vec2(0.0, 1.0)), fogHash(i + 1.0), f.x), f.y); }
        ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec4 fs = texture2D(uFogTex, (vFogW.xz - uFogXf.xy) * uFogXf.zw);
        vec2 o = max(max(-vFogW.xz, vFogW.xz - uMapWH), 0.0);
        float d = max(o.x, o.y), nz = 0.6 * fogNoise(vFogW.xz * 0.45) + 0.4 * fogNoise(vFogW.xz * 1.3 + 17.0);
        diffuseColor.rgb *= (0.86 + 0.28 * nz) * mix(1.0, 0.3, fs.b) * mix(0.55, 1.0, fs.a);
        diffuseColor.a = fs.g * (d < 3.0 ? 1.0 : exp((3.0 - d) / 22.0));`);
    };
    fogPlane = new THREE.Mesh(g, m);
    fogPlane.receiveShadow = true; fogPlane.renderOrder = -1; fogPlane.userData.key = key;
    terrain.add(fogPlane);
  }

  // ---------- merging ----------
  // A fadeable wall piece (anything markWall'd) keeps its own vertex range and box, so fading it rewrites only its aFade.
  const markWall = (mesh) => { mesh.userData.wall = true; return mesh; };
  // Meshes that stay whole (door leaves on their hinge, see-through secret walls) fade the old way, by their own material.
  function legacyWall(mesh) {
    const clone = (source) => {
      const material = terrainShader(source.clone(), 0);
      material.userData.occlusionBase = { opacity: source.opacity, transparent: source.transparent, depthWrite: source.depthWrite };
      cur.wallMats.push(material); return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    cur.walls.push(mesh); return mesh;
  }
  const batchMats = new Map();
  function batchMat(src, fade) {
    const flat = src.isMeshStandardMaterial && !src.map && !src.vertexColors && !(src.emissive && src.emissive.getHex());
    const key = (flat ? ['flat', src.roughness, src.metalness, src.transparent, src.opacity, src.side, src.flatShading] : [src.uuid]).concat(fade).join('|');
    let m = batchMats.get(key);
    if (!m) {
      m = flat ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: src.roughness, metalness: src.metalness, side: src.side,
        flatShading: src.flatShading, transparent: src.transparent, opacity: src.opacity, depthWrite: src.depthWrite }) : fade ? src.clone() : src;
      if (fade === 2) { m.transparent = true; m.depthWrite = false; }
      batchMats.set(key, terrainShader(m, fade));
    }
    return { m, flat, key };
  }
  const _nm = new THREE.Matrix3(), _c = new THREE.Color();
  function mergeChunk(ch, src) {
    const batches = new Map();
    for (const mesh of src) {
      const mats = [].concat(mesh.material);
      if (mesh.userData.wall && mats.some((m) => m.transparent)) { ch.group.add(mesh); ch.geos.push(mesh.geometry); legacyWall(mesh); continue; }
      mesh.updateMatrix(); _nm.getNormalMatrix(mesh.matrix);
      const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
      const groups = g.groups.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
      const cell = mesh.userData.cell ? mesh.userData.cell.y * gridW + mesh.userData.cell.x : -1, fade = mesh.userData.wall ? 1 : 0;
      const skip = mesh.userData.skip;
      for (const gr of groups) {
        if (skip && skip[gr.materialIndex]) continue;
        const sm = mats[gr.materialIndex] || mats[0], { m, flat, key } = batchMat(sm, fade);
        let b = batches.get(key);
        if (!b) batches.set(key, b = { m, flat, fade, src: sm, pos: [], nor: [], uv: [], col: [], cell: [], pieces: [] });
        if (flat) _c.copy(sm.color);
        const v0 = b.pos.length / 3, end = Math.min(gr.start + gr.count, I ? I.count : P.count);
        const e = mesh.matrix.elements, q = _nm.elements, pa = P.array, na = N.array, ua = U && U.array, ia = I && I.array;
        for (let k = gr.start; k < end; k++) {
          const i = ia ? ia[k] : k, x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
          b.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
          const nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
          const mx = q[0] * nx + q[3] * ny + q[6] * nz, my = q[1] * nx + q[4] * ny + q[7] * nz, mz = q[2] * nx + q[5] * ny + q[8] * nz, l = Math.hypot(mx, my, mz) || 1;
          b.nor.push(mx / l, my / l, mz / l);
          if (ua) b.uv.push(ua[i * 2], ua[i * 2 + 1]); else b.uv.push(0, 0);
          if (flat) b.col.push(_c.r, _c.g, _c.b);
        }
        for (let t = 0; t < (end - gr.start) / 3; t++) b.cell.push(cell);
        if (fade) b.pieces.push({ start: v0, count: b.pos.length / 3 - v0 });
      }
      g.dispose();
    }
    for (const b of batches.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.flat) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, b.m);
      mesh.castShadow = mesh.receiveShadow = !b.m.transparent || !!b.fade;
      mesh.userData.faceCell = Int32Array.from(b.cell);
      ch.group.add(mesh); ch.pick.push(mesh); ch.geos.push(g);
      if (!b.fade) continue;
      const attr = new THREE.Float32BufferAttribute(new Float32Array(b.pos.length / 3).fill(1), 1);
      attr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aFade', attr);
      const ghost = new THREE.Mesh(g, batchMat(b.src, 2).m);   // the see-through pass: only faded pieces draw in it
      ghost.visible = false;
      ch.group.add(ghost);
      const pieces = b.pieces.map(({ start, count }) => {
        const box = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        for (let i = start * 3; i < (start + count) * 3; i += 3) for (let a = 0; a < 3; a++) { box[a] = Math.min(box[a], b.pos[i + a]); box[a + 3] = Math.max(box[a + 3], b.pos[i + a]); }
        return { start, count, box, op: 1 };
      });
      ch.fades.push({ attr, ghost, pieces });
    }
  }

  function disposeChunk(ch) {
    terrain.remove(ch.group);
    ch.geos.forEach((g) => g.dispose());
    ch.wallMats.forEach((m) => m.dispose());
    for (const s of ch.flames) { fx.remove(s); s.material.dispose(); flames.splice(flames.indexOf(s), 1); }
    for (const l of ch.lights) { scene.remove(l); lights.splice(lights.indexOf(l), 1); }
    chunks.delete(ch.key);
  }
  function clearGlobals() {
    for (const o of globalObjs) { terrain.remove(o); o.geometry.dispose(); if (o.userData.ownMat) o.material.dispose(); }
    globalObjs = [];
  }
  const addGlobal = (mesh, ownMat = true) => { mesh.userData.ownMat = ownMat; terrain.add(mesh); globalObjs.push(mesh); return mesh; };

  // Small cache for materials that used to be made per call (rope, coals, leaves), so they batch and do not pile up.
  const oneMat = (key, make) => { if (!flatCache.has(key)) flatCache.set(key, make()); return flatCache.get(key); };

  function buildTerrain(v) {
    const W = v.width, H = v.height;
    gridW = W;
    let minH = 0, anyChasm = false;
    v.cells.forEach((row) => row.forEach((c) => {
      if (c.fog === 'unknown') return;
      minH = Math.min(minH, (c.h || 0) - (c.tags.includes('water') ? (v.legend[c.ch] && v.legend[c.ch].depth) || 2 : 0));
      if (c.tags.includes('chasm')) anyChasm = true;
    }));
    const bottom = minH * FT - (anyChasm ? 3.5 : 0.6);
    // Deep rock: known wall squares with no floor (or unseen square) around them, drawn as one low rough mass instead of columns.
    let massFt = 0;
    const deep = v.cells.map((row, y) => row.map((c, x) => {
      if (c.fog === 'unknown' || !c.tags.includes('wall') || c.obj) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = v.cells[y + dy] && v.cells[y + dy][x + dx];
        if (n && (n.fog === 'unknown' || !n.tags.includes('wall'))) return false;
      }
      massFt = Math.max(massFt, (v.legend[c.ch] && v.legend[c.ch].height) || 6);
      return true;
    }));
    const massH = (wallsLow ? 1.5 : massFt) * FT;
    // The top of the column under a square (what the labels sit on and what a chasm's walls run down from).
    const colTop = (x, y) => {
      const c = v.cells[y] && v.cells[y][x];
      if (!c || c.fog === 'unknown') return null;
      const top = (c.h || 0) * FT, legend = v.legend[c.ch] || {}, surf = TX.surfaceFor(c);
      if (deep[y][x]) return massH * 0.6;
      if (surf === 'chasm') return bottom;
      if (c.tags.includes('bridge')) return top;
      if (c.tags.includes('wall') && !c.obj) return top + (wallsLow ? 1.5 : legend.height || 6) * FT;
      if (surf === 'water') return top - (legend.depth || 2) * FT;
      return top;
    };

    // Anything every chunk depends on changed: start over.
    const gsig = JSON.stringify([W, H, bottom, massH, wallsLow]);
    if (gsig !== globalSig) { for (const ch of [...chunks.values()]) disposeChunk(ch); globalSig = gsig; }
    const wallsAt = new Map();
    for (const w of v.walls || []) {
      const x = Math.max(0, Math.min(W - 1, Math.min(w.x1, w.x2))), y = Math.max(0, Math.min(H - 1, Math.min(w.y1, w.y2)));
      const k = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
      if (!wallsAt.has(k)) wallsAt.set(k, []);
      wallsAt.get(k).push(w);
    }
    // A chunk's squares depend on their neighbours (deep rock, stairs, bridge rails, wall heights), so its signature takes a
    // one-square ring around it, plus its walls with the floor heights on both sides of each.
    const cellSig = (x, y) => { const c = v.cells[y] && v.cells[y][x]; return !c ? null : c.fog === 'unknown' ? 0 : [c.ch, c.h, c.tags, c.obj]; };
    let dirty = false;
    for (let cy = 0; cy * CHUNK < H; cy++) for (let cx = 0; cx * CHUNK < W; cx++) {
      const key = cx + ',' + cy, x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(W, x0 + CHUNK), y1 = Math.min(H, y0 + CHUNK);
      const parts = [];
      for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) parts.push(cellSig(x, y));
      const ws = wallsAt.get(key) || [];
      parts.push(ws.map((w) => [w, wallFloors(v, w)]));
      const sig = JSON.stringify(parts), old = chunks.get(key);
      if (old && old.sig === sig) continue;
      if (old) disposeChunk(old);
      buildChunk(v, key, sig, x0, y0, x1, y1, ws, { bottom, deep, colTop });
      dirty = true;
    }
    if (!dirty && globalObjs.length) return;
    occ = null; fogBuilt = null;
    clearGlobals();
    buildRockMass(v, deep, bottom, massH);
    buildAbyss(v, bottom, colTop);
    ensureFogPlane(W, H);
    // coordinate labels in a straight line along the north and west edges of what's known
    const known = (x, y) => v.cells[y][x].fog !== 'unknown';
    let x0 = W, y0 = H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (known(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
    const lh = (x, y) => (known(x, y) ? Math.max(0, colTop(x, y)) : 0) + 0.02, labels = [];
    for (let x = 0; x < W; x++) if (v.cells.some((r, y) => known(x, y))) labels.push([x, x + 0.5, lh(x, y0), y0 - 0.4]);
    for (let y = 0; y < H; y++) if (v.cells[y].some((c, x) => known(x, y))) labels.push([W + y, x0 - 0.4, lh(x0, y), y + 0.5]);
    buildLabels(W, H, labels);
  }

  function buildChunk(v, key, sig, X0, Y0, X1, Y1, walls, { bottom, deep, colTop }) {
    const ch = cur = { key, sig, group: new THREE.Group(), pick: [], fades: [], walls: [], wallMats: [], geos: [], flames: [], lights: [] };
    terrain.add(ch.group); chunks.set(key, ch);
    const src = [], geo = (g) => g;
    const add = (mesh, cell) => {
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (cell) mesh.userData.cell = cell;
      src.push(mesh);
      return mesh;
    };
    const props = [];
    // Faces nobody can see are left out of the merge: every column's underside, and a side that a solid neighbouring column
    // (rising from the same base) covers to at least that height. skip[] runs px, nx, py, ny, pz, nz like a BoxGeometry's groups.
    const solidTop = (x, y) => {
      const c = v.cells[y] && v.cells[y][x];
      if (!c || c.fog === 'unknown' || deep[y][x] || c.tags.includes('bridge') || c.tags.includes('stairs') || TX.surfaceFor(c) === 'chasm') return -Infinity;
      return colTop(x, y);
    };
    const hide = (mesh, x, y, y1, top = false) => {
      mesh.userData.skip = [solidTop(x + 1, y) >= y1 - 1e-6, solidTop(x - 1, y) >= y1 - 1e-6, top, true, solidTop(x, y + 1) >= y1 - 1e-6, solidTop(x, y - 1) >= y1 - 1e-6];
      return mesh;
    };
    const dim = false;   // remembered ground is dimmed by the fog field now, not by its materials
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const c = v.cells[y][x];
      if (c.fog === 'unknown' || deep[y][x]) continue;
      const variant = TX.hash(x, y) % VARIANTS;
      const surf = TX.surfaceFor(c);
      const top = (c.h || 0) * FT;
      const at = { x, y };
      const legend = v.legend[c.ch] || {};

      if (surf === 'chasm') {
        const m = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1, 1)), TEXTURED ? mat('chasm', 0, { dim }) : floorMat('chasm', x, y, dim)), at);
        m.rotation.x = -Math.PI / 2; m.position.set(x + 0.5, bottom + 0.01, y + 0.5);
        continue;
      }
      if (c.tags.includes('bridge')) { buildBridge(v, x, y, top, dim, add, geo); continue; }
      // the column under this square
      let colTop = top;
      if (c.tags.includes('wall') && !c.obj) colTop = top + (wallsLow ? 1.5 : legend.height || 6) * FT;
      if (surf === 'water') colTop = top - (legend.depth || 2) * FT;
      const h = colTop - bottom;
      const sideName = c.tags.includes('wall') && /brick|masonry|tower|built/.test((c.terrain || '').toLowerCase()) ? 'masonry' : SIDE_FOR[surf] || 'rock';
      const topName = surf === 'water' ? 'dirt' : surf === 'oil' ? 'flagstone' : c.tags.includes('wall') ? sideName : surf;
      const flatKey = surf === 'water' ? 'dirt' : surf;
      const rubble = !c.tags.includes('wall') && c.tags.includes('difficult') && (flatKey === 'flagstone' || flatKey === 'dirt' || flatKey === 'grass');
      const topMat = TEXTURED || c.tags.includes('wall') ? mat(topName, variant, { dim }) : floorMat(rubble ? 'rubble' : flatKey, x, y, dim);
      const side = mat(sideName, variant, { dim });
      if (c.tags.includes('wall') && !TEXTURED) {
        for (let y0 = bottom, i = Math.floor(bottom + 1e-6); y0 < colTop - 1e-6; i++) {
          const y1 = Math.min(colTop, i + 1), m = wallTone(x + y + i, dim);
          const b = add(new THREE.Mesh(geo(box(1, y1 - y0, 1, y0)), m), at);
          b.position.set(x + 0.5, (y0 + y1) / 2, y + 0.5); markWall(hide(b, x, y, y1, y1 < colTop - 1e-6));
          y0 = y1;
        }
        continue;
      }
      if (c.tags.includes('stairs') && buildStairs(v, x, y, bottom, [side, side, topMat, side, side, side], add, geo)) continue;
      const col = add(new THREE.Mesh(geo(box(1, h, 1, bottom)), [side, side, topMat, side, side, side]), at);
      col.position.set(x + 0.5, bottom + h / 2, y + 0.5); hide(col, x, y, colTop);
      if (c.tags.includes('wall')) markWall(col);
      if (surf === 'oil' && TEXTURED) {
        const o = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1.15, 1.15)), mat('oil', variant, { dim, rough: 0.1, metal: 0, opacity: 0.999 })), at);
        o.rotation.x = -Math.PI / 2; o.rotation.z = variant; o.position.set(x + 0.5, top + 0.005, y + 0.5);
        o.castShadow = false;
      }
      if (surf === 'water') {
        const w = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1, 1)), TEXTURED ? mat('water', variant, { dim, rough: 0.15, metal: 0.1, opacity: 0.78 }) : floorMat('water', x, y, dim, { rough: 0.15, metal: 0.1, opacity: 0.85 })), at);
        w.rotation.x = -Math.PI / 2; w.position.set(x + 0.5, top - 0.06, y + 0.5);
        w.castShadow = false;
        waters.add(w.material);
      }
      if (c.obj) props.push({ c, x, y, top, variant });
      else if (c.tags.includes('fire-source')) addFire(x + 0.5, top, y + 0.5, 1, dim);
      if (c.tags.includes('burning')) {
        const surfaceTop = c.obj && c.obj.stand ? top + c.obj.height * FT : top;
        for (let i = 0; i < 3; i++) {
          const r = TX.rng(TX.hash(x, y, i));
          addFire(x + 0.25 + r() * 0.5, surfaceTop, y + 0.25 + r() * 0.5, 0.8 + r() * 0.5, dim, i === 0);
        }
      }
    }
    for (const w of walls) buildWall(v, w, add, geo);
    mergeChunk(ch, src);
    buildProps(ch, props);
    cur = null;
  }

  // Props (crates, barrels, pillars, braziers, barracks furniture) stay whole meshes, one per piece with userData.cell, in the
  // chunk's own `props` group: they are not merged, so they can become entities with bodies of their own.
  function buildProps(ch, props) {
    ch.props = new THREE.Group(); ch.group.add(ch.props);
    const geo = (g) => { ch.geos.push(g); return g; };
    const add = (mesh, cell) => {
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (cell) mesh.userData.cell = cell;
      for (const m of [].concat(mesh.material)) terrainShader(m, 0);
      ch.props.add(mesh); ch.pick.push(mesh);
      return mesh;
    };
    for (const { c, x, y, top, variant } of props) buildObject(c.obj, x, y, top, false, variant, add, geo, c.terrain);
  }

  // The coordinate labels: one mesh over one atlas texture (A.. for columns, 1.. for rows).
  let labelAtlas = null;
  function buildLabels(W, H, labels) {
    if (!labelAtlas || labelAtlas.key !== W + 'x' + H) {
      if (labelAtlas) { labelAtlas.tex.dispose(); labelAtlas.mat.dispose(); }
      const n = W + H, cols = 16, rows = Math.ceil(n / cols), c = document.createElement('canvas');
      c.width = cols * 64; c.height = rows * 64;
      const ctx = c.getContext('2d');
      ctx.font = '600 40px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(12,11,9,.85)'; ctx.fillStyle = '#d8cfb8';
      for (let i = 0; i < n; i++) {
        const text = i < W ? String.fromCharCode(65 + i) : String(i - W + 1), px = (i % cols) * 64 + 32, py = Math.floor(i / cols) * 64 + 34;
        ctx.strokeText(text, px, py); ctx.fillText(text, px, py);
      }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      labelAtlas = { key: W + 'x' + H, tex, cols, rows, mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }) };
    }
    const { cols, rows } = labelAtlas, pos = [], uv = [], idx = [], s = 0.25;
    for (const [i, x, y, z] of labels) {
      const u0 = (i % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor(i / cols) / rows, v0 = v1 - 1 / rows, k = pos.length / 3;
      pos.push(x - s, y, z - s, x + s, y, z - s, x - s, y, z + s, x + s, y, z + s);
      uv.push(u0, v1, u1, v1, u0, v0, u1, v0);
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    addGlobal(new THREE.Mesh(g, labelAtlas.mat), false);
  }

  // Wall squares nothing can see past are one merged, lumpy mass: corner heights come from a hash so the same map always rises the
  // same way, shared by the squares round each corner so it stays one surface. Only the map's outer edge needs a skirt.
  function buildRockMass(v, deep, bottom, wallH) {
    const W = v.width, H = v.height, pos = [], col = [];
    const base = new THREE.Color('#2f2b24'), c = new THREE.Color(), corners = new Map();
    const isDeep = (x, y) => x >= 0 && y >= 0 && x < W && y < H && deep[y][x];
    const corner = (i, j) => {
      const key = i * 4096 + j;
      if (!corners.has(key)) {
        const f = 0.35 + 0.45 * (0.65 * TX.hash(i, j, 53) / 4294967296 + 0.35 * TX.hash(i >> 1, j >> 1, 59) / 4294967296);
        const inner = isDeep(i - 1, j - 1) && isDeep(i, j - 1) && isDeep(i - 1, j) && isDeep(i, j);
        const jit = (k) => (inner ? (TX.hash(i, j, k) / 4294967296 - 0.5) * 0.3 : 0);
        corners.set(key, [i + jit(61), wallH * f, j + jit(67), f]);
      }
      return corners.get(key);
    };
    const tri = (a, b, d) => {
      for (const q of [a, b, d]) {
        pos.push(q[0], q[1], q[2]);
        c.copy(base).multiplyScalar(0.7 + 0.7 * q[3]); col.push(c.r, c.g, c.b);
      }
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!deep[y][x]) continue;
      const A = corner(x, y), B = corner(x + 1, y), C = corner(x, y + 1), D = corner(x + 1, y + 1);
      if ((x + y) & 1) { tri(A, C, D); tri(A, D, B); } else { tri(A, C, B); tri(B, C, D); }
      for (const [dx, dy, p, q] of [[0, -1, A, B], [0, 1, C, D], [-1, 0, A, C], [1, 0, B, D]]) {
        if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) continue; // only the map's outer edge
        const lo = (r) => [r[0], bottom, r[2], 0];
        tri(p, lo(p), q); tri(q, lo(p), lo(q));
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = addGlobal(new THREE.Mesh(g, terrainShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }))));
    m.castShadow = true; m.receiveShadow = true; // not pickable and never fades: it is low and nothing stands behind it
  }

  // The abyss: chasm squares (and the bridges over them) joined into connected regions, each with one see-through dark skin
  // over its walls and floor whose darkness is a smooth function of depth below that region's rim. The region data stays in
  // `abyss` (a region id per square, each region's squares, rim and floor) for falls into regions below later.
  const ABYSS = '#040405';
  function buildAbyss(v, bottom, colTop) {
    const W = v.width, H = v.height, regionOf = new Int32Array(W * H).fill(-1), regions = [];
    const cellAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? v.cells[y][x] : null);
    const isChasm = (c) => c && c.fog !== 'unknown' && TX.surfaceFor(c) === 'chasm';
    const isOpen = (c) => isChasm(c) || (c && c.fog !== 'unknown' && c.tags.includes('bridge'));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isChasm(v.cells[y][x]) || regionOf[y * W + x] >= 0) continue;
      const id = regions.length, cells = [], todo = [[x, y]];
      regionOf[y * W + x] = id;
      while (todo.length) {
        const [px, py] = todo.pop(); cells.push([px, py]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (isOpen(cellAt(nx, ny)) && regionOf[ny * W + nx] < 0) { regionOf[ny * W + nx] = id; todo.push([nx, ny]); }
        }
      }
      let rim = -Infinity;
      for (const [cx, cy] of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = cellAt(cx + dx, cy + dy);
        if (n && n.fog !== 'unknown' && !isOpen(n) && !n.tags.includes('wall')) rim = Math.max(rim, (n.h || 0) * FT);
      }
      regions.push({ id, cells, rim: rim === -Infinity ? 0 : rim, bottom });
    }
    abyss = { regionOf, regions, width: W };
    const I = 0.012;
    for (const r of regions) {
      const pos = [], solid = [], idx = [];
      const quad = (a, b, c, d, s) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); solid.push(s, s, s, s); idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); };
      for (const [x, y] of r.cells) {
        quad([x, bottom + I, y], [x + 1, bottom + I, y], [x, bottom + I, y + 1], [x + 1, bottom + I, y + 1], 0);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && regionOf[ny * W + nx] === r.id) continue;
          const n = cellAt(nx, ny), seen = n && n.fog !== 'unknown' && !isOpen(n);
          const top = seen ? Math.min(colTop(nx, ny), r.rim + 2) : r.rim;
          if (top <= bottom) continue;
          // the edge between the squares, nudged into this one
          const ex = dx > 0 ? x + 1 - I : dx < 0 ? x + I : null, ez = dy > 0 ? y + 1 - I : dy < 0 ? y + I : null;
          if (ex !== null) quad([ex, top, y], [ex, top, y + 1], [ex, bottom, y], [ex, bottom, y + 1], seen ? 0 : 1);
          else quad([x, top, ez], [x + 1, top, ez], [x, bottom, ez], [x + 1, bottom, ez], seen ? 0 : 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aSolid', new THREE.Float32BufferAttribute(solid, 1));
      g.setIndex(idx);
      const u = { uRim: { value: r.rim }, uBot: { value: bottom } };
      const m = new THREE.MeshBasicMaterial({ color: ABYSS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'attribute float aSolid; varying float vSolid; varying float vY;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n  vSolid = aSolid; vY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = 'uniform float uRim, uBot; varying float vSolid; varying float vY;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float t = clamp((uRim - vY) / max(0.01, uRim - uBot), 0.0, 1.0);
          float a = max(smoothstep(0.0, 1.0, pow(t, 0.7)), vSolid) * 0.985;
          a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;
          diffuseColor.a *= clamp(a, 0.0, 1.0);`);
      };
      m.customProgramCacheKey = () => 'abyss';
      const mesh = addGlobal(new THREE.Mesh(g, m));
      mesh.renderOrder = -2; mesh.userData.region = r.id;
    }
  }

  // Stairs climb from the lower neighbour to the higher one in four steps across the square,
  // so the middle of the square stays at the cell's own height (where a token stands).
  function buildStairs(v, x, y, bottom, mats, add, geo) {
    const hAt = (cx, cy) => { const c = v.cells[cy] && v.cells[cy][cx]; return c && c.fog !== 'unknown' && !c.tags.includes('wall') ? (c.h || 0) * FT : null; };
    const self = hAt(x, y);
    let best = null;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = hAt(x - dx, y - dy), b = hAt(x + dx, y + dy);
      const lo = Math.min(a ?? self, b ?? self), hi = Math.max(a ?? self, b ?? self);
      if (hi - lo > 0 && (!best || hi - lo > best.hi - best.lo)) best = { dx, dy, lo, hi, up: (b ?? self) > (a ?? self) ? 1 : -1 };
    }
    if (!best || best.lo >= self || best.hi <= self) return false;
    for (let i = 0; i < 4; i++) {
      const topY = best.lo + ((best.hi - best.lo) * (i + 1)) / 5;
      const h = topY - bottom;
      const k = best.up > 0 ? i : 3 - i; // slice index along the axis, low end first
      const m = add(new THREE.Mesh(geo(box(best.dx ? 0.25 : 1, h, best.dy ? 0.25 : 1, bottom)), mats), { x, y });
      m.position.set(x + (best.dx ? 0.125 + k * 0.25 : 0.5), bottom + h / 2, y + (best.dy ? 0.125 + k * 0.25 : 0.5));
    }
    return true;
  }

  function buildBridge(v, x, y, top, dim, add, geo) {
    const plank = mat('planks', TX.hash(x, y) % VARIANTS, { dim }); // the bridge keeps its texture
    const slab = add(new THREE.Mesh(geo(box(0.92, 0.1, 1)), plank), { x, y });
    slab.position.set(x + 0.5, top - 0.05, y + 0.5);
    // rope rails on the sides that don't continue into more bridge
    const isBridge = (bx, by) => v.cells[by] && v.cells[by][bx] && (v.cells[by][bx].tags || []).includes('bridge');
    const rope = oneMat('rope', () => new THREE.MeshStandardMaterial({ color: '#b89a64', roughness: 1 }));
    const post = mat('planks', 1, { dim, tint: '#9b8a76' });
    const vertical = isBridge(x, y - 1) || isBridge(x, y + 1) || !(isBridge(x - 1, y) || isBridge(x + 1, y));
    const sides = vertical ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    for (const [sx, sy] of sides) {
      if (isBridge(x + sx, y + sy)) continue;
      const rx = x + 0.5 + sx * 0.46, rz = y + 0.5 + sy * 0.46;
      const r = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.025, 1, 6)), rope));
      r.position.set(rx, top + 0.28, rz);
      if (vertical) r.rotation.x = Math.PI / 2; else r.rotation.z = Math.PI / 2;
      const p = add(new THREE.Mesh(geo(box(0.06, 0.34, 0.06)), post));
      p.position.set(rx, top + 0.12, rz);
    }
  }

  function buildObject(o, x, y, top, dim, variant, add, geo, terrainName) {
    if (buildBarracksProp(o, { x, y, top, dim, variant, add, geo, terrainName, addFire })) return;
    const r = TX.rng(TX.hash(x, y, 77));
    const H = o.height * FT;
    const cx = x + 0.5, cz = y + 0.5;
    const at = { x, y };
    switch (o.kind) {
      case 'crate': {
        const big = add(new THREE.Mesh(geo(box(0.8, H * 0.62, 0.8)), mat('crate', variant, { dim })), at);
        big.position.set(cx, top + H * 0.31, cz); big.rotation.y = (r() - 0.5) * 0.3;
        const small = add(new THREE.Mesh(geo(box(0.48, H * 0.38, 0.48)), mat('crate', (variant + 1) % VARIANTS, { dim })), at);
        small.position.set(cx + (r() - 0.5) * 0.2, top + H * 0.62 + H * 0.19, cz + (r() - 0.5) * 0.2); small.rotation.y = r() * 1.5;
        break;
      }
      case 'barrel': {
        const n = 2 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r();
          const m = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.19, 0.19, H, 14)), [mat('barrel', variant, { dim }), mat('planks', 2, { dim, tint: '#a08060' }), mat('planks', 2, { dim, tint: '#a08060' })]), at);
          m.position.set(cx + Math.cos(a) * 0.2, top + H / 2, cz + Math.sin(a) * 0.2);
        }
        break;
      }
      case 'rubble': {
        for (let i = 0; i < 7; i++) {
          const s = 0.1 + r() * 0.16;
          const m = add(new THREE.Mesh(geo(new THREE.DodecahedronGeometry(s, 0)), mat('rock', variant, { dim })), at);
          m.position.set(x + 0.15 + r() * 0.7, top + s * 0.5, y + 0.15 + r() * 0.7);
          m.rotation.set(r() * 3, r() * 3, r() * 3);
          m.scale.y = Math.min(1, H / (s * 2)) * 0.8;
        }
        break;
      }
      case 'pillar': {
        const shaft = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.33, H - 0.3, 12)), mat('masonry', variant, { dim })), at);
        shaft.position.set(cx, top + H / 2, cz);
        for (const yy of [top + 0.08, top + H - 0.08]) {
          const cap = add(new THREE.Mesh(geo(box(0.8, 0.16, 0.8)), mat('masonry', variant, { dim })), at);
          cap.position.set(cx, yy, cz);
        }
        break;
      }
      case 'brazier': {
        const ironM = mat('iron', 0, { dim, rough: 0.55, metal: 0.6 });
        // open-topped, so the coals sit inside it instead of fighting its lid
        const bowlM = oneMat('bowl', () => { const m = ironM.clone(); m.side = THREE.DoubleSide; return m; });
        const bowl = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.16, 0.2, 14, 1, true)), bowlM), at);
        bowl.position.set(cx, top + H - 0.1, cz);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const leg = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.03, H - 0.15, 5)), ironM), at);
          leg.position.set(cx + Math.cos(a) * 0.16, top + (H - 0.15) / 2, cz + Math.sin(a) * 0.16);
        }
        const coals = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14)), oneMat('coals', () => new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ff5a1a', emissiveIntensity: 1.4 }))), at);
        coals.position.set(cx, top + H - 0.06, cz);
        addFire(cx, top + H, cz, 0.9, dim, true);
        break;
      }
      case 'tree': {
        const vis = Math.min(H, 3.2);
        const trunk = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.16, vis * 0.55, 8)), mat('bark', variant, { dim })), at);
        trunk.position.set(cx, top + vis * 0.275, cz);
        const leafM = oneMat('leaves' + variant, () => new THREE.MeshStandardMaterial({ map: tex('leaves', variant), roughness: 1, flatShading: true }));
        for (let i = 0; i < 3; i++) {
          const s = 0.55 + r() * 0.35;
          const blob = add(new THREE.Mesh(geo(new THREE.IcosahedronGeometry(s, 0)), leafM), at);
          blob.position.set(cx + (r() - 0.5) * 0.6, top + vis * 0.62 + i * 0.25, cz + (r() - 0.5) * 0.6);
          blob.rotation.set(r(), r(), r());
        }
        break;
      }
      default: {
        const m = add(new THREE.Mesh(geo(box(0.8, H, 0.8)), mat('masonry', variant, { dim })), at);
        m.position.set(cx, top + H / 2, cz);
      }
    }
  }

  const flameTex = () => {
    if (!texCache.has('flame')) { const t = new THREE.CanvasTexture(TX.flame()); t.colorSpace = THREE.SRGBColorSpace; texCache.set('flame', t); }
    return texCache.get('flame');
  };
  function addFire(x, y, z, size, dim, light = true) {
    const sm = new THREE.SpriteMaterial({ map: flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: dim ? 0.25 : 0.95 });
    const s = new THREE.Sprite(sm);
    s.scale.set(0.45 * size, 0.6 * size, 1);
    s.position.set(x, y + 0.27 * size, z);
    // cx, cy: the square it burns in, for updateFog (bright and lit only where the party can see it)
    s.userData = { base: s.scale.clone(), y: s.position.y, phase: Math.random() * 10, cx: Math.floor(x), cy: Math.floor(z) };
    fx.add(s); flames.push(s); cur.flames.push(s);
    if (light && lights.length < 8) {
      const l = new THREE.PointLight('#ff9a4a', 5, 6, 1.6);
      l.position.set(x, y + 0.5, z);
      l.userData = { phase: Math.random() * 10, on: 1, cx: Math.floor(x), cy: Math.floor(z) };
      scene.add(l); lights.push(l); cur.lights.push(l);
    }
  }

  // Floor heights on both sides of a wall segment (known squares only).
  function wallFloors(v, w) {
    const vertical = w.x1 === w.x2, len = vertical ? Math.abs(w.y2 - w.y1) : Math.abs(w.x2 - w.x1), hs = [];
    for (let i = 0; i < len; i++) {
      const a = vertical ? [w.x1 - 1, Math.min(w.y1, w.y2) + i] : [Math.min(w.x1, w.x2) + i, w.y1 - 1];
      const b = vertical ? [w.x1, Math.min(w.y1, w.y2) + i] : [Math.min(w.x1, w.x2) + i, w.y1];
      for (const [cx, cy] of [a, b]) if (v.cells[cy] && v.cells[cy][cx] && v.cells[cy][cx].fog !== 'unknown') hs.push((v.cells[cy][cx].h || 0) * FT);
    }
    if (!hs.length) hs.push(0);
    return hs;
  }
  function buildWall(v, w, add, geo) {
    const vertical = w.x1 === w.x2;
    const len = vertical ? Math.abs(w.y2 - w.y1) : Math.abs(w.x2 - w.x1);
    const hs = wallFloors(v, w);
    const base = Math.min(...hs), rim = Math.max(...hs);
    let ft = w.height || WALL_FT[w.kind] || 8;
    if (wallsLow && w.kind !== 'low') ft = Math.min(ft, 2);
    const T = 0.16;
    const midX = vertical ? w.x1 : (w.x1 + w.x2) / 2, midZ = vertical ? (w.y1 + w.y2) / 2 : w.y1;
    const opts = w.hidden ? { tint: SECRET, opacity: 0.55 } : {};
    const stone = mat('masonry', 0, opts);
    const piece = (l, y0, y1, m, offset = 0) => {
      const g = geo(box(vertical ? T : l, y1 - y0, vertical ? l : T));
      const mesh = add(new THREE.Mesh(g, m));
      mesh.position.set(midX + (vertical ? 0 : offset), (y0 + y1) / 2, midZ + (vertical ? offset : 0));
      return markWall(mesh);
    };
    if (w.kind === 'door') {
      const doorFt = wallsLow ? 2 : 7;
      if (ft > doorFt) piece(len, rim + doorFt * FT, rim + ft * FT, stone); // lintel
      for (const s of [-1, 1]) piece(0.08, base, rim + doorFt * FT, stone, s * (len / 2 - 0.04));
      const panelM = mat('door', 0, opts);
      const leaf = new THREE.Mesh(geo(box(vertical ? 0.07 : len - 0.16, doorFt * FT - 0.02, vertical ? len - 0.16 : 0.07)), panelM);
      leaf.castShadow = leaf.receiveShadow = true;
      const hinge = new THREE.Group();
      // hinge at one end of the opening; an open door swings 100 degrees
      hinge.position.set(vertical ? midX : midX - len / 2 + 0.08, rim + (doorFt / 2) * FT, vertical ? midZ - len / 2 + 0.08 : midZ);
      leaf.position.set(vertical ? 0 : (len - 0.16) / 2, 0, vertical ? (len - 0.16) / 2 : 0);
      legacyWall(leaf); hinge.add(leaf); cur.geos.push(leaf.geometry);
      hinge.rotation.y = w.open ? (vertical ? -1 : 1) * Math.PI * 0.55 : 0;
      cur.group.add(hinge);
      return;
    }
    if (w.kind === 'window') {
      piece(len, base, rim + 3 * FT, stone);                    // sill
      piece(len, rim + 6 * FT, rim + ft * FT, stone);           // lintel
      for (const s of [-1, 1]) piece(0.1, rim + 3 * FT, rim + 6 * FT, stone, s * (len / 2 - 0.05));
      const bar = mat('iron', 0, { rough: 0.5, metal: 0.6 });
      for (let i = 1; i < 4; i++) piece(0.03, rim + 3 * FT, rim + 6 * FT, bar, -len / 2 + (i * len) / 4);
      return;
    }
    if (TEXTURED) { piece(len + T * 0.01, base, rim + ft * FT, w.kind === 'low' ? mat('masonry', 2, opts) : stone); return; }
    const start = vertical ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2), across = vertical ? w.x1 : w.y1;
    for (let k = 0; k < len; k++) {
      for (let y0 = base, i = Math.floor(base + 1e-6); y0 < rim + ft * FT - 1e-6; i++) {
        const y1 = Math.min(rim + ft * FT, i + 1);
        piece(1 + (k === len - 1 ? T * 0.01 : 0), y0, y1, wallTone(start + k + across + i, false, opts), k + 0.5 - len / 2);
        y0 = y1;
      }
    }
  }

  // ---------- tokens ----------
  // The body: a capsule torso (armor), a head, a dark base disc with a side-coloured ring. `top` and `half` are kept for
  // hover and highlight. Materials are per body (the highlight shader is attached to each) and disposed with it.
  const BASE_GEO = new THREE.CylinderGeometry(0.34, 0.36, 0.06, 24), RIM_GEO = new THREE.TorusGeometry(0.35, 0.025, 8, 36);
  const TORSO_GEO = new THREE.CapsuleGeometry(0.2, 0.5, 6, 14), HEAD_GEO = new THREE.SphereGeometry(0.15, 16, 12);
  const SHIELD_GEO = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 18), SIDE_HALO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const hlTex = (n, draw) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); return t; };
  const haloTex = hlTex(128, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,.3)'); r.addColorStop(0.55, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  });
  const gfxTex = hlTex(256, (g, n) => { // a thin ring with four bold brackets on the diagonals
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.globalAlpha = 0.45; g.lineWidth = 2; g.beginPath(); g.arc(n / 2, n / 2, n * 0.4, 0, 7); g.stroke();
    g.globalAlpha = 1; g.lineWidth = 9;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(n / 2, n / 2, n * 0.4, Math.PI * (0.25 + i / 2) - 0.42, Math.PI * (0.25 + i / 2) + 0.42); g.stroke(); }
  });
  const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const hlMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const hlG = new THREE.Group(); scene.add(hlG);   // floor halos and rings (not in `tokens`: those are walked by the glide loop)

  function applyArmor(u, a) {
    const look = ARMOR_LOOK[a && a.kind] || ARMOR_LOOK.none, m = u.torso.material;
    m.color.set(look.color); m.roughness = look.roughness; m.metalness = look.metalness;
    u.shield.visible = !!(a && a.shield);
  }
  // The highlight's rim shader, added to every mesh of a body; its uniforms ride on u.fu.
  function hlAttach(g, u) {
    const fu = u.fu = { uRimC: { value: new THREE.Color() }, uRimK: { value: 0 }, uRimP: { value: 2.5 }, uRimB: { value: 0 } };
    g.traverse((o) => {
      if (!o.isMesh || !o.userData.rim) return;
      o.material.onBeforeCompile = (sh) => { // facing-ratio rim added to the emissive term
        Object.assign(sh.uniforms, fu);
        sh.fragmentShader = 'uniform vec3 uRimC; uniform float uRimK, uRimP, uRimB;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           totalEmissiveRadiance += uRimC * uRimK * mix(uRimB, 1., pow(1. - abs(dot(normalize(vNormal), normalize(vViewPosition))), uRimP));`);
      };
    });
    u.halo = new THREE.Mesh(flatGeo, hlMat(haloTex)); u.gfx = new THREE.Mesh(flatGeo, hlMat(gfxTex));
    for (const m of [u.halo, u.gfx]) { m.visible = false; m.renderOrder = 1; m.frustumCulled = false; hlG.add(m); }
    Object.assign(u, { apL: 0, pr: 0, lvl: 0, pk: 0 });
  }
  const easeBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const cA = new THREE.Color(), cB = new THREE.Color();
  // tg: 0 / .55 (square-mate) / 1 (hovered or selected); u.apL is the smoothed approach 0..1
  function hlStep(g, u, tg, dt) {
    u.lvl += (tg - u.lvl) * 0.4;
    const up = tg > 0;
    u.pr = up ? Math.min(1, u.pr + dt / HL.snap) : Math.max(0, u.pr - dt / (HL.snap * 0.6));
    u.pk = u.lvl * (up && HL.over ? easeBack(u.pr) : easeOut(u.pr));
    const kk = Math.min(u.pk, 1), a0 = HL.apInt * Math.pow(u.apL, HL.gamma), I = Math.max(0, a0 + (HL.pkInt - a0) * u.pk), on = I > 0.003;
    cA.set(HL.apC).lerp(cB.set(HL.pkC), kk);
    const fu = u.fu;
    fu.uRimK.value = HL.fre && on ? I * 1.8 : 0; fu.uRimP.value = HL.frePow; fu.uRimB.value = HL.freBias; fu.uRimC.value.copy(cA);
    // Sized from the body's own half-width; never past the edge of its square (radius .5).
    const R = u.half * 1.35 + 0.04, CAP = 0.48, p = g.position, y = u.floorY, h = u.halo, r = u.gfx;
    h.visible = HL.halo && on;
    if (h.visible) { h.material.color.copy(cA); h.material.opacity = Math.min(1, I * 0.5); h.scale.setScalar(2 * Math.min(0.5, R * 1.5 * (1.25 - 0.25 * u.pk))); h.position.set(p.x, y + 0.015, p.z); }
    r.visible = HL.gfx && kk > 0.01;
    if (r.visible) { r.material.color.copy(cA); r.material.opacity = Math.min(1, kk * HL.pkInt * 0.8); r.scale.setScalar(Math.min(CAP, R * (1.5 - 0.5 * u.pk)) / 0.4); r.position.set(p.x, y + 0.025, p.z); r.rotation.y = u.pr < 1 ? (1 - u.pr) * 0.9 : 0; }
  }

  function makeToken(c) {
    const g = new THREE.Group(), color = new THREE.Color(SIDE_COLOR[c.side] || SIDE_COLOR.neutral);
    const add = (geo, m, x, y, z, rim = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.userData.rim = rim; g.add(o); return o; };
    const std = (col, o = {}) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, ...o });
    const base = add(BASE_GEO, std('#1f1d18'), 0, 0.03, 0);
    const ring = add(RIM_GEO, std(color, { emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }), 0, 0.065, 0, false);
    ring.rotation.x = Math.PI / 2; ring.castShadow = false;
    const torso = add(TORSO_GEO, std('#8a806c'), 0, 0.5, 0), head = add(HEAD_GEO, std(SKIN), 0, 1.05, 0);
    const shield = add(SHIELD_GEO, std('#8b8f96', { metalness: 0.7, roughness: 0.4 }), 0.27, 0.55, 0); shield.rotation.z = Math.PI / 2; shield.visible = false;
    const sideHalo = new THREE.Mesh(SIDE_HALO, new THREE.MeshBasicMaterial({ map: haloTex, color, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sideHalo.position.y = 0.01; sideHalo.scale.setScalar(1.1); g.add(sideHalo);
    const turnRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true }));
    turnRing.rotation.x = Math.PI / 2; turnRing.position.y = 0.03;
    g.add(turnRing);
    g.userData = { id: c.id, turnRing, torso, head, shield, base, ring, sideHalo, path: [], target: null, offset: new THREE.Vector3(),
      top: 1.25, half: 0.26, prone: false, floorY: 0, apL: 0 };
    hlAttach(g, g.userData);
    tokens.add(g);
    return g;
  }
  function disposeToken(g) {
    const u = g.userData;
    for (const m of [u.halo, u.gfx]) { hlG.remove(m); m.material.dispose(); }
    g.traverse((o) => { if (o.material) { if (o.material.map && o.material.map !== haloTex) o.material.map.dispose(); o.material.dispose(); } });
  }
  function posture(u, prone) {
    u.prone = prone;
    if (prone) { u.torso.rotation.z = Math.PI / 2; u.torso.position.set(0, 0.22, 0); u.head.position.set(0.5, 0.2, 0); u.shield.position.set(0, 0.3, 0.27); u.shield.rotation.set(Math.PI / 2, 0, 0); }
    else { u.torso.rotation.z = 0; u.torso.position.set(0, 0.5, 0); u.head.position.set(0, 1.05, 0); u.shield.position.set(0.27, 0.55, 0); u.shield.rotation.set(0, 0, Math.PI / 2); }
    u.top = prone ? 0.45 : 1.25; u.half = prone ? 0.45 : 0.26;
  }

  function updateTokens(v) {
    const seen = new Set();
    for (const c of Object.values(v.creatures)) {
      seen.add(c.id);
      let g = tokenObjs.get(c.id);
      const p = cellOf(c.pos);
      const target = new THREE.Vector3(p.x + 0.5, (c.elev || 0) * FT, p.y + 0.5);
      if (!g) { g = makeToken(c); tokenObjs.set(c.id, g); g.position.copy(target); }
      const u = g.userData;
      u.target = target;
      const isTurn = v.current === c.id;
      const down = c.hp !== undefined ? c.hp <= 0 : c.health === 'down';
      const prone = down || (c.conditions || []).some((x) => x.name === 'prone');
      if (prone !== u.prone || !u.armored) posture(u, prone);
      const ak = JSON.stringify(c.armor || null);
      if (ak !== u.armored) { applyArmor(u, c.armor); u.armored = ak; }
      const fade = c.hidden ? 0.55 : 1;
      g.traverse((o) => { if (o.material && o.userData.rim !== undefined && o.material.opacity !== fade) { o.material.transparent = fade < 1; o.material.opacity = fade; o.material.needsUpdate = true; } });
      u.turnRing.visible = isTurn;
    }
    for (const [id, g] of tokenObjs) if (!seen.has(id)) {
      tokens.remove(g); tokenObjs.delete(id);
      if (glides.has(id)) { const r = glides.get(id); glides.delete(id); r(); }
      disposeToken(g);
      if (hoveredId === id) hoveredId = null;
      if (ptrHover === id) ptrHover = null;
    }
  }

  // A ghostly blade hovering over its square, eased between squares when it moves.
  function updateSpectral(v) {
    const seen = new Set();
    for (const e of v.effects || []) {
      const p = cellOf(e.pos), y = cellElev(v, p.x, p.y) * FT + 0.75;
      let g = spectral.getObjectByName(e.id);
      if (!g) {
        g = new THREE.Group(); g.name = e.id;
        const m = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.02), m); blade.position.y = 0.15;
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.04), m); guard.position.y = -0.15;
        const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), m); hilt.position.y = -0.25;
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: '#9fd3ff', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = -0.73;
        g.add(blade, guard, hilt, glow);
        g.position.set(p.x + 0.5, y, p.y + 0.5);
        spectral.add(g);
      }
      g.userData.target = new THREE.Vector3(p.x + 0.5, y, p.y + 0.5);
      seen.add(e.id);
    }
    for (const g of [...spectral.children]) if (!seen.has(g.name)) {
      spectral.remove(g);
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }
  function stepSpectral(t, dt) {
    for (const g of spectral.children) {
      const tg = g.userData.target;
      g.position.x += (tg.x - g.position.x) * Math.min(1, dt * 6 * speed);
      g.position.z += (tg.z - g.position.z) * Math.min(1, dt * 6 * speed);
      g.position.y = tg.y + Math.sin(t * 2.2) * 0.06;
      g.rotation.y = t * 0.8;
    }
  }

  function clearTrail() {
    if (!trail) return;
    fx.remove(trail); trail.geometry.dispose(); trail.material.dispose(); trail = null;
  }
  function resetMoves() {
    clearTrail(); settleGlides();
    for (const g of tokenObjs.values()) {
      g.userData.path = [];
      if (g.userData.target) g.position.copy(g.userData.target);
      g.userData.applied = null;
    }
  }
  function settleGlides() { const rs = [...glides.values()]; glides.clear(); rs.forEach((r) => r()); }
  // Walks a token along a path of cells; resolves on arrival (at once if it has no token). The
  // caller decides when it starts, so a goblin's move plays in log order, not on arrival.
  function glide(id, cells) {
    const g = tokenObjs.get(id);
    if (!g || !lastState || !cells || cells.length < 2) return Promise.resolve();
    const pts = cells.map((id) => { const p = cellOf(id); return new THREE.Vector3(p.x + 0.5, cellElev(lastState, p.x, p.y) * FT, p.y + 0.5); });
    if (glides.has(id)) glides.get(id)();
    if (follow && !followYielded) focusOn(id, cells[cells.length - 1]); // track whoever is actually moving
    g.position.copy(pts[0]); g.userData.applied = null; g.userData.path = pts.slice(1);
    clearTrail();
    const geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(p.y + 0.06)));
    trail = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: GOLD, dashSize: 0.12, gapSize: 0.14, transparent: true }));
    trail.computeLineDistances(); trail.userData.born = performance.now(); fx.add(trail);
    // Frames stop in a background tab or on a lost GL context; never let one glide wedge the queue.
    let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    return new Promise((done) => {
      const finish = () => { clearTimeout(timer); if (glides.get(id) === finish) glides.delete(id); done(); };
      const timer = setTimeout(() => {
        if (glides.get(id) !== finish) return;
        g.userData.path = []; g.position.copy(pts[pts.length - 1]); g.userData.applied = null; finish();
      }, (len / 7 * 1000 + 1500) / speed);
      glides.set(id, finish);
    });
  }
  // Finish every glide where it stands: tokens jump to their (already updated) targets.
  function snap() {
    clearTrail(); settleGlides();
    for (const g of tokenObjs.values()) {
      g.userData.path = [];
      if (g.userData.target) g.position.copy(g.userData.target);
      g.userData.applied = null;
    }
  }

  // ---------- cursor & pings ----------
  // The square cursor: a gold outline at the pointed height, with a drop line to the floor when
  // it floats above it.
  function setCursor(v, cur) {
    const key = JSON.stringify(cur && cur.cell ? [cur.cell, cur.z] : null);
    if (key === cursorKey) return;
    cursorKey = key;
    for (const o of [...cursorG.children]) { cursorG.remove(o); o.geometry.dispose(); o.material.dispose(); }
    if (!cur || !cur.cell) return;
    const p = cellOf(cur.cell), floor = cellElev(v, p.x, p.y);
    const z = typeof cur.z === 'number' ? cur.z : floor;
    const line = (pts) => cursorG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: GOLD, depthTest: false, transparent: true })));
    const y = z * FT + 0.04, x0 = p.x + 0.04, x1 = p.x + 0.96, z0 = p.y + 0.04, z1 = p.y + 0.96;
    line([new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z0)]);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(p.x + 0.5, y, p.y + 0.5);
    cursorG.add(fill);
    if (z !== floor) line([new THREE.Vector3(p.x + 0.5, floor * FT + 0.03, p.y + 0.5), new THREE.Vector3(p.x + 0.5, y, p.y + 0.5)]);
  }
  function labelSprite(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = '600 40px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(500, g.measureText(text).width + 40);
    g.fillStyle = 'rgba(20,19,15,.75)'; g.fillRect(256 - w / 2, 14, w, 68);
    g.fillStyle = GOLD; g.fillText(text, 256, 49);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(2.4, 0.45, 1);
    return s;
  }
  function addPing(p) {
    if (!lastState) return;
    const q = cellOf(p.cell), y = (p.z || cellElev(lastState, q.x, q.y)) * FT + 0.06;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthTest: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(q.x + 0.5, y, q.y + 0.5);
    // quiet: a bare, shorter ring (where a heard sound came from) with no name tag
    const label = p.quiet ? null : labelSprite(p.label ? `${p.who}: ${p.label}` : p.who);
    if (label) label.position.set(q.x + 0.5, y + 0.9, q.y + 0.5);
    if (p.quiet) ring.material.opacity = 0.7;
    fx.add(...(label ? [ring, label] : [ring]));
    pings.push({ ring, label, born: performance.now(), life: p.quiet ? 1600 : 3000 });
  }

  // ---------- move preview ----------
  let pathObj = null;
  function setPath(cells, ok) {
    if (pathObj) { fx.remove(pathObj); pathObj.geometry.dispose(); pathObj.material.dispose(); pathObj = null; }
    if (!cells || cells.length < 2 || !lastState) return;
    const pts = cells.map((id) => { const p = cellOf(id); return new THREE.Vector3(p.x + 0.5, cellElev(lastState, p.x, p.y) * FT + 0.08, p.y + 0.5); });
    pathObj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: ok ? GOLD : '#d25b4a', dashSize: 0.14, gapSize: 0.1, depthTest: false, transparent: true }));
    pathObj.computeLineDistances();
    fx.add(pathObj);
  }

  // ---------- combat effects ----------
  // Small, self-contained animations: each is a step(now) that returns true when it's finished.
  // Projectiles pick a look from the damage type; add kinds to SHOT_LOOK to grow the system.
  const effects = [];
  const SHOT_LOOK = {
    arrow: { color: '#d9c9a3', shape: 'arrow' }, fire: { color: '#ff8a3d', shape: 'orb', glow: true }, radiant: { color: '#fff3b0', shape: 'orb', glow: true },
    cold: { color: '#9fe3ff', shape: 'orb', glow: true }, necrotic: { color: '#b48cff', shape: 'orb', glow: true }, lightning: { color: '#cfe8ff', shape: 'orb', glow: true },
    default: { color: GOLD, shape: 'orb' },
  };
  const tokenPoint = (id, up) => { const g = tokenObjs.get(id); return g ? g.position.clone().setY(g.position.y + (up ?? g.userData.top * 0.7)) : null; };
  function shoot(fromId, toId, kind) {
    return new Promise((done) => {
      const a = tokenPoint(fromId), b = tokenPoint(toId);
      if (!a || !b) return done();
      const look = SHOT_LOOK[kind] || SHOT_LOOK.default;
      const mesh = look.shape === 'arrow'
        ? new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: look.color }))
        : new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshBasicMaterial({ color: look.color }));
      let light = null;
      if (look.glow) { light = new THREE.PointLight(look.color, 3, 3); mesh.add(light); }
      fx.add(mesh);
      const dur = Math.min(650, 160 + a.distanceTo(b) * 45) / speed, born = performance.now(), arc = Math.min(1.2, a.distanceTo(b) * 0.08);
      setTimeout(done, dur + 400); // no frames (background tab): don't hold up the playback queue
      const at = (k) => a.clone().lerp(b, k).setY(a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * arc);
      effects.push((now) => {
        const k = Math.min(1, (now - born) / dur), p = at(k);
        mesh.position.copy(p); mesh.lookAt(at(Math.min(1, k + 0.02)));
        if (k < 1) return false;
        fx.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); if (light) light.dispose();
        done(); return true;
      });
    });
  }
  // Lunge toward the target and back.
  function bump(fromId, toId) {
    return new Promise((done) => {
      const g = tokenObjs.get(fromId), t = tokenObjs.get(toId);
      if (!g || !t) return done();
      const dir = t.position.clone().sub(g.position).setY(0);
      if (dir.lengthSq() < 1e-6) return done();
      dir.normalize();
      const born = performance.now();
      setTimeout(done, 550 / speed); // as above
      let prev = 0, hitSent = false;
      effects.push((now) => {
        const k = Math.min(1, (now - born) * speed / 300), off = Math.sin(Math.PI * k) * 0.38;
        g.userData.offset.addScaledVector(dir, off - prev); prev = off;
        if (k >= 0.5 && !hitSent) { hitSent = true; done(); }
        return k >= 1;
      });
    });
  }
  function floatText(id, text, color, big) {
    const g = tokenObjs.get(id);
    if (!g) return;
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.font = `800 ${big ? 84 : 64}px Inter, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 10; x.strokeStyle = '#14130f'; x.strokeText(text, 128, 64); x.fillStyle = color; x.fillText(text, 128, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(big ? 1.5 : 1.1, big ? 0.75 : 0.55, 1);
    fx.add(s);
    const born = performance.now(), base = g.position.clone().setY(g.position.y + g.userData.top + 0.35);
    effects.push((now) => {
      const k = (now - born) * speed / 1300;
      s.position.copy(base).setY(base.y + k * 0.8);
      s.material.opacity = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k < 1) return false;
      fx.remove(s); t.dispose(); s.material.dispose(); return true;
    });
  }
  // Hit: the token flashes red and shakes, and the damage rises over it.
  function hit(id, { text, color = '#ff6b4f', big = false, flash = true } = {}) {
    const g = tokenObjs.get(id);
    if (!g) return;
    if (text) floatText(id, text, color, big);
    if (!flash) return;
    const u = g.userData, ms = [u.torso.material, u.head.material, u.base.material], born = performance.now();
    let prev = new THREE.Vector3();
    effects.push((now) => {
      const k = Math.min(1, (now - born) * speed / (big ? 520 : 380));
      for (const m of ms) { m.emissive.setRGB(1, 0.2, 0.12); m.emissiveIntensity = (1 - k) * 0.9; }
      const amp = (1 - k) * (big ? 0.12 : 0.07), off = new THREE.Vector3(Math.sin(now / 18) * amp, 0, Math.cos(now / 23) * amp);
      g.userData.offset.add(off.clone().sub(prev)); prev = off;
      if (k < 1) return false;
      g.userData.offset.sub(prev); for (const m of ms) { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1; } return true;
    });
  }

  // ---------- camera ----------
  let defDist = 30, ease = null;
  // id: a creature, or a cell name (eases to that square).
  function focusOn(id, at) {
    if (lastState && !lastState.creatures[id] && /^[A-Za-z]\d+$/.test(id || '')) at = id.toUpperCase();
    const c = lastState && lastState.creatures[id];
    if (!at && (!c || !c.pos || (c.hidden && c.side !== 'party'))) return; // your own hidden creature is still yours to find
    const p = cellOf(at || c.pos);
    const to = new THREE.Vector3(p.x + 0.5, (at ? cellElev(lastState, p.x, p.y) : c.elev || 0) * FT + 0.5, p.y + 0.5);
    const off = camera.position.clone().sub(controls.target), d = off.length();
    // Zoom in to a framing scaled by size (10 for a square or Medium-or-smaller) when further out; a closer view stays put.
    const goal = 10 * ({ large: 18, huge: 24, gargantuan: 30 }[String(c && c.size || '').toLowerCase()] || 14) / 14;
    if (d > goal * 1.3) off.setLength(goal);
    ease = { t0: performance.now(), fromT: controls.target.clone(), toT: to, fromO: camera.position.clone().sub(controls.target), toO: off };
  }
  // Where a creature (by id, at its current glide position) or a cell (by name) is on screen, in client px:
  // { x, y, r } with r the on-screen radius of its base. null when it's behind the camera or unknown.
  const projV = new THREE.Vector3();
  function screenOf(ref) {
    const g = tokenObjs.get(ref), ic = g && marks.screenOf(ref);
    if (ic && ic.icon) return { x: ic.x, y: ic.y, r: ic.r }; // the marker's icon, once it has grown
    let p, half = 0.4;
    if (g) { p = g.position.clone().setY(g.position.y + g.userData.top); half = Math.max(0.2, g.userData.half); }
    else if (lastState && /^[A-Za-z]\d+$/.test(ref)) { const q = cellOf(ref.toUpperCase()); p = new THREE.Vector3(q.x + 0.5, cellElev(lastState, q.x, q.y) * FT, q.y + 0.5); half = 0.5; }
    else return null;
    camera.updateMatrixWorld();
    const rc = renderer.domElement.getBoundingClientRect();
    const to = (v) => { projV.copy(v).project(camera); return { x: rc.left + (projV.x + 1) / 2 * rc.width, y: rc.top + (1 - projV.y) / 2 * rc.height, z: projV.z }; };
    const a = to(p);
    if (a.z > 1) return null;
    const b = to(p.clone().addScaledVector(projV.set(1, 0, 0).transformDirection(camera.matrixWorld), half));
    return { x: a.x, y: a.y, r: Math.hypot(b.x - a.x, b.y - a.y) };
  }
  // A square's screen centre, half its diagonal and the floor-ring basis ex/ey, in client px (the square wheel's anchor).
  function squareAnchor(ref) {
    if (!lastState || !/^[A-Za-z]\d+$/.test(ref)) return null;
    const q = cellOf(ref.toUpperCase()), y = cellElev(lastState, q.x, q.y) * FT;
    camera.updateMatrixWorld();
    const rc = renderer.domElement.getBoundingClientRect();
    const to = (x, z, h = y) => { projV.set(x, h, z).project(camera); return { x: rc.left + (projV.x + 1) / 2 * rc.width, y: rc.top + (1 - projV.y) / 2 * rc.height, z: projV.z }; };
    const m = to(q.x + 0.5, q.y + 0.5), a = to(q.x, q.y), b = to(q.x + 1, q.y + 1);
    const r = Math.hypot(a.x - b.x, a.y - b.y) / 2;
    if (m.z > 1) return null;
    // The ring lies on the floor: slot angle t sits at centre + cos t * ex + sin t * ey, so t = -90 (slot 1) is the camera's far side.
    const fw = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (fw.lengthSq() < 1e-6) fw.set(0, 0, -1).transformDirection(camera.matrixWorld).setY(0);   // looking straight down: the screen's up
    fw.normalize();
    const RW = 1.0, cx = q.x + 0.5, cz = q.y + 0.5;
    const pe = to(cx - fw.z * RW, cz + fw.x * RW), pn = to(cx - fw.x * RW, cz - fw.z * RW);
    let ex = { x: pe.x - m.x, y: pe.y - m.y }, ey = { x: pn.x - m.x, y: pn.y - m.y };
    const lx = Math.hypot(ex.x, ex.y), ly = Math.hypot(ey.x, ey.y);
    if (ly < 0.5 * lx) { const k = ly > 1e-6 ? 0.5 * lx / ly : 0; ey = ly > 1e-6 ? { x: ey.x * k, y: ey.y * k } : { x: 0, y: -0.5 * lx }; }
    const o = to(cx, cz, y + 0.5);   // the swirl starts half a cell above the square
    return { x: m.x, y: m.y, r, ex, ey, ox: o.x, oy: o.y };
  }
  function followTurn(v) {
    // v is the viewer's display state: its log stops at what has played, so a new turn entry means that
    // turn has started on screen (v.current may already be ahead of it while the queue plays out).
    const turns = (v.log || []).filter((e) => e.type === 'turn'), latest = turns[turns.length - 1];
    const key = JSON.stringify([v.name, v.round, latest ? latest.n : v.current]);
    if (key === turnKey) return;
    turnKey = key; followYielded = false;
    if (follow) focusOn((latest && latest.data && latest.data.id) || v.current);
  }
  // Yield to the player's own camera moves (press, drag, zoom), not to a pointer just passing over the map.
  const stopEase = () => { ease = null; followYielded = true; };
  renderer.domElement.addEventListener('pointerdown', stopEase);
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons) stopEase(); });
  renderer.domElement.addEventListener('wheel', stopEase, { passive: true });
  function stepEase(now) {
    if (!ease) return;
    const k = Math.min(1, (now - ease.t0) / 450), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(ease.fromT, ease.toT, e);
    camera.position.lerpVectors(ease.fromO, ease.toO, e).add(controls.target);
    if (k >= 1) ease = null;
  }

  function frame(v) {
    const cx = v.width / 2, cz = v.height / 2, span = Math.max(v.width, v.height);
    controls.target.set(cx, 0, cz);
    camera.position.set(cx - span * 0.08, span * 0.78, cz + span * 0.78);
    controls.update();
    defDist = camera.position.distanceTo(controls.target);
    const s = span * 0.8 + 4;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: span * 4 + 40 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(cx - span * 0.45, span * 1.1 + 8, cz - span * 0.25);
    sun.target.position.set(cx, 0, cz);
  }

  // ---------- hover & picking (screen space, from the mockup) ----------
  // Each body is an ellipse on screen (its projected height and width plus its footprint on the floor, padded, never tiny); its
  // score is the cursor's distance from the centre in units of those radii, so < 1 is inside. Where ellipses overlap, the body
  // the cursor is relatively nearer to wins. Line of sight (the costly part) is only checked for bodies the cursor is inside.
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Vector3(), camRight = new THREE.Vector3(), camFwd = new THREE.Vector3(), shapePts = [];
  let rect = renderer.domElement.getBoundingClientRect(), occ = null;
  const viewCache = new Map();
  const toScr = (v) => {
    tmp.copy(v).project(camera);
    return { x: rect.left + (tmp.x + 1) / 2 * rect.width, y: rect.top + (1 - tmp.y) / 2 * rect.height, front: tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15 };
  };
  // What blocks sight and takes clicks: each chunk's merged meshes and props, and secret walls (not door leaves, the fog plane,
  // the rock mass or the abyss).
  const occluders = () => occ || (occ = [...chunks.values()].flatMap((ch) => ch.pick.concat(ch.walls.filter((w) => w.parent === ch.group))));
  // The square (and, for a terrain face, which side) a raycast hit: merged meshes map each triangle to its square.
  function terrainHit(h) {
    const fc = h.object.userData.faceCell;
    const k = fc ? fc[h.faceIndex] : -1, cell = fc ? (k >= 0 ? { x: k % gridW, y: Math.floor(k / gridW) } : null) : h.object.userData.cell || null;
    if (!cell) return null;
    const n = h.face && h.face.normal;
    const side = !n ? null : n.y > 0.7 ? 'top' : n.y < -0.7 ? 'bottom' : Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? 'e' : 'w') : (n.z > 0 ? 's' : 'n');
    return { ...cell, side };
  }
  // Where each body stands this frame: its square, the floor under it, whether it floats above it, whether it shares the square.
  function bodyInfo() {
    const counts = {};
    for (const g of tokens.children) {
      const u = g.userData, cx = Math.floor(g.position.x), cy = Math.floor(g.position.z);
      u.cellKey = cx + ',' + cy; u.floorY = lastState ? cellElev(lastState, cx, cy) * FT : 0; u.alt = g.position.y - u.floorY > 0.08;
      if (!u.alt) counts[u.cellKey] = (counts[u.cellKey] || 0) + 1;
    }
    for (const g of tokens.children) g.userData.shared = !g.userData.alt && counts[g.userData.cellKey] > 1;
  }
  // In view = some part of the body or of its stem (middle, top, or along the stem) has a clear line from the camera.
  function inView(g) {
    if (viewCache.has(g)) return viewCache.get(g);
    const u = g.userData, occs = occluders();
    let ok = false;
    for (const h of [u.top, u.top / 2, u.top + STEM_W * 0.5, u.top + STEM_W]) {
      const p = g.position.clone().setY(g.position.y + h + 0.02), d = p.distanceTo(camera.position);
      ray.set(camera.position, p.sub(camera.position).normalize()); ray.far = d - 0.05;
      if (!ray.intersectObjects(occs, false).length) { ok = true; break; }
    }
    viewCache.set(g, ok); return ok;
  }
  // A body's screen shape: the box around its top, its sides and its footprint (a 0.7-wide square under a body alone in its
  // square), so the centre sits low and hovering the ground under a body counts a little. Flyers use their own underside.
  function shapeOf(g) {
    const u = g.userData, p = g.position, mid = p.y + u.top / 2, foot = u.alt ? p.y : u.floorY;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camera.getWorldDirection(camFwd).setY(0).normalize();
    shapePts.length = 0;
    const at = (y, rs, fs) => shapePts.push(toScr(tmp.set(p.x, y, p.z).addScaledVector(camRight, rs).addScaledVector(camFwd, fs)));
    at(p.y + u.top, 0, 0); at(mid, u.half, 0); at(mid, -u.half, 0);
    const f = u.alt || u.shared ? u.half + 0.06 : Math.max(u.half, 0.35);
    at(foot, f, 0); at(foot, -f, 0); at(foot, 0, f); at(foot, 0, -f);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of shapePts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, front: shapePts[1].front,
      rx: Math.max((x1 - x0) / 2, HOVER_MIN) + HOVER_PAD, ry: Math.max((y1 - y0) / 2, HOVER_MIN) + HOVER_PAD };
  }
  function hoverScores(x, y) {
    for (const g of tokens.children) {
      const h = g.userData.hv = shapeOf(g);
      h.s = h.front && x > -1e3 ? Math.hypot((x - h.x) / h.rx, (y - h.y) / h.ry) : Infinity;
    }
  }
  // The body at (x, y). `cur` (the last pick) holds on until another body scores clearly better, so edges don't flicker.
  function bodyAt(x, y, cur) {
    hoverScores(x, y);
    const best = tokens.children.filter((g) => g.userData.hv.s < 1).sort((a, b) => a.userData.hv.s - b.userData.hv.s).find(inView) || null;
    if (cur && cur.parent === tokens && cur !== best && cur.userData.hv.s < 1 && (!best || best.userData.hv.s > cur.userData.hv.s * STICKY) && inView(cur)) return cur;
    return best;
  }
  // The terrain under the cursor (walls' own segments don't count), with its square as `.cell`; leaves `ray` cast through
  // (x, y) for props.pick.
  function rayHit(x, y) {
    ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera); ray.far = Infinity;
    for (const h of ray.intersectObjects(occluders(), false)) { const c = terrainHit(h); if (c) return Object.assign(h, { cell: { x: c.x, y: c.y } }); }
    return null;
  }
  function cellAt(x, y) { const hit = rayHit(x, y); return hit ? hit.cell : null; }
  // A side worth selecting: a wall square's face over known open ground, or a drop of 5 ft or more (a ledge, a chasm edge).
  const STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  function faceSpan(x, y, side) {
    const v = lastState, c = v && v.cells[y] && v.cells[y][x], d = STEP[side], n = c && v.cells[y + d[1]] && v.cells[y + d[1]][x + d[0]];
    if (!c || !n || c.fog === 'unknown' || n.fog === 'unknown' || n.tags.includes('wall')) return null;
    if (c.tags.includes('wall') && !c.obj) return [(n.h || 0) * FT, (c.h || 0) * FT + (wallsLow ? 1.5 : (v.legend[c.ch] || {}).height || 6) * FT];
    return (c.h || 0) - (n.h || 0) >= 5 ? [(n.h || 0) * FT, (c.h || 0) * FT] : null;
  }
  const cellOfBody = (g) => { const q = cellOf(lastState.creatures[g.userData.id].pos); return [q.x, q.y]; };
  // Hover from the pointer. `emit` (a real pointer move) always tells onHover; a frame only does when a body's square changed.
  function updateHover(emit) {
    const free = mouse.x > -1e3 && !mouse.btn && lastState;
    ptrHover = marks.hover(!!free);   // icons and traced stems first, then the body ellipses
    const hg = ptrHover && tokenObjs.get(ptrHover);
    renderer.domElement.style.cursor = ptrHover || propHover ? 'pointer' : '';
    if (!free || !onHover) return;
    let c = null;
    if (hg) { c = cellOfBody(hg); if (propHover) { propHover = null; props.highlight(props.has(lastSelected) ? lastSelected : null, null); } }
    else if (emit) {
      const th = rayHit(mouse.x, mouse.y), q = th && th.cell, ph = props.pick(ray, th ? th.distance : Infinity);
      if ((ph && ph.id) !== propHover) { propHover = ph && ph.id; props.highlight(props.has(lastSelected) ? lastSelected : null, propHover); }
      if (propHover) renderer.domElement.style.cursor = 'pointer';
      c = q ? [q.x, q.y] : [-1, -1];
    } else return;
    const key = c.join(',');
    if (emit || key !== hoverKey) { hoverKey = key; onHover(c[0], c[1]); }
  }
  // Debug (?debug): draw the hover ellipses.
  let dbg = null;
  function drawHits() {
    if (!DEBUG) return;
    if (!dbg) { dbg = document.createElement('canvas'); dbg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; container.style.position = container.style.position || 'relative'; container.appendChild(dbg); }
    const w = container.clientWidth, h = container.clientHeight; if (dbg.width !== w) dbg.width = w; if (dbg.height !== h) dbg.height = h;
    const g = dbg.getContext('2d'); g.clearRect(0, 0, w, h);
    for (const t of tokens.children) { const q = t.userData.hv; if (!q || !q.front) continue;
      g.strokeStyle = t === lastBody ? '#d8b45a' : 'rgba(233,227,211,.4)'; g.setLineDash(q.s < 1 ? [] : [3, 3]);
      g.beginPath(); g.ellipse(q.x - rect.left, q.y - rect.top, q.rx, q.ry, 0, 0, 7); g.stroke(); }
  }

  // Markers (stems, icons, labels, tracing, icon mode). They get first say on what the pointer is on.
  marks = createMarks({ scene, camera, renderer, container, tokenObjs, inView, bodyAt, hoverScores, mouse });
  // Feet each creature stands above its floor (for the "N ft up" label).
  const alts = (v) => { const o = {}; for (const c of Object.values(v.creatures)) { const p = c.pos && cellOf(c.pos); if (p) o[c.id] = Math.max(0, Math.round((c.elev || 0) - cellElev(v, p.x, p.y))); } return o; };

  // The highlight each frame: hovered or selected 1, their square-mates .55; the approach grows as the cursor nears.
  function stepHighlights(dt) {
    const eff = ptrHover || hoveredId, cells = new Set();
    for (const id of [eff, lastSelected]) { const g = id && tokenObjs.get(id); if (g) cells.add(g.userData.cellKey); }
    for (const g of tokens.children) {
      const u = g.userData, sel = lastSelected === u.id, hov = eff === u.id;
      let ap = 0;
      const s = u.hv ? u.hv.s : Infinity, q = Math.min(1, (HL.range - s) / Math.max(0.05, HL.range - HL.full));
      if (hov) ap = 1; else if (q > 0 && inView(g)) ap = Math.min(q, 0.97);
      u.apL += (ap - u.apL) * 0.35; if (u.apL < 0.002) u.apL = 0;
      hlStep(g, u, hov || sel ? 1 : cells.has(u.cellKey) ? 0.55 : 0, dt);
    }
  }

  // The selected square on the floor: a gold fill plus an outline, for a picked square.
  const selSq = new THREE.Group();
  {
    const g = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    selSq.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22, depthWrite: false })),
      new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: GOLD })));
    selSq.visible = false; scene.add(selSq);
  }
  let sqHold = false;   // a wheel is on the square: keep it lit even where the cursor marks it
  function showSquare(cell, hold = false) { // cell: {x, y} or null
    pickedCell = cell; sqHold = !!cell && hold;
    selSq.visible = !!cell;
    if (cell && lastState) selSq.position.set(cell.x + 0.5, cellElev(lastState, cell.x, cell.y) * FT + 0.012, cell.y + 0.5);
  }

  // ---------- input ----------
  // LMB drags the ground (the floor point under the cursor stays under it); RMB orbits, the wheel zooms, MMB dollies.
  // A click is a press and release under ~5 px without movement.
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let grab = null, downAt = null, pressed = null;   // pressed: the marker under the pointer at press time (pressing ends the trace and shrinks it)
  function groundAt(x, y) {
    ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(ground, new THREE.Vector3());
  }
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => {
    rect = dom.getBoundingClientRect(); camera.updateMatrixWorld();
    downAt = [e.clientX, e.clientY, e.button]; pressed = e.button === 0 ? marks.pickAt(e.clientX, e.clientY) : null; mouse.btn = e.buttons;
    if (e.button === 0 && e.pointerType === 'mouse') { grab = groundAt(e.clientX, e.clientY); try { dom.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  });
  dom.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.btn = e.buttons;
    if (e.buttons) {
      ptrHover = null;
      if (grab && (e.buttons & 1)) {
        const p = groundAt(e.clientX, e.clientY);
        if (p && p.distanceTo(grab) < 30) { const d = grab.clone().sub(p); camera.position.add(d); controls.target.add(d); camera.updateMatrixWorld(); } // near the horizon the plane runs away
      }
      return;
    }
    rect = dom.getBoundingClientRect(); camera.updateMatrixWorld(); bodyInfo(); viewCache.clear();
    updateHover(true);
  });
  const release = () => { grab = null; mouse.btn = 0; };
  dom.addEventListener('pointercancel', release);
  dom.addEventListener('pointerup', (e) => {
    release();
    if (e.pwHandled) return;   // the action wheel used this click
    if (!downAt || downAt[2] !== 0 || e.button !== 0 || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !lastState) return;
    rect = dom.getBoundingClientRect(); camera.updateMatrixWorld(); bodyInfo(); viewCache.clear();
    const id = pressed || marks.pickAt(e.clientX, e.clientY);
    if (id) { showSquare(null); if (onSelect) onSelect(id); return; }
    const th = rayHit(e.clientX, e.clientY), pr = props.pick(ray, th ? th.distance : Infinity);
    if (pr) { showSquare(null); if (onSelect) onSelect(pr.id); return; }
    const f = onSurface && props.faceOf(th, (x, y, side) => !!faceSpan(x, y, side));
    if (f) { showSquare(null); onSurface(f.x, f.y, f.side); return; }
    const c = th && th.cell;
    if (c) { showSquare(c); if (onCell) onCell(c.x, c.y); }
  });
  dom.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; ptrHover = null; propHover = null; hoverKey = null; if (onHover) onHover(-1, -1); });

  // Walls between the camera and the creatures that matter fade. Merged wall pieces are tested as boxes (a ray-box test per
  // piece, no triangle raycasts) and fade by rewriting their aFade range; door leaves and secret walls fade by material.
  const wallRay = new THREE.Raycaster();
  function rayBox(r, b) {
    let t0 = 0, t1 = r.far;
    for (let a = 0; a < 3; a++) {
      const o = r.o[a], d = r.d[a];
      if (Math.abs(d) < 1e-9) { if (o < b[a] || o > b[a + 3]) return false; continue; }
      let ta = (b[a] - o) / d, tb = (b[a + 3] - o) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return true;
  }
  function fadeOccludingWalls(dt) {
    const rays = [], blocked = new Set(), k = 1 - Math.exp(-dt * 12);
    camera.updateMatrixWorld(true);
    for (const id of new Set([lastState && lastState.current, lastSelected, ptrHover || hoveredId])) {
      const c = lastState && lastState.creatures[id], g = tokenObjs.get(id);
      if (!c || c.hidden || !g) continue;
      for (const up of [0.55, 0.95, g.userData.top]) {
        const dir = g.position.clone().add(new THREE.Vector3(0, up, 0)).sub(camera.position), distance = dir.length();
        dir.normalize();
        rays.push({ o: camera.position.toArray(), d: dir.toArray(), far: Math.max(0, distance - 0.05), dir });
      }
    }
    for (const ch of chunks.values()) {
      for (const f of ch.fades) {
        let changed = false;
        for (const p of f.pieces) {
          const target = rays.length && rays.some((r) => rayBox(r, p.box)) ? 0.18 : 1;
          if (p.op === target) continue;
          p.op += (target - p.op) * k;
          if (Math.abs(p.op - target) < 0.002) p.op = target;
          f.attr.array.fill(p.op, p.start, p.start + p.count); changed = true;
        }
        if (changed) { f.attr.needsUpdate = true; f.ghost.visible = f.pieces.some((p) => p.op < 0.995); }
      }
      if (!ch.walls.length) continue;
      if (rays.length) {
        ch.group.updateMatrixWorld(true);
        for (const r of rays) { wallRay.set(camera.position, r.dir); wallRay.far = r.far; for (const hit of wallRay.intersectObjects(ch.walls, false)) blocked.add(hit.object); }
      }
      for (const mesh of ch.walls) for (const material of [].concat(mesh.material)) {
        const base = material.userData.occlusionBase;
        const target = blocked.has(mesh) ? Math.min(base.opacity, 0.18) : base.opacity;
        if (material.opacity === target && material.transparent === base.transparent) continue;
        material.opacity += (target - material.opacity) * k;
        if (Math.abs(material.opacity - target) < 0.002) material.opacity = target;
        const fading = material.opacity < base.opacity, transparent = fading || base.transparent;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.depthWrite = fading ? false : base.depthWrite;
      }
    }
  }

  // ---------- loop ----------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // Perf: frame times (last 300), per-section {last, max, n} timings, and the renderer's own counters.
  const frames = [], sections = {}, PERF_LOG = /[?&]perf/.test(location.search);
  const timed = (name, fn) => {
    const t0 = performance.now(), r = fn();
    const e = sections[name] || (sections[name] = { last: 0, max: 0, n: 0 });
    e.last = performance.now() - t0; e.n++; if (e.last > e.max) e.max = e.last;
    return r;
  };
  const pct = (a, q) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  function perf() {
    const sum = frames.reduce((a, b) => a + b, 0), avg = frames.length ? sum / frames.length : 0, mx = frames.length ? Math.max(...frames) : 0;
    const i = renderer.info, r = (n) => Math.round(n * 100) / 100;
    return {
      fps: { avg: avg ? r(1000 / avg) : 0, min: mx ? r(1000 / mx) : 0 },
      frameMs: { p50: r(pct(frames, 0.5)), p95: r(pct(frames, 0.95)), max: r(mx) },
      drawCalls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures,
      sections: Object.fromEntries(Object.entries(sections).map(([k, e]) => [k, { last: r(e.last), max: r(e.max), n: e.n }])),
    };
  }
  let fpsNow = 0, fpsAt = performance.now(), fpsN = 0;
  if (PERF_LOG) setInterval(() => { const p = perf(); console.log('[perf] ' + JSON.stringify(p)); for (const e of Object.values(sections)) e.max = 0; }, 5000);

  let raf = 0, prev = performance.now();
  function tick(now) {
    raf = requestAnimationFrame(tick);
    { const ms = now - prev; if (ms > 0 && ms < 2000) { frames.push(ms); if (frames.length > 300) frames.shift(); } fpsN++; if (now - fpsAt >= 500) { fpsNow = Math.round(fpsN * 1000 / (now - fpsAt)); fpsN = 0; fpsAt = now; if (onFps) onFps(fpsNow, perf); } }
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const t = now / 1000;
    for (const s of flames) {
      const k = 1 + Math.sin(t * 9 + s.userData.phase) * 0.08 + Math.sin(t * 23 + s.userData.phase) * 0.05;
      s.scale.set(s.userData.base.x * (2 - k), s.userData.base.y * k, 1);
      s.position.y = s.userData.y + (k - 1) * 0.1;
    }
    for (const l of lights) l.intensity = 5 * l.userData.on * (1 + Math.sin(t * 11 + l.userData.phase) * 0.12 + Math.sin(t * 27 + l.userData.phase) * 0.08);
    for (const w of waters) { const m = w.map; if (m) { m.offset.x = (t * 0.02) % 1; m.offset.y = (t * 0.013) % 1; } }
    stepSpectral(t, dt);
    for (const g of tokens.children) {
      const u = g.userData;
      // Effects (lunges, shakes) live in u.offset, on top of where the token is walking to.
      if (u.applied) g.position.sub(u.applied);
      u.applied = u.offset.clone();
      if (u.path.length) {
        const next = u.path[0];
        const step = 7 * speed * dt;
        const d = g.position.distanceTo(next);
        if (d <= step) { g.position.copy(next); u.path.shift(); } else g.position.lerp(next, step / d);
        if (!u.path.length && glides.has(u.id)) { const r = glides.get(u.id); glides.delete(u.id); r(); }
      } else if (u.target && !glides.has(u.id)) g.position.lerp(u.target, 1 - Math.exp(-dt * 10 * speed));
      g.position.add(u.applied);
      u.turnRing.material.opacity = 0.55 + Math.sin(t * 4) * 0.35;
    }
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i], age = (now - pg.born) / pg.life;
      pg.ring.scale.setScalar(1 + ((age * 3) % 1) * 1.5);
      pg.ring.material.opacity = Math.max(0, 1 - age);
      if (pg.label) pg.label.material.opacity = Math.max(0, Math.min(1, (1 - age) * 2));
      if (age >= 1) {
        for (const o of [pg.ring, pg.label].filter(Boolean)) { fx.remove(o); o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        pings.splice(i, 1);
      }
    }
    if (trail) {
      const age = (now - trail.userData.born) * speed / 2400;
      trail.material.opacity = Math.max(0, 0.9 * (1 - age));
      if (age >= 1) clearTrail();
    }
    stepEase(now);
    controls.update();
    camera.updateMatrixWorld(); rect = renderer.domElement.getBoundingClientRect(); viewCache.clear();
    if (lastState) {
      bodyInfo(); updateHover(false);
      timed('marksStep', () => marks.step({ now, hoverId: ptrHover || hoveredId, selected: lastSelected, rect }));
      stepHighlights(dt * 1000); drawHits();
    }
    timed('wallFade', () => fadeOccludingWalls(dt));
    timed('render', () => renderer.render(scene, camera));
  }
  raf = requestAnimationFrame(tick);

  function signature(v) {
    // geometry only: what is known, not whether it is seen now (that is the fog field's, see fogSignature)
    return JSON.stringify([v.width, v.height, wallsLow, v.walls, v.cells.map((r) => r.map((c) => (c.fog === 'unknown' ? 0 : [c.ch, c.h, c.tags, c.obj])))]);
  }

  return {
    update(v, { selected, cursor, hovered, you, surface } = {}) {
      const encounterChanged = lastState && (lastState.name !== v.name || v.round < lastState.round);
      if (encounterChanged) { turnKey = null; resetMoves(); hoveredId = ptrHover = null; ease = null; framed = false; showSquare(null); }
      lastState = v; lastSelected = selected;
      if (hovered !== undefined) hoveredId = hovered;
      if (pickedCell && !sqHold && cursor && cursor.cell === cellName(pickedCell.x, pickedCell.y)) showSquare(null);
      const sig = timed('signature', () => signature(v));
      if (sig !== built) { timed('terrainBuild', () => buildTerrain(v)); built = sig; }
      const fsig = fogSignature(v);
      if (fsig !== fogBuilt) { timed('fogUpdate', () => updateFog(v)); fogBuilt = fsig; }
      if (!framed) { frame(v); framed = true; }
      timed('tokens', () => updateTokens(v));
      props.sync(v, (x, y) => (v.cells[y][x].h || 0));
      props.highlight(props.has(selected) ? selected : null, propHover);
      const sp = surface && /^[A-Z]\d+$/.test(surface.cell) && cellOf(surface.cell), span = sp && faceSpan(sp.x, sp.y, surface.side);
      props.showFace(span ? { x: sp.x, y: sp.y, side: surface.side } : null, ...(span || []));
      updateSpectral(v);
      timed('marksSync', () => marks.sync(v.creatures, you, alts(v)));
      followTurn(v);
      setCursor(v, cursor);
    },
    ping: addPing, perf,
    abyss: () => abyss,   // chasm regions: { regionOf (id per square, -1 none), regions: [{ id, cells, rim, bottom }], width }
    debug: { camera, controls, scene, renderer },   // for the console and perf checks
    setPath, shoot, bump, hit, glide, snap, showSquare,
    setSpeed(k) { speed = k > 0 ? k : 1; },
    setWallsLow(on) { wallsLow = on; if (lastState) this.update(lastState, { selected: lastSelected }); },
    resetCamera() { ease = null; if (lastState) frame(lastState); },
    focus: focusOn,
    screenOf, squareAnchor,
    get pressed() { return pressed; },   // the marker a press began on (until the next press)
    marks: () => marks,   // icon element/position per id, setLow, active (icon mode or tracing)
    setFollow(on) {
      follow = !!on;
      if (!follow) ease = null;
      else if (!followYielded && lastState) focusOn(lastState.current);
    },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); marks.dispose(); props.dispose();
      clearTrail();
      for (const ch of [...chunks.values()]) disposeChunk(ch);
      clearGlobals();
      if (fogPlane) { fogPlane.geometry.dispose(); fogPlane.material.dispose(); }
      if (fogTex) fogTex.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}

function cellOf(id) { return { x: id.charCodeAt(0) - 65, y: parseInt(id.slice(1), 10) - 1 }; }

function cellName(x, y) { return String.fromCharCode(65 + x) + (y + 1); }
