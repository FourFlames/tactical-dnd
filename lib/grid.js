// Grid geometry, pathing, line of sight and cover: pure functions of a state, no files. Runs in Node (lib/core.js
// re-exports all of it) and in the browser (served at /lib/grid.js as window.Grid), where the viewer routes on its
// player view through fromView() so a route preview only knows what the party knows. The server referees on commit.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Grid = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------- coordinates ----------
// Cells are "C4": column letter (A = first column), row number (1 = top row).
function parseCell(id) {
  const m = /^([A-Za-z])(\d+)$/.exec(String(id).trim());
  if (!m) throw new Error(`Bad cell "${id}". Use letter+number, e.g. C4.`);
  return { x: m[1].toUpperCase().charCodeAt(0) - 65, y: parseInt(m[2], 10) - 1 };
}
function cellId(x, y) {
  return String.fromCharCode(65 + x) + (y + 1);
}
function inBounds(s, x, y) {
  return x >= 0 && y >= 0 && x < s.width && y < s.height;
}
// 5e default grid rule: diagonals cost the same as orthogonals. Height is a third axis
// counted the same way, rounded to the nearest square, when both points carry z (feet).
function distFeet(a, b) {
  const dz = typeof a.z === 'number' && typeof b.z === 'number' ? Math.round(Math.abs(a.z - b.z) / 5) : 0;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), dz) * 5;
}

// ---------- terrain ----------
function tagsAt(s, x, y) {
  const ch = s.rows[y][x];
  const base = (s.legend[ch] && s.legend[ch].tags) || [];
  const extra = (s.tagOverrides && s.tagOverrides[cellId(x, y)]) || {};
  const out = new Set(base);
  const placed = placedObjectAt(s, x, y);
  if (placed) (placed.tags || []).forEach((t) => out.add(t));
  (extra.add || []).forEach((t) => out.add(t));
  (extra.remove || []).forEach((t) => out.delete(t));
  return [...out];
}
function terrainName(s, x, y) {
  const ch = s.rows[y][x];
  return (s.legend[ch] && s.legend[ch].name) || 'floor';
}
// ---------- elevation & objects ----------
// Heights are in feet. An encounter may give a `heights` grid (one string per row, digits are
// 5-ft steps, "." falls back to the legend; or arrays of numbers in feet) and/or `elev` on
// legend entries. Everything defaults to 0.
function floorFeet(s, x, y) {
  const row = s.heights && s.heights[y];
  if (row !== undefined) {
    const v = Array.isArray(row) ? row[x] : heightChar(s, row[x]);
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  const l = s.legend[s.rows[y][x]];
  return (l && l.elev) || 0;
}
function heightChar(s, ch) {
  if (ch === undefined || ch === '.' || ch === ' ') return undefined;
  if (s.heightKey && s.heightKey[ch] !== undefined) return Number(s.heightKey[ch]);
  return /[0-9]/.test(ch) ? Number(ch) * 5 : undefined;
}
// Props on a cell: a legend entry's `object` ({kind, height, stand}) or an entry in the
// encounter's `objects` list ({at: "C3" | "C3:D4", kind, name, height, tags, stand}).
// Placed objects' tags merge into the cell's tags. `stand` means creatures stand on top of it
// (defaults to true for climbable props).
function placedObjectAt(s, x, y) {
  for (const o of s.objects || []) {
    const [a, b] = String(o.at).split(':').map(parseCell);
    const e = b || a;
    if (x >= Math.min(a.x, e.x) && x <= Math.max(a.x, e.x) && y >= Math.min(a.y, e.y) && y <= Math.max(a.y, e.y)) return o;
  }
  return null;
}
function objectAt(s, x, y) {
  const placed = placedObjectAt(s, x, y);
  const l = s.legend[s.rows[y][x]];
  const o = placed || (l && l.object);
  if (!o) return null;
  const tags = placed ? tagsAt(s, x, y) : (l.tags || []);
  return {
    kind: o.kind || 'block', name: o.name || (l && l.name) || o.kind,
    height: o.height !== undefined ? o.height : 5,
    stand: o.stand !== undefined ? !!o.stand : tags.includes('climbable'),
  };
}
// Where a creature in this cell stands: floor plus anything it's standing on.
function elevAt(s, x, y) {
  const o = objectAt(s, x, y);
  return floorFeet(s, x, y) + (o && o.stand ? o.height : 0);
}
function creatureElev(s, c) {
  if (typeof c.z === 'number') return c.z;
  const p = parseCell(c.pos);
  return elevAt(s, p.x, p.y);
}
// A creature's square plus the height it stands at: what distance and sight measure from.
function at(s, c) {
  return Object.assign(parseCell(c.pos), { z: creatureElev(s, c) });
}
// How tall an obstacle in this square is, in feet, for jumping over it: a prop's height, or the
// legend's `obstacle` (ice, mud and shallow water default to 0: only the width matters).
function obstacleHeight(s, x, y) {
  const o = objectAt(s, x, y);
  if (o) return o.height;
  const l = s.legend[s.rows[y][x]];
  return (l && l.obstacle) || 0;
}
// DC of the Athletics check to climb up to (or down from) this square at full speed.
function climbDC(s, x, y) {
  const l = s.legend[s.rows[y][x]];
  return (l && l.climbDC) || s.climbDC || 12;
}

// ---------- edge walls ----------
// Walls run along grid lines, between vertices. Vertex "D3" is the top-left corner of cell D3,
// so "D2-D6" is the line down the left side of column D from row 2 to row 6 (four cells long);
// the right/bottom map border is column/row one past the last cell.
// Each entry is "D2-D6" or { from, to, kind, id, open, hidden, height, tags }.
// Kinds: wall (blocks all), door (blocks while closed), window (blocks movement, half cover),
// low (half cover, costs 5 ft extra to cross). `tags` replaces the kind's defaults.
const WALL_KINDS = {
  wall: ['wall'], door: ['wall'], window: ['impassable', 'cover-half'], low: ['cover-half', 'difficult'],
};
function wallSegments(s) {
  return (s.walls || []).map((w, i) => {
    const spec = typeof w === 'string' ? { from: w.split('-')[0], to: w.split('-')[1] } : w;
    if (!spec.from || !spec.to) throw new Error(`Wall #${i + 1} needs "from-to" vertices, e.g. "D2-D6".`);
    const a = parseCell(spec.from), b = parseCell(spec.to);
    if (a.x !== b.x && a.y !== b.y) throw new Error(`Wall ${spec.id || '#' + (i + 1)} (${spec.from}-${spec.to}) must run along a grid line.`);
    const kind = spec.kind || 'wall';
    if (!WALL_KINDS[kind] && !spec.tags) throw new Error(`Wall ${spec.id || '#' + (i + 1)} has unknown kind "${kind}". Use ${Object.keys(WALL_KINDS).join(', ')} or give tags.`);
    const tags = kind === 'door' && spec.open ? [] : spec.tags || WALL_KINDS[kind];
    return { id: spec.id || null, kind, from: spec.from, to: spec.to, x1: a.x, y1: a.y, x2: b.x, y2: b.y, open: !!spec.open, hidden: !!spec.hidden, height: spec.height, tags };
  });
}
// Unit edges: "v{x},{y}" is the vertical edge on the left of cell (x,y); "h{x},{y}" the top edge.
function wallIndex(s) {
  const segs = wallSegments(s);
  const edges = new Map();
  const add = (k, tags) => edges.set(k, [...new Set([...(edges.get(k) || []), ...tags])]);
  for (const w of segs) {
    if (w.x1 === w.x2) for (let y = Math.min(w.y1, w.y2); y < Math.max(w.y1, w.y2); y++) add(`v${w.x1},${y}`, w.tags);
    else for (let x = Math.min(w.x1, w.x2); x < Math.max(w.x1, w.x2); x++) add(`h${x},${w.y1}`, w.tags);
  }
  return { segs, edges };
}
// Tags of the walls a one-square step from (x,y) to (nx,ny) crosses. A diagonal step counts
// every wall touching the corner it slips past, so nothing squeezes around a wall's end.
function stepWallTags(idx, x, y, nx, ny) {
  const dx = nx - x, dy = ny - y;
  const keys = [];
  if (dx && dy) {
    const cx = x + (dx > 0 ? 1 : 0), cy = y + (dy > 0 ? 1 : 0);
    keys.push(`v${cx},${cy - 1}`, `v${cx},${cy}`, `h${cx - 1},${cy}`, `h${cx},${cy}`);
  } else if (dx) keys.push(`v${x + (dx > 0 ? 1 : 0)},${y}`);
  else keys.push(`h${x},${y + (dy > 0 ? 1 : 0)}`);
  const out = new Set();
  for (const k of keys) (idx.edges.get(k) || []).forEach((t) => out.add(t));
  return [...out];
}
// Walls the straight line between two cell centres crosses (touching a wall's end counts), with
// how far along the line (t, 0..1) and the two squares either side of the crossing.
function wallsOnLine(idx, a, b, from = [0.5, 0.5]) {
  const px = a.x + from[0], py = a.y + from[1], qx = b.x + 0.5, qy = b.y + 0.5;
  const out = [];
  for (const w of idx.segs) {
    if (w.x1 === w.x2) {
      if ((px - w.x1) * (qx - w.x1) > 0 || px === qx) continue;
      const t = (w.x1 - px) / (qx - px), yy = py + t * (qy - py);
      if (yy >= Math.min(w.y1, w.y2) - 1e-9 && yy <= Math.max(w.y1, w.y2) + 1e-9) out.push({ w, t, cross: [[w.x1 - 1, Math.floor(yy)], [w.x1, Math.floor(yy)]] });
    } else {
      if ((py - w.y1) * (qy - w.y1) > 0 || py === qy) continue;
      const t = (w.y1 - py) / (qy - py), xx = px + t * (qx - px);
      if (xx >= Math.min(w.x1, w.x2) - 1e-9 && xx <= Math.max(w.x1, w.x2) + 1e-9) out.push({ w, t, cross: [[Math.floor(xx), w.y1 - 1], [Math.floor(xx), w.y1]] });
    }
  }
  return out;
}
function wallBetween(s, a, b) {
  return stepWallTags(wallIndex(s), a.x, a.y, b.x, b.y);
}

const blocksMove = (tags) => tags.includes('wall') || tags.includes('impassable');
const blocksSight = (tags) => tags.includes('wall') || tags.includes('opaque');
const isDifficult = (tags) => tags.includes('difficult') || tags.includes('water');

// ---------- creatures ----------
function living(c) {
  return c.hp > 0 || c.side === 'party';
}
function occupant(s, x, y, exceptId) {
  for (const [id, c] of Object.entries(s.creatures)) {
    if (id === exceptId || !c.pos) continue;
    if (c.hp <= 0 && c.side !== 'party') continue; // corpses don't block
    const p = parseCell(c.pos);
    if (p.x === x && p.y === y) return id;
  }
  return null;
}
function hostile(a, b) {
  if (a.side === b.side) return false;
  if (a.side === 'neutral' || b.side === 'neutral') return false;
  return true;
}
// A creature's height in feet: its own `height`, else typical for its size (Medium 6 ft).
const SIZE_FT = { tiny: 2, small: 3.5, medium: 6, large: 10, huge: 18, gargantuan: 30 };
function bodyHeight(c) {
  return c.height || SIZE_FT[String(c.size || 'medium').toLowerCase()] || 6;
}
function speedOf(c) {
  const m = /(\d+)/.exec(String(c.speed || 30));
  return m ? parseInt(m[1], 10) : 30;
}
function moveModes(c) {
  return String(c.movement || '').toLowerCase();
}

// ---------- pathing (Dijkstra on 8-neighbour grid) ----------
// Climbing (PHB): a step up or down a ledge of 5 ft or more costs the vertical distance twice
// (each foot climbed costs an extra foot), unless the creature has a climb speed or the step
// runs along stairs. With opts.fastClimb the creature climbs at full speed instead and the step
// is marked for an Athletics check against the ledge's climb DC; failing means falling.
// Jumping (opts.jump): a long jump in a straight line over difficult squares, chasms or low
// walls, landing on clear ground at the same height. Its width can't exceed the creature's
// Strength score (half without 10 ft of run-up in this move, or opts.running). Obstacles up to the
// high jump height (3 + Str mod, half standing) are cleared freely; taller ones need an
// Athletics check, DC 5 + 3 per foot of excess, and failing means tripping into the obstacle.
// Jumping up a ledge (also opts.jump): a ledge within the high jump is landed on freely. A
// taller one can be grabbed for free if it's within the high jump plus the jumper's reach
// (1.5 x its height, about 9 ft for a Medium creature), then hauled up as 5 ft of climbing;
// with opts.fastClimb the haul is quick but takes an Athletics check against the climb DC, and
// failing falls from the lip. opts.vault instead tries to land on top in one bound: DC 5 + 3
// per foot the ledge is taller than the high jump; failing knocks the jumper back down, prone.
function findPath(s, id, to, opts = {}) {
  const c = s.creatures[id];
  const start = parseCell(c.pos);
  const goal = parseCell(to);
  const modes = moveModes(c);
  const flies = /\bfly\b/.test(modes), climbs = /\bclimb\b/.test(modes);
  const str = (c.stats && c.stats.str) || 10, strMod = Math.floor((str - 10) / 2);
  const reach = 1.5 * bodyHeight(c);
  const ceil5 = (ft) => Math.ceil(Math.max(0, ft) / 5) * 5;
  const jumpDC = (excess) => 5 + 3 * Math.ceil(Math.max(0, excess));
  const walls = wallIndex(s);
  const key = (x, y) => y * s.width + x;
  const dist = new Map([[key(start.x, start.y), 0]]);
  const prev = new Map();
  const open = [[0, start.x, start.y]];
  // Among routes of equal cost, the one that hugs the straight start-goal line (no Chebyshev zigzag): the queue runs on
  // cost + TIE x (each entered square's distance from that line). TIE is small enough that the sum over any route stays
  // under 1 ft, so it only ever breaks ties; `dist` and the reported cost are the plain sums of the steps.
  const TIE = 1e-5, lx = goal.x - start.x, ly = goal.y - start.y, llen = Math.hypot(lx, ly) || 1;
  const dev = (x, y) => Math.abs(lx * (y - start.y) - ly * (x - start.x)) / llen;
  const tie = new Map([[key(start.x, start.y), 0]]);
  const pri = (k) => dist.get(k) + tie.get(k);
  const blockedBy = (x, y) => { const o = occupant(s, x, y, id); return o && hostile(c, s.creatures[o]); };
  // A diagonal step slips past one solid corner (5e has no corner rule), but not between two:
  // two walls or tall things (a pillar, a tree trunk) touching at the corner leave no gap. Low
  // braziers and chasm edges never fill a corner.
  const fillsCorner = (cx, cy) => {
    const t = tagsAt(s, cx, cy);
    if (t.includes('wall')) return true;
    if (!blocksMove(t) || t.includes('chasm') || t.includes('pit')) return false;
    const o = objectAt(s, cx, cy);
    return !o || o.height >= 5;
  };
  const cornerCut = (x, y, dx, dy) => dx && dy && fillsCorner(x + dx, y) && fillsCorner(x, y + dy);
  const relax = (d, x, y, nx, ny, step) => {
    const k = key(nx, ny), t = tie.get(key(x, y)) + TIE * dev(nx, ny);
    if (d + t < (dist.has(k) ? pri(k) : Infinity)) {
      dist.set(k, d); tie.set(k, t);
      prev.set(k, { x, y, step });
      open.push([d + t, nx, ny]);
    }
  };
  function walkStep(x, y, nx, ny) {
    const t = tagsAt(s, nx, ny);
    if (blocksMove(t) || cornerCut(x, y, nx - x, ny - y)) return null;
    const wt = stepWallTags(walls, x, y, nx, ny);
    if (blocksMove(wt) || blockedBy(nx, ny)) return null;
    const step = { kind: 'walk', to: cellId(nx, ny), cost: (!flies && isDifficult(t) ? 10 : 5) + (!flies && wt.includes('difficult') ? 5 : 0) };
    const rise = floorFeet(s, nx, ny) - floorFeet(s, x, y);
    if (flies || Math.abs(rise) < 5) return step;
    if ((tagsAt(s, x, y).includes('stairs') || t.includes('stairs')) && Math.abs(rise) <= 5) return step;
    const [hx, hy] = rise > 0 ? [nx, ny] : [x, y];
    if (tagsAt(s, hx, hy).includes('unclimbable')) return null;
    Object.assign(step, { kind: 'climb', rise, dc: climbDC(s, hx, hy), base: step.cost });
    if (climbs) step.cost += Math.abs(rise);
    else if (opts.fastClimb) { step.cost += Math.abs(rise); step.check = true; }
    else step.cost += 2 * Math.abs(rise);
    return step;
  }
  // A long jump goes in a straight line at any angle, not just the eight grid directions: try
  // every landing square in range and check the squares the line passes over (Bresenham). It
  // can clear gaps (chasms, pits), difficult terrain and low obstacles, and low walls on the way.
  function jumpAll(d, x, y) {
    const running = !!opts.running || d >= 10;
    const maxLong = running ? str : Math.floor(str / 2);
    const maxHigh = running ? 3 + strMod : (3 + strMod) / 2;
    const R = Math.min(6, Math.floor(maxLong / 5) + 1);
    for (let ty = y - R; ty <= y + R; ty++) for (let tx = x - R; tx <= x + R; tx++) {
      if ((tx !== x || ty !== y) && inBounds(s, tx, ty)) jumpTo(d, x, y, tx, ty, running, maxLong, maxHigh);
    }
  }
  function jumpTo(d, x, y, tx, ty, running, maxLong, maxHigh) {
    const base = floorFeet(s, x, y);
    const line = [...lineCells({ x, y }, { x: tx, y: ty }), { x: tx, y: ty }];
    let px = x, py = y, height = 0, overWall = false;
    const over = [];
    // In the air, only something solid blocks a corner: a chasm or pit beside the line doesn't.
    const solid = (cx, cy) => { const t = tagsAt(s, cx, cy); return blocksMove(t) && !t.includes('chasm') && !t.includes('pit'); };
    for (const { x: nx, y: ny } of line) {
      if (nx !== px && ny !== py && (solid(nx, py) || solid(px, ny))) return;
      const wt = stepWallTags(walls, px, py, nx, ny);
      if (blocksMove(wt)) return;
      if (wt.includes('difficult')) { overWall = true; height = Math.max(height, 3 + Math.max(floorFeet(s, px, py), floorFeet(s, nx, ny)) - base); }
      const t = tagsAt(s, nx, ny);
      if (nx === tx && ny === ty) {
        // landing square
        if (!over.length && !overWall) return;
        if (blocksMove(t) || blockedBy(nx, ny) || occupant(s, nx, ny, id) || Math.abs(floorFeet(s, nx, ny) - base) >= 5) return;
        const width = Math.max(5, over.length * 5);
        const dc = jumpDC(height - maxHigh);
        if (width > maxLong || dc > 30) return;
        relax(d + 5 * (over.length + 1), x, y, nx, ny, {
          kind: 'jump', to: cellId(nx, ny), over, width, height, running, cost: 5 * (over.length + 1),
          check: height > maxHigh, dc,
        });
        return;
      }
      const gap = t.includes('chasm') || t.includes('pit');
      if (!(((isDifficult(t) && !blocksMove(t)) || gap) && !occupant(s, nx, ny, id))) return; // can't fly over solid ground or a body
      over.push(cellId(nx, ny));
      if (!gap) height = Math.max(height, floorFeet(s, nx, ny) + obstacleHeight(s, nx, ny) - base);
      px = nx; py = ny;
    }
  }
  // Up a ledge by jumping: land on it, vault onto it, or grab the lip and haul up.
  function leapUp(d, x, y, step) {
    const running = !!opts.running || d >= 10;
    const maxHigh = running ? 3 + strMod : (3 + strMod) / 2;
    const p = parseCell(step.to), rise = step.rise;
    const leap = { to: step.to, rise, running };
    if (rise <= maxHigh) return relax(d + step.base + ceil5(rise), x, y, p.x, p.y, { ...leap, kind: 'leap', cost: step.base + ceil5(rise) });
    if (opts.vault) {
      const dc = jumpDC(rise - maxHigh);
      if (dc <= 30) relax(d + step.base + ceil5(rise), x, y, p.x, p.y, { ...leap, kind: 'leap', cost: step.base + ceil5(rise), check: true, dc });
      return;
    }
    if (rise > maxHigh + reach) return;
    const quick = climbs || opts.fastClimb;
    const cost = step.base + ceil5(rise - reach) + (quick ? 5 : 10);
    relax(d + cost, x, y, p.x, p.y, { ...leap, kind: 'grab', cost, check: !!opts.fastClimb && !climbs, dc: step.dc });
  }
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [q, x, y] = open.shift();
    if (x === goal.x && y === goal.y) break;
    if (q > pri(key(x, y))) continue;
    const d = dist.get(key(x, y));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBounds(s, nx, ny)) continue;
      const step = walkStep(x, y, nx, ny);
      // jumping up goes first so it wins a tie with plain climbing
      if (step && step.kind === 'climb' && step.rise > 0 && opts.jump && !climbs) leapUp(d, x, y, step);
      if (step) relax(d + step.cost, x, y, nx, ny, step);
    }
    if (opts.jump && !flies) jumpAll(d, x, y);
  }
  const gk = key(goal.x, goal.y);
  if (!dist.has(gk)) return null;
  const steps = [];
  for (let cur = prev.get(gk); cur; cur = prev.get(key(cur.x, cur.y))) steps.unshift(cur.step);
  const cells = [c.pos];
  for (const st of steps) cells.push(...(st.over || []), st.to);
  return { cost: dist.get(gk), cells, steps };
}

// ---------- line of sight ----------
function lineCells(a, b) {
  // Bresenham between cell centres, endpoints excluded.
  const out = [];
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  while (!(x0 === b.x && y0 === b.y)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (!(x0 === b.x && y0 === b.y)) out.push({ x: x0, y: y0 });
  }
  return out;
}
// Sight and cover are traced in 3D: from the viewer's eyes (5 ft above where it stands) to the
// target's head (5 ft up) and middle (2.5 ft up). Anything taller than the line where it
// crosses gets in the way: raised ground, walls, opaque props. Like the DMG's grid rule, the
// viewer looks from whichever point of its own square sees best (centre or near a corner), so
// a parapet right in front of you doesn't hide what's below. Points may carry z (feet);
// without it they stand on their square.
const EYE = 5, MID = 2.5;
const VANTAGE = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
const standZ = (s, p) => (typeof p.z === 'number' ? p.z : elevAt(s, p.x, p.y));
// How high this square stops sight: its ground, or the top of an opaque wall/prop on it
// (a full-square wall with no `height` in its legend is endless).
function sightTop(s, x, y) {
  const f = floorFeet(s, x, y);
  if (!blocksSight(tagsAt(s, x, y))) return f;
  const o = objectAt(s, x, y), l = s.legend[s.rows[y][x]];
  if (o) return f + o.height;
  return l && typeof l.height === 'number' ? f + l.height : Infinity;
}
// How high cover on this square reaches (props by their height; other cover is endless).
function coverTop(s, x, y) {
  const o = objectAt(s, x, y), l = s.legend[s.rows[y][x]];
  const f = floorFeet(s, x, y);
  if (o) return f + o.height;
  return l && typeof l.height === 'number' ? f + l.height : Infinity;
}
function wallTop(s, w, cross) {
  const rim = Math.max(...cross.map(([x, y]) => (inBounds(s, x, y) ? floorFeet(s, x, y) : -Infinity)));
  if (typeof w.height === 'number') return rim + w.height;
  return w.kind === 'low' ? rim + 3 : Infinity;
}
// Everything the line from a's eyes to a point `bh` feet above b passes, with its height there.
function sightLine(s, a, b, bh, walls, from = [0.5, 0.5]) {
  const za = standZ(s, a) + EYE, zb = standZ(s, b) + bh;
  const ox = a.x + from[0], oy = a.y + from[1], vx = b.x + 0.5 - ox, vy = b.y + 0.5 - oy;
  const len2 = vx * vx + vy * vy || 1;
  const hAt = (t) => za + (zb - za) * Math.max(0, Math.min(1, t));
  const cells = lineCells(a, b).map((p) => ({ p, h: hAt(((p.x + 0.5 - ox) * vx + (p.y + 0.5 - oy) * vy) / len2), tags: tagsAt(s, p.x, p.y) }));
  const edges = wallsOnLine(walls, a, b, from).map(({ w, t, cross }) => ({ w, h: hAt(t), top: wallTop(s, w, cross) }));
  return { cells, edges };
}
function lineBlocked(s, line) {
  return line.cells.some((c) => sightTop(s, c.p.x, c.p.y) > c.h) || line.edges.some((e) => blocksSight(e.w.tags) && e.top > e.h);
}
function hasLOS(s, a, b, walls = wallIndex(s)) {
  return VANTAGE.some((v) => !lineBlocked(s, sightLine(s, a, b, EYE, walls, v)) || !lineBlocked(s, sightLine(s, a, b, MID, walls, v)));
}
// Cover between attacker and target: cover-half/cover-3q squares and walls that rise above the
// line to the target's middle where it crosses them, plus three-quarters cover when only the
// target's head shows over something solid (a ledge, a wall).
function coverBetween(s, a, b) {
  const walls = wallIndex(s);
  const score = (tags) => (tags.includes('cover-3q') ? 5 : tags.includes('cover-half') ? 2 : 0);
  let least = Infinity;
  for (const v of VANTAGE) {
    const mid = sightLine(s, a, b, MID, walls, v);
    const midBlocked = lineBlocked(s, mid);
    const headBlocked = lineBlocked(s, sightLine(s, a, b, EYE, walls, v));
    if (midBlocked && headBlocked) continue; // can't see the target from here at all
    let best = midBlocked ? 5 : 0;
    for (const c of mid.cells) if (coverTop(s, c.p.x, c.p.y) > c.h) best = Math.max(best, score(c.tags));
    for (const e of mid.edges) if (e.top > e.h) best = Math.max(best, score(e.w.tags));
    least = Math.min(least, best);
  }
  return least === Infinity ? 0 : least;
}

const hasCond = (c, name) => (c.conditions || []).some((x) => x.name === name);

// Hostiles whose reach a route leaves (opportunity attacks), measured in 3D along the route: { id, from, z }, with the
// square (and height) each one was left from. sees(s, observer, mover) decides whether a hiding mover is noticed (lib/core
// passes observerSees); without it a hiding mover provokes like anyone else.
function provokeDetail(s, id, walked, sees) {
  const c = s.creatures[id];
  const ts = (s.turn || {})[id] || {};
  if (ts.disengage) return [];
  const z = (cell) => { const p = parseCell(cell); return Object.assign(p, { z: typeof c.z === 'number' ? c.z : elevAt(s, p.x, p.y) }); };
  const out = [];
  for (const [oid, o] of Object.entries(s.creatures)) {
    if (oid === id || !o.pos || o.hp <= 0 || !hostile(c, o) || hasCond(o, 'incapacitated') || o.reactionUsed) continue;
    if (['surrendered', 'paralyzed', 'stunned', 'unconscious'].some((k) => hasCond(o, k))) continue;
    const reach = Math.max(5, ...(o.attacks || []).filter((a) => !a.range).map((a) => a.reach || 5));
    const op = at(s, o);
    for (let i = 0; i < walked.length - 1; i++) {
      if (c.hideState && sees && !sees(s, o, Object.assign({}, c, { pos: walked[i] }))) continue;
      if (distFeet(z(walked[i]), op) <= reach && distFeet(z(walked[i + 1]), op) > reach) { out.push({ id: oid, from: walked[i], z: z(walked[i]).z }); break; }
    }
  }
  return out;
}

// A pathable state built from a view (C.view, player or DM): the squares, walls and creatures it shows and nothing else.
// Unknown squares block (a preview never routes through ground the party hasn't seen); creatures without hit points in
// the view are standing unless shown down; monster reach isn't in the view, so it counts as 5 ft. `turn` is s.turn for
// the movers that matter (the viewer passes its own creature's dash/disengage).
function fromView(v, turn = {}) {
  const legend = [], rows = [], heights = [];
  for (let y = 0; y < v.height; y++) {
    const row = [], hs = [];
    for (let x = 0; x < v.width; x++) {
      const c = (v.cells[y] || [])[x] || { fog: 'unknown' }, k = legend.length;
      legend.push(c.fog === 'unknown' ? { name: 'unknown', tags: ['impassable'] }
        : Object.assign({}, (v.legend || {})[c.ch], { name: c.terrain, tags: c.tags || [], object: c.obj || undefined, elev: 0 }));
      row.push(k); hs.push(c.h || 0);
    }
    rows.push(row); heights.push(hs);
  }
  const creatures = {};
  for (const [id, c] of Object.entries(v.creatures || {})) {
    if (!c.pos) continue;
    creatures[id] = Object.assign({}, c, { id, hp: c.hp !== undefined ? c.hp : c.health === 'down' ? 0 : 1, conditions: c.conditions || [] });
  }
  return { width: v.width, height: v.height, legend, rows, heights, walls: v.walls || [], objects: [], creatures, turn, climbDC: v.climbDC };
}

return {
  parseCell, cellId, inBounds, distFeet, tagsAt, terrainName, floorFeet, objectAt, elevAt, creatureElev, at, obstacleHeight, climbDC,
  wallSegments, wallIndex, stepWallTags, wallsOnLine, wallBetween, blocksMove, blocksSight, isDifficult,
  living, occupant, hostile, bodyHeight, speedOf, findPath, lineCells, hasLOS, coverBetween, hasCond, provokeDetail, fromView,
};
});
