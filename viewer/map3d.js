// 3D battlemap. Reads the same view the 2D map does (/api/state) and draws it with three.js:
// one textured column per cell at its floor height, props on top, walls along grid lines,
// tokens as standees. One world unit is one 5-ft square; y is up; cell (x, y) sits at
// world x..x+1, z = y..y+1.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as TX from './textures.js';
import { buildBarracksProp } from './barracks-props.js';

const FT = 1 / 5;
const VARIANTS = 4;
const SIDE_COLOR = { party: '#4fb3a4', enemy: '#cf6a4c', neutral: '#a59f8e' };
const SECRET = '#a98bd6';
const GOLD = '#d8b45a';
const WALL_FT = { wall: 8, door: 7, window: 8, low: 3 };

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

export function createMap3D(container, { onSelect, onCell, onHover } = {}) {
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
  scene.add(terrain, tokens, fx, cursorG);

  let built = null;          // signature of the terrain currently built
  let disposables = [];      // geometries made for the current terrain
  let flames = [], waters = [], lights = [];
  let framed = false, wallsLow = false;
  let lastState = null, lastSelected = null, lastMoveT = null;
  const tokenObjs = new Map();
  let trail = null;
  let cursorKey = null;
  const pings = [];

  // ---------- terrain ----------
  function cellElev(v, x, y) {
    const c = v.cells[y] && v.cells[y][x];
    if (!c || c.fog === 'unknown') return 0;
    return (c.h || 0) + (c.obj && c.obj.stand ? c.obj.height : 0);
  }

  function buildTerrain(v) {
    for (const o of [...terrain.children]) {
      terrain.remove(o);
      if (o.userData.dispose) { o.userData.dispose.dispose(); o.material.dispose(); }
    }
    disposables.forEach((g) => g.dispose());
    // Flames live in the fx group (so they draw over everything), so take them out by hand.
    for (const s of flames) { fx.remove(s); s.material.dispose(); }
    disposables = []; flames = []; waters = [];
    lights.forEach((l) => scene.remove(l)); lights = [];
    const geo = (g) => { disposables.push(g); return g; };
    const add = (mesh, cell) => {
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (cell) mesh.userData.cell = cell;
      terrain.add(mesh);
      return mesh;
    };

    let minH = 0, anyChasm = false;
    v.cells.forEach((row) => row.forEach((c) => {
      if (c.fog === 'unknown') return;
      minH = Math.min(minH, (c.h || 0) - (c.tags.includes('water') ? (v.legend[c.ch] && v.legend[c.ch].depth) || 2 : 0));
      if (c.tags.includes('chasm')) anyChasm = true;
    }));
    const bottom = minH * FT - (anyChasm ? 3.5 : 0.6);
    const colTops = v.cells.map((row) => row.map(() => 0));

    for (let y = 0; y < v.height; y++) for (let x = 0; x < v.width; x++) {
      const c = v.cells[y][x];
      if (c.fog === 'unknown') continue;
      const dim = c.fog === 'remembered';
      const variant = TX.hash(x, y) % VARIANTS;
      const surf = TX.surfaceFor(c);
      const top = (c.h || 0) * FT;
      const at = { x, y };
      const legend = v.legend[c.ch] || {};

      if (surf === 'chasm') {
        const m = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1, 1)), mat('chasm', 0, { dim })), at);
        m.rotation.x = -Math.PI / 2; m.position.set(x + 0.5, bottom + 0.01, y + 0.5);
        colTops[y][x] = bottom;
        continue;
      }
      if (c.tags.includes('bridge')) {
        buildBridge(v, x, y, top, dim, add, geo);
        colTops[y][x] = top;
        continue;
      }
      // the column under this square
      let colTop = top;
      if (c.tags.includes('wall') && !c.obj) colTop = top + (wallsLow ? 1.5 : legend.height || 6) * FT;
      if (surf === 'water') colTop = top - (legend.depth || 2) * FT;
      const h = colTop - bottom;
      const g = geo(box(1, h, 1, bottom));
      const sideName = c.tags.includes('wall') && /brick|masonry|tower|built/.test((c.terrain || '').toLowerCase()) ? 'masonry' : SIDE_FOR[surf] || 'rock';
      const topName = surf === 'water' ? 'dirt' : surf === 'oil' ? 'flagstone' : c.tags.includes('wall') ? sideName : surf;
      const topMat = mat(topName, variant, { dim });
      const side = mat(sideName, variant, { dim });
      if (c.tags.includes('stairs') && buildStairs(v, x, y, bottom, [side, side, topMat, side, side, side], add, geo)) { colTops[y][x] = top; continue; }
      const col = add(new THREE.Mesh(g, [side, side, topMat, side, side, side]), at);
      col.position.set(x + 0.5, bottom + h / 2, y + 0.5);
      colTops[y][x] = colTop;
      if (surf === 'oil') {
        const o = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1.15, 1.15)), mat('oil', variant, { dim, rough: 0.1, metal: 0, opacity: 0.999 })), at);
        o.rotation.x = -Math.PI / 2; o.rotation.z = variant; o.position.set(x + 0.5, top + 0.005, y + 0.5);
        o.castShadow = false;
      }
      if (surf === 'water') {
        const w = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(1, 1)), mat('water', variant, { dim, rough: 0.15, metal: 0.1, opacity: 0.78 })), at);
        w.rotation.x = -Math.PI / 2; w.position.set(x + 0.5, top - 0.06, y + 0.5);
        w.castShadow = false;
        waters.push(w);
      }
      if (c.obj) buildObject(c.obj, x, y, top, dim, variant, add, geo, c.terrain);
      else if (c.tags.includes('fire-source')) addFire(x + 0.5, top, y + 0.5, 1, dim);
      if (c.tags.includes('burning')) {
        const surfaceTop = c.obj && c.obj.stand ? top + c.obj.height * FT : top;
        for (let i = 0; i < 3; i++) {
          const r = TX.rng(TX.hash(x, y, i));
          addFire(x + 0.25 + r() * 0.5, surfaceTop, y + 0.25 + r() * 0.5, 0.8 + r() * 0.5, dim, i === 0);
        }
      }
    }
    for (const w of v.walls || []) buildWall(v, w, add, geo);
    // coordinate labels along the north and west edges
    for (let x = 0; x < v.width; x++) addLabel(String.fromCharCode(65 + x), x + 0.5, Math.max(0, colTops[0][x]) + 0.02, -0.4, geo);
    for (let y = 0; y < v.height; y++) addLabel(String(y + 1), -0.4, Math.max(0, colTops[y][0]) + 0.02, y + 0.5, geo);
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
    const plank = mat('planks', TX.hash(x, y) % VARIANTS, { dim });
    const slab = add(new THREE.Mesh(geo(box(0.92, 0.1, 1)), plank), { x, y });
    slab.position.set(x + 0.5, top - 0.05, y + 0.5);
    // rope rails on the sides that don't continue into more bridge
    const isBridge = (bx, by) => v.cells[by] && v.cells[by][bx] && (v.cells[by][bx].tags || []).includes('bridge');
    const rope = new THREE.MeshStandardMaterial({ color: dim ? '#4a3f2e' : '#b89a64', roughness: 1 });
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
        const bowl = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.16, 0.2, 14)), ironM), at);
        bowl.position.set(cx, top + H - 0.1, cz);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const leg = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.03, H - 0.15, 5)), ironM), at);
          leg.position.set(cx + Math.cos(a) * 0.16, top + (H - 0.15) / 2, cz + Math.sin(a) * 0.16);
        }
        const coals = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14)), new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ff5a1a', emissiveIntensity: dim ? 0.2 : 1.4 })), at);
        coals.position.set(cx, top + H - 0.01, cz);
        addFire(cx, top + H, cz, 0.9, dim, true);
        break;
      }
      case 'tree': {
        const vis = Math.min(H, 3.2);
        const trunk = add(new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.16, vis * 0.55, 8)), mat('bark', variant, { dim })), at);
        trunk.position.set(cx, top + vis * 0.275, cz);
        const leafM = new THREE.MeshStandardMaterial({ map: tex('leaves', variant), roughness: 1, flatShading: true, color: dim ? '#555' : '#fff' });
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
    s.userData = { base: s.scale.clone(), y: s.position.y, phase: Math.random() * 10 };
    fx.add(s); flames.push(s);
    if (light && !dim && lights.length < 8) {
      const l = new THREE.PointLight('#ff9a4a', 5, 6, 1.6);
      l.position.set(x, y + 0.5, z);
      l.userData.phase = Math.random() * 10;
      scene.add(l); lights.push(l);
    }
  }

  function buildWall(v, w, add, geo) {
    const vertical = w.x1 === w.x2;
    const len = vertical ? Math.abs(w.y2 - w.y1) : Math.abs(w.x2 - w.x1);
    // floor heights on both sides of the segment
    const hs = [];
    for (let i = 0; i < len; i++) {
      const a = vertical ? [w.x1 - 1, Math.min(w.y1, w.y2) + i] : [Math.min(w.x1, w.x2) + i, w.y1 - 1];
      const b = vertical ? [w.x1, Math.min(w.y1, w.y2) + i] : [Math.min(w.x1, w.x2) + i, w.y1];
      for (const [cx, cy] of [a, b]) if (v.cells[cy] && v.cells[cy][cx] && v.cells[cy][cx].fog !== 'unknown') hs.push((v.cells[cy][cx].h || 0) * FT);
    }
    if (!hs.length) hs.push(0);
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
      return mesh;
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
      hinge.add(leaf);
      hinge.rotation.y = w.open ? (vertical ? -1 : 1) * Math.PI * 0.55 : 0;
      terrain.add(hinge);
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
    piece(len + T * 0.01, base, rim + ft * FT, w.kind === 'low' ? mat('masonry', 2, opts) : stone);
  }

  function addLabel(text, x, y, z, geo) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '600 40px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(12,11,9,.85)'; ctx.strokeText(text, 32, 34);
    ctx.fillStyle = '#d8cfb8'; ctx.fillText(text, 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.5, 0.5)), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    m.userData.dispose = t;
    terrain.add(m);
  }

  // ---------- tokens ----------
  function tokenCanvas(c, label, isTurn) {
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const down = c.hp !== undefined ? c.hp <= 0 : c.health === 'down';
    const color = SIDE_COLOR[c.side] || SIDE_COLOR.neutral;
    const R = 50;
    ctx.globalAlpha = down ? 0.55 : 1;
    ctx.fillStyle = '#1b1a15'; ctx.beginPath(); ctx.arc(64, 64, R, 0, 7); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = color;
    if (c.hidden) ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.arc(64, 64, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (c.hp !== undefined && c.maxHp) {
      const f = Math.max(0, Math.min(1, c.hp / c.maxHp));
      ctx.lineWidth = 5; ctx.strokeStyle = f > 0.5 ? '#6fbf73' : f > 0.25 ? '#d8b45a' : '#d25b4a';
      ctx.beginPath(); ctx.arc(64, 64, R - 10, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#e9e3d3'; ctx.font = '700 44px "Cormorant SC", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 64, 68);
    if (down) {
      ctx.globalAlpha = 1; ctx.strokeStyle = '#d25b4a'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(88, 88); ctx.moveTo(88, 40); ctx.lineTo(40, 88); ctx.stroke();
    }
    const conds = (c.conditions || []).filter((x) => x.name !== 'unconscious' || !down);
    if (conds.length) { ctx.globalAlpha = 1; ctx.fillStyle = SECRET; ctx.beginPath(); ctx.arc(108, 20, 12, 0, 7); ctx.fill(); }
    if (isTurn) { ctx.globalAlpha = 1; ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(64, 64, R + 9, 0, 7); ctx.stroke(); }
    return cv;
  }

  function makeToken(c) {
    const g = new THREE.Group();
    const color = new THREE.Color(SIDE_COLOR[c.side] || SIDE_COLOR.neutral);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.08, 28), new THREE.MeshStandardMaterial({ color: '#1f1d18', roughness: 0.6 }));
    base.position.y = 0.04; base.castShadow = true; base.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.03, 8, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.08;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#2a2822' }));
    stem.position.y = 0.33;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
    sprite.scale.set(0.72, 0.72, 1); sprite.position.y = 0.92;
    const turnRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true }));
    turnRing.rotation.x = Math.PI / 2; turnRing.position.y = 0.03;
    const selRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.53, 48), new THREE.MeshBasicMaterial({ color: '#e9e3d3', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.025;
    g.add(base, rim, stem, sprite, turnRing, selRing);
    g.traverse((o) => { o.userData.id = c.id; });
    g.userData = { id: c.id, sprite, turnRing, selRing, rim, stem, key: null, path: [], target: null, offset: new THREE.Vector3() };
    tokens.add(g);
    return g;
  }

  function updateTokens(v, selected) {
    const labels = tokenLabels(v);
    const seen = new Set();
    for (const c of Object.values(v.creatures)) {
      seen.add(c.id);
      let g = tokenObjs.get(c.id);
      const p = cellOf(c.pos);
      const target = new THREE.Vector3(p.x + 0.5, (c.elev || 0) * FT, p.y + 0.5);
      if (!g) { g = makeToken(c); tokenObjs.set(c.id, g); g.position.copy(target); }
      g.userData.target = target;
      const isTurn = v.current === c.id;
      const key = JSON.stringify([labels[c.id], c.hp, c.maxHp, c.health, c.hidden, c.conditions, c.side, isTurn]);
      if (key !== g.userData.key) {
        const old = g.userData.sprite.material.map;
        const t = new THREE.CanvasTexture(tokenCanvas(c, labels[c.id], isTurn)); t.colorSpace = THREE.SRGBColorSpace;
        g.userData.sprite.material.map = t; g.userData.sprite.material.needsUpdate = true;
        if (old) old.dispose();
        g.userData.key = key;
      }
      const down = c.hp !== undefined ? c.hp <= 0 : c.health === 'down';
      g.userData.sprite.material.opacity = c.hidden ? 0.55 : 1;
      g.userData.sprite.position.y = down ? 0.3 : 0.92;
      g.userData.stem.visible = !down;
      g.userData.turnRing.visible = isTurn;
      g.userData.selRing.visible = selected === c.id;
    }
    for (const [id, g] of tokenObjs) if (!seen.has(id)) { tokens.remove(g); tokenObjs.delete(id); }
  }

  // Animate the most recent move along its path, and draw a fading trail like the 2D map.
  function playMoves(v) {
    const moves = (v.log || []).filter((e) => e.type === 'move' && e.data);
    const last = moves[moves.length - 1];
    if (!last) return;
    if (lastMoveT === null) { lastMoveT = last.t; return; } // first load: no replay
    if (last.t === lastMoveT) return;
    lastMoveT = last.t;
    const g = tokenObjs.get(last.data.id);
    if (!g || !last.data.path) return;
    const pts = last.data.path.map((id) => { const p = cellOf(id); return new THREE.Vector3(p.x + 0.5, cellElev(v, p.x, p.y) * FT, p.y + 0.5); });
    g.position.copy(pts[0]);
    g.userData.path = pts.slice(1);
    if (trail) { fx.remove(trail); trail.geometry.dispose(); }
    const lg = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(p.y + 0.06)));
    trail = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: GOLD, dashSize: 0.12, gapSize: 0.14, transparent: true }));
    trail.computeLineDistances();
    trail.userData.born = performance.now();
    fx.add(trail);
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
    const label = labelSprite(p.label ? `${p.who}: ${p.label}` : p.who);
    label.position.set(q.x + 0.5, y + 0.9, q.y + 0.5);
    fx.add(ring, label);
    pings.push({ ring, label, born: performance.now() });
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
  const tokenPoint = (id, up = 0.7) => { const g = tokenObjs.get(id); return g ? g.position.clone().setY(g.position.y + up) : null; };
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
      const dur = Math.min(650, 160 + a.distanceTo(b) * 45), born = performance.now(), arc = Math.min(1.2, a.distanceTo(b) * 0.08);
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
      let prev = 0, hitSent = false;
      effects.push((now) => {
        const k = Math.min(1, (now - born) / 300), off = Math.sin(Math.PI * k) * 0.38;
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
    const born = performance.now(), base = g.position.clone().setY(g.position.y + 1.4);
    effects.push((now) => {
      const k = (now - born) / 1300;
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
    const m = g.userData.sprite.material, born = performance.now();
    let prev = new THREE.Vector3();
    effects.push((now) => {
      const k = Math.min(1, (now - born) / (big ? 520 : 380));
      m.color.setRGB(1, 0.35 + 0.65 * k, 0.3 + 0.7 * k);
      const amp = (1 - k) * (big ? 0.12 : 0.07), off = new THREE.Vector3(Math.sin(now / 18) * amp, 0, Math.cos(now / 23) * amp);
      g.userData.offset.add(off.clone().sub(prev)); prev = off;
      if (k < 1) return false;
      g.userData.offset.sub(prev); m.color.setRGB(1, 1, 1); return true;
    });
  }

  // ---------- camera ----------
  function frame(v) {
    const cx = v.width / 2, cz = v.height / 2, span = Math.max(v.width, v.height);
    controls.target.set(cx, 0, cz);
    camera.position.set(cx - span * 0.08, span * 0.78, cz + span * 0.78);
    controls.update();
    const s = span * 0.8 + 4;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: span * 4 + 40 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(cx - span * 0.45, span * 1.1 + 8, cz - span * 0.25);
    sun.target.position.set(cx, 0, cz);
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...tokens.children, ...terrain.children], true).find((h) => h.object.userData.id || h.object.userData.cell);
    if (!hit) return null;
    if (hit.object.userData.id) return { id: hit.object.userData.id };
    return { cell: hit.object.userData.cell };
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const p = pick(e);
    if (p && p.id && onSelect) onSelect(p.id);
    else if (p && p.cell && onCell) onCell(p.cell.x, p.cell.y);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!onHover || e.buttons) return;
    const p = pick(e);
    if (p && p.id && lastState) { const q = cellOf(lastState.creatures[p.id].pos); onHover(q.x, q.y); }
    else if (p && p.cell) onHover(p.cell.x, p.cell.y);
    else onHover(-1, -1);
  });
  renderer.domElement.addEventListener('pointerleave', () => onHover && onHover(-1, -1));

  // ---------- loop ----------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let raf = 0, prev = performance.now();
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const t = now / 1000;
    for (const s of flames) {
      const k = 1 + Math.sin(t * 9 + s.userData.phase) * 0.08 + Math.sin(t * 23 + s.userData.phase) * 0.05;
      s.scale.set(s.userData.base.x * (2 - k), s.userData.base.y * k, 1);
      s.position.y = s.userData.y + (k - 1) * 0.1;
    }
    for (const l of lights) l.intensity = 5 * (1 + Math.sin(t * 11 + l.userData.phase) * 0.12 + Math.sin(t * 27 + l.userData.phase) * 0.08);
    for (const w of waters) { const m = w.material.map; m.offset.x = (t * 0.02) % 1; m.offset.y = (t * 0.013) % 1; }
    for (const g of tokens.children) {
      const u = g.userData;
      // Effects (lunges, shakes) live in u.offset, on top of where the token is walking to.
      if (u.applied) g.position.sub(u.applied);
      u.applied = u.offset.clone();
      if (u.path.length) {
        const next = u.path[0];
        const step = 7 * dt;
        const d = g.position.distanceTo(next);
        if (d <= step) { g.position.copy(next); u.path.shift(); } else g.position.lerp(next, step / d);
      } else if (u.target) g.position.lerp(u.target, 1 - Math.exp(-dt * 10));
      g.position.add(u.applied);
      u.turnRing.material.opacity = 0.55 + Math.sin(t * 4) * 0.35;
    }
    for (let i = effects.length - 1; i >= 0; i--) if (effects[i](now)) effects.splice(i, 1);
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i], age = (now - pg.born) / 3000;
      pg.ring.scale.setScalar(1 + ((age * 3) % 1) * 1.5);
      pg.ring.material.opacity = Math.max(0, 1 - age);
      pg.label.material.opacity = Math.max(0, Math.min(1, (1 - age) * 2));
      if (age >= 1) {
        for (const o of [pg.ring, pg.label]) { fx.remove(o); o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        pings.splice(i, 1);
      }
    }
    if (trail) {
      const age = (now - trail.userData.born) / 2400;
      trail.material.opacity = Math.max(0, 0.9 * (1 - age));
      if (age >= 1) { fx.remove(trail); trail.geometry.dispose(); trail = null; }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  function signature(v) {
    return JSON.stringify([v.width, v.height, wallsLow, v.walls, v.cells.map((r) => r.map((c) => [c.fog, c.ch, c.h, c.tags, c.obj]))]);
  }

  return {
    update(v, { selected, cursor } = {}) {
      lastState = v; lastSelected = selected;
      const sig = signature(v);
      if (sig !== built) { buildTerrain(v); built = sig; }
      if (!framed) { frame(v); framed = true; }
      updateTokens(v, selected);
      playMoves(v);
      setCursor(v, cursor);
    },
    ping: addPing,
    setPath, shoot, bump, hit,
    setWallsLow(on) { wallsLow = on; if (lastState) this.update(lastState, { selected: lastSelected }); },
    resetCamera() { if (lastState) frame(lastState); },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      disposables.forEach((g) => g.dispose());
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}

function cellOf(id) { return { x: id.charCodeAt(0) - 65, y: parseInt(id.slice(1), 10) - 1 }; }

// Same two-letter labels as the 2D map.
function tokenLabels(v) {
  const base = {}, count = {};
  for (const c of Object.values(v.creatures)) {
    base[c.id] = c.name.replace(/^(Goblin|Brother|Sister|the)\s+/i, '').slice(0, 2);
    count[base[c.id]] = (count[base[c.id]] || 0) + 1;
  }
  const out = {};
  for (const [id, b] of Object.entries(base)) out[id] = count[b] > 1 ? b[0] + ((id.match(/\d+$/) || [''])[0] || id.slice(-1)) : b;
  return out;
}
