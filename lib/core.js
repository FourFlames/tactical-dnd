// Shared rules core: grid geometry, pathing, line of sight, dice, views.
// Used by engine.js (the CLI the DM calls) and server.js (the viewer backend).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'state.json');
const LOG = path.join(ROOT, 'log.jsonl');

// ---------- state io ----------
function loadState() {
  if (!fs.existsSync(STATE)) return null;
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function saveState(s) {
  updateExplored(s);
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE);
}
function appendLog(s, type, text, data) {
  const entry = { t: Date.now(), round: s ? s.round || 0 : 0, type, text };
  if (data) entry.data = data;
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  return entry;
}
function readLog(n = 200) {
  if (!fs.existsSync(LOG)) return [];
  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-n).map((l) => JSON.parse(l));
}

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
// 5e default grid rule: diagonals cost the same as orthogonals.
function distFeet(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
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
// legend entries. Everything defaults to 0. Rules don't use height yet; the 3D viewer does.
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
// Walls the straight line between two cell centres crosses (touching a wall's end counts).
function wallsOnLine(idx, a, b) {
  const px = a.x + 0.5, py = a.y + 0.5, qx = b.x + 0.5, qy = b.y + 0.5;
  return idx.segs.filter((w) => {
    if (w.x1 === w.x2) {
      if ((px - w.x1) * (qx - w.x1) > 0 || px === qx) return false;
      const yy = py + ((w.x1 - px) / (qx - px)) * (qy - py);
      return yy >= Math.min(w.y1, w.y2) - 1e-9 && yy <= Math.max(w.y1, w.y2) + 1e-9;
    }
    if ((py - w.y1) * (qy - w.y1) > 0 || py === qy) return false;
    const xx = px + ((w.y1 - py) / (qy - py)) * (qx - px);
    return xx >= Math.min(w.x1, w.x2) - 1e-9 && xx <= Math.max(w.x1, w.x2) + 1e-9;
  });
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
function speedOf(c) {
  const m = /(\d+)/.exec(String(c.speed || 30));
  return m ? parseInt(m[1], 10) : 30;
}
function moveModes(c) {
  return String(c.movement || '').toLowerCase();
}

// ---------- pathing (Dijkstra on 8-neighbour grid) ----------
function findPath(s, id, to) {
  const c = s.creatures[id];
  const start = parseCell(c.pos);
  const goal = parseCell(to);
  const flies = /\bfly\b/.test(moveModes(c));
  const walls = wallIndex(s);
  const key = (x, y) => y * s.width + x;
  const dist = new Map([[key(start.x, start.y), 0]]);
  const prev = new Map();
  const open = [[0, start.x, start.y]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = open.shift();
    if (x === goal.x && y === goal.y) break;
    if (d > (dist.get(key(x, y)) ?? Infinity)) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBounds(s, nx, ny)) continue;
      const t = tagsAt(s, nx, ny);
      if (blocksMove(t)) continue;
      if (dx && dy && (blocksMove(tagsAt(s, x + dx, y)) || blocksMove(tagsAt(s, x, y + dy)))) continue; // no corner-cutting
      const wt = stepWallTags(walls, x, y, nx, ny);
      if (blocksMove(wt)) continue;
      const occ = occupant(s, nx, ny, id);
      if (occ && hostile(c, s.creatures[occ])) continue;
      const step = (!flies && isDifficult(t) ? 10 : 5) + (!flies && wt.includes('difficult') ? 5 : 0);
      const nd = d + step;
      if (nd < (dist.get(key(nx, ny)) ?? Infinity)) {
        dist.set(key(nx, ny), nd);
        prev.set(key(nx, ny), [x, y]);
        open.push([nd, nx, ny]);
      }
    }
  }
  const gk = key(goal.x, goal.y);
  if (!dist.has(gk)) return null;
  const cells = [];
  let cur = [goal.x, goal.y];
  while (cur) {
    cells.unshift(cellId(cur[0], cur[1]));
    cur = prev.get(key(cur[0], cur[1]));
  }
  return { cost: dist.get(gk), cells };
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
function hasLOS(s, a, b, walls = wallIndex(s)) {
  return lineCells(a, b).every((p) => !blocksSight(tagsAt(s, p.x, p.y))) && !wallsOnLine(walls, a, b).some((w) => blocksSight(w.tags));
}
// Cover from terrain or walls tagged cover-half / cover-3q between attacker and target.
function coverBetween(s, a, b) {
  let best = 0;
  const tagSets = lineCells(a, b).map((p) => tagsAt(s, p.x, p.y)).concat(wallsOnLine(wallIndex(s), a, b).map((w) => w.tags));
  for (const t of tagSets) {
    if (t.includes('cover-3q')) best = Math.max(best, 5);
    else if (t.includes('cover-half')) best = Math.max(best, 2);
  }
  return best;
}

function visibleSet(s) {
  const eyes = Object.values(s.creatures).filter((c) => c.side === 'party' && c.pos && c.hp > 0).map((c) => parseCell(c.pos));
  const walls = wallIndex(s);
  const vis = new Set();
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    if (eyes.some((e) => hasLOS(s, e, { x, y }, walls))) vis.add(cellId(x, y));
  }
  return vis;
}
function updateExplored(s) {
  const ex = new Set(s.explored || []);
  visibleSet(s).forEach((c) => ex.add(c));
  s.explored = [...ex];
}

// ---------- views ----------
// The player view is derived from the truth, never maintained separately.
function view(s, mode) {
  const dm = mode === 'dm';
  const vis = dm ? null : visibleSet(s);
  const explored = new Set(s.explored || []);
  const cells = [];
  for (let y = 0; y < s.height; y++) {
    const row = [];
    for (let x = 0; x < s.width; x++) {
      const id = cellId(x, y);
      const fog = dm ? 'visible' : vis.has(id) ? 'visible' : explored.has(id) ? 'remembered' : 'unknown';
      if (fog === 'unknown') { row.push({ fog }); continue; }
      const cell = { fog, terrain: terrainName(s, x, y), ch: s.rows[y][x], tags: tagsAt(s, x, y), h: floorFeet(s, x, y) };
      const obj = objectAt(s, x, y);
      if (obj) cell.obj = obj;
      row.push(cell);
    }
    cells.push(row);
  }
  const creatures = {};
  for (const [id, c] of Object.entries(s.creatures)) {
    if (!c.pos) continue;
    const seen = dm || c.side === 'party' || (vis.has(c.pos) && !c.hidden);
    if (!seen) continue;
    const pub = { id, name: c.name, side: c.side, pos: c.pos, elev: creatureElev(s, c), conditions: c.conditions || [], controller: c.controller, hidden: !!c.hidden };
    if (dm || c.side === 'party') Object.assign(pub, { hp: c.hp, maxHp: c.maxHp, ac: c.ac, speed: c.speed, attacks: c.attacks, notes: c.notes });
    else pub.health = c.hp <= 0 ? 'down' : c.hp / c.maxHp > 0.5 ? 'healthy' : c.hp / c.maxHp > 0.25 ? 'bloodied' : 'near death';
    creatures[id] = pub;
  }
  // A wall shows once any square beside it has been seen; secret ones only in the DM view.
  const known = (x, y) => inBounds(s, x, y) && cells[y][x].fog !== 'unknown';
  const walls = wallSegments(s).filter((w) => {
    if (dm) return true;
    if (w.hidden) return false;
    for (let y = Math.min(w.y1, w.y2); y <= Math.max(w.y1, w.y2); y++) for (let x = Math.min(w.x1, w.x2); x <= Math.max(w.x1, w.x2); x++) {
      if (known(x, y) || known(x - 1, y) || known(x, y - 1) || known(x - 1, y - 1)) return true;
    }
    return false;
  });
  const order = (s.turnOrder || []).filter((id) => creatures[id]);
  return {
    name: s.name, width: s.width, height: s.height, legend: s.legend, cells, creatures, walls,
    round: s.round || 0, turnOrder: order, current: s.turnOrder ? s.turnOrder[s.turnIdx] : null,
    mode: dm ? 'dm' : 'player',
    log: readLog(80).filter((e) => dm || e.type !== 'secret'),
  };
}

// ---------- dice ----------
function d(n) { return 1 + Math.floor(Math.random() * n); }
function roll(expr, { crit = false } = {}) {
  const src = String(expr).replace(/\s+/g, '');
  const terms = src.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  const parts = [];
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    const body = term.replace(/^[+-]/, '');
    const m = /^(\d*)d(\d+)$/i.exec(body);
    if (m) {
      const count = (parseInt(m[1] || '1', 10)) * (crit ? 2 : 1);
      const rolls = Array.from({ length: count }, () => d(parseInt(m[2], 10)));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      parts.push(`${sign < 0 ? '-' : ''}[${rolls.join(',')}]`);
    } else if (/^\d+$/.test(body)) {
      total += sign * parseInt(body, 10);
      parts.push(`${sign < 0 ? '-' : '+'}${body}`);
    } else throw new Error(`Can't roll "${expr}"`);
  }
  return { total, detail: parts.join(' ').replace(/^\+/, '') };
}
function d20(mode) {
  const a = d(20), b = d(20);
  if (mode === 'adv') return { nat: Math.max(a, b), detail: `adv[${a},${b}]` };
  if (mode === 'dis') return { nat: Math.min(a, b), detail: `dis[${a},${b}]` };
  return { nat: a, detail: `[${a}]` };
}

module.exports = {
  ROOT, STATE, LOG, loadState, saveState, appendLog, readLog,
  parseCell, cellId, inBounds, distFeet, tagsAt, terrainName, blocksMove, isDifficult,
  floorFeet, objectAt, elevAt, creatureElev, wallSegments, wallIndex, wallBetween,
  occupant, hostile, speedOf, living, findPath, hasLOS, coverBetween, visibleSet, view, roll, d20, d,
};
