// Situated NPC minds: perception, per-agent knowledge, alarm, intentions, speech and command.
//
// The engine owns the truth (state.creatures). Each NPC with a mind (state.minds[id]) holds only
// what that NPC has perceived, been told, or concluded: observations with ids (its evidence),
// tracks (where it thinks things are, and why), beliefs, alarm, intentions and plans, orders.
// Perception turns world events into observations after every engine command; nothing here ever
// copies truth into a mind except through a sense, a message, or an explicit DM `notice`.
//
// A language model (the `npc` subagent, model chosen by the NPC's tier) reads `brief(s, id)`,
// which is built only from the mind, and answers with a decision object. `decide` validates it
// against what the NPC knows and what the rules allow. The engine executes plans step by step
// (engine.js `mind <id> act`, `tick`); when no model is consulted, `fallbackPlan` is a
// deterministic policy built from the same knowledge, so the world never stalls.
'use strict';

const C = require('./core');
const Places = require('./places');

const LIGHT = { dark: 0, dim: 1, bright: 2 };
const TIERS = { minion: 'haiku', elite: 'sonnet', commander: 'opus' };
const ALARM = [['routine', 0], ['curious', 15], ['alert', 40], ['combat', 70]];
const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const DIR_WORD = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
const STEPS = ['move', 'guard', 'patrol', 'watch', 'investigate', 'attack', 'say', 'door', 'hide', 'wait', 'flee', 'follow'];
const KINDS = ['report', 'question', 'answer', 'order', 'warning', 'acknowledgement'];
const CHANNELS = { whisper: 5, speech: 30, shout: 150, signal: 0 };
const SIG_ALARM = { 0: 0, 1: 12, 2: 25, 3: 50 };

const active = (s) => !!(s && s.minds && Object.keys(s.minds).length);
const now = (s) => s.mtime || 0;
const hasCond = C.hasCond;
const mod = (n) => Math.floor(((n || 10) - 10) / 2);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const seq = (s) => (s.mseq = (s.mseq || 0) + 1);

// ---------- set-up ----------
// An encounter gives a creature a `mind` block; anything left out gets a sensible default.
function initMind(s, id, spec = {}) {
  const c = s.creatures[id];
  if (!c) throw new Error(`No creature "${id}".`);
  s.minds = s.minds || {};
  const old = s.minds[id];
  const motive = (x, i) => (typeof x === 'string' ? { description: x } : x);
  const prof = {
    identity: spec.identity || c.name, role: spec.role || 'guard', faction: spec.faction || c.faction || c.side,
    rank: spec.rank ?? 1, tier: spec.tier || 'minion', model: spec.model || null,
    personality: spec.personality || [], competencies: spec.competencies || [],
    senses: spec.senses || {}, post: spec.post || null, patrol: spec.patrol || null,
    facing: spec.facing || 'S', fov: spec.fov || 'cone', passive: spec.passive,
    knowsMap: spec.knowsMap !== false, home: spec.home || null, bark: !!spec.bark,
  };
  if (!TIERS[prof.tier] && !prof.model) throw new Error(`Unknown tier "${prof.tier}" (minion, elite, commander).`);
  const d = Object.assign({ vigilance: 0.5, courage: 0.5, obedience: 0.6, curiosity: 0.5, impulsiveness: 0.4, sociability: 0.5, superstition: 0 }, spec.disposition || {});
  const m = old && !spec.reset ? old : {
    id, obs: [], memory: [], tracks: {}, beliefs: [], intentions: [], orders: [], pending: [], results: [], traces: [],
    alarm: { intensity: 0, level: 'routine', causes: [], at: now(s) }, warned: {}, checked: {}, doors: {},
    _known: {}, _fig: {}, _reported: {}, _smell: {}, kseq: 0, patrolIdx: 0,
  };
  m.profile = prof;
  m.disposition = d;
  m.facing = (old && old.facing) || prof.facing;
  m.motivations = (spec.motivations || (old && old.motivations) || []).map(motive).map((x, i) => ({
    id: x.id || `mot${i + 1}`, description: x.description, priority: x.priority || 2, source: x.source || 'duty', persistence: x.persistence || 'standing',
  }));
  if (!m.motivations.length) m.motivations.push({ id: 'mot1', description: prof.post ? `Hold your post at ${prof.post}.` : 'Do your job and stay alive.', priority: 2, source: 'duty', persistence: 'standing' });
  // Who they know: their own side, with role, rank and usual post. Not where anyone is right now.
  m.roster = {};
  for (const [oid, o] of Object.entries(s.creatures)) {
    if (oid === id || o.side !== c.side) continue;
    const om = (o.mind || {});
    const theirs = (s.minds[oid] && s.minds[oid].profile) || om;
    m.roster[oid] = { name: o.name, role: theirs.role || 'comrade', rank: theirs.rank ?? 1, post: theirs.post || null };
  }
  Object.assign(m.roster, spec.knows || {});
  m.relationships = {};
  for (const oid of Object.keys(m.roster)) {
    const r = (spec.relationships || {})[oid] || {};
    m.relationships[oid] = { trust: r.trust ?? 0.6, loyalty: r.loyalty ?? 0.5, authority: r.authority ?? (m.roster[oid].rank > prof.rank ? 0.8 : 0.2), notes: r.notes || [] };
  }
  // The doors of their own building, as they last saw them (at the start: as they are).
  for (const w of C.wallSegments(s)) if (w.kind === 'door' && w.id && !w.hidden && m.doors[w.id] === undefined) m.doors[w.id] = { open: w.open, t: now(s) };
  s.minds[id] = m;
  return m;
}
function initAll(s) {
  for (const [id, c] of Object.entries(s.creatures)) if (c.mind) initMind(s, id, c.mind);
  if (active(s)) { s.mtime = s.mtime || 0; s.mindStats = s.mindStats || { deliberations: {}, accepted: 0, rejected: 0, stale: 0, fallbacks: 0, steps: 0 }; }
}

// ---------- senses ----------
const canSee = (c) => c && c.hp > 0 && !['asleep', 'unconscious', 'blinded', 'dead'].some((k) => hasCond(c, k));
const canHear = (c) => c && (c.hp > 0 || c.side === 'party') && !['unconscious', 'dead', 'deafened'].some((k) => hasCond(c, k));
const canSpeak = (c) => c && c.hp > 0 && !['asleep', 'unconscious', 'dead', 'gagged', 'silenced', 'paralyzed', 'stunned'].some((k) => hasCond(c, k));
function passive(m, c) {
  if (typeof m.profile.passive === 'number') return m.profile.passive;
  const sk = (c.skills || {}).perception;
  return 10 + (sk !== undefined ? sk : mod((c.stats || {}).wis)) + (m.profile.senses.keen ? 5 : 0);
}
function stealthOf(t) {
  if (typeof t.stealth === 'number') return t.stealth;
  const sk = (t.skills || {}).stealth;
  return 10 + (sk !== undefined ? sk : mod((t.stats || {}).dex));
}
function inArea(spec, x, y) {
  const [a, b] = String(spec).split(':').map(C.parseCell);
  const e = b || a;
  return x >= Math.min(a.x, e.x) && x <= Math.max(a.x, e.x) && y >= Math.min(a.y, e.y) && y <= Math.max(a.y, e.y);
}
// Light: the encounter's `lighting` {ambient, areas: {"D2:I9": "dark"}}, cell tags lit/dim/dark,
// then anything carrying or giving light (creature `light: <bright radius ft>`, fires) brightens.
function baseLight(s, x, y) {
  const L = s.lighting || {};
  let lv = LIGHT[L.ambient || 'bright'];
  for (const [area, v] of Object.entries(L.areas || {})) if (inArea(area, x, y)) lv = LIGHT[v];
  const t = C.tagsAt(s, x, y);
  if (t.includes('lit')) lv = 2; else if (t.includes('dark')) lv = 0; else if (t.includes('dim')) lv = 1;
  return lv;
}
function lightSources(s) {
  const out = [];
  for (const c of Object.values(s.creatures)) if (c.pos && c.light && (c.hp > 0 || c.side === 'party')) out.push(Object.assign(C.at(s, c), { r: Number(c.light) || 20 }));
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const t = C.tagsAt(s, x, y);
    if (t.includes('burning') || t.includes('fire-source')) out.push({ x, y, z: C.elevAt(s, x, y), r: t.includes('burning') ? 10 : 20 });
  }
  return out;
}
function lightAt(s, ctx, x, y) {
  const k = x + ',' + y;
  if (ctx.light.has(k)) return ctx.light.get(k);
  let lv = baseLight(s, x, y);
  for (const L of ctx.lights) {
    if (lv === 2) break;
    const p = { x, y, z: C.elevAt(s, x, y) };
    const dd = C.distFeet(L, p);
    if (dd > L.r * 2) continue;
    if (dd > 0 && !C.hasLOS(s, L, p, ctx.walls)) continue;
    lv = Math.max(lv, dd <= L.r ? 2 : 1);
  }
  ctx.light.set(k, lv);
  return lv;
}
const newCtx = (s) => ({ walls: C.wallIndex(s), lights: lightSources(s), light: new Map(), cues: [] });

function dirOf(dx, dy) {
  if (!dx && !dy) return null;
  const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = east, 90 = south
  return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][((Math.round(a / 45) % 8) + 8) % 8];
}
function dirBetween(from, to) {
  const a = C.parseCell(from), b = C.parseCell(to);
  return dirOf(b.x - a.x, b.y - a.y);
}
const dirWord = (from, to) => { const d = dirBetween(from, to); return d ? `to the ${DIR_WORD[d]}` : 'right here'; };
const distWord = (ft) => (ft <= 10 ? 'very close' : ft <= 30 ? 'nearby' : ft <= 60 ? 'a short way off' : ft <= 120 ? 'some distance off' : 'far off');
function angleTo(facing, dx, dy) {
  const f = DIRS[facing] || DIRS.S;
  const n = Math.hypot(dx, dy) * Math.hypot(f[0], f[1]);
  if (!n) return 0;
  return Math.acos(clamp((f[0] * dx + f[1] * dy) / n, -1, 1)) * 180 / Math.PI;
}
const looksAround = (m) => m.profile.fov === 'all' || m.alarm.level === 'alert' || m.alarm.level === 'combat';

// How well observer `me` (with mind m) could make out `t` if it stood at `cell`. null: not at all.
function sightOf(s, ctx, m, me, t, cell) {
  const p = C.parseCell(cell);
  const a = C.at(s, me);
  const b = { x: p.x, y: p.y, z: t.pos === cell ? C.creatureElev(s, t) : C.elevAt(s, p.x, p.y) };
  const dist = C.distFeet(a, b), sn = m.profile.senses || {};
  const blind = sn.blindsight && dist <= sn.blindsight;
  if (!blind && !C.hasLOS(s, a, b, ctx.walls)) return null;
  let lv = blind || t.light ? 2 : lightAt(s, ctx, p.x, p.y);
  if (!blind && sn.darkvision && dist <= sn.darkvision) lv = Math.min(2, lv + 1);
  if (lv <= 0) return null;
  let periph = false;
  if (!blind && !looksAround(m) && dist > 5) {
    const ang = angleTo(m.facing, p.x - a.x, p.y - a.y);
    if (ang > 110) return null;
    periph = ang > 60;
  }
  let clarity = 1 - (dist > 120 ? 0.6 : dist > 60 ? 0.3 : dist > 30 ? 0.1 : 0) - (lv === 1 ? 0.25 : 0) - (periph ? 0.35 : 0);
  const cover = t.id ? C.coverBetween(s, a, b) : 0;
  clarity -= cover >= 5 ? 0.25 : cover >= 2 ? 0.1 : 0;
  if (t.hidden && !(cover === 0 && lv === 2 && !periph && dist <= 30)) {
    const pp = passive(m, me) - (lv === 1 ? 5 : 0) - (periph ? 5 : 0);
    if (pp < stealthOf(t)) return null;
    clarity -= 0.2;
  }
  return { clarity: Math.max(0.05, Math.round(clarity * 100) / 100), lv, dist, periph, cover };
}
// Sound loses ground to walls: a wall soaks 30 ft of it, a closed door 20, a window 10.
function muffle(s, ctx, a, b) {
  let m = 0;
  for (const { w } of C.wallsOnLine(ctx.walls, a, b)) {
    if (w.tags.includes('wall')) m += w.kind === 'door' ? 20 : 30;
    else if (w.tags.includes('impassable')) m += 10;
  }
  for (const p of C.lineCells(a, b)) if (C.tagsAt(s, p.x, p.y).includes('wall')) m += 30;
  return Math.min(m, 400);
}
function audible(s, ctx, r, rm, cell, loud) {
  const p = C.parseCell(cell);
  const a = C.at(s, r), b = { x: p.x, y: p.y, z: C.elevAt(s, p.x, p.y) };
  const dist = C.distFeet(a, b);
  const eff = dist + muffle(s, ctx, a, b);
  const thr = loud * (hasCond(r, 'asleep') ? 0.5 : 1) * (rm && rm.profile.senses.keenHearing ? 1.5 : 1);
  return eff <= thr ? { dist, eff } : null;
}
function blur(s, p, r) {
  const j = () => (r ? Math.floor(Math.random() * (2 * r + 1)) - r : 0);
  return { x: clamp(p.x + j(), 0, s.width - 1), y: clamp(p.y + j(), 0, s.height - 1) };
}

// ---------- knowledge ----------
function keyOf(m, tid) {
  if (m.roster[tid]) return tid;
  return m._fig[tid] || m._known[tid] || null;
}
const seesNow = (m, tid) => { const k = keyOf(m, tid); return !!(k && m.tracks[k] && m.tracks[k].inView); };
const newKey = (m, p) => `${p}${++m.kseq}`;
function labelOf(t) {
  if (t.descr) return t.descr;
  const w = (t.attacks || [])[0];
  return `a${t.size && t.size !== 'medium' ? ' ' + t.size : ''} stranger${w ? ' with a ' + w.name.toLowerCase() : ''}`;
}
function evidenceIds(m) {
  return new Set([...m.obs.map((o) => o.id), ...m.memory.map((o) => o.id)]);
}
function setLevel(s, m, ctx) {
  const lvl = ALARM.reduce((l, [n, th]) => (m.alarm.intensity >= th ? n : l), 'routine');
  if (lvl === m.alarm.level) return;
  const up = ALARM.findIndex((x) => x[0] === lvl) > ALARM.findIndex((x) => x[0] === m.alarm.level);
  (m._cues = m._cues || []).push({ from: m.alarm.level, to: lvl });
  m.alarm.level = lvl;
  m.alarm.at = now(s);
  const c = s.creatures[m.id];
  if (c) { if (lvl === 'routine') delete c.cue; else c.cue = lvl; }
  trigger(m, up ? { curious: 1, alert: 2, combat: 3 }[lvl] : 1, `alarm ${up ? 'rose' : 'fell'} to ${lvl}`, []);
}
// mindConfig.calm: vague, unidentified things don't stampede the lair. Only a confirmed intruder or an `uncanny` creature
// gets a shouted warning; vague sightings and second-hand reports about them count for as much as the listener's `superstition`.
const calm = (s) => !!(s.mindConfig || {}).calm;
const fear = (m) => m.disposition.superstition || 0;
function bump(s, m, amount, cause) {
  if (!amount) return;
  m.alarm.intensity = clamp(Math.round(m.alarm.intensity + amount), 0, 100);
  if (cause && amount > 0) m.alarm.causes = [...m.alarm.causes.filter((x) => x !== cause), cause].slice(-6);
  setLevel(s, m);
}
function trigger(m, urgency, why, refs) {
  if (!urgency) return;
  const same = m.pending.find((p) => p.why === why);
  if (same) { same.urgency = Math.max(same.urgency, urgency); same.refs = [...new Set([...same.refs, ...refs])]; same.seen = false; return; }
  m.pending.push({ why, urgency, refs });
}
function note(s, m, o) {
  o.id = o.id || `o${seq(s)}`;
  o.seq = s.mseq;
  o.t = now(s);
  m.obs.push(o);
  const vig = m.disposition.vigilance;
  bump(s, m, (SIG_ALARM[o.sig] || 0) * (0.6 + 0.8 * vig) + (o.alarmAdd || 0), o.id);
  if (o.sig >= 1) trigger(m, o.sig, o.kind === 'message' ? `${o.msgKind} from ${o.fromLabel}` : o.text, [o.id]);
  return o;
}
function trackHistory(tr, cell, via) {
  tr.history = [...(tr.history || []), { cell, t: tr.t, via }].slice(-6);
}

// Is someone of their own side known to be about there (so footsteps there are nothing new)?
function expected(s, m, center, r) {
  return Object.values(m.tracks).some((t) => t.side === 'ally' && t.cell && (t.inView || now(s) - t.t <= 1)
    && C.distFeet(C.parseCell(t.cell), center) <= (r + 2) * 5);
}

// ---------- perception: turning what happened into what each NPC noticed ----------
function snapshot(s) {
  const pos = {};
  for (const [id, c] of Object.entries(s.creatures || {})) pos[id] = c.pos;
  return { pos, round: s.round || 0 };
}
function soundsFrom(s, entries, paths) {
  const out = [];
  for (const id of Object.keys(paths)) {
    const c = s.creatures[id];
    if (!c || !c.pos) continue;
    if (c.hidden) out.push({ at: c.pos, loud: 15, desc: 'a faint scuff of movement', sig: 1, src: id, quiet: stealthOf(c), kind: 'steps' });
    else out.push({ at: c.pos, loud: c.noisy ? 60 : 30, desc: c.noisy ? 'heavy, clinking footsteps' : 'footsteps', sig: 1, src: id, kind: 'steps' });
  }
  for (const e of entries) {
    const d = e.data || {};
    if (e.type === 'attack' && d.attacker) {
      const a = s.creatures[d.attacker], t = s.creatures[d.target];
      if (d.ranged) {
        if (a) out.push({ at: a.pos, loud: 20, desc: 'the snap of a bowstring', sig: 2, src: d.attacker });
        if (t) out.push({ at: t.pos, loud: 30, desc: d.hit ? 'a thud and a cry of pain' : 'something whipping past and clattering', sig: 2, src: d.target });
      } else if (t) out.push({ at: t.pos, loud: 90, desc: 'the clash of a fight', sig: 3, src: d.attacker });
      if (d.down && t) out.push({ at: t.pos, loud: 40, desc: 'a body hitting the ground', sig: 3, src: d.target });
    }
    if (e.type === 'damage' && d.id && /fire|thunder|lightning/.test(d.dtype || '') && s.creatures[d.id]) {
      out.push({ at: s.creatures[d.id].pos, loud: d.dtype === 'thunder' ? 300 : 60, desc: d.dtype === 'thunder' ? 'a thunderclap' : 'a roar of flame', sig: 3, src: d.id });
    }
    if (d.noise && d.cell) out.push({ at: d.cell, loud: d.loud, desc: d.desc, sig: d.sig ?? 2, src: d.by || null });
    if (e.type === 'terrain' && d.door) out.push({ at: d.cell, loud: 40, desc: `a door ${d.open ? 'creaking open' : 'banging shut'}`, sig: 1, src: d.by || null, kind: 'door' });
  }
  return out.filter((x) => x.at);
}

function scan(s, ctx, m, me, paths) {
  const eyes = canSee(me);
  for (const [tid, t] of Object.entries(s.creatures)) {
    if (tid === me.id || !t.pos) continue;
    const path = (paths[tid] && paths[tid].length ? paths[tid] : [t.pos]);
    let best = null, first = -1, last = -1, endVis = null;
    if (eyes) path.forEach((cell, i) => {
      const v = sightOf(s, ctx, m, me, t, cell);
      if (!v) return;
      if (first < 0) first = i;
      last = i;
      if (!best || v.clarity > best.clarity) best = v;
      if (i === path.length - 1) endVis = v;
    });
    const pk = keyOf(m, tid), prev = pk && m.tracks[pk];
    if (!best) {
      if (prev && prev.inView) {
        prev.inView = false;
        delete m._fig[tid];
        if (prev.side !== 'ally') note(s, m, { modality: 'visual', kind: 'lost', subject: prev.key, cell: prev.cell, sig: prev.side === 'neutral' ? 0 : 2, text: `Lost sight of ${prev.label} (last seen at ${prev.cell}).` });
      }
      continue;
    }
    const id = identify(s, m, me, t, best);
    const tr = m.tracks[id.key] || (m.tracks[id.key] = { key: id.key, history: [] });
    const was = { cell: tr.cell, inView: tr.inView };
    const cell = path[last];
    Object.assign(tr, { label: id.label, base: id.label, side: id.side, level: id.level, cell, t: now(s), direct: true, src: 'saw it yourself', inView: !!endVis });
    if (!was.inView || was.cell !== cell) trackHistory(tr, cell, 'saw');
    if (!endVis) delete m._fig[tid];
    const down = t.hp <= 0;
    if (down) {
      if (!tr.downSeen) { tr.downSeen = true; note(s, m, { modality: 'visual', kind: 'sight', subject: id.key, cell, sig: id.side === 'ally' ? 3 : 2, text: `${cap(id.label)} lies motionless at ${cell}.`, alarmAdd: id.side === 'ally' ? 25 : 0 }); }
      continue;
    }
    if (id.side === 'ally') continue; // comrades going about their business: tracked, not news
    const fresh = !was.inView, moved = was.cell && was.cell !== cell;
    if (!fresh && !moved && endVis) continue;
    const how = best.periph ? ' out of the corner of your eye' : best.lv === 1 ? ' in the gloom' : '';
    let text;
    if (fresh && path.length > 1 && first < last) text = `Saw ${id.label}${how} moving ${dirWord(path[first], cell).replace('to the ', '')} from ${path[first]} to ${cell}${endVis ? '' : ', then lost sight of it'}.`;
    else if (fresh) text = `Saw ${id.label}${how} at ${cell}${endVis ? '' : ', just for a moment'}.`;
    else if (moved) text = `${cap(id.label)} moved from ${was.cell} to ${cell}${endVis ? '' : ' and out of sight'}.`;
    else text = `Lost sight of ${id.label} (last seen at ${cell}).`;
    const sig = id.level === 'identified' ? (id.side === 'hostile' ? 3 : 0) : id.level === 'figure' ? 2 : 1; // something clearly seen and harmless (a deer) is noted, not news
    let sig2 = sig, add = 0;
    if (t.uncanny && id.level !== 'movement') tr.uncanny = true;
    if (calm(s) && id.side === 'unknown' && !tr.uncanny) { sig2 = fear(m) >= 0.5 ? sig : 1; add = fear(m) * 25; }
    else if (calm(s) && tr.uncanny) add = 25;
    note(s, m, { modality: 'visual', kind: endVis ? 'sight' : 'lost', subject: id.key, cell, clarity: best.clarity, sig: sig2, alarmAdd: add, text });
    // An armed intruder plainly in sight and close: that's a fight, whatever your temperament.
    if (endVis && id.level === 'identified' && id.side === 'hostile' && best.dist <= 60 && m.alarm.intensity < 75) { m.alarm.intensity = 75; m.alarm.causes = [...m.alarm.causes, s.mseq ? `o${s.mseq}` : ''].filter(Boolean).slice(-6); setLevel(s, m); }
    if (t.hidden && C.hostile(me, t) && id.level !== 'movement' && endVis) {
      t.hidden = false;
      delete t.stealth;
      ctx.cues.push({ spotted: tid, by: me.id });
    }
  }
  // Doors in sight: a door left open is news.
  if (!eyes) return;
  for (const w of C.wallSegments(s)) {
    if (w.kind !== 'door' || !w.id || w.hidden) continue;
    const sides = w.x1 === w.x2 ? [[w.x1 - 1, Math.min(w.y1, w.y2)], [w.x1, Math.min(w.y1, w.y2)]] : [[Math.min(w.x1, w.x2), w.y1 - 1], [Math.min(w.x1, w.x2), w.y1]];
    const vis = sides.some(([x, y]) => C.inBounds(s, x, y) && sightOf(s, ctx, m, me, {}, C.cellId(x, y)));
    if (!vis) continue;
    const k = m.doors[w.id];
    if (k && k.open !== w.open && !ctx.doorMovers.has(me.id + ':' + w.id)) {
      const at = C.cellId(...sides.find(([x, y]) => C.inBounds(s, x, y)));
      note(s, m, { modality: 'visual', kind: 'sight', cell: at, sig: 2, text: `The door ${w.id}${w.name ? ` (${w.name})` : ''} is ${w.open ? 'OPEN' : 'shut'}; it was ${k.open ? 'open' : 'shut'} when you last saw it.` });
    }
    m.doors[w.id] = { open: w.open, t: now(s) };
  }
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function identify(s, m, me, t, v) {
  const level = v.clarity >= 0.65 ? 'identified' : v.clarity >= 0.35 ? 'figure' : 'movement';
  if (m.roster[t.id] && v.clarity >= 0.45) return { key: t.id, label: m.roster[t.id].name, side: 'ally', level: 'identified' };
  const known = m._known[t.id];
  if (level !== 'identified' && known && m.tracks[known] && m.tracks[known].inView) {
    const tr = m.tracks[known]; return { key: known, label: tr.label, side: tr.side, level: tr.level };
  }
  if (level === 'identified') {
    const fig = m._fig[t.id];
    if (fig) { delete m.tracks[fig]; delete m._fig[t.id]; }
    const key = known || (m._known[t.id] = newKey(m, 'x'));
    let out;
    if (t.disguise && !(v.dist <= 10 && v.clarity >= 0.8 && passive(m, me) >= (t.disguiseDC || 13))) out = { key, label: t.disguise, side: 'neutral', level };
    else out = { key, label: labelOf(t) + (C.hostile(me, t) ? ' (an intruder)' : ''), side: C.hostile(me, t) ? 'hostile' : 'neutral', level };
    // They watched the figure the whole time: say what it turned out to be, so nobody hunts a ghost.
    if (fig) note(s, m, { modality: 'visual', kind: 'sight', subject: key, sig: 0, cell: t.pos, text: `Got a better look: the figure ${fig} is ${out.label}.` });
    return out;
  }
  const key = m._fig[t.id] || (m._fig[t.id] = newKey(m, '?'));
  return { key, label: level === 'figure' ? `an unidentified ${t.size === 'small' ? 'small ' : ''}figure (${key})` : `movement (${key})`, side: 'unknown', level };
}
function touch(s, ctx, m, me, e) {
  const d = e.data || {};
  if (e.type === 'attack' && d.attacker) {
    const a = s.creatures[d.attacker];
    const la = seesNow(m, d.attacker) ? m.tracks[keyOf(m, d.attacker)].label : null;
    if (d.target === me.id) {
      let label = la;
      if (!label && a) {
        const p = C.parseCell(a.pos), r = Math.max(1, Math.round(C.distFeet(C.at(s, me), C.at(s, a)) / 20));
        const c = blur(s, p, r), key = newKey(m, '?');
        label = `an unseen ${d.ranged ? 'archer' : 'attacker'} (${key})`;
        m.tracks[key] = { key, label, side: 'hostile', level: 'movement', cell: C.cellId(c.x, c.y), t: now(s), direct: true, src: 'guessed from where the attack came from', inView: false, history: [] };
      }
      note(s, m, { modality: 'tactile', kind: 'touch', sig: 3, alarmAdd: 40,
        text: `${d.hit ? 'Hit' : 'Missed'} by ${label || 'something'}${a ? ` from ${dirWord(me.pos, a.pos)}` : ''}${d.hit ? `: ${d.dmg} damage` : ''}.` });
    } else if (d.attacker !== me.id && (la || seesNow(m, d.target))) {
      const lt = seesNow(m, d.target) ? m.tracks[keyOf(m, d.target)].label : 'someone you can\'t see';
      note(s, m, { modality: 'visual', kind: 'sight', sig: 3, cell: s.creatures[d.target] && s.creatures[d.target].pos, alarmAdd: 20, text: `Saw ${la || 'someone unseen'} attack ${lt} (${d.hit ? 'a hit' : 'a miss'}).` });
      if (la && m.tracks[keyOf(m, d.attacker)] && m.roster[d.target]) m.tracks[keyOf(m, d.attacker)].side = 'hostile';
    }
  }
  if (e.type === 'damage' && d.id === me.id) note(s, m, { modality: 'tactile', kind: 'touch', sig: 3, alarmAdd: 30, text: `Hurt: ${d.dmg} ${d.dtype || ''} damage.`.replace(' .', '.') });
}
function hear(s, ctx, m, me, snd) {
  if (snd.src === me.id || !canHear(me)) return;
  if (snd.src && seesNow(m, snd.src)) return; // they can see what made it
  if (snd.quiet !== undefined && passive(m, me) < snd.quiet) return;
  const h = audible(s, ctx, me, m, snd.at, snd.loud);
  if (!h) return;
  if (hasCond(me, 'asleep')) {
    me.conditions = me.conditions.filter((x) => x.name !== 'asleep');
    note(s, m, { modality: 'auditory', kind: 'sound', sig: 1, text: 'Woke with a start.' });
    ctx.cues.push({ woke: me.id });
  }
  const r = Math.max(0, Math.round(h.eff / 30));
  const p = C.parseCell(snd.at), c = blur(s, p, r);
  if (snd.kind === 'steps' && expected(s, m, c, r)) return;
  const cell = C.cellId(c.x, c.y);
  note(s, m, { modality: 'auditory', kind: 'sound', cell, region: r * 5, sig: snd.sig,
    text: `Heard ${snd.desc}, ${dirWord(me.pos, snd.at)}, ${distWord(h.dist)} (around ${cell}${r ? `, give or take ${r * 5} ft` : ''}).` });
  if (m.alarm.level !== 'combat') m.facing = dirBetween(me.pos, cell) || m.facing;
}
function smell(s, ctx, m, me) {
  const sc = m.profile.senses.scent;
  if (!sc || hasCond(me, 'asleep')) return;
  for (const [tid, t] of Object.entries(s.creatures)) {
    if (tid === me.id || !t.pos || m.roster[tid] || t.hp <= 0 || seesNow(m, tid)) continue;
    const dd = C.distFeet(C.at(s, me), C.at(s, t));
    if (dd > sc || (m._smell[tid] !== undefined && now(s) - m._smell[tid] < 2)) continue;
    m._smell[tid] = now(s);
    const c = blur(s, C.parseCell(t.pos), 2);
    note(s, m, { modality: 'special', kind: 'scent', cell: C.cellId(c.x, c.y), region: 10, sig: 2, text: `Caught a stranger's scent, ${dirWord(me.pos, t.pos)}, within ${sc} ft.` });
  }
}

// Run after every state-changing command. Returns lines for the DM's console.
function perceive(s, before, entries) {
  if (!active(s)) return [];
  const out = [];
  if (before && (s.round || 0) > before.round && (s.turnOrder || []).length) passTime(s, s.round - before.round);
  const ctx = newCtx(s);
  ctx.doorMovers = new Set(entries.filter((e) => e.type === 'terrain' && e.data && e.data.door && e.data.by).map((e) => `${e.data.by}:${e.data.door}`));
  const paths = {};
  for (const e of entries) {
    const d = e.data || {};
    if ((e.type === 'move' || e.type === 'secret') && d.id && Array.isArray(d.path) && d.path.length) paths[d.id] = paths[d.id] ? paths[d.id].concat(d.path.slice(1)) : d.path.slice();
  }
  for (const [id, c] of Object.entries(s.creatures)) {
    const was = before && before.pos[id];
    if (was && c.pos && was !== c.pos && !paths[id]) paths[id] = [was, c.pos];
  }
  for (const [id, p] of Object.entries(paths)) {
    const m = s.minds[id];
    if (m && p.length > 1) m.facing = dirBetween(p[p.length - 2], p[p.length - 1]) || m.facing;
  }
  const sounds = soundsFrom(s, entries, paths);
  const touched = [];
  for (const [mid, m] of Object.entries(s.minds)) {
    const me = s.creatures[mid];
    if (!me || !me.pos || me.hp <= 0) continue;
    const n0 = m.obs.length;
    scan(s, ctx, m, me, paths);
    for (const e of entries) touch(s, ctx, m, me, e);
    for (const snd of sounds) hear(s, ctx, m, me, snd);
    smell(s, ctx, m, me);
    if (m.obs.length > n0) touched.push(mid);
  }
  // What the party can see of NPCs' reactions, and what only the DM should know.
  for (const cue of ctx.cues) {
    if (cue.spotted) {
      const t = s.creatures[cue.spotted];
      C.appendLog(s, 'action', `${t.name} has been spotted: no longer hidden.`, { id: cue.spotted });
    }
    if (cue.woke) C.appendLog(s, partySees(s, s.creatures[cue.woke]) ? 'narration' : 'secret', `${s.creatures[cue.woke].name} wakes up.`);
  }
  for (const [mid, m] of Object.entries(s.minds)) {
    for (const cu of m._cues || []) {
      const c = s.creatures[mid];
      if (!c) continue;
      const line = cueLine(c, m, cu.to);
      const seen = partySees(s, c);
      C.appendLog(s, seen ? 'narration' : 'secret', seen ? line : `[mind] ${c.name}: alarm ${cu.from} → ${cu.to}.`);
    }
    m._cues = [];
  }
  for (const mid of touched) {
    const m = s.minds[mid], c = s.creatures[mid];
    const fresh = m.obs.slice(-3).map((o) => o.text).join(' | ');
    out.push(`[minds] ${c.name} (${mid}, ${m.alarm.level}): ${fresh}`);
  }
  return out;
}
// One line for the DM after a command: who needs a model to think, who wants to fight.
const wantsFight = (s, m) => m.alarm.level === 'combat' && s.creatures[m.id] && s.creatures[m.id].hp > 0 && Object.values(m.tracks).some((t) => t.inView && t.side === 'hostile');
function summary(s) {
  if (!active(s)) return [];
  const out = [];
  const at = (s.mindConfig || {}).deliberateAt || 2;
  const urgent = Object.values(s.minds).filter((m) => s.creatures[m.id] && s.creatures[m.id].hp > 0 && m.pending.some((p) => p.urgency >= at));
  const remote = (m) => String(modelFor(s, m)).includes('/');
  const mine = urgent.filter((m) => !remote(m)), auto = urgent.filter(remote);
  if (mine.length) out.push(`[minds] needs thought: ${mine.map((m) => `${m.id} (${modelFor(s, m)}, urgency ${Math.max(...m.pending.map((p) => p.urgency))})`).join(', ')}. See "minds".`);
  if (auto.length) out.push(`[minds] will think on their own (OpenRouter) at the next tick or their turn: ${auto.map((m) => m.id).join(', ')}.`);
  const fighting = Object.values(s.minds).filter((m) => wantsFight(s, m));
  if (fighting.length && !(s.turnOrder || []).length) out.push(`[minds] COMBAT: ${fighting.map((m) => m.id).join(', ')} can see an enemy and will fight. Roll "initiative".`);
  return out;
}
function partySees(s, c) {
  if (!c || !c.pos || c.hidden) return false;
  const b = C.at(s, c);
  return Object.values(s.creatures).some((p) => p.side === 'party' && p.pos && p.hp > 0 && C.hasLOS(s, C.at(s, p), b));
}
function cueLine(c, m, lvl) {
  const dir = DIR_WORD[m.facing] || 'around';
  return {
    curious: `${c.name} stops and peers toward the ${dir}.`,
    alert: `${c.name} grips their weapon and scans the ${dir}, suddenly wary.`,
    combat: `${c.name} shouts and readies for a fight!`,
    routine: `${c.name} relaxes and goes back to their business.`,
  }[lvl];
}
// Is a move worth showing in the chronicle? Only if the party could see some of it.
function partySeesPath(s, path) {
  const vis = C.visibleSet(s);
  return (path || []).some((cell) => vis.has(cell));
}

// ---------- time ----------
function passTime(s, units = 1) {
  if (!active(s)) return;
  s.mtime = now(s) + units;
  for (const m of Object.values(s.minds)) {
    const threat = Object.values(m.tracks).some((t) => t.inView && t.side === 'hostile');
    if (!threat) {
      const fresh = m.obs.some((o) => o.sig >= 1 && o.t >= now(s) - 1);
      const decay = units * (fresh ? 2 : 4 + 8 * (1 - m.disposition.vigilance));
      bump(s, m, -decay);
    }
    for (const o of m.orders) if (o.expiresAt !== undefined && now(s) >= o.expiresAt && ['received', 'accepted'].includes(o.status)) o.status = 'failed';
    while (m.obs.length > 30) {
      const o = m.obs.shift();
      m.memory.push({ id: o.id, t: o.t, text: (o.kind === 'message' ? `[${o.msgKind} from ${o.fromLabel}] ` : '') + o.text });
    }
    if (m.memory.length > 60) m.memory = m.memory.slice(-60);
  }
}

// ---------- speech ----------
// Speech is a world event: whoever is in earshot hears it, friend or foe, and only they do.
function speak(s, fromId, msg) {
  const from = s.creatures[fromId];
  if (!canSpeak(from)) return { error: `${from.name} can't speak right now.` };
  const channel = msg.channel || 'speech';
  if (CHANNELS[channel] === undefined) return { error: `Unknown channel "${channel}" (${Object.keys(CHANNELS).join(', ')}).` };
  const to = !msg.to || msg.to === 'all' ? 'all' : [].concat(msg.to);
  msg = Object.assign({}, msg, { text: Places.speakable(s, msg.text) }); // people say "the cookfire", not "J14"
  const ctx = newCtx(s);
  const mid = `m${seq(s)}`;
  const heard = [], party = [];
  const fm = s.minds[fromId];
  for (const [rid, r] of Object.entries(s.creatures)) {
    if (rid === fromId || !r.pos) continue;
    const rm = s.minds[rid];
    let ok;
    if (channel === 'signal') ok = canSee(r) && (rm ? !!sightOf(s, ctx, rm, r, from, from.pos) : C.hasLOS(s, C.at(s, r), C.at(s, from)));
    else ok = canHear(r) && !!audible(s, ctx, r, rm, from.pos, CHANNELS[channel]);
    if (!ok) continue;
    heard.push(rid);
    if (rm) receive(s, ctx, rm, r, fromId, from, fm, mid, msg, to, channel);
    else if (r.side === 'party') party.push(rid);
  }
  const verb = channel === 'shout' ? 'shouts' : channel === 'whisper' ? 'whispers' : channel === 'signal' ? 'signals' : 'says';
  if (party.length) {
    const sees = partySees(s, from);
    C.appendLog(s, 'narration', `${party.map((id) => s.creatures[id].name).join(' and ')} ${party.length > 1 ? 'hear' : 'hears'} ${sees ? from.name : `a voice ${dirWord(s.creatures[party[0]].pos, from.pos)}`} ${channel === 'signal' ? 'signal' : verb.replace(/s$/, '')}: “${msg.text}”`);
  }
  C.appendLog(s, 'secret', `[mind] ${from.name} ${verb} (${msg.kind || 'report'}${to === 'all' ? '' : ' to ' + to.join(',')}): “${msg.text}”. Heard by: ${heard.map((id) => s.creatures[id].name).join(', ') || 'nobody'}.`);
  const delivered = to === 'all' ? heard.filter((id) => s.minds[id]) : to.filter((id) => heard.includes(id));
  if (fm) fm.results.push({ t: now(s), text: `You ${verb.replace(/s$/, '')}: “${msg.text}”${to !== 'all' ? (delivered.length ? '' : ` (no answer from ${to.join(', ')}: maybe out of earshot)`) : ''}` });
  return { id: mid, heard, party, delivered };
}
function receive(s, ctx, rm, r, fromId, from, fm, mid, msg, to, channel) {
  const addressed = to === 'all' || to.includes(r.id);
  const inView = seesNow(rm, fromId);
  const fromKey = rm.roster[fromId] ? fromId : null;
  const fromLabel = fromKey ? rm.roster[fromId].name : inView ? rm.tracks[keyOf(rm, fromId)].label : `an unseen voice ${dirWord(r.pos, from.pos)}`;
  let about = null;
  // An order's square is where to go, not a sighting; only reports, warnings and answers say where something is.
  const tells = !['order', 'acknowledgement'].includes(msg.kind || 'report');
  if (msg.about && msg.about.at && tells) {
    const sk = msg.about.subject;
    const st = fm && sk ? fm.tracks[sk] : null;
    let key;
    if (sk && rm.roster[sk]) key = sk;
    else if (sk === r.id) key = null;
    else {
      const ref = `${fromId}:${sk || msg.about.at}`;
      key = rm._reported[ref] || (rm._reported[ref] = newKey(rm, 'r'));
    }
    const chain = st && !st.direct ? `${fromLabel}, passing on what they heard (${st.src})` : `${fromLabel}, who says they saw it`;
    about = { subject: key, at: msg.about.at, t: msg.about.t ?? (st ? st.t : now(s)) };
    if (key && !(rm.tracks[key] && rm.tracks[key].inView)) {
      const tr = rm.tracks[key] || (rm.tracks[key] = { key, history: [] });
      const label = rm.roster[key] ? rm.roster[key].name : `${msg.about.label || (st ? st.base || st.label : 'something')} (reported by ${fromLabel})`;
      Object.assign(tr, { label, base: msg.about.label || (st ? st.base || st.label : 'something'), side: tr.side || (st ? st.side : 'unknown'), cell: about.at, t: about.t, direct: false, src: chain, inView: false, via: mid });
      trackHistory(tr, about.at, `report ${mid}`);
    }
  }
  const verb = channel === 'shout' ? 'shouted' : channel === 'whisper' ? 'whispered' : channel === 'signal' ? 'signalled' : 'said';
  const kind = msg.kind || 'report';
  const o = {
    id: mid, modality: channel === 'signal' ? 'visual' : 'auditory', kind: 'message', msgKind: kind, from: fromKey, fromLabel, addressed,
    content: msg.text, about, chain: [...(msg.chain || []), fromKey || '?'], cell: about ? about.at : undefined,
    text: `${cap(fromLabel)} ${verb}${to === 'all' ? '' : addressed ? ' to you' : ` (to ${to.map((id) => (rm.roster[id] ? rm.roster[id].name : id)).join(', ')})`}: “${msg.text}”`,
    sig: kind === 'warning' || (kind === 'order' && addressed) ? 3 : kind === 'acknowledgement' || kind === 'answer' ? 1 : 2,
    alarmAdd: kind === 'warning' ? 15 * (fromKey ? rm.relationships[fromId].trust * 2 : 1) : 0,
  };
  if (calm(s) && kind !== 'order') { // a report of something vague is only as scary as the listener is superstitious
    const st = fm && msg.about && msg.about.subject ? fm.tracks[msg.about.subject] : null;
    if (kind === 'warning' && st && st.side !== 'hostile' && !st.uncanny) { o.sig = fear(rm) >= 0.5 ? 3 : 1; o.alarmAdd *= fear(rm) * 2; }
    else if (st && st.uncanny) o.alarmAdd += 15;
  }
  if (kind === 'order' && addressed && msg.orderId) {
    for (const old of rm.orders) if (old.issuer === fromId && ['received', 'accepted'].includes(old.status)) old.status = 'superseded'; // the latest word from the same boss stands
    rm.orders.push({ id: msg.orderId, issuer: fromId, issuerLabel: fromLabel, objective: msg.text, plan: msg.plan || null, at: msg.about ? msg.about.at : null,
      priority: msg.priority || 2, issuedAt: now(s), expiresAt: msg.expires ? now(s) + msg.expires : undefined, status: 'received', via: mid, authority: fromKey ? rm.relationships[fromId].authority : 0 });
  }
  if (kind === 'acknowledgement' && msg.orderId) {
    const mine = (rm.issued || []).find((x) => x.id === msg.orderId);
    if (mine) mine.status = msg.response || 'acknowledged';
  }
  note(s, rm, o);
}

// ---------- the brief: everything this NPC knows, and nothing else ----------
function edgeKinds(s) {
  const out = new Map();
  for (const w of C.wallSegments(s)) {
    const kind = w.kind === 'door' ? 'door' : w.kind;
    if (w.hidden) continue;
    const put = (k) => out.set(k, { kind, id: w.id });
    if (w.x1 === w.x2) for (let y = Math.min(w.y1, w.y2); y < Math.max(w.y1, w.y2); y++) put(`v${w.x1},${y}`);
    else for (let x = Math.min(w.x1, w.x2); x < Math.max(w.x1, w.x2); x++) put(`h${x},${w.y1}`);
  }
  return out;
}
// Where something last seen at `cell` `ago` rounds ago could be now, if it moves 30 ft a round
// through anything passable (doors included). Pure geometry; says nothing about where it is.
function reachable(s, cell, feet) {
  const start = C.parseCell(cell), walls = C.wallIndex(s), kinds = edgeKinds(s);
  const dist = new Map([[`${start.x},${start.y}`, 0]]);
  const q = [[0, start.x, start.y]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, x, y] = q.shift();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!C.inBounds(s, nx, ny)) continue;
      const t = C.tagsAt(s, nx, ny);
      if (C.blocksMove(t) && !t.includes('difficult')) continue;
      const wt = C.stepWallTags(walls, x, y, nx, ny);
      if (C.blocksMove(wt)) {
        const k = dx ? `v${x + (dx > 0 ? 1 : 0)},${y}` : `h${x},${y + (dy > 0 ? 1 : 0)}`;
        if (dx && dy) continue;
        if (!kinds.get(k) || kinds.get(k).kind !== 'door') continue;
      }
      const nd = d + (C.isDifficult(t) ? 10 : 5);
      if (nd > feet || nd >= (dist.get(`${nx},${ny}`) ?? Infinity)) continue;
      dist.set(`${nx},${ny}`, nd);
      q.push([nd, nx, ny]);
    }
  }
  return [...dist.keys()].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
}
function regionText(s, cells) {
  if ((s.places || []).length) { // as places a goblin would name, not a box of squares
    const names = [...new Set(cells.map((p) => Places.nameOf(s, C.cellId(p.x, p.y))).filter((n) => n && !/ of /.test(n)))];
    if (names.length) return `${names.slice(0, 8).join(', ')}${names.length > 8 ? ', or farther' : ''}`;
  }
  const xs = cells.map((p) => p.x), ys = cells.map((p) => p.y);
  const box = `${C.cellId(Math.min(...xs), Math.min(...ys))}:${C.cellId(Math.max(...xs), Math.max(...ys))}`;
  const hide = cells.filter((p) => { const t = C.tagsAt(s, p.x, p.y); return t.includes('cover-half') || t.includes('cover-3q') || t.includes('opaque'); }).map((p) => C.cellId(p.x, p.y));
  return `${cells.length} squares within ${box}${hide.length ? `; cover there: ${hide.slice(0, 10).join(' ')}${hide.length > 10 ? '…' : ''}` : ''}`;
}
// The map, or with `r` only the squares within r of the NPC (a big map buries the few squares that matter).
function renderMap(s, m, me, marks, r, seen = new Set()) {
  const kinds = edgeKinds(s);
  const p = C.parseCell(me.pos);
  const x0 = r ? Math.max(0, p.x - r) : 0, x1 = r ? Math.min(s.width - 1, p.x + r) : s.width - 1;
  const y0 = r ? Math.max(0, p.y - r) : 0, y1 = r ? Math.min(s.height - 1, p.y + r) : s.height - 1;
  const doorCh = (e) => (e.id && m.doors[e.id] && m.doors[e.id].open ? '/' : 'D');
  const ek = (e) => (!e ? ' ' : e.kind === 'door' ? doorCh(e) : e.kind === 'window' ? ':' : e.kind === 'low' ? '~' : null);
  const lines = ['    ' + Array.from({ length: x1 - x0 + 1 }, (_, i) => String.fromCharCode(65 + x0 + i)).join(' ')];
  for (let y = y0; y <= y1 + 1; y++) {
    let hl = '   ';
    for (let x = x0; x <= x1; x++) { const e = kinds.get(`h${x},${y}`); hl += ' ' + (e ? (ek(e) || '-') : ' '); }
    if (hl.trim()) lines.push(hl);
    if (y > y1) break;
    let row = String(y + 1).padStart(3) + ' ';
    for (let x = x0; x <= x1 + 1; x++) {
      if (x > x0) {
        const id = C.cellId(x - 1, y);
        seen.add(s.rows[y][x - 1]);
        row += id === me.pos ? '@' : marks[id] || s.rows[y][x - 1];
      }
      const e = kinds.get(`v${x},${y}`);
      if (x <= x1) row += e ? (ek(e) || '|') : ' ';
    }
    lines.push(row.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
// The tracks a brief lists, in order (map mark n is the nth): in sight first, then newest. Stale
// secondhand reports drop out; the ones that matter get repeated.
function briefTracks(m, t) {
  return Object.values(m.tracks).filter((tr) => !m.roster[tr.key] && (tr.inView || tr.direct || t - tr.t <= 3))
    .sort((a, b) => (b.inView - a.inView) || (b.t - a.t)).slice(0, 6);
}
function evidenceLine(o) {
  return `  ${o.id} [t${o.t}, ${o.kind === 'message' ? (o.modality === 'visual' ? 'signal' : 'heard') : o.modality}] ${o.text}`;
}
function brief(s, id) {
  const m = s.minds[id], me = s.creatures[id];
  if (!m) throw new Error(`${id} has no mind.`);
  const P = m.profile, D = m.disposition, t = now(s);
  const word = (v) => (v >= 0.75 ? 'high' : v >= 0.4 ? 'middling' : 'low');
  const L = [];
  m.lastBrief = { version: s.mseq || 0, t };
  L.push(`=== WHAT ${me.name.toUpperCase()} KNOWS (brief v${s.mseq || 0}, time ${t}${(s.turnOrder || []).length ? `, combat round ${s.round}` : ''}) ===`);
  L.push(`You are ${P.identity}, ${P.role} (rank ${P.rank}) of ${P.faction}.${P.personality.length ? ' ' + P.personality.join(' ') : ''}${P.competencies.length ? ` Good at: ${P.competencies.join(', ')}.` : ''}`);
  L.push(`Temperament: vigilance ${word(D.vigilance)}, courage ${word(D.courage)}, obedience ${word(D.obedience)}, curiosity ${word(D.curiosity)}, impulsiveness ${word(D.impulsiveness)}, sociability ${word(D.sociability)}${D.superstition ? `, superstition ${word(D.superstition)} (omens, ghosts and unexplained shapes frighten you; ordinary comrades and plain trouble do not)` : ''}. These lean your choices; they don't dictate them.`);
  L.push('', 'MOTIVATIONS');
  for (const x of m.motivations) L.push(`  ${x.id} (${x.source}, ${x.persistence}, priority ${x.priority}) ${x.description}`);
  const ords = m.orders.filter((o) => ['received', 'accepted'].includes(o.status));
  if (ords.length) { L.push('', 'ORDERS'); for (const o of ords) L.push(`  ${o.id} from ${o.issuerLabel} (t${o.issuedAt}, ${o.status}${o.authority >= 0.6 ? ', your superior' : ''}): “${o.objective}”${o.at ? ` [at ${o.at}]` : ''}${o.plan ? ` suggested plan: ${o.plan.map(stepText).join('; ')}` : ''}`); }
  L.push('', 'YOU');
  const conds = (me.conditions || []).map((x) => x.name).join(', ');
  L.push(`  At ${me.pos}${C.creatureElev(s, me) ? ` (${C.creatureElev(s, me)} ft up)` : ''}, facing ${DIR_WORD[m.facing]}. HP ${me.hp}/${me.maxHp}${conds ? `, ${conds}` : ''}. Speed ${C.speedOf(me)} ft. Attacks: ${(me.attacks || []).map((a) => `${a.name}${a.range ? ` (range ${a.range[0]}/${a.range[1]})` : ''}`).join(', ') || 'none'}.${me.light ? ' You carry a light.' : ''}`);
  L.push(`  Alarm: ${m.alarm.level.toUpperCase()} (${m.alarm.intensity}/100)${m.alarm.causes.length ? `, because of ${[...new Set(m.alarm.causes)].join(', ')}` : ''}.`);
  if (P.senses && Object.keys(P.senses).length) L.push(`  Senses: ${Object.entries(P.senses).map(([k, v]) => (v === true ? k : `${k} ${v} ft`)).join(', ')}.`);
  if (Object.keys(m.roster).length) {
    L.push('', 'PEOPLE YOU KNOW (your side)');
    for (const [oid, r] of Object.entries(m.roster)) {
      const tr = m.tracks[oid], rel = m.relationships[oid];
      L.push(`  ${oid}: ${r.name}, ${r.role}, rank ${r.rank}${r.post ? `, usually at ${r.post}` : ''}. Trust ${word(rel.trust)}. ${tr ? (tr.inView ? `In sight at ${tr.cell}.` : `Last ${tr.direct ? 'seen' : 'reported'} at ${tr.cell}, t${tr.t}.`) : 'Not seen yet.'}`);
    }
  }
  const tracks = briefTracks(m, t);
  const marks = {};
  for (const [oid, tr] of Object.entries(m.tracks)) if (m.roster[oid] && tr.inView && tr.cell) marks[tr.cell] = oid[0].toLowerCase(); // comrades in sight: their initial
  if (tracks.length) {
    L.push('', 'WHERE THINGS MIGHT BE (your own tracking; use the key, e.g. "x1", to attack or talk about one)');
    tracks.forEach((tr, i) => {
      if (tr.cell && !marks[tr.cell]) marks[tr.cell] = String(i + 1);
      const ago = t - tr.t;
      let line = `  ${tr.key} (map mark ${i + 1}): ${tr.label}. ${tr.inView ? `IN SIGHT NOW at ${tr.cell}.` : `Last at ${tr.cell}, ${ago ? ago + ' round' + (ago > 1 ? 's' : '') + ' ago' : 'just now'}, ${tr.src}.`}`;
      if (!tr.inView && ago > 0 && tr.side !== 'neutral' && !tr.downSeen) line += `\n      By now it could have reached: ${regionText(s, reachable(s, tr.cell, Math.min(120, ago * 30)))}.`;
      if (tr.searchedAt !== undefined) line += `\n      You searched there ${t - tr.searchedAt ? `${t - tr.searchedAt} round(s) ago` : 'this round'}.`;
      L.push(line);
    });
  }
  L.push('', 'WHAT YOU HAVE PERCEIVED (newest last; cite these ids as evidence)');
  if (m.memory.length) L.push(...m.memory.slice(-10).map((o) => `  ${o.id} [t${o.t}, older] ${o.text}`));
  if (m.obs.length) L.push(...m.obs.slice(-14).map(evidenceLine)); else L.push('  Nothing out of the ordinary.');
  if (m.beliefs.length) { L.push('', 'YOUR BELIEFS'); for (const b of m.beliefs) L.push(`  ${b.id} (${b.status}, ${b.confidence}) ${b.proposition}${b.where ? ` [where: ${b.where}]` : ''} — for: ${b.supporting.join(',') || '-'}; against: ${b.contradicting.join(',') || '-'}`); }
  const it = current(m);
  L.push('', 'WHAT YOU ARE DOING');
  if (it) L.push(`  ${it.id} “${it.objective}” (${it.source}) plan: ${it.plan.map((st, i) => `${i < it.step ? '✓' : i === it.step ? '→' : ' '} ${stepText(st)}`).join(' | ')}`);
  else L.push('  Nothing in particular.');
  if (m.results.length) L.push('  Recent results: ' + m.results.slice(-4).map((r) => `[t${r.t}] ${r.text}`).join(' / '));
  if (m.pending.length) L.push('', 'WHY YOU ARE THINKING NOW', ...m.pending.map((p) => `  (${['', 'notable', 'important', 'URGENT'][p.urgency]}) ${p.why}${p.refs.length ? ` [${p.refs.join(',')}]` : ''}`));
  // Squares in the prose get the name a local would use: "L18 (the crack mouth)".
  const named = (s.places || []).length ? L.map((line) => line.replace(/\b([A-Z])([1-9]\d?)\b(?! \()/g, (c, col, row) => (C.inBounds(s, col.charCodeAt(0) - 65, Number(row) - 1) ? Places.label(s, c) : c))) : L;
  if (P.knowsMap) {
    const places = Places.list(s);
    if (places.length) {
      named.push('', 'PLACES YOU KNOW (name: squares)');
      named.push('  ' + (s.places || []).map((p) => `${p.name}: ${p.at || p.area}`).join('; '));
    }
    const r = places.length ? 7 : 0; // with named places, the nearby squares are enough
    named.push('', `MAP ${r ? 'AROUND YOU' : 'YOU KNOW'} (@ you, digits = map marks above, lowercase letters = comrades in sight; | - walls, D shut door, / open door (as last seen), : window, ~ low wall)`);
    const shown = new Set();
    named.push(renderMap(s, m, me, marks, r, shown));
    named.push('  Terrain: ' + Object.entries(s.legend).filter(([k]) => shown.has(k)).map(([k, l]) => `${k} ${l.name}${(l.tags || []).length ? ` (${l.tags.join(',')})` : ''}`).join('; '));
    const doors = Object.entries(m.doors);
    if (doors.length) named.push('  Doors: ' + doors.map(([d, v]) => `${d} ${v.open ? 'open' : 'shut'} (as of t${v.t})`).join(', '));
  }
  named.push('', DECISION_HELP(m));
  return named.join('\n');
}
function stepText(st) {
  switch (st.do) {
    case 'move': return `move to ${st.to}${st.dash ? ' (dash)' : ''}`;
    case 'flee': return `flee to ${st.to}`;
    case 'guard': return `guard ${st.at}${st.facing ? ` facing ${st.facing}` : ''}`;
    case 'patrol': return 'walk your patrol route';
    case 'watch': return `watch ${st.at}${st.rounds ? ` for ${st.rounds} round(s)` : ''}`;
    case 'investigate': return `investigate ${st.at}`;
    case 'attack': return `attack ${st.target}${st.weapon ? ` with ${st.weapon}` : ''}`;
    case 'follow': return `follow ${st.target}`;
    case 'say': return `${st.channel || 'say'} to ${[].concat(st.to || 'all').join(',')}: “${st.text}”`;
    case 'door': return `${st.state || 'open'} door ${st.id}`;
    default: return st.do;
  }
}
const DECISION_HELP = (m) => `HOW TO ANSWER
Reply with ONE JSON object and nothing else. Every field is optional except "version".
{
  "version": <the brief number above>,
  "beliefs": [{"proposition": "...", "confidence": 0.0-1.0, "status": "hypothesis|accepted|disputed|rejected", "evidence": ["o12"], "contradicts": ["m14"], "where": "C3:F6", "replaces": "b2"}],
  "alarm": "routine|curious|alert|combat",
  "intention": {"objective": "...", "priority": 1-3, "plan": [<steps>], "reconsiderWhen": ["..."]},
  "now": <one step to do first, this turn>,
  "say": [{"to": "all" | ["<id from PEOPLE YOU KNOW>"], "channel": "whisper|speech|shout|signal", "kind": "${KINDS.join('|')}", "text": "...", "about": {"subject": "<track key>", "at": "C5"}}],
  ${m.profile.rank > 1 ? '"orders": [{"to": "<someone of lower rank>", "objective": "...", "plan": [<steps>], "at": "C5", "channel": "shout"}],\n  ' : ''}"orderResponses": [{"order": "<order id>", "response": "accept|decline", "reply": "..."}],
  "rationale": "one or two sentences, for the record"
}
Steps: {"do":"move","to":"C5","dash":true} {"do":"investigate","at":"C5"} (go there and search: finds hidden things nearby) {"do":"watch","at":"C5","rounds":2} {"do":"guard","at":"C5","facing":"N","rounds":2} (no rounds: hold until you change plans) {"do":"patrol"} {"do":"attack","target":"<track key in sight>"} {"do":"follow","target":"<track key>"} {"do":"say", ...as above} {"do":"door","id":"<door>","state":"open|close"} {"do":"hide"} {"do":"flee","to":"C5"} {"do":"wait"}
Rules: cite only evidence ids listed above. You can only attack what is IN SIGHT. Speech reaches only those in earshot (whisper 5 ft, speech 30, shout 150; walls muffle). You know nothing beyond this brief; guessing is allowed, but say it's a guess in your beliefs.
Squares (like "C5") go in the JSON fields ("to", "at", "where"); a place name from PLACES YOU KNOW works there too. In "text", talk like your character: name places ("by the cookfire"), never squares.`;

// ---------- decisions ----------
function current(m) { return m.intentions.find((i) => i.status === 'active') || null; }
function validCell(s, v) {
  try { const p = C.parseCell(v); return C.inBounds(s, p.x, p.y) ? C.cellId(p.x, p.y) : null; } catch { return null; }
}
function validArea(s, v) {
  const parts = String(v).split(':');
  return parts.length <= 2 && parts.every((p) => validCell(s, p)) ? parts.map((p) => validCell(s, p)).join(':') : null;
}
function checkStep(s, m, st, opts = {}) {
  if (!st || typeof st !== 'object') return 'a step must be an object like {"do":"move","to":"C5"}';
  if (!STEPS.includes(st.do)) return `unknown step "${st.do}" (use ${STEPS.join(', ')})`;
  for (const k of st.do === 'say' ? [] : ['to', 'at']) if (st[k] !== undefined) {
    const c = validCell(s, st[k]);
    if (!c) return `"${st[k]}" isn't a square on the map`;
    st[k] = c;
  }
  if (['move', 'flee'].includes(st.do) && !st.to) return `${st.do} needs "to"`;
  if (['guard', 'watch', 'investigate'].includes(st.do) && !st.at) return `${st.do} needs "at"`;
  if (['move', 'flee', 'guard'].includes(st.do)) { const p = C.parseCell(st.to || st.at); if (C.blocksMove(C.tagsAt(s, p.x, p.y))) return `${st.to || st.at} can't be stood on`; }
  if (st.facing && !DIRS[st.facing]) return `facing must be one of ${Object.keys(DIRS).join(' ')}`;
  if (['attack', 'follow'].includes(st.do) && !opts.forOther) {
    if (!st.target || !m.tracks[st.target]) return `you don't know of anything called "${st.target}" (use a track key from your brief)`;
  }
  if (st.do === 'say') {
    if (!st.text || typeof st.text !== 'string') return 'say needs "text"';
    const err = checkSay(s, m, st, opts);
    if (err) return err;
  }
  if (st.do === 'door' && (!st.id || !m.doors[st.id])) return `you don't know a door "${st.id}"`;
  if (st.do === 'patrol' && !(m.profile.patrol || []).length && !opts.forOther) return 'you have no patrol route';
  return null;
}
function checkSay(s, m, st, opts = {}) {
  if (st.kind && !KINDS.includes(st.kind)) return `kind must be one of ${KINDS.join(', ')}`;
  if (st.channel && CHANNELS[st.channel] === undefined) return `channel must be one of ${Object.keys(CHANNELS).join(', ')}`;
  const to = st.to === undefined || st.to === 'all' ? [] : [].concat(st.to);
  for (const id of to) if (!m.roster[id]) return `you don't know anyone called "${id}" to talk to`;
  if (st.about) {
    if (st.about.at && !validCell(s, st.about.at)) return `about.at "${st.about.at}" isn't a square`;
    if (st.about.subject && !m.tracks[st.about.subject] && !m.roster[st.about.subject] && !opts.forOther) return `about.subject "${st.about.subject}" isn't something you track`;
  }
  if (st.kind === 'order' && !opts.order) return 'to give an order, use "orders"';
  return null;
}
// Cheap models make honest slips: a map mark for a track key, a place name for a square, an order
// filed under "say", a fence square to stand on. Fix what has one obvious meaning, and say so.
function lenient(s, m, dec) {
  const fixed = [];
  const marked = briefTracks(m, now(s));
  const key = (k) => {
    if (k === undefined || m.tracks[k] || m.roster[k]) return k;
    const n = Number(String(k).replace(/^#/, ''));
    const v = Number.isInteger(n) && marked[n - 1] ? marked[n - 1].key : null;
    if (v) { fixed.push(`"${k}" read as ${v}`); return v; }
    return k;
  };
  const placeCell = (v) => {
    if (typeof v !== 'string' || validCell(s, v)) return v;
    const want = v.toLowerCase().replace(/^(the|by the|at the|near the)\s+/, '').trim();
    const p = (s.places || []).find((q) => q.name.toLowerCase().replace(/^the\s+/, '') === want);
    if (!p) return v;
    const [a, b] = String(p.at || p.area).split(':').map(C.parseCell);
    const c = C.cellId(Math.round((a.x + (b || a).x) / 2), Math.round((a.y + (b || a).y) / 2));
    fixed.push(`"${v}" read as ${c}`);
    return c;
  };
  const oneCell = (v) => { // a range where one square belongs: its middle
    if (typeof v !== 'string' || !v.includes(':') || !validArea(s, v)) return v;
    const [a, b] = v.split(':').map(C.parseCell);
    const c = C.cellId(Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2));
    fixed.push(`"${v}" read as ${c}`);
    return c;
  };
  const standable = (v, what) => { // the nearest square you can stand on, within 10 ft
    const c = validCell(s, v);
    if (!c) return v;
    const p = C.parseCell(c);
    if (!C.blocksMove(C.tagsAt(s, p.x, p.y))) return c;
    for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (C.inBounds(s, x, y) && !C.blocksMove(C.tagsAt(s, x, y))) { const n = C.cellId(x, y); fixed.push(`${what} ${c} can't be stood on: ${n} instead`); return n; }
    }
    return c;
  };
  const step = (st) => {
    if (!st || typeof st !== 'object') return st;
    for (const k of ['to', 'at']) if (st[k] !== undefined && st.do !== 'say') st[k] = oneCell(placeCell(st[k]));
    if (['move', 'flee'].includes(st.do)) st.to = standable(st.to, st.do);
    if (st.do === 'guard') st.at = standable(st.at, 'guard');
    if (st.target !== undefined) st.target = key(st.target);
    if (st.about) {
      st.about.subject = key(st.about.subject);
      if (st.about.subject !== undefined && !m.tracks[st.about.subject] && !m.roster[st.about.subject]) { // a name made up for something only heard: talk about the place instead
        fixed.push(`about "${st.about.subject}" isn't a track: talking about the place only`);
        delete st.about.subject;
      }
      if (st.about.at) st.about.at = oneCell(placeCell(st.about.at));
    }
    return st;
  };
  if (dec.intention && Array.isArray(dec.intention.plan)) dec.intention.plan = dec.intention.plan.map(step);
  if (dec.now) dec.now = step(dec.now);
  for (const o of [].concat(dec.orders || [])) { if (o && Array.isArray(o.plan)) o.plan = o.plan.map(step); if (o && o.at) o.at = placeCell(o.at); }
  for (const b of [].concat(dec.beliefs || [])) if (b && b.where) b.where = placeCell(b.where);
  // An order filed under "say": a real order if it's for subordinates, otherwise just a warning.
  const say = [];
  for (const st of [].concat(dec.say || [])) {
    step(st);
    if (st && st.kind === 'order') {
      const to = st.to === 'all' || st.to === undefined ? [] : [].concat(st.to);
      const subs = to.filter((x) => m.roster[x] && m.roster[x].rank < m.profile.rank);
      if (subs.length && subs.length === to.length) {
        dec.orders = [].concat(dec.orders || [], subs.map((x) => ({ to: x, objective: st.text, at: st.about && st.about.at, channel: st.channel || 'shout' })));
        fixed.push(`order in "say" sent as an order to ${subs.join(',')}`);
        continue;
      }
      st.kind = 'warning';
      fixed.push('order to everyone in "say" sent as a warning');
    }
    say.push(st);
  }
  if (dec.say) dec.say = say;
  // Plan steps that only say something run fine as "say" steps; a step-level order becomes a warning too.
  for (const st of [...((dec.intention || {}).plan || []), dec.now].filter(Boolean)) if (st.do === 'say' && st.kind === 'order') { st.kind = 'warning'; fixed.push('order in a plan step sent as a warning (give orders in "orders")'); }
  return fixed;
}
// Validate a model's decision against what this NPC knows and may do, and apply what passes.
function decide(s, id, dec, opts = {}) {
  const m = s.minds[id], me = s.creatures[id];
  if (!m) throw new Error(`${id} has no mind.`);
  const ok = [], no = [], said = [];
  if (!dec || typeof dec !== 'object' || Array.isArray(dec)) throw new Error('A decision is one JSON object.');
  const fixes = lenient(s, m, dec);
  const known = Object.keys(dec).filter((k) => !['version', 'beliefs', 'alarm', 'intention', 'now', 'say', 'orders', 'orderResponses', 'rationale'].includes(k));
  if (known.length) no.push(`ignored unknown field(s): ${known.join(', ')}`);
  const version = Number(dec.version);
  // Minds thinking together (lib/think.js) answer the same moment; what the others say meanwhile isn't news they ignored.
  const stale = !opts.together && Number.isFinite(version) && m.obs.some((o) => o.seq > version);
  if (!Number.isFinite(version)) no.push('no "version": treated as current');
  const ev = evidenceIds(m);
  // beliefs
  for (const b of [].concat(dec.beliefs || [])) {
    if (!b || typeof b.proposition !== 'string' || !b.proposition.trim()) { no.push('belief without a proposition'); continue; }
    const cites = [...(b.evidence || []), ...(b.contradicts || [])];
    const bad = cites.filter((x) => !ev.has(x));
    if (bad.length && bad.length === cites.length) { no.push(`belief “${b.proposition.slice(0, 50)}” cites evidence you never had: ${bad.join(', ')}`); continue; }
    if (bad.length) { // some real evidence: keep the belief, drop the citations it can't have
      no.push(`belief “${b.proposition.slice(0, 50)}”: dropped evidence you never had: ${bad.join(', ')}`);
      b.evidence = (b.evidence || []).filter((x) => ev.has(x));
      b.contradicts = (b.contradicts || []).filter((x) => ev.has(x));
    }
    const where = b.where ? validArea(s, b.where) : null;
    if (b.where && !where) { no.push(`belief where "${b.where}" isn't a square or range`); continue; }
    const rec = {
      id: b.replaces && m.beliefs.some((x) => x.id === b.replaces) ? b.replaces : `b${seq(s)}`,
      proposition: b.proposition.trim().slice(0, 300), confidence: clamp(Number(b.confidence) || 0.5, 0, 1),
      status: ['hypothesis', 'accepted', 'disputed', 'rejected'].includes(b.status) ? b.status : 'hypothesis',
      supporting: b.evidence || [], contradicting: b.contradicts || [], where, subject: m.tracks[b.subject] ? b.subject : undefined, revisedAt: now(s),
    };
    m.beliefs = [...m.beliefs.filter((x) => x.id !== rec.id), rec].slice(-12);
    ok.push(`belief ${rec.id}`);
  }
  // alarm: the model may raise it freely, lower it one step at a time, never below what's in sight
  if (dec.alarm) {
    const idx = ALARM.findIndex((x) => x[0] === dec.alarm), cur = ALARM.findIndex((x) => x[0] === m.alarm.level);
    if (idx < 0) no.push(`alarm "${dec.alarm}" isn't a level`);
    else {
      const floor = Object.values(m.tracks).some((t) => t.inView && t.side === 'hostile') ? 2 : 0;
      const target = Math.max(idx, cur - 1, floor);
      if (target !== cur) { m.alarm.intensity = ALARM[target][1] + (target === cur - 1 ? 10 : 5); setLevel(s, m); }
      ok.push(`alarm ${m.alarm.level}`);
    }
  }
  // answers to orders
  for (const r of [].concat(dec.orderResponses || [])) {
    const o = m.orders.find((x) => x.id === (r && r.order));
    if (!o) { no.push(`no order "${r && r.order}"`); continue; }
    if (!['accept', 'decline'].includes(r.response)) { no.push(`order ${o.id}: response must be accept or decline`); continue; }
    o.status = r.response === 'accept' ? 'accepted' : 'declined';
    said.push({ do: 'say', to: m.roster[o.issuer] ? [o.issuer] : 'all', channel: 'shout', kind: 'acknowledgement', text: r.reply || (r.response === 'accept' ? 'Understood!' : 'Can\'t do that.'), orderId: o.id, response: o.status });
    ok.push(`order ${o.id} ${o.status}`);
  }
  // orders to others: only down the chain of command, and only by voice or signal
  for (const o of [].concat(dec.orders || [])) {
    const to = o && o.to;
    if (!to || !m.roster[to]) { no.push(`order to "${to}": you don't know them`); continue; }
    if (m.roster[to].rank >= m.profile.rank) { no.push(`order to ${to}: they don't answer to you (ask instead, with "say")`); continue; }
    if (!o.objective) { no.push(`order to ${to}: needs an objective`); continue; }
    const plan = [].concat(o.plan || []);
    const errs = plan.map((st) => checkStep(s, m, st, { forOther: true })).filter(Boolean);
    if (errs.length) { no.push(`order to ${to}: ${errs.join('; ')}`); continue; }
    if (o.at && !validCell(s, o.at)) { no.push(`order to ${to}: "${o.at}" isn't a square`); continue; }
    const orderId = `ord${seq(s)}`;
    (m.issued = m.issued || []).push({ id: orderId, to, objective: o.objective, at: o.at || null, status: 'issued', t: now(s) });
    said.push({ do: 'say', to: [to], channel: o.channel || 'shout', kind: 'order', text: o.objective, orderId, plan: plan.length ? plan : null, about: o.at ? { at: o.at } : null, priority: o.priority });
    ok.push(`order ${orderId} to ${to}`);
  }
  for (const st of [].concat(dec.say || [])) {
    const err = checkStep(s, m, Object.assign({ do: 'say' }, st));
    if (err) { no.push(`say: ${err}`); continue; }
    said.push(Object.assign({ do: 'say' }, st));
  }
  // intention and the immediate step
  let it = null;
  if (dec.intention) {
    const plan = [].concat(dec.intention.plan || []);
    const errs = plan.map((st, i) => { const e = checkStep(s, m, st); return e && `step ${i + 1}: ${e}`; }).filter(Boolean);
    if (!dec.intention.objective) no.push('intention needs an objective');
    else if (errs.length) no.push(`intention “${dec.intention.objective}” rejected: ${errs.join('; ')}`);
    else {
      it = { id: `i${seq(s)}`, objective: String(dec.intention.objective).slice(0, 200), priority: clamp(Number(dec.intention.priority) || 2, 1, 3), status: 'active', plan, step: 0, source: 'model', reconsiderWhen: dec.intention.reconsiderWhen || [], t: now(s) };
      if (!plan.length) it.plan.push({ do: 'wait' });
    }
  }
  if (dec.now) {
    const err = checkStep(s, m, dec.now);
    if (err) no.push(`now: ${err}`);
    else if (stale) no.push('now: dropped, because something new happened while you were thinking (your plan and beliefs still stand)');
    else {
      if (!it) { const cur = current(m); it = cur ? Object.assign({}, cur, { plan: [...cur.plan] }) : { id: `i${seq(s)}`, objective: 'act on the moment', priority: 3, status: 'active', plan: [], step: 0, source: 'model', t: now(s) }; }
      if (JSON.stringify(it.plan[it.step]) !== JSON.stringify(dec.now)) it.plan.splice(it.step, 0, dec.now);
    }
  }
  if (it) {
    it.plan.forEach((st, i) => { if (st.do === 'guard' && !st.rounds && i < it.plan.length - 1) st.rounds = 1; }); // a guard step mid-plan holds one round; last, it holds until the plan changes
    for (const o of m.intentions) if (o.status === 'active' && o.id !== it.id) o.status = 'suspended';
    m.intentions = [it, ...m.intentions.filter((o) => o.id !== it.id)].slice(0, 5);
    ok.push(`intention ${it.id}: ${it.plan.map(stepText).join('; ')}`);
  }
  // Talking is free and happens at once.
  const spoken = [];
  for (const st of said) {
    const r = speak(s, id, { to: st.to, text: st.text, kind: st.kind, channel: st.channel, about: st.about ? Object.assign({}, st.about, st.about.subject && m.tracks[st.about.subject] ? { t: m.tracks[st.about.subject].t } : {}) : null, orderId: st.orderId, plan: st.plan, priority: st.priority, response: st.response });
    if (r.error) no.push(`say: ${r.error}`);
    else { ok.push(`${st.kind || 'speech'} to ${[].concat(st.to || 'all').join(',')}`); spoken.push(`${st.kind || 'said'} → heard by ${r.heard.map((x) => s.creatures[x].name).join(', ') || 'nobody'}`); }
  }
  if (!ok.length) m.pending = [...m.pending.filter((p) => p.why !== 'the last decision was rejected'), { why: 'the last decision was rejected', urgency: 2, refs: [] }];
  else if (opts.together) { // news from others thinking in the same moment still needs thought next time
    const late = new Set(m.obs.filter((o) => o.seq > version).map((o) => o.id));
    m.pending = m.pending.filter((p) => p.refs.some((x) => late.has(x)));
  } else m.pending = stale ? [{ why: 'new evidence arrived while deciding', urgency: 1, refs: m.obs.filter((o) => o.seq > version).map((o) => o.id) }] : [];
  if (ok.length) ok.unshift(...fixes.map((f) => `fixed: ${f}`));
  m.lastDeliberation = now(s);
  const tier = m.profile.tier;
  const st = s.mindStats = s.mindStats || { deliberations: {}, accepted: 0, rejected: 0, stale: 0, fallbacks: 0, steps: 0 };
  st.deliberations[tier] = (st.deliberations[tier] || 0) + 1;
  st.accepted += ok.length; st.rejected += no.length; if (stale) st.stale++;
  m.traces = [...m.traces, { t: now(s), version, current: s.mseq, tier, model: modelFor(s, m), source: opts.source || 'model', stale, decision: dec, accepted: ok, rejected: no, spoken }].slice(-15);
  C.appendLog(s, 'secret', `[mind] ${me.name} decides (${tier}${stale ? ', stale' : ''}): ${dec.rationale ? '“' + String(dec.rationale).slice(0, 160) + '” ' : ''}${ok.join('; ')}${no.length ? ' | rejected: ' + no.join('; ') : ''}`, { mind: id, decision: dec });
  return { ok, no, spoken, stale };
}
// Which model thinks for a mind: its own `model`, else the encounter's `mindConfig.models`, else the
// table's `minds.config.json` (project root), else the Claude tier default. An id with a slash is an
// OpenRouter model, and the engine asks it itself (lib/think.js).
let tableModels;
function projectModels() {
  if (tableModels === undefined) {
    try { tableModels = JSON.parse(require('fs').readFileSync(require('path').join(C.ROOT, 'minds.config.json'), 'utf8')).models || {}; } catch { tableModels = {}; }
  }
  return tableModels;
}
const modelFor = (s, m) => m.profile.model || ((s.mindConfig || {}).models || {})[m.profile.tier] || projectModels()[m.profile.tier] || TIERS[m.profile.tier];

// ---------- the deterministic policy: what an NPC does with no model consulted ----------
function fallbackPlan(s, id) {
  const m = s.minds[id], me = s.creatures[id], t = now(s), lvl = m.alarm.level, D = m.disposition;
  const threats = Object.values(m.tracks).filter((x) => (x.side === 'hostile' || x.side === 'unknown') && !x.downSeen && x.cell);
  threats.sort((a, b) => (b.inView - a.inView) || (b.t - a.t));
  const inSight = threats.filter((x) => x.inView && x.side === 'hostile');
  const lead = threats.find((x) => t - x.t <= 4 && !(x.searchedAt !== undefined && x.searchedAt >= x.t));
  const mk = (objective, plan, priority = 2) => ({ id: `i${seq(s)}`, objective, priority, status: 'active', plan, step: 0, source: 'fallback', t, reconsiderWhen: ['anything new'] });
  const steps = [];
  // answer orders: accept if obedient enough (or calm), and say so
  for (const o of m.orders.filter((x) => x.status === 'received')) {
    o.status = D.obedience >= 0.3 || o.authority >= 0.8 ? 'accepted' : 'declined';
    if (m.roster[o.issuer]) steps.push({ do: 'say', to: [o.issuer], channel: 'shout', kind: 'acknowledgement', text: o.status === 'accepted' ? 'On it!' : 'Not now!', orderId: o.id, response: o.status });
  }
  if (lvl === 'combat' && inSight.length) {
    const near = inSight.map((x) => ({ x, d: C.distFeet(C.parseCell(x.cell), C.parseCell(me.pos)) })).sort((a, b) => a.d - b.d)[0].x;
    if (me.hp < me.maxHp / 3 && D.courage < 0.5 && m.profile.post) return mk(`Fall back from ${near.label}`, [...steps, { do: 'flee', to: m.profile.post }], 3);
    if (!m.warned[near.key] && D.sociability >= 0.2) { m.warned[near.key] = true; steps.push(warn(m, `Intruder at ${near.cell}!`, near)); }
    return mk(`Fight ${near.label}`, [...steps, { do: 'attack', target: near.key }], 3);
  }
  // An accepted order outranks chasing leads: the officer has already weighed them.
  const order = m.orders.find((x) => x.status === 'accepted');
  if (order) return mk(order.objective, [...steps, ...(order.plan || (order.at ? [{ do: 'investigate', at: order.at }] : [{ do: 'wait' }]))], order.priority || 2);
  if (lead && lvl !== 'routine') {
    const loud = !calm(s) || lead.side === 'hostile' || lead.uncanny || D.superstition >= 0.8; // calm lairs only shout about intruders and freaks (and the very superstitious)
    if (!m.warned[lead.key] && lead.direct && loud && (lead.side === 'hostile' || lvl !== 'curious') && D.sociability >= 0.2) {
      m.warned[lead.key] = true;
      steps.push(warn(m, `${lead.side === 'hostile' ? 'Intruder' : 'Someone\'s out there'}! Last seen near ${lead.cell}!`, lead));
    }
    if (m.profile.rank >= 3 && lvl !== 'combat') return mk(`Hold ${m.profile.post || 'here'} and wait for reports`, [...steps, { do: 'guard', at: m.profile.post || me.pos, facing: dirBetween(m.profile.post || me.pos, lead.cell) || m.facing }], 2); // officers send others
    const nerve = calm(s) && lead.side !== 'hostile' ? D.courage - 0.5 * (D.superstition || 0) : D.courage; // the superstitious won't go poking at omens
    if (calm(s) && lead.side !== 'hostile' && D.superstition >= 0.5 && nerve < 0.35 && lvl !== 'combat' && m.profile.post) return mk(`Back away from ${lead.label} and watch it`, [...steps, { do: 'flee', to: m.profile.post }, { do: 'guard', at: m.profile.post, facing: dirBetween(m.profile.post, lead.cell) || m.facing }], 3); // omens are for backing away from
    if (nerve >= 0.35 || lvl === 'combat') return mk(`Find ${lead.label}`, [...steps, { do: 'investigate', at: lead.cell }], 3);
    return mk(`Hold and watch for ${lead.label}`, [...steps, { do: 'guard', at: m.profile.post || me.pos, facing: dirBetween(me.pos, lead.cell) || m.facing }], 2);
  }
  const clue = m.obs.slice().reverse().find((o) => o.sig >= 1 && o.cell && t - o.t <= 3 && !m.checked[o.cell] && ['sound', 'sight', 'lost', 'scent', 'message'].includes(o.kind));
  if (clue && lvl !== 'routine') {
    const plan = D.curiosity >= 0.35 || lvl === 'alert' ? [{ do: 'watch', at: clue.cell, rounds: 1 }, { do: 'investigate', at: clue.cell }] : [{ do: 'watch', at: clue.cell, rounds: 2 }];
    return mk(`Check out ${clue.kind === 'sound' ? 'a noise' : 'something'} near ${clue.cell}`, [...steps, ...plan], 2);
  }
  if ((m.profile.patrol || []).length) return mk('Walk the patrol route', [...steps, { do: 'patrol' }], 1);
  if (m.profile.post) return mk(`Stand watch at ${m.profile.post}`, [...steps, { do: 'guard', at: m.profile.post, facing: m.profile.facing }], 1);
  return mk('Wait', [...steps, { do: 'wait' }], 1);
}
// A shouted warning; a dog just barks (the noise says where it is, not what it saw).
function warn(m, text, tr) {
  return m.profile.bark ? { do: 'say', to: 'all', channel: 'shout', kind: 'warning', text: '*barks and snarls furiously*' }
    : { do: 'say', to: 'all', channel: 'shout', kind: 'warning', text, about: { subject: tr.key, at: tr.cell } };
}
function adoptFallback(s, id) {
  const m = s.minds[id];
  const it = fallbackPlan(s, id);
  for (const p of m.pending) p.seen = true;
  for (const o of m.intentions) if (o.status === 'active') o.status = o.source === 'fallback' ? 'abandoned' : 'suspended';
  m.intentions = [it, ...m.intentions.filter((o) => o.status !== 'abandoned')].slice(0, 5);
  (s.mindStats || {}).fallbacks = ((s.mindStats || {}).fallbacks || 0) + 1;
  return it;
}
// Pick what to follow this turn: a model's plan stands until it's done or fails; a fallback plan is
// rebuilt whenever there's news (it's cheap and deterministic).
function intentionFor(s, id) {
  const m = s.minds[id];
  const it = current(m);
  if (!it || it.step >= it.plan.length) { if (it) it.status = 'completed'; return adoptFallback(s, id); }
  // A fallback plan is cheap: rebuild it whenever there is news it hasn't taken into account yet.
  if (it.source === 'fallback' && m.pending.some((p) => !p.seen)) return adoptFallback(s, id);
  return it;
}
// Search: a Perception roll against the Stealth of anything hidden within 10 ft of the spot.
// Finds what's there; says nothing about what isn't.
function search(s, id, at, total) {
  const m = s.minds[id], me = s.creatures[id];
  const p = C.parseCell(at);
  const found = [];
  for (const [tid, t] of Object.entries(s.creatures)) {
    if (tid === id || !t.pos || !t.hidden || !C.hostile(me, t)) continue;
    if (C.distFeet(C.parseCell(t.pos), p) > 10) continue;
    if (total >= stealthOf(t)) { t.hidden = false; delete t.stealth; found.push(tid); }
  }
  m.checked[at] = now(s);
  for (const tr of Object.values(m.tracks)) if (!tr.inView && tr.cell && C.distFeet(C.parseCell(tr.cell), p) <= 10) tr.searchedAt = now(s);
  if (!found.length) note(s, m, { modality: 'visual', kind: 'search', cell: at, sig: 0, alarmAdd: Object.values(m.tracks).some((t) => t.inView && t.side === 'hostile') ? 0 : -15, text: `Searched around ${at} (Perception ${total}): found nothing.` });
  return found;
}

// ---------- reports ----------
function queue(s) {
  if (!active(s)) return 'No minds in this encounter.';
  const L = [`Minds (time ${now(s)}; deliberate when urgency ≥ ${(s.mindConfig || {}).deliberateAt || 2}):`];
  const rows = Object.values(s.minds).map((m) => ({ m, u: m.pending.length ? Math.max(...m.pending.map((p) => p.urgency)) : 0 })).sort((a, b) => b.u - a.u);
  for (const { m, u } of rows) {
    const c = s.creatures[m.id], it = current(m);
    const state = !c ? 'gone' : c.hp <= 0 ? 'down' : hasCond(c, 'asleep') ? 'asleep' : m.alarm.level;
    L.push(`  ${m.id.padEnd(8)} ${m.profile.tier.padEnd(9)} ${String(modelFor(s, m)).padEnd(7)} ${state.padEnd(8)} ${it ? `${it.source === 'model' ? '◆' : '·'} ${it.objective}`.slice(0, 48).padEnd(50) : ''.padEnd(50)}${u ? `NEEDS THOUGHT (${u}): ${m.pending.map((p) => p.why).join(' / ').slice(0, 90)}` : ''}`);
  }
  const st = s.mindStats || {};
  L.push(`Deliberations: ${Object.entries(st.deliberations || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; accepted ${st.accepted || 0}, rejected ${st.rejected || 0}, stale ${st.stale || 0}, fallback plans ${st.fallbacks || 0}, steps run ${st.steps || 0}.`);
  for (const [model, u] of Object.entries(st.usage || {})) L.push(`  ${model}: ${u.calls} calls, ${u.prompt} in + ${u.completion} out tokens, $${u.cost.toFixed(4)}, avg ${Math.round(u.ms / u.calls)} ms`);
  L.push('To think for one: node engine.js mind <id> brief → npc agent (model above) → node engine.js mind <id> decide --file -   (or "mind <id> fallback")');
  return L.join('\n');
}
// The DM's inspector: the NPC's picture of the world next to the truth.
function inspect(s, id) {
  const m = s.minds[id], me = s.creatures[id];
  if (!m) throw new Error(`${id} has no mind.`);
  const L = [`${me.name} [${id}] ${m.profile.role}, rank ${m.profile.rank}, ${m.profile.tier} (${modelFor(s, m)}). At ${me.pos} facing ${m.facing}. Alarm ${m.alarm.level} ${m.alarm.intensity}. Passive Perception ${passive(m, me)}.`];
  const it = current(m);
  L.push(`Doing: ${it ? `${it.objective} [${it.source}] ${it.plan.map((st, i) => `${i === it.step ? '→' : ''}${stepText(st)}`).join(' | ')}` : 'nothing'}`);
  if (m.orders.length) L.push('Orders: ' + m.orders.map((o) => `${o.id} from ${o.issuer} ${o.status}: ${o.objective}`).join(' / '));
  if ((m.issued || []).length) L.push('Issued: ' + m.issued.map((o) => `${o.id} → ${o.to} ${o.status}`).join(' / '));
  L.push('Tracks (belief | truth):');
  const rev = {};
  for (const [tid, k] of [...Object.entries(m._known), ...Object.entries(m._fig)]) rev[k] = tid;
  for (const tr of Object.values(m.tracks)) {
    const tid = m.roster[tr.key] ? tr.key : rev[tr.key];
    const truth = tid && s.creatures[tid] ? `${tid} at ${s.creatures[tid].pos}${s.creatures[tid].hidden ? ' (hidden)' : ''}` : '(report or guess; no single truth)';
    L.push(`  ${tr.key.padEnd(6)} ${tr.inView ? 'SEES ' : 'thinks'} ${String(tr.cell).padEnd(4)} t${tr.t} ${tr.direct ? 'direct' : 'reported'} ${tr.label.slice(0, 50)}  |  ${truth}`);
  }
  if (m.beliefs.length) L.push('Beliefs: ' + m.beliefs.map((b) => `${b.id} ${b.confidence} ${b.proposition}`).join(' / '));
  L.push('Recent evidence:', ...m.obs.slice(-8).map(evidenceLine));
  if (m.pending.length) L.push('Pending: ' + m.pending.map((p) => `(${p.urgency}) ${p.why}`).join(' / '));
  const tr = m.traces[m.traces.length - 1];
  if (tr) L.push(`Last decision t${tr.t} (${tr.source}${tr.stale ? ', stale' : ''}): ok ${tr.accepted.join('; ') || '-'}${tr.rejected.length ? ' | rejected ' + tr.rejected.join('; ') : ''}`);
  return L.join('\n');
}

module.exports = {
  TIERS, STEPS, active, initMind, initAll, snapshot, perceive, passTime, speak, brief, decide, fallbackPlan, adoptFallback,
  intentionFor, current, search, queue, inspect, summary, wantsFight, checkStep, stepText, keyOf, seesNow, stealthOf, passive, note, partySeesPath,
  dirBetween, modelFor, canSpeak, bump, trigger, validCell,
};
