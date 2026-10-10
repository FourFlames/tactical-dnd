// Shared rules core: grid geometry, pathing, line of sight, dice, views.
// Used by engine.js (the CLI the DM calls) and server.js (the viewer backend).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'state.json');
const LOG = path.join(ROOT, 'log.jsonl');
const SEATS = path.join(ROOT, 'seats.json');
const INTENTS = path.join(ROOT, 'intents.jsonl');

// ---------- state io ----------
function loadState() {
  if (!fs.existsSync(STATE)) return null;
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function saveState(s) {
  updateExplored(s);
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  // On Windows the rename fails while another process (the viewer server) has state.json open
  // for reading. Those reads take a millisecond or two, so wait briefly and try again.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, STATE); return; } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
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

// ---------- remote seats ----------
// seats.json: { <player>: { token, creatures: [ids] } }. The token is that player's personal link.
// intents.jsonl: actions remote players declare from the viewer. Append-only; the engine marks
// one handled by appending { ack: id }. Only the DM turns an intent into engine commands.
function loadSeats() {
  if (!fs.existsSync(SEATS)) return {};
  return JSON.parse(fs.readFileSync(SEATS, 'utf8'));
}
function saveSeats(seats) { fs.writeFileSync(SEATS, JSON.stringify(seats, null, 2)); }
// Join codes are typed by hand, so "Ember Wolf 42" and "ember-wolf-42" are the same code.
const normCode = (code) => String(code || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const WORDS = ('amber anvil arrow ash aspen badger bard bear bell birch blade bloom bolt bone bramble brass brook candle cedar cinder clover cobalt comet copper coral crane crow crown dagger dawn deer dove drake drum dusk eagle ember falcon fern finch flame flint fog forge fox frost gale garnet ghost glade goat gold griffin hawk hazel heron hollow horn iron ivy jade jasper kestrel lantern lark lily lynx maple marsh mist moon moss moth nettle night oak onyx otter owl pearl pike pine plum quartz quill rain raven reed ridge river robin rook rose rune sage salt shade shield silver slate smoke snow sparrow spear spruce star stone storm sun swan thistle thorn tide toad torch tower vale viper wand wasp willow wind wolf wren yew').split(' ');
function newCode(taken = []) {
  const crypto = require('crypto');
  for (;;) {
    const code = `${WORDS[crypto.randomInt(WORDS.length)]}-${WORDS[crypto.randomInt(WORDS.length)]}-${crypto.randomInt(10, 100)}`;
    if (!taken.includes(code)) return code;
  }
}
function seatByToken(token) {
  const code = normCode(token);
  if (!code) return null;
  for (const [player, seat] of Object.entries(loadSeats())) if (seat.token === code) return { player, ...seat };
  return null;
}
// intents.jsonl is append-only: declarations from players, plus {ack} lines when the DM has seen
// one and {reply} lines for the DM's short answers. Read back, each declaration carries its status.
function readIntents() {
  if (!fs.existsSync(INTENTS)) return [];
  const all = fs.readFileSync(INTENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const acked = new Map(all.filter((e) => e.ack).map((e) => [e.ack, e.t]));
  const replies = {};
  for (const e of all) if (e.reply) (replies[e.reply] = replies[e.reply] || []).push(e);
  return all.filter((e) => !e.ack && !e.reply && !e.offer).map((e) => {
    const rs = replies[e.id] || [];
    return { ...e, handled: acked.has(e.id), seenAt: acked.get(e.id), replies: rs.map(({ t, text }) => ({ t, text })), done: rs.some((r) => r.done) };
  });
}
function appendIntent(entry) { fs.appendFileSync(INTENTS, JSON.stringify(entry) + '\n'); }
// Offers: the DM puts terms to a player ("Athletics DC 13 to climb; fail and you fall") and the
// player answers Do it / Never mind from the viewer. An answer is an intent pointing back at it.
function readOffers() {
  if (!fs.existsSync(INTENTS)) return [];
  const all = fs.readFileSync(INTENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const answers = new Map(all.filter((e) => e.kind === 'answer' && e.to).map((e) => [e.to, e]));
  return all.filter((e) => e.offer).map((e) => ({ ...e, answer: answers.get(e.offer) || null }));
}
// While the DM sits in `listen` or `wait`, the engine touches this file every second or so;
// the server reads its age to tell players whether the DM is at the table right now.
const LISTEN = path.join(ROOT, 'listening.json');
function markListening(what) { fs.writeFileSync(LISTEN, JSON.stringify({ t: Date.now(), what })); }
function dmPresence() {
  try {
    const l = JSON.parse(fs.readFileSync(LISTEN, 'utf8'));
    return { listening: Date.now() - l.t < 4000, what: l.what, since: l.t };
  } catch { return { listening: false }; }
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
  const blockedBy = (x, y) => { const o = occupant(s, x, y, id); return o && hostile(c, s.creatures[o]); };
  // A diagonal step can't squeeze past a wall corner or something tall (a pillar, a tree trunk),
  // but slipping past a low brazier or the edge of a chasm is fine.
  const fillsCorner = (cx, cy) => {
    const t = tagsAt(s, cx, cy);
    if (t.includes('wall')) return true;
    if (!blocksMove(t) || t.includes('chasm') || t.includes('pit')) return false;
    const o = objectAt(s, cx, cy);
    return !o || o.height >= 5;
  };
  const cornerCut = (x, y, dx, dy) => dx && dy && (fillsCorner(x + dx, y) || fillsCorner(x, y + dy));
  const relax = (d, x, y, nx, ny, step) => {
    if (d < (dist.get(key(nx, ny)) ?? Infinity)) {
      dist.set(key(nx, ny), d);
      prev.set(key(nx, ny), { x, y, step });
      open.push([d, nx, ny]);
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
    const [d, x, y] = open.shift();
    if (x === goal.x && y === goal.y) break;
    if (d > (dist.get(key(x, y)) ?? Infinity)) continue;
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

function visibleSet(s) {
  const eyes = Object.values(s.creatures).filter((c) => c.side === 'party' && c.pos && c.hp > 0).map((c) => at(s, c));
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
    const pub = { id, name: c.name, side: c.side, pos: c.pos, elev: creatureElev(s, c), conditions: c.conditions || [], controller: c.controller, player: c.player, hidden: !!c.hidden };
    if (c.cue) pub.cue = c.cue; // an NPC's visible mood (curious / alert / combat), set by lib/minds.js
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

// ---------- looking at things ----------
// What a party member can tell about a creature or a square from where they stand: what the
// party has seen (never hidden creatures or unexplored squares), how far, sight, cover, which of
// their attacks reach, and any facts the DM has recorded with `describe`. Returns null when the
// thing isn't something the party knows about.
const TAG_TEXT = {
  difficult: 'difficult terrain (double movement)', water: 'water (difficult terrain; softens a fall)',
  'cover-half': 'half cover (+2 AC) for anyone behind it', 'cover-3q': 'three-quarters cover (+5 AC) for anyone behind it',
  climbable: 'climbable', unclimbable: 'too sheer to climb', stairs: 'stairs (no climbing needed)',
  flammable: 'looks like it would burn', burning: 'ON FIRE', 'fire-source': 'an open flame', slick: 'slick underfoot',
  narrow: 'narrow: single file', 'can-topple': 'could be knocked over', chasm: 'a sheer drop', impassable: "can't be entered",
  wall: 'solid wall', opaque: 'blocks sight', bridge: 'a bridge',
};
function partyKnows(s) {
  const vis = visibleSet(s), explored = new Set(s.explored || []);
  return {
    vis,
    creature: (c) => c && c.pos && (c.side === 'party' || (vis.has(c.pos) && !c.hidden)),
    cell: (id) => vis.has(id) || explored.has(id),
  };
}
function look(s, fromId, target) {
  const me = s.creatures[fromId];
  if (!me || me.side !== 'party' || !me.pos) return null;
  const knows = partyKnows(s);
  const known = (s.known || {});
  const a = at(s, me);
  const out = { from: { id: fromId, name: me.name }, lines: [], facts: [] };
  let b;
  if (target.id) {
    const c = s.creatures[target.id];
    if (!knows.creature(c)) return null;
    b = at(s, c);
    const p = parseCell(c.pos);
    Object.assign(out, { kind: 'creature', id: target.id, name: c.name, side: c.side, cell: c.pos, z: b.z });
    if (c.look) out.lines.push(c.look);
    if (c.side === 'party') out.lines.push(`HP ${c.hp}/${c.maxHp}, AC ${c.ac}, speed ${c.speed} ft.`);
    else out.lines.push(c.hp <= 0 ? 'Down.' : `Looks ${c.hp / c.maxHp > 0.5 ? 'healthy' : c.hp / c.maxHp > 0.25 ? 'bloodied' : 'near death'}.`);
    if (c.size && c.size !== 'medium') out.lines.push(`Size: ${c.size}.`);
    if ((c.conditions || []).length) out.lines.push('Conditions: ' + c.conditions.map((x) => x.name).join(', ') + '.');
    out.lines.push(`Standing on ${terrainName(s, p.x, p.y)} at ${c.pos}${b.z ? `, ${b.z} ft up` : ''}.`);
    if (c.side !== 'party' && (c.attacks || []).length) out.lines.push(`${c.hp <= 0 ? 'Had' : 'Armed with'}: ${c.attacks.map((w) => w.name).join(', ')}.`);
    const yielded = (c.conditions || []).some((x) => ['surrendered', 'charmed', 'frightened'].includes(x.name));
    if (c.side !== 'party' && fromId !== target.id && c.hp > 0 && !yielded) out.lines.push(hostile(me, c) ? 'Hostile.' : 'Not hostile to you, as far as you can tell.');
    out.facts = known[target.id] || [];
  } else {
    const p = parseCell(target.cell);
    if (!inBounds(s, p.x, p.y)) return null;
    const id = cellId(p.x, p.y);
    if (!knows.cell(id)) return null;
    const floor = elevAt(s, p.x, p.y);
    const z = typeof target.z === 'number' && !Number.isNaN(target.z) ? target.z : floor;
    b = Object.assign(p, { z });
    const tags = tagsAt(s, p.x, p.y), obj = objectAt(s, p.x, p.y), l = s.legend[s.rows[p.y][p.x]] || {};
    Object.assign(out, { kind: 'square', cell: id, z, floor, name: obj ? obj.name : terrainName(s, p.x, p.y) });
    if (l.look) out.lines.push(l.look);
    if (obj) out.lines.push(`About ${obj.height} ft tall${obj.stand ? ', you could stand on top' : ''}, on ${terrainName(s, p.x, p.y)}.`);
    if (floorFeet(s, p.x, p.y)) out.lines.push(`The ground here is ${floorFeet(s, p.x, p.y)} ft up.`);
    if (z !== floor) out.lines.push(`Your cursor is ${Math.abs(z - floor)} ft ${z > floor ? 'above' : 'below'} where you'd stand there.`);
    const said = tags.filter((t) => TAG_TEXT[t]).map((t) => TAG_TEXT[t]);
    if (said.length) out.lines.push(said.map((t) => t[0].toUpperCase() + t.slice(1)).join('. ') + '.');
    if (!knows.vis.has(id)) out.lines.push('Out of sight right now: this is how you remember it.');
    const occ = occupant(s, p.x, p.y);
    if (occ && knows.creature(s.creatures[occ])) out.lines.push(`${s.creatures[occ].name} is there.`);
    if (!blocksMove(tags) && !occ && id !== me.pos) {
      try {
        const route = findPath(s, fromId, id);
        const ts = (s.turn || {})[fromId] || { used: 0, dash: false };
        const left = speedOf(me) * (ts.dash ? 2 : 1) - ts.used;
        if (route) out.move = { cost: route.cost, left };
        out.lines.push(route ? `Getting there: ${route.cost} ft of movement (${Math.max(0, left)} ft left this turn).` : 'You see no way to walk there.');
      } catch { /* odd terrain: skip the route */ }
    }
    out.facts = known[id] || [];
  }
  if (fromId !== target.id) {
    const dist = distFeet(a, b), los = hasLOS(s, a, b), cover = los ? coverBetween(s, a, b) : 0;
    Object.assign(out, { dist, los, cover, rise: b.z - a.z });
    const rel = [`${dist} ft from ${me.name}`];
    if (b.z !== a.z) rel.push(`${Math.abs(b.z - a.z)} ft ${b.z > a.z ? 'above' : 'below'} you`);
    rel.push(los ? 'in plain sight' : 'no line of sight');
    if (cover) rel.push(`behind ${cover === 2 ? 'half' : cover === 5 ? 'three-quarters' : '+' + cover} cover from you`);
    out.lines.push(rel.join(', ') + '.');
    if (target.id && s.creatures[target.id].side !== 'party') {
      out.attacks = (me.attacks || []).map((w) => {
        const plan = attackPlan(s, fromId, target.id, w.name);
        if (plan.error) {
          const verdict = !los ? 'no line of sight' : w.range ? 'out of range' : 'out of reach';
          return { name: w.name, ok: false, verdict };
        }
        const verdict = (w.range ? 'in range' : 'in reach') + (plan.mode === 'adv' ? ', advantage' : plan.mode === 'dis' ? ', disadvantage' : '');
        return { name: w.name, ok: true, verdict, mode: plan.mode, notes: plan.notes, sneak: plan.sneak, damage: w.damage };
      });
    }
  }
  return out;
}

// ---------- turns, attacks and features (read-only; the engine applies them) ----------
const hasCond = (c, name) => (c.conditions || []).some((x) => x.name === name);
// What a creature's sheet says it can do, read from its `features` list or, failing that, its notes.
function featuresOf(c) {
  const text = [...(c.features || []), c.notes || ''].join(' ');
  const sneak = /Sneak Attack\s*\+?\s*(\d+d\d+)/i.exec(text);
  return {
    cunningAction: /Cunning Action/i.test(text),
    nimbleEscape: /Nimble Escape/i.test(text),
    sneakDice: sneak ? sneak[1] : null,
  };
}
// Where a creature stands in its turn: movement, action, bonus action, reaction.
function turnInfo(s, id) {
  const c = s.creatures[id];
  const ts = (s.turn || {})[id] || {};
  let budget = speedOf(c) * (ts.dash ? 2 : 1);
  if (hasCond(c, 'prone')) budget = Math.floor(budget / 2);
  return {
    used: ts.used || 0, budget, left: Math.max(0, budget - (ts.used || 0)), dash: !!ts.dash, disengage: !!ts.disengage,
    action: !!ts.action, bonus: !!ts.bonus, reaction: !!c.reactionUsed, attacks: ts.attacks || 0, sneakUsed: !!ts.sneak,
    attacksPerAction: c.attacksPerAction || 1,
  };
}
// Hostiles whose reach a route leaves (opportunity attacks), measured in 3D along the route.
function provokersAlong(s, id, walked) {
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
      if (distFeet(z(walked[i]), op) <= reach && distFeet(z(walked[i + 1]), op) > reach) { out.push(oid); break; }
    }
  }
  return out;
}
// Everything about an attack that's decided before the dice: can it happen, advantage, cover, AC,
// and whether Sneak Attack would apply. { error } when it can't happen.
function attackPlan(s, attId, tgtId, weapon, flags = {}) {
  const a = s.creatures[attId], t = s.creatures[tgtId];
  if (!a || !t) return { error: 'No such creature.' };
  if (a.hp <= 0 && a.side !== 'party') return { error: `${a.name} is down.` };
  const attacks = a.attacks || [];
  if (!attacks.length) return { error: `${a.name} has no attacks listed.` };
  const w = weapon ? attacks.find((x) => x.name.toLowerCase().includes(String(weapon).toLowerCase())) : attacks[0];
  if (!w) return { error: `${a.name} has no attack matching "${weapon}". Has: ${attacks.map((x) => x.name).join(', ')}` };
  const ap = at(s, a), tp = at(s, t);
  const dist = distFeet(ap, tp);
  if (!hasLOS(s, ap, tp)) return { error: `${a.name} has no line of sight to ${t.name}.`, w, dist };
  const fold = (mode, m) => (mode && mode !== m ? 'none' : mode === 'none' ? 'none' : m);
  let mode = flags.adv && !flags.dis ? 'adv' : flags.dis && !flags.adv ? 'dis' : null;
  const notes = [];
  if (w.range) {
    const [norm, long] = w.range;
    if (dist > long) return { error: `${t.name} is ${dist} ft away; ${w.name} max range is ${long} ft.`, w, dist };
    if (dist > norm) { mode = fold(mode, 'dis'); notes.push('long range'); }
    const adjacentFoe = Object.values(s.creatures).some((o) => o.pos && o.hp > 0 && hostile(a, o) && distFeet(ap, at(s, o)) <= 5 && !hasCond(o, 'incapacitated') && !hasCond(o, 'surrendered'));
    if (adjacentFoe) { mode = fold(mode, 'dis'); notes.push('hostile adjacent'); }
  } else if (dist > (w.reach || 5)) return { error: `${t.name} is ${dist} ft away; ${w.name} reach is ${w.reach || 5} ft.`, w, dist };
  if (hasCond(t, 'prone')) { mode = fold(mode, w.range ? 'dis' : 'adv'); notes.push('target prone'); }
  const helpless = ['restrained', 'paralyzed', 'stunned', 'unconscious', 'blinded'].filter((k) => hasCond(t, k));
  if (helpless.length) { mode = fold(mode, 'adv'); notes.push('target ' + helpless.join('/')); }
  if (hasCond(t, 'dodging') && !a.hidden) { mode = fold(mode, 'dis'); notes.push('target dodging'); }
  if (a.hidden) { mode = fold(mode, 'adv'); notes.push('unseen attacker'); }
  const cover = coverBetween(s, ap, tp);
  if (cover) notes.push(`cover +${cover}`);
  const finalMode = mode === 'none' ? null : mode;
  // Sneak Attack (PHB): once per turn, finesse or ranged weapon, with advantage or an ally of the
  // attacker within 5 ft of the target (and no disadvantage).
  const f = featuresOf(a);
  let sneak = null;
  if (f.sneakDice && finalMode !== 'dis') {
    const ally = Object.values(s.creatures).some((o) => o.id !== attId && o.pos && o.side === a.side && living(o) && o.hp > 0 && !hasCond(o, 'incapacitated') && distFeet(at(s, o), tp) <= 5);
    const finesse = w.range || w.finesse || /dagger|rapier|shortsword|scimitar|whip/i.test(w.name);
    const used = ((s.turn || {})[attId] || {}).sneak;
    if (finesse && (finalMode === 'adv' || ally) && !used) sneak = f.sneakDice;
  }
  const crit19 = w.critRange === 19;
  return { w, dist, mode: finalMode, notes, cover, ac: (t.ac || 10) + cover, sneak, crit19, ranged: !!w.range };
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
  SEATS, INTENTS, loadSeats, saveSeats, seatByToken, newCode, normCode, readIntents, appendIntent,
  LISTEN, markListening, dmPresence, look, partyKnows, readOffers,
  hasCond, featuresOf, turnInfo, provokersAlong, attackPlan,
  parseCell, cellId, inBounds, distFeet, tagsAt, terrainName, blocksMove, isDifficult,
  floorFeet, objectAt, elevAt, creatureElev, at, obstacleHeight, climbDC, wallSegments, wallIndex, wallBetween,
  occupant, hostile, speedOf, living, findPath, hasLOS, lineCells, wallsOnLine, stepWallTags, coverBetween, visibleSet, view, roll, d20, d,
};
