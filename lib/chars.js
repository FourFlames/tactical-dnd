// Player profiles and characters for the character builder (Node only).
//
// players.json:          { <name>: { code, t } }. The code is the player's sign-in key; it doubles as
//                        their seat token when the DM seats them (see `seat` in engine.js).
// characters/<id>.json:  { id, owner, created, updated, build, suggestions: [...] }.
// homebrew.json:         optional table settings for the power-creep allowance ({ creep, pool, selfRatedCap }).
//
// The build is what the player chose; lib/rules.js derives everything else. A few fields are the
// server's, never the browser's: rolled ability scores and hit points, homebrew approval, and the DM's
// OK on hand-entered scores. mergeBuild() keeps those when a player saves.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./core');
const R = require('./rules');
const Power = require('./power');

const PLAYERS = path.join(C.ROOT, 'players.json');
const DIR = path.join(C.ROOT, 'characters');
const STAMP = path.join(DIR, '.stamp');
const CONFIG = path.join(C.ROOT, 'homebrew.json');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const loadPlayers = () => readJson(PLAYERS, {});
const savePlayers = (p) => fs.writeFileSync(PLAYERS, JSON.stringify(p, null, 2));
const config = () => Object.assign({}, Power.DEFAULTS, readJson(CONFIG, {}));
const NAME_RE = /^[\w-]{1,24}$/;

// ---------- profiles ----------
function profileByCode(code) {
  const c = C.normCode(code);
  if (!c) return null;
  const players = loadPlayers();
  for (const [name, p] of Object.entries(players)) if (p.code === c) return { name, code: c };
  // A seat link is a sign-in too: the first time someone uses one here, it becomes their profile.
  const seat = C.seatByToken(c);
  if (seat && !players[seat.player]) {
    players[seat.player] = { code: c, t: Date.now() };
    savePlayers(players);
    return { name: seat.player, code: c };
  }
  return null;
}
function register(name) {
  const n = String(name || '').trim().replace(/\s+/g, '-');
  if (!NAME_RE.test(n)) return { error: 'Use 1-24 letters, digits, - or _ for your name.' };
  const players = loadPlayers();
  const lower = n.toLowerCase();
  if (Object.keys(players).some((k) => k.toLowerCase() === lower)) return { error: 'That name is taken. Sign in with your code instead, or pick another name.' };
  if (Object.keys(C.loadSeats()).some((k) => k.toLowerCase() === lower)) return { error: 'The DM already gave that name a seat. Sign in with the code from your seat link.' };
  const taken = [...Object.values(players).map((p) => p.code), ...Object.values(C.loadSeats()).map((s) => s.token)];
  const code = C.newCode(taken);
  players[n] = { code, t: Date.now() };
  savePlayers(players);
  return { name: n, code };
}

// ---------- characters ----------
function touch() { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STAMP, String(Date.now())); }
function file(id) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(id || ''))) return null;
  return path.join(DIR, id + '.json');
}
function load(id) { const f = file(id); return f && fs.existsSync(f) ? readJson(f, null) : null; }
function save(c) {
  fs.mkdirSync(DIR, { recursive: true });
  c.updated = Date.now();
  const f = file(c.id);
  fs.writeFileSync(f + '.tmp', JSON.stringify(c, null, 2));
  fs.renameSync(f + '.tmp', f);
  touch();
  return c;
}
function list(owner) {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(DIR, f), null))
    .filter((c) => c && (!owner || c.owner === owner)).sort((a, b) => b.updated - a.updated);
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
// Character ids double as creature ids in encounters, so they avoid every id already in use.
function freeId(name) {
  const base = slug(name) || 'hero';
  const s = C.loadState();
  const used = new Set([...(fs.existsSync(DIR) ? fs.readdirSync(DIR).map((f) => f.replace(/\.json$/, '')) : []), ...Object.keys((s && s.creatures) || {})]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}
function create(owner, name, level) {
  const build = R.blank(Math.min(20, Math.max(1, Number(level) || 3)));
  build.name = String(name || '').slice(0, 40);
  const c = { id: freeId(name || 'hero'), owner, created: Date.now(), build, suggestions: [] };
  return save(c);
}
function derive(c) { return R.derive(c.build, { config: config() }); }

// What the browser may change, and what stays the server's.
function mergeBuild(old, incoming) {
  const b = JSON.parse(JSON.stringify(incoming || {}));
  b.abilities = Object.assign({}, b.abilities || {});
  const oa = old.abilities || {};
  if (oa.rolls) b.abilities.rolls = oa.rolls; else delete b.abilities.rolls;
  b.abilities.approved = !!oa.approved && b.abilities.method === 'manual' && JSON.stringify(b.abilities.base) === JSON.stringify(oa.base);
  b.hp = Object.assign({ method: 'average' }, b.hp || {});
  if (old.hp && old.hp.rolls) b.hp.rolls = old.hp.rolls; else delete b.hp.rolls;
  b.homebrew = (b.homebrew || []).filter((h) => h && /^[a-z0-9]{1,12}$/.test(h.id)).slice(0, 12).map((h) => {
    const prev = (old.homebrew || []).find((x) => x.id === h.id) || {};
    const clean = { id: h.id, name: String(h.name || '').slice(0, 60), slot: Power.SLOTS[h.slot] ? h.slot : 'other', text: String(h.text || '').slice(0, 800),
      effects: (h.effects || []).slice(0, 12).map(cleanEffect), status: prev.status || 'draft' };
    if (prev.approvedSig) clean.approvedSig = prev.approvedSig;
    if (prev.dmNote) clean.dmNote = prev.dmNote;
    // An edit takes an automatic or DM approval back to a draft (pending stays pending until the DM answers).
    if (R.hbSig(clean) !== R.hbSig(prev) && ['auto', 'approved', 'declined'].includes(clean.status)) clean.status = 'draft';
    return clean;
  });
  b.level = Math.min(20, Math.max(1, Math.round(Number(b.level) || 3)));
  b.name = String(b.name || '').slice(0, 40);
  return b;
}
function cleanEffect(e) {
  const out = {};
  for (const k of ['kind', 'ability', 'skill', 'type', 'scope', 'armor', 'when', 'per', 'text', 'dice']) if (e[k] !== undefined && e[k] !== '') out[k] = String(e[k]).slice(0, 120);
  for (const k of ['value', 'uses']) if (e[k] !== undefined && e[k] !== '') out[k] = e[k] === 'prof' || e[k] === 'mod' ? e[k] : Number(e[k]) || 0;
  return out;
}

// ---------- rolls (the server rolls, so they're honest) ----------
function rollAbilities(c) {
  if ((c.build.abilities || {}).rolls) return { error: 'Already rolled. Ask the DM for a reroll.' };
  const sets = [];
  for (let i = 0; i < 6; i++) {
    const d = [C.d(6), C.d(6), C.d(6), C.d(6)];
    const drop = d.indexOf(Math.min(...d));
    sets.push({ dice: d, drop, total: d.reduce((t, x, j) => (j === drop ? t : t + x), 0) });
  }
  c.build.abilities = { method: 'rolled', base: { str: null, dex: null, con: null, int: null, wis: null, cha: null }, rolls: sets, rolledAt: Date.now() };
  return { rolls: sets };
}
function rollHp(c) {
  const cls = R.CLASSES[c.build.class];
  if (!cls) return { error: 'Choose a class first.' };
  c.build.hp = Object.assign({ method: 'rolled' }, c.build.hp || {}, { method: 'rolled' });
  const rolls = c.build.hp.rolls = c.build.hp.rolls || {};
  const got = [];
  for (let lv = 2; lv <= c.build.level; lv++) if (rolls[lv] === undefined) { rolls[lv] = C.d(cls.hd); got.push({ level: lv, roll: rolls[lv] }); }
  return { rolls: got, hd: cls.hd };
}

// ---------- homebrew and the DM ----------
function useHomebrew(c, hbId) {
  const h = (c.build.homebrew || []).find((x) => x.id === hbId);
  if (!h) return { error: 'No such homebrew.' };
  const cfg = config();
  const r = Power.rate(h, { level: c.build.level, config: cfg });
  if (r.needsDm || r.verdict === 'over' || r.verdict === 'dm') return { error: 'This one needs the DM: ' + r.dm.join('; ') + '.' };
  const others = (c.build.homebrew || []).filter((x) => x.id !== hbId && x.status === 'auto').map((x) => Power.rate(x, { level: c.build.level, config: cfg }));
  const pool = Power.ratePool([...others, r], cfg);
  if (pool.over) return { error: `Together with this character's other homebrew, that's ${pool.used} FP over budget; the table allows ${pool.pool} without the DM. Trim something or send it to the DM.` };
  h.status = 'auto';
  return { ok: true, rating: r };
}
function intent(player, c, text, extra = {}) {
  const e = Object.assign({ id: crypto.randomBytes(6).toString('hex'), t: Date.now(), player, creature: c.id, kind: 'build', text: String(text).slice(0, 600) }, extra);
  C.appendIntent(e);
  return e;
}
function sendHomebrew(player, c, hbId, note) {
  const h = (c.build.homebrew || []).find((x) => x.id === hbId);
  if (!h) return { error: 'No such homebrew.' };
  if (!(h.effects || []).length && !h.text) return { error: 'Describe it first: what does it do?' };
  h.status = 'pending';
  const r = Power.rate(h, { level: c.build.level, config: config() });
  const e = intent(player, c, `Homebrew for review: "${h.name}" (${r.slotLabel}, ${r.cost} FP of ${r.budget === null ? 'no fixed budget' : r.budget}). ${note ? 'Note: ' + note : ''}`.trim(), { hb: hbId });
  h.request = e.id;
  return { ok: true, intent: e };
}
function ask(player, c, text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Say what you\'d like help with.' };
  const e = intent(player, c, `Asks the DM: ${t}`, { ask: true });
  c.requests = (c.requests || []).concat({ id: e.id, t: e.t, text: t }).slice(-10);
  return { ok: true, intent: e };
}

// Suggestions: the DM proposes a change; the player accepts, declines, or talks about it.
function suggest(c, text, patch, opts = {}) {
  const s = { id: 's' + crypto.randomBytes(3).toString('hex'), t: Date.now(), text: String(text || '').slice(0, 800), patch: patch || {}, status: 'open', thread: [] };
  if (opts.re) s.re = opts.re;
  // Check now that the patch would apply cleanly.
  R.applyPatch(c.build, s.patch);
  c.suggestions = (c.suggestions || []).concat(s);
  return s;
}
function answerSuggestion(player, c, sid, action, text) {
  const s = (c.suggestions || []).find((x) => x.id === sid);
  if (!s) return { error: 'That suggestion is gone.' };
  if (s.status !== 'open') return { error: `Already ${s.status}.` };
  if (action === 'accept') {
    const before = c.build;
    let next = R.applyPatch(before, s.patch);
    // A DM-proposed homebrew comes pre-approved: the DM wrote it.
    for (const h of next.homebrew || []) {
      const touched = Object.keys(s.patch).some((k) => k === `homebrew.${h.id}` || k.startsWith(`homebrew.${h.id}.`));
      if (touched) { h.status = 'approved'; h.approvedSig = R.hbSig(h); }
    }
    c.build = next;
    s.status = 'accepted';
    intent(player, c, `Accepted your suggestion ${sid}.`, { quiet: true });
  } else if (action === 'decline') {
    s.status = 'declined';
    if (text) s.thread.push({ who: 'player', text: String(text).slice(0, 600), t: Date.now() });
    intent(player, c, `Declined suggestion ${sid}${text ? ': ' + text : '.'}`, { quiet: true });
  } else if (action === 'discuss') {
    const t = String(text || '').trim();
    if (!t) return { error: 'Say something.' };
    s.thread.push({ who: 'player', text: t.slice(0, 600), t: Date.now() });
    intent(player, c, `About suggestion ${sid} ("${s.text.slice(0, 60)}${s.text.length > 60 ? '…' : ''}"): ${t}`, { sug: sid });
  } else return { error: 'Accept, decline or discuss.' };
  return { ok: true };
}

// What the builder and home page need about a character, in one go.
function view(c) {
  const d = derive(c);
  const s = C.loadState();
  const inGame = !!(s && s.creatures && s.creatures[c.id] && s.creatures[c.id].char === c.id);
  const reqIds = new Set([...(c.requests || []).map((r) => r.id), ...(c.build.homebrew || []).map((h) => h.request).filter(Boolean)]);
  const answers = C.readIntents().filter((e) => reqIds.has(e.id)).map(({ id, t, text, handled, seenAt, replies, done }) => ({ id, t, text, handled, seenAt, replies, done }));
  return { id: c.id, owner: c.owner, updated: c.updated, build: c.build, suggestions: c.suggestions || [], requests: answers, derived: d, inGame, summary: R.summary(c.build), config: config() };
}

module.exports = {
  PLAYERS, DIR, STAMP, CONFIG, config, loadPlayers, savePlayers, profileByCode, register,
  load, save, list, create, derive, mergeBuild, rollAbilities, rollHp, useHomebrew, sendHomebrew, ask,
  suggest, answerSuggestion, view, touch, freeId,
};
