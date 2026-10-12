// Markers for the 3D map (ported from poc/wheel3d.html): per creature a world stem (fat line, solid in front, dashed where
// hidden), an icon at its top and a name label hanging off the icon. The stem grows as the cursor nears; tracing it turns it
// gold and, at the top, enters icon mode (square-mates' icons grow, the pointer picks by icon). map3d owns the scene and the
// bodies and passes in what is needed; this module owns the pointer logic for stems and icons (`hover`, `pickAt`).
// All screen maths here is in the container's own coordinates; the pointer and the exported positions are client px.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

export const STEM_W = 0.9;   // a lone stem's world length above the top of the body
const LOW = 0.55;            // how much shorter the other stems get while a wheel is out of an icon
const TRACE_R = 11;          // px: the cursor this close to a shown stem holds that creature
const SPREAD_D = 26, SPREAD_EXIT = 50;
const SPREAD = false;        // icon mode pushes packed icons apart (spreadLayout); off, as in the mockup
const GROW_CURVE = 1.3;      // = HL.growCurve in map3d

const CSS = `
.mk-layer { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; user-select: none; }
.mk-layer .mk { opacity: 0; pointer-events: none; position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 700 11px/1 var(--sans, system-ui, sans-serif); border: 2px solid; background: #14130f; will-change: transform, opacity; }
.mk-layer .mk.party { border-color: var(--party, #4fb3a4); color: var(--party, #4fb3a4); }
.mk-layer .mk.enemy { border-color: var(--enemy, #cf6a4c); color: var(--enemy, #cf6a4c); }
.mk-layer .mk.neutral { border-color: var(--neutral, #a59f8e); color: var(--neutral, #a59f8e); }
.mk-layer .mk.hot { border-color: var(--gold, #d8b45a); background: #2e2a1e; }
.mk-layer .lb { opacity: 0; pointer-events: none; position: absolute; left: 0; top: 0; display: flex; align-items: center; height: 15px; padding: 0 5px; border-radius: 6px; background: #14130fd9; color: var(--ink, #e9e3d3); white-space: nowrap; font: 600 11px/1 var(--sans, system-ui, sans-serif); will-change: transform, opacity, clip-path; }
.mk-layer .lb small { color: var(--ink-faint, #6b6557); font-weight: 400; margin-left: 4px; }
.mk-layer .lb.hot { color: var(--gold, #d8b45a); }`;

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cLo = new THREE.Color('#ffbf2e'), cHi = new THREE.Color('#e9e3d3');
const Y = new THREE.Vector3(0, 1, 0);

// deps: { scene, camera, renderer, container, tokenObjs (id -> body group), inView(g), bodyAt(x, y, curGroup) -> group|null,
//         hoverScores(x, y), mouse ({x, y, btn}, client px) }
export function createMarks({ scene, camera, renderer, container, tokenObjs, inView, bodyAt, hoverScores, mouse }) {
  if (!document.getElementById('mk-css')) document.head.insertAdjacentHTML('beforeend', `<style id="mk-css">${CSS}</style>`);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const layer = document.createElement('div');
  layer.className = 'mk-layer'; container.appendChild(layer);

  const ents = new Map();   // id -> { id, g, u, mk, ... }
  let off = { x: 0, y: 0 }, W = 1, H = 1;   // the container's client offset and size this frame
  let hoverEnt = null, mkHover = null, lastBody = null, lowEnt = null, wheelEl = null, youId = null, selId = null, escHold = false;
  let iconMode = null;   // { key (the square), list, pin, from (the last icon hovered), full } or null
  let pre = null;        // the last 15% of a traced stem blends into icon mode: { list, pin, tr, k 0..1, full }
  const trace = { e: null, t: 0, lock: { x: 0, y: 0 } };

  // ---- the world stem: two pieces so the part up to the cursor can be gold while tracing ----
  const stemGeo = new LineGeometry().setPositions([0, 0, 0, 0, 1, 0]);   // unit length, scaled per frame
  const lineMats = [];
  function makeStem() {
    const piece = (w) => {
      const mk = (o) => { const m = new LineMaterial({ linewidth: w, transparent: true, opacity: 0, ...o }); lineMats.push(m); return m; };
      const solid = new Line2(stemGeo, mk({})), dash = new Line2(stemGeo, mk({ dashed: true, dashSize: 0.05, gapSize: 0.05, depthFunc: THREE.GreaterDepth, depthWrite: false }));
      dash.computeLineDistances();
      for (const l of [solid, dash]) { l.visible = false; l.frustumCulled = false; scene.add(l); }
      return { solid, dash };
    };
    return { lo: piece(2.6), hi: piece(1.4) };
  }
  const qd = new THREE.Vector3();
  function setPiece(p, A, B, col, op) {   // a piece of stem from A to B: the unit line, placed, turned and stretched
    const len = A.distanceTo(B), vis = op > 0.01 && len > 0.004;
    for (const [l, k] of [[p.solid, 1], [p.dash, 0.55]]) {
      l.visible = vis;
      if (!vis) continue;
      l.position.copy(A); l.scale.y = len; l.quaternion.setFromUnitVectors(Y, qd.subVectors(B, A).normalize());
      l.material.opacity = op * k; l.material.color.copy(col);
      if (k < 1) l.material.dashSize = l.material.gapSize = 0.05 / len;   // dashes keep their world size at any length
    }
  }
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,250,225,1)'); r.addColorStop(0.25, 'rgba(255,205,90,.8)'); r.addColorStop(1, 'rgba(255,190,50,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  spark.visible = false; spark.renderOrder = 5; scene.add(spark);

  // ---- creatures ----
  // c: the view's creature; alt: feet above the floor (0 on it)
  function labelOf(c, alt) {
    const sub = c.id === youId ? 'you' : alt > 0 ? `${alt} ft up` : (c.hp !== undefined ? c.hp <= 0 : c.health === 'down') ? 'down' : '';
    return esc(c.name) + (sub ? ` <small>${sub}</small>` : '');
  }
  function sync(creatures, you, alts = {}) {
    youId = you || null;
    for (const c of Object.values(creatures)) {
      const g = tokenObjs.get(c.id);
      if (!g) continue;
      let e = ents.get(c.id);
      if (!e) {
        const lb = document.createElement('div'); lb.className = 'lb'; layer.appendChild(lb);
        const el = document.createElement('div'); el.className = 'mk'; layer.appendChild(el);
        e = { id: c.id, g, u: g.userData, el, lb, stem: makeStem(), gp: 0, tu: 0, lab: 0, dim: 1, op: 0, big: 0, low: 0, ox: 0, oy: 0, w: 0, x: 0, y: 0, sc: 1, ik: 0,
          shown: false, front: false, base: new THREE.Vector3(), ta: { x: 0, y: 0 }, anchor: { x: 0, y: 0 }, html: null, side: null };
        ents.set(c.id, e);
      }
      e.g = g; e.u = g.userData;
      if (e.side !== c.side) { e.side = c.side; e.el.className = 'mk ' + (c.side === 'party' || c.side === 'enemy' ? c.side : 'neutral'); }
      const gl = (c.name || '?')[0].toUpperCase();
      if (e.el.textContent !== gl) e.el.textContent = gl;
      const html = labelOf(c, alts[c.id] || 0);
      if (html !== e.html) { e.html = html; e.lb.innerHTML = html; e.w = 0; }
    }
    for (const [id, e] of ents) if (!creatures[id] || !tokenObjs.has(id)) remove(id, e);
  }
  function remove(id, e) {
    ents.delete(id); e.el.remove(); e.lb.remove();
    for (const p of [e.stem.lo, e.stem.hi]) for (const l of [p.solid, p.dash]) { scene.remove(l); l.material.dispose(); lineMats.splice(lineMats.indexOf(l.material), 1); }
    if (trace.e === e) trace.e = null;
    if (lastBody === e) lastBody = null;
    if (mkHover === e) mkHover = null;
    if (hoverEnt === e) hoverEnt = null;
    if (lowEnt === e) lowEnt = null;
    iconMode = iconMode && iconMode.list.includes(e) ? null : iconMode;
    pre = pre && pre.list.includes(e) ? null : pre;
  }

  const proj = new THREE.Vector3();
  function toScreen(v) {   // container-local px
    proj.copy(v).project(camera);
    return { x: (proj.x + 1) / 2 * W, y: (1 - proj.y) / 2 * H, front: proj.z < 1 && Math.abs(proj.x) < 1.15 && Math.abs(proj.y) < 1.15 };
  }
  const camF = new THREE.Vector3(), rayD = new THREE.Vector3(), tmp = new THREE.Vector3();
  function worldAt(x, y, ref) {   // the point under local screen (x, y) on the camera-facing plane through ref
    rayD.set(x / W * 2 - 1, -(y / H) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    camera.getWorldDirection(camF);
    return rayD.clone().multiplyScalar(tmp.copy(ref).sub(camera.position).dot(camF) / rayD.dot(camF)).add(camera.position);
  }

  // ---- icon mode ----
  function spreadLayout(list, pin) {   // a fixed number of relaxation passes from the stem tops each frame (no simulation)
    const home = list.map((e) => e.ta), p = home.map((h) => ({ x: h.x, y: h.y }));
    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        let dx = p[j].x - p[i].x, dy = p[j].y - p[i].y, d = Math.hypot(dx, dy);
        if (d >= SPREAD_D) continue;
        if (d < 0.01) { const a = (i * 2.4 + j) % 6.283; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
        const k = (SPREAD_D - d) / 2 / d;
        p[i].x -= dx * k; p[i].y -= dy * k; p[j].x += dx * k; p[j].y += dy * k;
      }
      for (let i = 0; i < p.length; i++) { p[i].x += (home[i].x - p[i].x) * 0.1; p[i].y += (home[i].y - p[i].y) * 0.1; }
    }
    const j = list.indexOf(pin), px = j >= 0 ? p[j].x - home[j].x : 0, py = j >= 0 ? p[j].y - home[j].y : 0;
    return p.map((q, i) => ({ x: q.x - home[i].x - px, y: q.y - home[i].y - py }));
  }
  const mates = (e) => [...ents.values()].filter((o) => o.u.cellKey === e.u.cellKey);
  function enterSpread(e, pin = e) {
    const list = mates(e);
    if (list.length > 1) iconMode = { list, pin, from: e, full: null };
    pre = null;
  }
  const inSpread = (e) => !!e && !!iconMode && iconMode.list.includes(e);
  const busy = () => !!lowEnt;

  // ---- tracing ----
  // Where (x, y) sits along e's stem on screen: t up from the body, d off it. In a spread the icon leans toward its spread place
  // by the blend, and the blend follows t, so t is found by a few fixed-point steps.
  function stemT(e, x, y) {
    const x0 = e.anchor.x, y0 = e.anchor.y, ux = e.x - e.ox, uy = e.y - e.oy;
    const s = iconMode || pre, j = s?.full ? s.list.indexOf(e) : -1, f = j >= 0 ? s.full[j] : null;
    let k = iconMode ? 1 : pre?.k || 0, t = 0, d = 0, l2 = 0;
    for (let i = 0; i < (f ? 4 : 1); i++) {
      const dx = ux + (f ? f.x * k : 0) - x0, dy = uy + (f ? f.y * k : 0) - y0;
      l2 = dx * dx + dy * dy;
      t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      d = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
      k = sstep(0.85, 1, t);
    }
    return { t, d, l2 };
  }
  // The cursor within TRACE_R px of a shown stem (body top to icon) holds that creature, wherever it moves along the stem, and
  // beats the ellipse scoring; `t` is how far up the stem the cursor is. The current one holds on a bit.
  function traceAt(x, y) {
    let best = null, bd = TRACE_R, bt = 0;
    const cur = trace.e || lastBody;
    if (!busy()) for (const e of ents.values()) {
      if (pre && e !== pre.tr) continue;   // mid-blend only the traced stem counts
      if (!e.shown) continue;
      if (e !== cur && [...ents.values()].some((o) => o !== e && o.u.hv?.s < 1)) continue;   // a stem doesn't steal the cursor from a body it is over, unless it is the one followed
      const g = stemT(e, x, y);
      if (g.l2 < 64) continue;
      const d = g.d * (e === cur ? 0.7 : 1);
      if (d < bd) { bd = d; best = e; bt = g.t; }
    }
    trace.e = best; trace.t = bt;
    return best;
  }
  // In icon mode the icons catch the pointer 25% wider than they're drawn; where those overlap, the nearest centre wins.
  function iconHit(x, y) {
    if (mouse.btn || mouse.x < -1e3 || busy()) return null;
    let best = null, bd = Infinity;
    for (const e of iconMode.list) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (e.op > 0.3 && e.front && d < 11 * (e.sc || 1) * 1.25 && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  // Outside icon mode an icon is hit as drawn, once it has grown enough to be pointed at.
  function plainHit(x, y) {
    let best = null, bd = Infinity;
    for (const e of ents.values()) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (e.ik > 0.6 && e.front && d < 11 * (e.sc || 1) && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  // In icon mode, sliding off the last icon you were on and down its own stem traces back out, the blend running in reverse.
  function traceDown(lx, ly) {
    const e = iconMode.from;
    if (!e || mkHover || !e.shown) return;
    const g = stemT(e, lx, ly);
    if (g.d >= TRACE_R || g.t >= 0.995) return;
    trace.e = lastBody = e; trace.t = g.t; trace.lock = { x: mouse.x, y: mouse.y };
    pre = { list: iconMode.list, pin: iconMode.pin, tr: e, k: sstep(0.85, 1, g.t), full: iconMode.full };
    iconMode = null;
  }

  // Decide what the pointer is on this frame: an icon, a traced stem, or a body. `free` = the pointer may hover at all.
  // Returns the creature id or null.
  function hover(free) {
    const lx = mouse.x - off.x, ly = mouse.y - off.y;
    mkHover = null;
    if (free && !busy()) mkHover = iconMode ? iconHit(lx, ly) : plainHit(lx, ly);
    if (iconMode && mkHover && iconMode.list.includes(mkHover)) iconMode.from = mkHover;
    const onOwnIcon = trace.e && mkHover === trace.e, overIcon = !iconMode && mkHover && !onOwnIcon;
    const fr = free && !overIcon;
    if (iconMode && fr) traceDown(lx, ly);
    if (fr && !iconMode) {
      const was = trace.e, b = bodyAt(mouse.x, mouse.y, lastBody?.g);
      traceAt(lx, ly);
      lastBody = trace.e || (b ? ents.get(b.userData.id) || null : null);
      // while a stem is traced, the other stems' growth uses where the trace began, so they hold still as the cursor climbs
      if (trace.e && trace.e !== was) trace.lock = { x: mouse.x, y: mouse.y };
      if (trace.e) hoverScores(trace.lock.x, trace.lock.y);
    } else { hoverScores(mouse.x, mouse.y); trace.e = lastBody = null; }
    // icon mode starts when a trace reaches the top of its stem, or the pointer is on an icon (Esc holds it off until the pointer leaves)
    // (a traced stem blends in over its last 15% and commits at the very top; an icon reached any other way is instant)
    const top = !iconMode && !busy() && (mkHover && mkHover !== trace.e ? mkHover : trace.e && trace.t >= 0.995 ? trace.e : null);
    const blend = !iconMode && !busy() && trace.e ? sstep(0.85, 1, trace.t) : 0;
    const keep = pre?.tr === trace.e ? pre : null;   // a trace back down keeps the spread's pin, so nothing jumps
    if (!top && !blend) escHold = false; else if (top && !escHold) enterSpread(top, keep && top === trace.e ? keep.pin : top);
    const ms = blend && !escHold && !iconMode ? mates(trace.e) : [];
    pre = ms.length > 1 ? { list: ms, pin: keep ? keep.pin : trace.e, tr: trace.e, k: blend, full: keep?.full } : null;
    hoverEnt = mkHover || lastBody;
    return hoverEnt ? hoverEnt.id : null;
  }
  // What a click at (x, y) (client px) picks: an icon, then a traced stem, then a body.
  function pickAt(x, y) {
    const lx = x - off.x, ly = y - off.y;
    const ic = !busy() && (iconMode ? iconHit(lx, ly) : plainHit(lx, ly));
    if (ic) return ic.id;
    const t = traceAt(lx, ly);
    if (t) return t.id;
    const b = bodyAt(x, y, lastBody?.g);
    return b ? b.userData.id : null;
  }

  // ---- per frame ----
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pD = new THREE.Vector3();
  // ctx: { now, hoverId (the highlighted creature: pointer or portrait), selected (id), rect }
  function step({ now, hoverId, selected, rect }) {
    off = { x: rect.left, y: rect.top }; W = container.clientWidth || 1; H = container.clientHeight || 1;
    const sz = renderer.getSize(sizeV); for (const m of lineMats) m.resolution.set(sz.x, sz.y);
    selId = selected || null;
    const hot = hoverId ? ents.get(hoverId) : hoverEnt;
    const busyNow = busy(), sel = selId && ents.get(selId);
    const lx = mouse.x - off.x, ly = mouse.y - off.y;
    // 1. bodies: where each stem starts and how far its marker should have grown
    for (const e of ents.values()) {
      const g = e.g, u = e.u, top = u.top;
      e.anchor = toScreen(tmp.copy(g.position).setY(g.position.y + top));
      e.base.copy(g.position).y += top;
      e.ta = toScreen(tmp.copy(e.base).setY(e.base.y + STEM_W));
      e.front = e.anchor.front;
      const me = e.id === youId;
      let tp = 0;   // growth target: the approach while the cursor nears, 1 when hovered, selected or picked
      if (e.front && !busyNow) {
        if (iconMode) tp = inSpread(e) ? 1 : 0;
        else if (sel === e) tp = 1;
        else if (inView(g)) tp = hot === e ? 1 : u.apL || 0;
        if (me && !iconMode) tp = 1;   // you are always on the map, dimmer from afar
        if (pre && !iconMode) tp = pre.list.includes(e) ? Math.max(tp, pre.k) : tp * (1 - pre.k);
      } else if (e.front && busyNow) {   // a wheel is out of an icon: that one, its square-mates and you stay (the others lowered)
        tp = e === lowEnt || me || e.u.cellKey === lowEnt.u.cellKey ? 1 : 0;
      }
      e.gp += (tp - e.gp) * 0.3; if (e.gp < 0.002) e.gp = 0;
    }
    // 2. icon mode: the way out
    if (iconMode) {
      const xs = iconMode.list.map((e) => e.x), ys = iconMode.list.map((e) => e.y);
      const x0 = Math.min(...xs) - SPREAD_EXIT, x1 = Math.max(...xs) + SPREAD_EXIT, y0 = Math.min(...ys) - SPREAD_EXIT - 20, y1 = Math.max(...ys) + SPREAD_EXIT + 20;
      if (busyNow || lx < x0 || lx > x1 || ly < y0 || ly > y1) iconMode = null;
    }
    const spr = iconMode || pre, sk = iconMode ? 1 : pre?.k || 0;
    if (spr) spr.full = SPREAD ? spreadLayout(spr.list, spr.pin) : spr.list.map(() => ({ x: 0, y: 0 }));
    const offs = spr ? spr.full.map((o) => ({ x: o.x * sk, y: o.y * sk })) : null;
    // 3. draw: the stem grows with the approach, the icon rides its top from 40% growth, the label grows out of the icon near the end
    for (const e of ents.values()) {
      const me = e.id === youId, isSel = sel === e || lowEnt === e;
      const k = spr ? spr.list.indexOf(e) : -1, o = k >= 0 ? offs[k] : { x: 0, y: 0 };
      e.ox += (o.x - e.ox) * 0.3; e.oy += (o.y - e.oy) * 0.3;
      if (Math.abs(e.ox) + Math.abs(e.oy) < 0.05) e.ox = e.oy = 0;
      e.dim += ((me && hot !== e && !isSel ? 0.6 : 1) - e.dim) * 0.2;
      // while a wheel is out of an icon, every other icon drops to a lower plane (shorter stem) and behind the wheel
      e.low += ((busyNow && lowEnt !== e ? 1 : 0) - e.low) * 0.25; if (e.low < 0.002) e.low = 0;
      const r = e.gp > 0 ? Math.pow(e.gp, GROW_CURVE) : 0, Lg = STEM_W * r * (1 - LOW * e.low);
      pA.copy(e.base); pB.copy(e.base).y += Lg;   // the stem's top, upright
      const top = toScreen(pB);
      e.x = top.x + e.ox; e.y = top.y + e.oy;
      if (e.ox || e.oy) pB.copy(worldAt(e.x, e.y, pB));   // leaning toward its spread icon
      const ik = e.ik = sstep(0.35, 0.7, r), op = e.op = ik * e.dim;
      e.el.style.opacity = op < 0.02 ? 0 : op;
      // the icon you're on in icon mode is bigger; a traced one grows into that with the blend
      e.big += ((iconMode ? +(hoverEnt === e) : pre?.tr === e ? pre.k : 0) - e.big) * 0.3;
      const sc = e.sc = (0.6 + 0.4 * ik) * (1 + 0.3 * e.big);
      e.el.style.transform = `translate(${e.x}px, ${e.y}px) scale(${sc})`;
      const isHot = hoverEnt === e || hot === e;
      e.el.classList.toggle('hot', isHot); e.lb.classList.toggle('hot', isHot);
      // the label: always above its icon; in a crowd of icons only the hovered one is named
      const crowd = (busyNow && !isSel) || (!(iconMode && SPREAD) && !isSel && !isHot && [...ents.values()].some((q) => q !== e && q.op > 0.3 && Math.hypot(q.x - e.x, q.y - e.y) < 30));
      e.lab += ((!crowd ? sstep(0.65, 1, r) : 0) - e.lab) * 0.3; if (e.lab < 0.01) e.lab = 0;
      if (!e.w) e.w = e.lb.offsetWidth;
      e.lb.style.opacity = e.lab * e.dim;
      e.lb.style.clipPath = `inset(0 ${50 * (1 - e.lab)}% round 6px)`;
      e.lb.style.transform = `translate(${e.x - e.w / 2}px, ${e.y - 11 * sc - 11}px)`;
      // the stem: gold and wider from the body up to the trace point (all of it for the icon and the selection)
      const tracing = trace.e === e && !iconMode;
      e.tu += ((mkHover === e || isSel || (iconMode && hoverEnt === e) ? 1 : tracing ? trace.t : 0) - e.tu) * 0.35;
      const sop = Math.min(1, r * 4) * (0.55 + 0.45 * ik) * e.dim;
      pD.lerpVectors(pA, pB, e.tu);
      setPiece(e.stem.lo, pA, pD, cLo, sop);
      setPiece(e.stem.hi, pD, pB, cHi, sop);
      e.shown = sop > 0.05 && r > 0.3 && !busyNow && e.front;
      if (tracing && e.shown) {   // the spark rides the gold's tip
        spark.visible = true; spark.position.copy(pD);
        spark.scale.setScalar(0.0125 * (1 + 0.08 * Math.sin(now / 45) + 0.05 * Math.sin(now / 17)));
        spark.material.opacity = 0.85 + 0.15 * Math.sin(now / 31);
      }
    }
    if (!trace.e || iconMode) spark.visible = false;
    // 4. stacking: nearest to the cursor on top, each label one step above its icon
    const order = [...ents.values()].filter((e) => e.op > 0.02 || e.lab > 0).sort((a, b) => Math.hypot(lx - b.x, ly - b.y) - Math.hypot(lx - a.x, ly - a.y));
    // with a wheel out of an icon: everything else, then the wheel, then that icon and its label (the pips fold under it)
    if (lowEnt) { const i = order.indexOf(lowEnt); if (i >= 0) order.splice(i, 1); order.push(lowEnt); }
    order.forEach((e, i) => {
      const z = String(2 * i + 1 + (lowEnt === e ? 1 : 0));
      if (e.el.style.zIndex !== z) { e.el.style.zIndex = z; e.lb.style.zIndex = String(+z + 1); }
    });
    if (wheelEl) wheelEl.style.zIndex = String(lowEnt ? 2 * order.length - 1 : 2 * order.length + 1);   // a square's wheel tops them all
  }
  const sizeV = new THREE.Vector2();

  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && iconMode) { iconMode = null; escHold = true; } });

  // The icon of a creature in client px, or the body top while the icon isn't shown. r: the icon's radius.
  function screenOf(id) {
    const e = ents.get(id);
    if (!e) return null;
    const icon = e.op > 0.15 && e.front;
    const p = icon ? e : e.anchor;
    return { x: off.x + p.x, y: off.y + p.y, r: icon ? 11 * e.sc : 0, icon };
  }
  return {
    sync, hover, pickAt, step, screenOf,
    iconOf(id) { const e = ents.get(id); return e ? { el: e.el, label: e.lb, x: off.x + e.x, y: off.y + e.y, scale: e.sc } : null; },
    // A wheel is out of this icon (the others drop to the lower plane) and `el` is its element, stacked between them and the icon;
    // id null with an el: a square's wheel, above every icon; no arguments: closed.
    setLow(id, el = null) {
      lowEnt = id ? ents.get(id) || null : null;
      if (wheelEl && wheelEl !== el) wheelEl.style.zIndex = '';
      wheelEl = el;
      layer.style.zIndex = el ? '20' : '';   // the wheel is above the page's floating cards (the icons come along)
    },
    enter(id) { const e = ents.get(id); if (e && !busy()) enterSpread(e); },   // icon mode on e's square (a crowded square's click)
    get layer() { return layer; },
    get active() { return !!(iconMode || pre || trace.e); },   // the pointer is in icon mode or tracing a stem
    get iconMode() { return !!iconMode; },
    get tracing() { return !!trace.e; },
    dispose() {
      for (const [id, e] of [...ents]) remove(id, e);
      scene.remove(spark); spark.material.map.dispose(); spark.material.dispose(); stemGeo.dispose(); layer.remove();
    },
  };
}
