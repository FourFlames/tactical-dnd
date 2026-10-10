// The engine thinking for NPC minds itself, through OpenRouter. A mind whose model is an OpenRouter
// id ("deepseek/deepseek-v4.1-flash": anything with a slash) is briefed, asked, and its answer run
// through Minds.decide, with no DM in the loop. Claude-tier minds ("haiku", "sonnet", "opus") are
// left to the DM and the `npc` subagent, as before.
//
// The key comes from the OPENROUTER_API_KEY environment variable and nowhere else.
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./core');
const Minds = require('./minds');
const Places = require('./places');

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT = 60000;

const SYSTEM = `You are the mind of one non-player character in a tactical D&D game: a guard, a sentry, an officer. You are not the narrator and not a game master. You know only what your character has seen, heard, been told, or worked out. Your brief (the next message) is all of it.

Think as that person would, at that moment:
- Stay inside your evidence. A sound is a sound, not a person. A sighting from two rounds ago is not where they are now: the brief says where they could have got to. A report from someone else is their word, not your eyes; weigh it by how much you trust them. Record a guess as a guess (a belief with "status": "hypothesis" and an honest confidence).
- Be the character. Your motivations, orders and temperament matter. A bored guard may shrug off one noise; a vigilant one won't. A coward holds back; an ambitious one wants credit. You can disobey an order you think is foolish, but it has consequences.
- Prefer intentions to twitches. Give a short plan (two to four steps) that will still make sense next round, plus "reconsiderWhen". Use "now" only for something that must happen this instant.
- Talk like people do. Warn others only of what you know (or say it's a guess), in words your character would use, naming places ("by the cookfire"), never grid squares. A shout carries far and is heard by enemies too. Officers give orders with "orders"; everyone else asks with "say".
- Be beatable. You're a person, not an oracle: you can be fooled, distracted and wrong.

Answer with exactly one JSON object in the shape the brief describes, and nothing else. Include "version" from the brief. Cite only evidence ids that appear in your brief.`;

const isRemote = (model) => typeof model === 'string' && model.includes('/');
// Minds this engine should think for right now: alive, on an OpenRouter model, and with news.
function due(s, ids) {
  if (!Minds.active(s)) return [];
  const at = (s.mindConfig || {}).deliberateAt || 2;
  return (ids || Object.keys(s.minds)).filter((id) => {
    const m = s.minds[id], c = s.creatures[id];
    return m && c && c.hp > 0 && isRemote(Minds.modelFor(s, m)) && m.pending.some((p) => p.urgency >= at && !(p.after !== undefined && p.after >= (s.mtime || 0)));
  });
}

// Request options from minds.config.json's "openrouter" block. Reasoning models (DeepSeek V4) spend
// their whole budget thinking unless told not to: off by default, it's 4x faster and cheaper.
function options() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(C.ROOT, 'minds.config.json'), 'utf8')).openrouter || {}; } catch { /* defaults */ }
  return Object.assign({ temperature: 0.7, max_tokens: 2500, reasoning: { enabled: false } }, o);
}
// One session per game keeps OpenRouter on the same provider, so shared prompt openings stay cached.
const sessionOf = (s) => (s.mindSession = s.mindSession || `game-${Date.now().toString(36)}`);
let SESSION = null;
async function ask(model, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(URL, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'tactical-dnd NPC minds' },
      body: JSON.stringify(Object.assign({ model, messages, response_format: { type: 'json_object' }, usage: { include: true } }, SESSION ? { session_id: SESSION } : {}, options())),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(body.error && body.error.message) || res.statusText}`);
    const ch = body.choices && body.choices[0];
    const text = (ch && ch.message && ch.message.content) || '';
    if (!text && ch && ch.finish_reason === 'length') throw new Error('ran out of tokens before answering (raise openrouter.max_tokens, or turn reasoning down)');
    return { text, usage: body.usage || {} };
  } finally { clearTimeout(timer); }
}
function parse(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the answer');
  return JSON.parse(text.slice(a, b + 1));
}
function count(s, model, usage, ms) {
  const st = s.mindStats = s.mindStats || { deliberations: {}, accepted: 0, rejected: 0, stale: 0, fallbacks: 0, steps: 0 };
  const u = (st.usage = st.usage || {})[model] = (st.usage || {})[model] || { calls: 0, prompt: 0, completion: 0, cost: 0, ms: 0 };
  u.calls++; u.prompt += usage.prompt_tokens || 0; u.completion += usage.completion_tokens || 0; u.cost += usage.cost || 0; u.ms += ms;
  u.cached = (u.cached || 0) + ((usage.prompt_tokens_details || {}).cached_tokens || 0);
}
// Which way listeners take in a new standing order: "folded" (in their next full think) or "split"
// (a short call of its own, right away, that also says whether it changes their plans).
function takeMode() {
  if (process.env.MINDS_STANDING_TAKE) return process.env.MINDS_STANDING_TAKE;
  try { return JSON.parse(fs.readFileSync(path.join(C.ROOT, 'minds.config.json'), 'utf8')).standingTake || 'folded'; } catch { return 'folded'; }
}

const TAKE_SYSTEM = `You are one goblin in a tactical D&D game. A superior has just shouted a standing order (a rule that holds until lifted) and you heard it. Decide, as yourself, how you take it.

Rule kinds the game understands:
${Object.entries(Minds.STANDING).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
"custom" covers anything else; say what it means for you in "as".

Be yourself: the loyal and frightened keep a rule to the letter, the proud or resentful bend it to suit themselves, a muffled order may be misheard, a rival may take it as aimed at him. Your reaction is a private thought, one line. Your reply is what you shout back, short, or empty. "changesPlan" is true only if, given this rule, what you are doing now no longer fits and you need to rethink.

If you heard several orders, take each one, in order: a later one may sharpen or overrule an earlier one.

Answer with one JSON object and nothing else:
{"takes": [{"order": "<order id>", "understood": [{"kind": "<kind>", "as": "what it means for you"}], "keeps": "strongly|fairly|barely|not at all", "reaction": "...", "reply": "..."}], "changesPlan": false}`;

// The listener as only they know themselves: built from their own mind, nothing else.
// Every fact here comes from the listener's own mind (what it sees, was told, concluded), never the truth.
function selfSketch(s, id, issuer) {
  const m = s.minds[id], c = s.creatures[id], D = m.disposition, rel = m.relationships[issuer] || {};
  const word = (v) => (v >= 0.75 ? 'high' : v >= 0.4 ? 'middling' : 'low');
  const it = Minds.current(m);
  const here = C.parseCell(c.pos);
  // Company: comrades they can see right now, and how far.
  const near = Object.values(m.tracks).filter((t) => m.roster[t.key] && t.inView && t.cell && !t.downSeen)
    .map((t) => ({ name: m.roster[t.key].name, d: C.distFeet(C.parseCell(t.cell), here) })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d);
  // Trouble: only what they track, have news about, or have been told.
  const trouble = [];
  for (const t of Object.values(m.tracks)) {
    if (m.roster[t.key] || !t.cell || t.kin) continue;
    if (t.static) trouble.push(`news about ${Places.label(s, t.cell)} (told by ${(t.sources || []).join(', ')})`);
    else if (t.side === 'hostile' || t.side === 'unknown') trouble.push(`${t.label}: ${t.inView ? 'in sight' : t.direct ? 'last seen' : 'reported'} at ${Places.label(s, t.cell)}`);
  }
  for (const k of (m.claims || []).slice(-3)) trouble.push(`what you were told (${k.sources.join(', ')}${k.relays.length ? `, repeated by ${k.relays.join(', ')}` : ''}): “${k.text.slice(0, 140)}”`);
  // Rules already held, one line per order.
  const byAnn = new Map();
  for (const o of (m.standing || []).filter((x) => !(m.newRules || []).some((r) => r.ann === x.ann))) {
    const g = byAnn.get(o.ann || o.id) || { who: o.issuerLabel, text: o.text, kinds: [] };
    g.kinds.push(o.kind); byAnn.set(o.ann || o.id, g);
  }
  return [`YOU: ${m.profile.identity}, ${m.profile.role} (rank ${m.profile.rank}). ${m.profile.personality.join(' ')}`,
    `Temperament: obedience ${word(D.obedience)}, courage ${word(D.courage)}, vigilance ${word(D.vigilance)}, impulsiveness ${word(D.impulsiveness)}.`,
    `Towards ${m.roster[issuer] ? m.roster[issuer].name : issuer}: trust ${word(rel.trust ?? 0.6)}, loyalty ${word(rel.loyalty ?? 0.5)}, their authority over you ${word(rel.authority ?? 0.5)}.`,
    `Right now: alarm ${m.alarm.level}; at ${Places.label(s, c.pos)}${m.profile.post ? `, your post is ${Places.label(s, m.profile.post)}` : ''}; ${it ? `doing: ${it.objective}` : 'nothing in particular'}.`,
    near.length ? `With you: ${near.map((x) => `${x.name} (${x.d} ft)`).join(', ')}.` : 'You are alone: no comrade in sight within 30 ft.',
    trouble.length ? `What you know of the trouble:\n${trouble.slice(-5).map((x) => `  - ${x}`).join('\n')}` : 'You know nothing yet of any trouble.',
    m.beliefs.length ? `You believe: ${m.beliefs.slice(-3).map((b) => b.proposition).join(' / ')}` : '',
    byAnn.size ? `Rules you already keep: ${[...byAnn.values()].map((g) => `from ${g.who}, “${g.text.slice(0, 80)}” (${g.kinds.join(', ')})`).join('; ')}` : ''].filter(Boolean).join('\n');
}

// What a listener is shown to take in its new orders: the orders first (shared, so cached), then itself.
function takePrompt(s, id) {
  const rules = s.minds[id].newRules || [];
  const orders = rules.map((r) => `${r.ann} from ${r.issuerLabel}, heard ${r.clarity === 'muffled' ? 'muffled (this is all you caught)' : 'clearly'}:\n“${r.text}”`).join('\n');
  return `THE ORDERS YOU HEARD:\n${orders}\n\n${selfSketch(s, id, rules.length ? rules[rules.length - 1].issuer : null)}`;
}
// Split mode: every listener with a new standing order takes it in now, in parallel. The order comes
// first in the prompt, so everyone who heard the same words shares a cached opening.
async function takeOrders(s, ids, log = console.log) {
  SESSION = sessionOf(s);
  // One call per listener, covering every new order they heard (oldest first).
  const jobs = ids.filter((id) => (s.minds[id].newRules || []).length).map((id) => ({ id, rules: s.minds[id].newRules.slice(), model: Minds.modelFor(s, s.minds[id]) }));
  if (!jobs.length) return;
  const t0 = Date.now();
  const res = await Promise.all(jobs.map(async (j) => {
    const user = takePrompt(s, j.id);
    const t1 = Date.now();
    try { const a = await ask(j.model, [{ role: 'system', content: TAKE_SYSTEM }, { role: 'user', content: user }]); return Object.assign(j, { a, ms: Date.now() - t1 }); } catch (e) { return Object.assign(j, { err: e.message, ms: Date.now() - t1 }); }
  }));
  for (const j of res) {
    const name = s.creatures[j.id].name, m = s.minds[j.id];
    if (j.a) count(s, j.model, j.a.usage, j.ms);
    let ans = null;
    try { ans = j.a && parse(j.a.text); } catch (e) { j.err = e.message; }
    const takes = ans ? [].concat(ans.takes || (ans.understood ? [Object.assign({ order: j.rules[0].ann }, ans)] : [])) : [];
    if (!takes.length) { log(`${name} [${j.id}] couldn't take the orders in (${j.err || 'no takes'}); the formula stands in.`); m.newRules = []; continue; }
    const said = [], took = [];
    for (const t of takes) {
      const out = Minds.applyTake(s, j.id, t.order, t);
      if (out.error) continue;
      took.push(`${t.order}: ${out.understood.join('+') || 'nothing'} (${out.keeps})`);
      if (out.reply) said.push(out);
    }
    for (const r of m.newRules || []) Minds.applyTake(s, j.id, r.ann, {}); // any it skipped: keep the boss's own kinds, formula firmness
    const last = said[said.length - 1]; // one reply, to the latest order: nobody answers a speech line by line
    if (last) Minds.speak(s, j.id, { to: [last.issuer], channel: 'shout', kind: 'acknowledgement', text: last.reply });
    m.takeLog = [...(m.takeLog || []), { t: Minds.now ? Minds.now(s) : s.mtime, model: j.model, ms: j.ms, answer: ans }].slice(-5);
    // Absorbed: orders alone are no reason for a full think. Unless they change their plans.
    const anns = new Set(j.rules.map((r) => r.ann));
    if (ans.changesPlan) { // rethink next tick: this one stays quick, and they hold meanwhile
      m.pending = m.pending.filter((p) => !p.refs.some((x) => anns.has(x))); // the order itself is taken in; what's left is the rethink
      Minds.trigger(m, 2, 'new standing orders change your plans', [...anns]);
      const p = m.pending.find((x) => x.why === 'new standing orders change your plans');
      if (p) p.after = s.mtime || 0;
    }
    else m.pending = m.pending.filter((p) => !p.refs.some((x) => anns.has(x)));
    log(`${name} [${j.id}] takes ${j.rules.length} order(s) (${j.ms} ms${(j.a.usage.prompt_tokens_details || {}).cached_tokens ? `, ${j.a.usage.prompt_tokens_details.cached_tokens} cached` : ''}): ${took.join('; ')}${ans.changesPlan ? ', RETHINKS' : ''}. “${last ? last.reply : ''}”`);
  }
  log(`(order take-in: ${jobs.length} calls in parallel, ${Date.now() - t0} ms wall)`);
}

// Ask every mind in `ids` at once (they think in parallel, from the same moment), then apply the
// answers one by one. A decision that comes back with nothing usable gets one retry, with the
// reasons. Anyone whose model fails falls back to the deterministic plan, so the world never stalls.
async function think(s, ids, log = console.log) {
  SESSION = sessionOf(s);
  const tStart = Date.now();
  const asked = ids.map((id) => ({ id, model: Minds.modelFor(s, s.minds[id]), brief: Minds.brief(s, id, { takeOrders: takeMode() === 'folded' }) }));
  for (const q of asked) s.minds[q.id].lastBriefText = q.brief; // what the model was shown, for the DM's inspector
  const answers = await Promise.all(asked.map(async (q) => {
    const t0 = Date.now();
    try {
      const r = await ask(q.model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: q.brief }]);
      return Object.assign(q, { text: r.text, usage: r.usage, ms: Date.now() - t0 });
    } catch (e) { return Object.assign(q, { error: e.message, ms: Date.now() - t0 }); }
  }));
  for (const q of answers) {
    const name = s.creatures[q.id].name;
    if (q.usage) count(s, q.model, q.usage, q.ms);
    let dec = null, err = q.error;
    if (!err) { try { dec = parse(q.text); } catch (e) { err = e.message; } }
    let r = null;
    if (dec) {
      try { r = Minds.decide(s, q.id, dec, { source: q.model, together: true }); } catch (e) { err = e.message; }
    }
    const planLost = r && r.ok.length && dec.intention && r.no.some((x) => /^intention|^now:/.test(x));
    if (r && ((!r.ok.length && r.no.length) || planLost)) { // one more try, told why
      // Whole answer unusable: ask again for all of it. Only the plan lost: ask for just the plan,
      // so what already went through (beliefs, things said aloud) doesn't happen twice.
      const why = r.no.filter((x) => !planLost || /^intention|^now:/.test(x));
      const ask2 = planLost
        ? `The rest went through, but your plan was rejected:\n- ${why.join('\n- ')}\nEach plan step must be an object like {"do":"move","to":"C5"} from the step list. Reply with one JSON object holding only "version", "intention" and, if needed, "now".`
        : `None of that could be used:\n- ${why.join('\n- ')}\nAnswer again with one corrected JSON object.`;
      try {
        const t0 = Date.now();
        const again = await ask(q.model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: q.brief }, { role: 'assistant', content: q.text }, { role: 'user', content: ask2 }]);
        count(s, q.model, again.usage, Date.now() - t0);
        let d2 = parse(again.text);
        if (planLost) d2 = { version: d2.version, intention: d2.intention, now: d2.now };
        const r2 = Minds.decide(s, q.id, d2, { source: q.model, together: true });
        r = planLost ? { ok: [...r.ok, ...r2.ok.map((x) => `(retry) ${x}`)], no: [...r.no.filter((x) => !/^intention|^now:/.test(x)), ...r2.no.map((x) => `(retry) ${x}`)], spoken: [...r.spoken, ...r2.spoken] } : r2;
      } catch (e) { err = `retry failed: ${e.message}`; }
    }
    if (r && r.ok.length) {
      log(`${name} [${q.id}] thinks (${q.model}, ${q.ms} ms): ${r.ok.join('; ')}${r.no.length ? ` | rejected: ${r.no.join('; ')}` : ''}${r.spoken.length ? ` | ${r.spoken.join('; ')}` : ''}`);
    } else {
      const it = Minds.adoptFallback(s, q.id);
      s.minds[q.id].pending = [];
      log(`${name} [${q.id}] couldn't think (${err || (r ? r.no.join('; ') : 'no answer')}); fallback: ${it.objective}`);
    }
  }
  log(`(thinking: ${asked.length} minds in parallel, ${Date.now() - tStart} ms wall)`);
}

module.exports = { think, due, isRemote, SYSTEM, takeOrders, takeMode, takePrompt, TAKE_SYSTEM };
