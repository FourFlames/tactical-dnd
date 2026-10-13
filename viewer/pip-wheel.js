// Pip wheel: icons on a hexagon around the target, the middle left empty so the target stays visible. Each icon has a
// short caption right under it; the details (role, odds, why it's greyed) go in one tooltip for the slot under the
// pointer. Only icons and captions are hit targets. Clicking the target backs out (closes at the root).
//
// Menus: { title, slots: { 1..6: { what, short?, odds?, role?, icon?, sub?(), full?(), off?, self?, warn?, sug?, back? } } }.
// Slot 1 is at 12 o'clock, clockwise. Inside a submenu slot 4 is Back. Leaves go to onLeaf(slot); the wheel then closes,
// unless onLeaf returns 'keep': then it stays open and redraws that slot (the host may have changed the leaf's `what`,
// `short`, `odds` or `warn` fields: a red ring, for "this will hurt, choose again to confirm"). `sug` is a gold ring
// (the suggested move). The host may also open another wheel from inside onLeaf.
//
//   const pw = createPipWheel(document.body, { onLeaf, onClose, spinMs: () => 150 });
//   pw.open(menu, () => ({ x, y, r, s }));   // anchor in client px, polled every frame; r = target's screen radius,
//                                            // s = optional size factor for the whole wheel (eased)
//
// While open the wheel owns its clicks, keys 1-6, Esc/Backspace and right-click, in the capture phase. It never
// stops a pointerup (camera controls must see every button release); a click it used is marked `ev.pwHandled`.
// The grey ring is the cutoff: leave it (other than onto an icon or caption) and the wheel folds without closing:
// the icons fan in to one line and slide back under the target; coming back they rush out along that line and fan
// out to the hexagon. The same unfold plays on open. Keys still work and clicks pass through while folded.
// The host can stack the wheel under its target: `pw.el` is the wheel's element (the 3D viewer moves it into its icon layer
// and sets its z-index there; it stays position: fixed, so the anchor is still in client px).
// A click inside the ring goes to onInnerClick(ev) first; if that returns true (the host picked something else
// there) the wheel leaves it, otherwise it backs out.

const CSS = `
.pw { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 20; pointer-events: none; font: 13px/1.15 system-ui, sans-serif; }
.pw svg { position: absolute; overflow: visible; left: 0; top: 0; width: 1px; height: 1px; }
.pw .halo { fill: none; stroke: #e9e3d33a; stroke-width: 1.2; }
.pw .b { position: absolute; width: 0; height: 0; transition: scale .08s; }
.pw .b .i { position: absolute; left: -17px; top: -17px; width: 34px; height: 34px; box-sizing: border-box; border-radius: 50%; display: grid; place-items: center;
  z-index: 1; font-size: 17px; background: #14130f; border: 1.5px solid #5a5446; color: var(--gold, #d8b45a); box-shadow: 0 1px 5px #000a; transition: border-color .08s, background .08s; }
.pw .b .k { position: absolute; right: -4px; top: -6px; min-width: 13px; height: 13px; padding: 0 2px; border-radius: 4px; background: #14130f;
  border: 1px solid #4a4538; color: var(--ink-dim, #9c9584); font: 600 9px/11px ui-monospace, monospace; text-align: center; }
.pw .b .c { position: absolute; left: 0; top: 13px; transform: translateX(-50%); max-width: 86px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; padding: 1px 5px; border-radius: 6px; background: #14130fd9; color: var(--ink, #e9e3d3); font-size: 11px; font-weight: 600; }
.pw .b.off { opacity: .5; }
.pw .b.off .i { color: var(--ink-faint, #6b6557); }
.pw .b.back .i { color: var(--ink, #e9e3d3); }
.pw .b.sug .i { border-color: #d8b45a99; }
.pw .b.warn .i { border-color: #d25b4a; background: #2e1a16; color: #e8826f; box-shadow: 0 0 0 2px #d25b4a55, 0 1px 5px #000a; }
.pw .b.hot { scale: 1.08; }
.pw .b.hot .i { border-color: var(--gold, #d8b45a); background: #2e2a1e; }
.pw .b.warn.hot .i { border-color: #ef7a66; background: #3a1f1a; }
.pw .b.hot .c { color: var(--gold, #d8b45a); }
.pw.tight .b:not(.hot) .c { display: none; }
.pw .tip { position: absolute; left: 0; top: 0; z-index: 2; display: none; width: max-content; max-width: 190px; padding: 6px 9px; border-radius: 7px; background: #1c1b16f5;
  border: 1px solid #4a4538; color: var(--ink, #e9e3d3); box-shadow: 0 3px 10px #000b; font-size: 12px; line-height: 1.3; white-space: normal; }
.pw .tip .r { color: var(--ink-faint, #6b6557); font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; }
.pw .tip .w { font-weight: 600; }
.pw .tip .o { color: var(--gold, #d8b45a); }
.pw .tip .o.w2 { color: #e8826f; }
.pw .tip .n { color: var(--ink-dim, #9c9584); font-size: 11px; }
.pw .tip .self { font-size: 9px; color: var(--party, #4fb3a4); border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; margin-left: 4px; }
.pw .crumb { position: absolute; white-space: nowrap; transform: translate(-50%, -100%); color: var(--ink-dim, #9c9584); font-size: 11px;
  background: #14130fcc; padding: 1px 6px; border-radius: 4px; }
`;
// Icons by role, then by words in the label; the slot's own `icon` wins. Unknown: the slot number.
const ROLE_ICON = { Strike: '⚔', Signature: '★', Kit: '✦', Tactics: '♜', Inspect: '?', Move: '➜', Aid: '✚', Use: '◆', Talk: '❝',
  'Try something': '✧', Other: '⋯', 'Move here': '➜', Dash: '»', 'Aim here': '◎', Tricks: '↯', Ping: '!', Self: '♥' };
const WORD_ICON = [[/shove|push|trip|kick/i, '⇥'], [/sword|unarmed|strike|attack|precision|riposte/i, '⚔'], [/javelin|axe|throw|flask|fire|oil/i, '➶'], [/grapple|drag|disarm|hand|pick up/i, '✋'], [/help|aid|rally|stabili|heal|wind/i, '✚'],
  [/approach|move|walk|flank|reach|engage|jump|vault|climb|sneak|swap|dash/i, '➜'], [/ready|dodge|menac|surge/i, '◷'],
  [/speak|whisper|shout|signal|listen/i, '❝'], [/inspect|look/i, '?'], [/prone|stand/i, '⤓'], [/open|break|bar|lock|door/i, '◆']];
const iconOf = (s, k) => s.back ? '↶' : s.icon || ROLE_ICON[s.role] || WORD_ICON.find(([re]) => re.test(s.what))?.[1] || k;

const ease = (t) => 1 - Math.pow(1 - t, 3);
const rad = (a) => a * Math.PI / 180;
const slotAngle = (k) => -90 + (k - 1) * 60;
// Icons (D px) sit on a hexagon; their captions hang under them, tucked 4 px behind the circle's bottom.
const D = 34, GAP = 6, GRACE = 10;   // GRACE: see pointermove
const UNFOLD_MS = 190, FOLD_MS = 150;
const angTo = (a, b) => ((b - a) % 360 + 540) % 360 - 180;   // shortest turn from a to b, degrees
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The caption: the slot's `short` if it has one, else its title, cut to the first word when long ("Approach & strike"
// → "Approach"); the tooltip has the whole title. A submenu gets a ▸.
const shorten = (t) => { t = t.replace(/\s*\(.*\)$/, ''); return t.length > 12 && t.includes(' ') ? t.split(' ')[0] : t; };
const caption = (s) => s.back ? 'Back' : (s.short || shorten(s.what)) + (s.sub ? ' ▸' : '');
function tipHtml(s, root) {
  if (s.back) return '<div class="w">Back</div><div class="n">Esc, right-click or the target also go back</div>';
  const role = root && s.role && s.role !== s.what ? `<div class="r">${esc(s.role)}</div>` : '';
  return role + `<div class="w">${esc(s.what)}${s.self ? '<span class="self">self</span>' : ''}</div>`
    + (s.odds ? `<div class="${s.off ? 'n' : s.warn ? 'o w2' : 'o'}">${esc(s.odds)}</div>` : '')
    + (s.sub ? '<div class="n">Opens a menu</div>' : s.full ? '<div class="n">Shift-click: every option</div>' : '');
}

export function createPipWheel(parent, { onLeaf = () => {}, onClose = () => {}, onInnerClick = () => false, spinMs = () => 150 } = {}) {
  if (!document.getElementById('pw-css')) document.head.insertAdjacentHTML('beforeend', `<style id="pw-css">${CSS}</style>`);
  const el = document.createElement('div');
  el.className = 'pw'; el.hidden = true;
  parent.appendChild(el);

  let S = null; // { stack, anchor(), hot, offset, spin, u (0 folded under the target .. 1 out), a0 (the line they travel), x, y, R, raf }
  const cur = () => S.stack[S.stack.length - 1];
  const slotOf = (k) => (S.stack.length > 1 && k === 4 ? { what: 'Back', back: true } : cur().slots[k] || null);

  function open(menu, anchor) {
    close(true);
    S = { stack: [menu], anchor, folded: false, u: 0, a0: -90, goal: 1, hot: 0, offset: 0, spin: null, x: 0, y: 0, R: 80 };
    el.hidden = false;
    build();
    for (const [t, f] of listeners) addEventListener(t, f, true);
    S.raf = requestAnimationFrame(frame);
  }
  function close(silent) {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    for (const [t, f] of listeners) removeEventListener(t, f, true);
    S = null; el.hidden = true; el.innerHTML = '';
    if (!silent) onClose();
  }

  function build() {
    const menu = cur();
    let html = '<svg><circle class="halo"/></svg><div class="tip"></div>';
    if (S.stack.length > 1) html += `<div class="crumb">${S.stack.map((m) => esc(m.title)).join(' › ')}</div>`;
    for (let k = 1; k <= 6; k++) {
      const s = slotOf(k);
      if (!s) continue;
      html += `<div class="b${s.off ? ' off' : ''}${s.back ? ' back' : ''}${s.warn ? ' warn' : ''}${s.sug ? ' sug' : ''}" data-k="${k}"><span class="i">${iconOf(s, k)}<span class="k">${k}</span></span><span class="c">${esc(caption(s))}</span></div>`;
    }
    el.innerHTML = html;
    S.btns = [...el.querySelectorAll('.b')];
    S.tip = el.querySelector('.tip');
    S.hot = 0;
    place();
    if (last) setHot(hit(last.x, last.y)); // stay aimed after a drill
  }
  function spin(dir, frac = 1) { S.spin = { from: -dir * 60 * frac, t0: performance.now(), dur: spinMs() }; }

  // Ring radius clears the target; the whole wheel is nudged inside the window if it would spill out.
  function frame(now) {
    if (!S) return;
    if (S.spin) {
      const t = Math.min(1, (now - S.spin.t0) / S.spin.dur);
      S.offset = S.spin.from * (1 - ease(t));
      if (t >= 1) S.spin = null;
    }
    const a = S.anchor();
    S.k = (S.k || a.s || 1) + ((a.s || 1) - (S.k || a.s || 1)) * .25;
    // layout radius: the buttons ring the target just clear of it, so the ring (the fold cutoff) follows the zoom; buttons keep their size.
    // 44: the least that keeps neighbouring buttons apart; below 70 the captions would collide, so only the hot one shows.
    S.r = Math.max(44, Math.min(140, (a.r || 0) + D / 2 + GAP));
    el.classList.toggle('tight', S.r < 70);
    S.R = S.r * S.k;   // on screen
    // fold/unfold: u runs to 0 or 1. Each time it turns, the line they travel is re-aimed at the pointer (up if it's on the target)
    const goal = S.folded ? 0 : 1, dt = Math.min(50, now - (S.t ?? now)); S.t = now;
    if (goal !== S.goal) {
      S.goal = goal;
      const dx = (last?.x ?? S.x) - S.x, dy = (last?.y ?? S.y) - S.y;
      S.a0 = Math.hypot(dx, dy) > 10 ? Math.atan2(dy, dx) * 180 / Math.PI : -90;
    }
    S.u = Math.max(0, Math.min(1, S.u + (goal ? dt / UNFOLD_MS : -dt / FOLD_MS)));
    S.scale = S.k;
    el.style.visibility = S.u <= 0 ? 'hidden' : '';
    // keep the ring (not every label) on screen, so it stays centred on the target as long as possible
    const padX = S.R + 52, padY = S.R + 40;
    S.x = Math.max(padX, Math.min(innerWidth - padX, a.x));
    S.y = Math.max(padY, Math.min(innerHeight - padY, a.y));
    el.style.transform = `translate(${S.x}px, ${S.y}px) scale(${S.scale})`;
    place();
    S.raf = requestAnimationFrame(frame);
  }
  // Icons sit exactly on the hexagon, captions right under them. The tooltip for the hot slot hangs outward from its
  // icon (sideways for the side slots, above slot 1, below slot 4's caption), blended with |cos| so spins don't snap,
  // then kept inside the window.
  // Unfolding: the first half they rush out together along the line a0, the second half they fan out to their slots
  // (each the short way round), captions fading in. Folding plays it backwards.
  function place() {
    const r = S.r || S.R, u = S.u ?? 1;
    const out = ease(Math.min(1, u * 2)), fan = ease(Math.max(0, u * 2 - 1));
    for (const b of S.btns) {
      const ta = slotAngle(+b.dataset.k) + S.offset, t = rad(S.a0 + angTo(S.a0, ta) * fan);
      b.style.left = r * out * Math.cos(t) + 'px'; b.style.top = r * out * Math.sin(t) + 'px';
      b.style.transform = out < 1 ? `scale(${.5 + .5 * out})` : '';
      b.querySelector('.c').style.opacity = fan;
    }
    const crumb = el.querySelector('.crumb');
    if (crumb) { crumb.style.left = '0px'; crumb.style.top = -(r + D / 2 + 6) + 'px'; crumb.style.opacity = fan; }
    const halo = el.querySelector('.halo');
    halo.setAttribute('r', r * out); halo.style.opacity = fan;
    placeTip();
  }
  function placeTip() {
    const tip = S.tip, b = S.hot && S.u > .98 && S.btns.find((x) => +x.dataset.k === S.hot);
    if (!b) { tip.style.display = 'none'; return; }
    tip.style.display = 'block';
    const r = S.r || S.R, t = rad(slotAngle(S.hot) + S.offset), cx = Math.cos(t), cy = Math.sin(t);
    const w = smooth(.15, .8, Math.abs(cx)), sx = cx < 0 ? -1 : 1, sy = cy < 0 ? -1 : 1;
    const c = b.querySelector('.c'), below = sy > 0 ? c.offsetHeight + 4 : 0;
    const outX = Math.max(D / 2, c.offsetWidth / 2) + 8, outY = D / 2 + 8;   // sideways it clears the caption too
    let x = r * cx + outX * sx * w, y = r * cy + (outY + below) * sy * (1 - w);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    x -= tw / 2 - tw / 2 * sx * w; y -= th / 2 - th / 2 * sy * (1 - w);
    x = Math.max(6 - S.x, Math.min(innerWidth - 6 - S.x - tw, x));
    y = Math.max(6 - S.y, Math.min(innerHeight - 6 - S.y - th, y));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  // The slot at (mx, my) where the wheel is at full size (icons never move, so a folded wheel's would-be icons count
  // too): its icon circle or its caption, grown by `slack` px. Else 0.
  function hit(mx, my, slack = 4) {
    for (const b of S.btns) {
      const t = rad(slotAngle(+b.dataset.k) + S.offset), ix = S.x + S.R * Math.cos(t), iy = S.y + S.R * Math.sin(t), k = S.k;
      const c = b.querySelector('.c'), cw = c.offsetWidth / 2 * k, cy = iy + (D / 2 - 4) * k;
      if (Math.hypot(mx - ix, my - iy) < D / 2 * k + slack
        || (Math.abs(mx - ix) < cw + slack && my > cy - slack && my < cy + c.offsetHeight * k + slack)) return +b.dataset.k;
    }
    return 0;
  }
  const away = (mx, my) => Math.hypot(mx - S.x, my - S.y) - S.R;   // px beyond the ring
  function setHot(k) {
    if (S.hot === k) return;
    S.hot = k;
    for (const b of S.btns) b.classList.toggle('hot', +b.dataset.k === k);
    const sl = k && slotOf(k);
    if (sl) S.tip.innerHTML = tipHtml(sl, S.stack.length === 1);
    placeTip();
  }

  function choose(k, shift) {
    const s = slotOf(k);
    if (!s || s.off) return;
    if (s.back) return back();
    if (shift && s.full && S.stack.length === 1) return drill(s.full());
    if (s.sub) return drill(s.sub());
    const was = S, r = onLeaf(s);
    if (S !== was) return;   // the host closed or replaced the wheel itself
    if (r === 'keep') build(); else close(true);
  }
  function drill(menu) { S.folded = false; S.stack.push(menu); build(); spin(+1); }
  function back() {
    if (!S) return;
    if (S.stack.length === 1) return close();
    S.stack.pop(); build(); spin(-1);
  }

  let down = null, last = null;
  const listeners = [
    ['pointermove', (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (ev.buttons) return;   // dragging the camera: leave the wheel as it is
      // The ring is the cutoff; an icon or caption holds it open past it. Folding is instant (the look animates).
      // Open = inside the full-size ring or on a full-size icon/caption, plus GRACE px (a few more to stay open, so
      // the edge doesn't flicker). A folded wheel pops back to full as soon as the pointer is there.
      const out = away(ev.clientX, ev.clientY), g = GRACE + (S.folded ? 0 : 4);
      S.folded = out > g && !hit(ev.clientX, ev.clientY, g);
      const k = S.folded ? 0 : hit(ev.clientX, ev.clientY);
      setHot(k);
    }],
    ['pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; }],
    ['pointerup', (ev) => {
      // a drag (e.g. orbiting the camera) passes through; so does a click that isn't on a button or the target
      if (!down || ev.button !== 0 || S.folded || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const k = hit(ev.clientX, ev.clientY);
      if (k) { ev.pwHandled = true; return choose(k, ev.shiftKey); }
      if (away(ev.clientX, ev.clientY) < 0) { ev.pwHandled = true; const r = onInnerClick(ev) || back(); if (!S) ev.pwClosed = true; return r; } // pwClosed: the click folded the wheel away
      close();
    }],
    ['contextmenu', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (S.folded) return;
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) <= 5) back();
    }],
    ['keydown', (ev) => {
      if (/^Digit[1-6]$/.test(ev.code)) { ev.stopPropagation(); const k = +ev.code.slice(5); setHot(k); choose(k, ev.shiftKey); }
      else if (ev.key === 'Escape' || ev.key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); back(); }
    }],
  ];

  return { el, open, close: () => close(), back, get isOpen() { return !!S; }, get folded() { return !!S?.folded; }, get hot() { return S?.hot || 0; } };
}
