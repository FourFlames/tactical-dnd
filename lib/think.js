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
    return m && c && c.hp > 0 && isRemote(Minds.modelFor(s, m)) && m.pending.some((p) => p.urgency >= at);
  });
}

// Request options from minds.config.json's "openrouter" block. Reasoning models (DeepSeek V4) spend
// their whole budget thinking unless told not to: off by default, it's 4x faster and cheaper.
function options() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(C.ROOT, 'minds.config.json'), 'utf8')).openrouter || {}; } catch { /* defaults */ }
  return Object.assign({ temperature: 0.7, max_tokens: 2500, reasoning: { enabled: false } }, o);
}
async function ask(model, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(URL, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'tactical-dnd NPC minds' },
      body: JSON.stringify(Object.assign({ model, messages, response_format: { type: 'json_object' }, usage: { include: true } }, options())),
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
}

// Ask every mind in `ids` at once (they think in parallel, from the same moment), then apply the
// answers one by one. A decision that comes back with nothing usable gets one retry, with the
// reasons. Anyone whose model fails falls back to the deterministic plan, so the world never stalls.
async function think(s, ids, log = console.log) {
  const asked = ids.map((id) => ({ id, model: Minds.modelFor(s, s.minds[id]), brief: Minds.brief(s, id) }));
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
}

module.exports = { think, due, isRemote, SYSTEM };
