// Procedural textures for the 3D battlemap: small canvases drawn at load time, no image files.
// Clean, stylized, board-game look: flat base colours, crisp edges, a little noise for life.
// Every generator is seeded so a cell always gets the same variant, and tiles seamlessly.

const SIZE = 128;

// ---------- helpers ----------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= v | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Tileable value noise: lattice values wrap every `period` cells.
function makeNoise(seed, period) {
  const lat = [];
  const r = rng(seed);
  for (let i = 0; i < period * period; i++) lat.push(r());
  const at = (x, y) => lat[((y % period) + period) % period * period + ((x % period) + period) % period];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => { // u, v in [0,1)
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(seed, base = 4, octaves = 3) {
  const layers = Array.from({ length: octaves }, (_, i) => makeNoise(seed + i * 101, base << i));
  return (u, v) => {
    let sum = 0, amp = 1, norm = 0;
    for (const n of layers) { sum += n(u, v) * amp; norm += amp; amp *= 0.5; }
    return sum / norm;
  };
}

function canvas(w = SIZE, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, v * k)));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Multiply the whole canvas by a tileable noise field: cheap, keeps flat areas from looking dead.
function grain(ctx, seed, strength = 0.12, base = 8) {
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const n = fbm(seed, base, 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = 1 + (n(x / w, y / h) - 0.5) * 2 * strength;
    const i = (y * w + x) * 4;
    img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
}
// Draw something at every wrapped offset so shapes crossing an edge tile cleanly.
function wrapped(ctx, fn) {
  const { width: w, height: h } = ctx.canvas;
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { ctx.save(); ctx.translate(ox, oy); fn(); ctx.restore(); }
}

// ---------- ground ----------
export function flagstone(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  const mortar = hex('#4b473f');
  ctx.fillStyle = rgb(mortar); ctx.fillRect(0, 0, SIZE, SIZE);
  // 2x2 stones with jittered seams; the jitter repeats at the edges so it tiles.
  const j = () => (r() - 0.5) * 14;
  const sx = [0, 64 + j(), 128], sy = [0, 64 + j(), 128];
  const base = hex('#8c867a');
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
    const x0 = sx[ix] + 2, y0 = sy[iy] + 2, x1 = sx[ix + 1] - 2, y1 = sy[iy + 1] - 2;
    const col = shade(mix(base, hex(r() < 0.5 ? '#9a8f7c' : '#7f8287'), r() * 0.5), 0.9 + r() * 0.2);
    ctx.fillStyle = rgb(col);
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 5); ctx.fill();
    // bevel: light top-left, dark bottom-right
    ctx.strokeStyle = rgb(shade(col, 1.18)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0 + 4, y1 - 2); ctx.lineTo(x0 + 2, y0 + 2); ctx.lineTo(x1 - 4, y0 + 2); ctx.stroke();
    ctx.strokeStyle = rgb(shade(col, 0.72));
    ctx.beginPath(); ctx.moveTo(x1 - 2, y0 + 4); ctx.lineTo(x1 - 2, y1 - 2); ctx.lineTo(x0 + 4, y1 - 2); ctx.stroke();
    if (r() < 0.35) { // a hairline crack
      ctx.strokeStyle = rgb(shade(col, 0.65)); ctx.lineWidth = 1;
      ctx.beginPath(); let px = x0 + 8 + r() * (x1 - x0 - 16), py = y0 + 6; ctx.moveTo(px, py);
      for (let k = 0; k < 4; k++) { px += (r() - 0.5) * 14; py += 6 + r() * 8; ctx.lineTo(px, Math.min(py, y1 - 6)); }
      ctx.stroke();
    }
  }
  grain(ctx, seed, 0.1);
  return c;
}

export function grass(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  const n = fbm(seed, 3, 3);
  const img = ctx.createImageData(SIZE, SIZE);
  const lo = hex('#4e6a2e'), hi = hex('#6f8c3c');
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const col = mix(lo, hi, n(x / SIZE, y / SIZE));
    const i = (y * SIZE + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // blade tufts
  for (let k = 0; k < 90; k++) {
    const x = r() * SIZE, y = r() * SIZE, len = 4 + r() * 6;
    const col = r() < 0.5 ? '#86a64c' : '#3f5726';
    wrapped(ctx, () => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y - len); ctx.stroke();
    });
  }
  // the odd flower
  for (let k = 0; k < 3; k++) {
    const x = r() * SIZE, y = r() * SIZE;
    wrapped(ctx, () => { ctx.fillStyle = r() < 0.5 ? '#e8dca0' : '#d9a0b8'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); });
  }
  return c;
}

export function dirt(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  ctx.fillStyle = '#7a6347'; ctx.fillRect(0, 0, SIZE, SIZE);
  grain(ctx, seed, 0.18, 4);
  for (let k = 0; k < 26; k++) {
    const x = r() * SIZE, y = r() * SIZE, rad = 1.5 + r() * 3.5;
    const col = shade(hex(r() < 0.5 ? '#8c8170' : '#6a5a46'), 0.9 + r() * 0.3);
    wrapped(ctx, () => {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.2, rad, rad * 0.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = rgb(col); ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.8, 0, 0, 7); ctx.fill();
    });
  }
  return c;
}

// Cliff faces and rough rock: horizontal strata with a few cracks. Used for wall columns.
export function rock(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  let y = 0;
  const base = hex('#6d675d');
  while (y < SIZE) {
    const h = 10 + r() * 18;
    ctx.fillStyle = rgb(shade(base, 0.85 + r() * 0.3));
    ctx.fillRect(0, y, SIZE, h + 1);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, y + h - 2, SIZE, 2);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, y, SIZE, 1.5);
    y += h;
  }
  ctx.strokeStyle = 'rgba(25,22,18,.55)'; ctx.lineWidth = 1.5;
  for (let k = 0; k < 5; k++) {
    let px = r() * SIZE, py = r() * SIZE;
    wrapped(ctx, () => {
      ctx.beginPath(); ctx.moveTo(px, py);
      let x = px, yy = py;
      for (let i = 0; i < 3; i++) { x += (r() - 0.5) * 12; yy += 5 + r() * 9; ctx.lineTo(x, yy); }
      ctx.stroke();
    });
  }
  grain(ctx, seed, 0.12, 6);
  return c;
}

// Dressed masonry, running bond. For built walls and pillars.
export function masonry(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  ctx.fillStyle = '#4d483f'; ctx.fillRect(0, 0, SIZE, SIZE);
  const rows = 4, bh = SIZE / rows, bw = SIZE / 2;
  const base = hex('#857e70');
  for (let iy = 0; iy < rows; iy++) {
    const off = iy % 2 ? bw / 2 : 0;
    for (let ix = -1; ix < 3; ix++) {
      const x = ix * bw + off, yy = iy * bh;
      const col = shade(base, 0.86 + r() * 0.26);
      ctx.fillStyle = rgb(col); ctx.fillRect(x + 2, yy + 2, bw - 4, bh - 4);
      ctx.fillStyle = rgb(shade(col, 1.15)); ctx.fillRect(x + 2, yy + 2, bw - 4, 2);
      ctx.fillStyle = rgb(shade(col, 0.75)); ctx.fillRect(x + 2, yy + bh - 4, bw - 4, 2);
    }
  }
  grain(ctx, seed, 0.1);
  return c;
}

export function chasm(seed) {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = '#0d0c0b'; ctx.fillRect(0, 0, 64, 64);
  grain(ctx, seed, 0.4, 4);
  return c;
}

// ---------- wood ----------
// Boards running along u. `boards` across the tile, dark gaps, wavy grain, a nail at each end.
export function planks(seed, { boards = 4, color = '#8a6238', nails = true } = {}) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  const base = hex(color);
  const bh = SIZE / boards;
  ctx.fillStyle = '#2f2013'; ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < boards; i++) {
    const y = i * bh, col = shade(base, 0.85 + r() * 0.3);
    ctx.fillStyle = rgb(col); ctx.fillRect(0, y + 1.5, SIZE, bh - 3);
    ctx.strokeStyle = rgb(shade(col, 0.78)); ctx.lineWidth = 1;
    const ph = r() * 6.28, amp = 1 + r() * 2;
    for (let g = 0; g < 3; g++) {
      const gy = y + 5 + g * (bh - 10) / 2;
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x += 4) ctx.lineTo(x, gy + Math.sin(x / SIZE * 6.283 * 2 + ph + g) * amp);
      ctx.stroke();
    }
    if (nails) {
      ctx.fillStyle = '#2a2420';
      for (const nx of [6, SIZE - 6]) { ctx.beginPath(); ctx.arc(nx, y + bh / 2, 1.6, 0, 7); ctx.fill(); }
    }
  }
  grain(ctx, seed, 0.08);
  return c;
}

export function crate(seed) {
  const [c, ctx] = canvas();
  ctx.drawImage(planks(seed, { boards: 4, color: '#9a7140', nails: false }), 0, 0);
  const frame = '#6b4a28', dark = '#3a2716';
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, SIZE, 14); ctx.fillRect(0, SIZE - 14, SIZE, 14);
  ctx.fillRect(0, 0, 14, SIZE); ctx.fillRect(SIZE - 14, 0, 14, SIZE);
  ctx.save(); ctx.translate(SIZE / 2, SIZE / 2); ctx.rotate(Math.PI / 4);
  ctx.fillRect(-SIZE * 0.68, -7, SIZE * 1.36, 14); ctx.restore();
  ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2); ctx.strokeRect(14, 14, SIZE - 28, SIZE - 28);
  ctx.fillStyle = '#2a2420';
  for (const [x, y] of [[7, 7], [SIZE - 7, 7], [7, SIZE - 7], [SIZE - 7, SIZE - 7]]) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
  grain(ctx, seed + 7, 0.06);
  return c;
}

export function barrel(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  const staves = 8, w = SIZE / staves;
  for (let i = 0; i < staves; i++) {
    ctx.fillStyle = rgb(shade(hex('#8a5f34'), 0.85 + r() * 0.3)); ctx.fillRect(i * w, 0, w, SIZE);
    ctx.fillStyle = '#3a2716'; ctx.fillRect(i * w, 0, 1.5, SIZE);
  }
  for (const y of [14, SIZE - 22]) {
    ctx.fillStyle = '#3d3b39'; ctx.fillRect(0, y, SIZE, 8);
    ctx.fillStyle = '#5a5754'; ctx.fillRect(0, y, SIZE, 2);
  }
  grain(ctx, seed, 0.08);
  return c;
}

export function door(seed) {
  const [c, ctx] = canvas();
  const p = planks(seed, { boards: 5, color: '#7a5330', nails: false });
  ctx.save(); ctx.translate(SIZE, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(p, 0, 0); ctx.restore();
  for (const y of [22, SIZE - 30]) {
    ctx.fillStyle = '#34322f'; ctx.fillRect(0, y, SIZE, 8);
    ctx.fillStyle = '#1e1c1a';
    for (let x = 10; x < SIZE; x += 22) { ctx.beginPath(); ctx.arc(x, y + 4, 2, 0, 7); ctx.fill(); }
  }
  ctx.fillStyle = '#c8a050'; ctx.beginPath(); ctx.arc(SIZE - 22, SIZE / 2, 4, 0, 7); ctx.fill();
  return c;
}

export function bark(seed) {
  const [c, ctx] = canvas(64, 128);
  const r = rng(seed);
  ctx.fillStyle = '#5a4430'; ctx.fillRect(0, 0, 64, 128);
  for (let k = 0; k < 14; k++) {
    const x = r() * 64;
    ctx.fillStyle = r() < 0.5 ? '#46341f' : '#6b543b';
    ctx.fillRect(x, 0, 2 + r() * 3, 128);
  }
  grain(ctx, seed, 0.15, 4);
  return c;
}

export function leaves(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  ctx.fillStyle = '#3f6a2c'; ctx.fillRect(0, 0, SIZE, SIZE);
  for (let k = 0; k < 140; k++) {
    const x = r() * SIZE, y = r() * SIZE, rad = 3 + r() * 6;
    const col = ['#4f7d34', '#355a24', '#6a943f', '#2d4c1f'][Math.floor(r() * 4)];
    wrapped(ctx, () => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); });
  }
  return c;
}

// ---------- metal, liquids, fire ----------
export function iron(seed) {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = '#3b3936'; ctx.fillRect(0, 0, 64, 64);
  grain(ctx, seed, 0.2, 4);
  ctx.fillStyle = '#5c5955';
  for (const x of [8, 32, 56]) { ctx.beginPath(); ctx.arc(x, 10, 2.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x, 54, 2.5, 0, 7); ctx.fill(); }
  return c;
}

// A puddle decal (transparent outside the blob) with a faint rainbow sheen, laid over the floor.
export function oil(seed) {
  const [c, ctx] = canvas();
  const n = fbm(seed, 2, 3), edge = fbm(seed + 9, 3, 2);
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2 + (edge(u, v) - 0.5) * 0.7;
    const a = Math.max(0, Math.min(1, (0.98 - d) * 8));
    const t = n(u, v) * 14;
    const band = Math.max(0, Math.sin(t)) ** 4;
    const i = (y * SIZE + x) * 4;
    img.data[i] = 52 + (Math.sin(t) * 0.5 + 0.5) * 80 * band;
    img.data[i + 1] = 50 + (Math.sin(t + 2.1) * 0.5 + 0.5) * 90 * band;
    img.data[i + 2] = 42 + (Math.sin(t + 4.2) * 0.5 + 0.5) * 100 * band;
    img.data[i + 3] = a * 210;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function water(seed) {
  const [c, ctx] = canvas();
  const r = rng(seed);
  const n = fbm(seed, 3, 2);
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const v = n(x / SIZE, y / SIZE);
    const i = (y * SIZE + x) * 4;
    img.data[i] = 40 + v * 30; img.data[i + 1] = 92 + v * 40; img.data[i + 2] = 110 + v * 50; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(220,240,255,.35)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    const x = r() * SIZE, y = r() * SIZE, w = 6 + r() * 12;
    wrapped(ctx, () => { ctx.beginPath(); ctx.arc(x, y, w, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); });
  }
  return c;
}

export function flame() {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 40, 2, 32, 36, 30);
  g.addColorStop(0, 'rgba(255,244,200,1)');
  g.addColorStop(0.3, 'rgba(255,190,80,.95)');
  g.addColorStop(0.65, 'rgba(230,90,30,.55)');
  g.addColorStop(1, 'rgba(200,50,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(32, 2);
  ctx.bezierCurveTo(50, 22, 60, 40, 46, 58); ctx.lineTo(18, 58); ctx.bezierCurveTo(4, 40, 14, 22, 32, 2);
  ctx.fill();
  return c;
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// Which ground texture a cell gets, from its tags and terrain name. Unknown terrain falls back to
// flagstones, so a new encounter always renders; add a generator here for a new look.
export function surfaceFor(cell) {
  const t = cell.tags || [], name = (cell.terrain || '').toLowerCase();
  if (t.includes('chasm')) return 'chasm';
  if (t.includes('wall')) return 'rock';
  if (t.includes('bridge') || /plank|wood|deck|floorboard/.test(name)) return 'planks';
  if (t.includes('water')) return 'water';
  if (t.includes('slick') || /oil/.test(name)) return 'oil';
  if (/grass|meadow|lawn/.test(name)) return 'grass';
  if (/dirt|mud|earth|sand|path/.test(name)) return 'dirt';
  return 'flagstone';
}

export const GENERATORS = { flagstone, grass, dirt, rock, masonry, chasm, planks, crate, barrel, door, bark, leaves, iron, oil, water };
