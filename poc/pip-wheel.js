// Pip wheel: icons on a hexagon around the target, each with an attached label chip around the target, the middle left empty so the target stays visible.
// Each slot is one button (icon + label + odds); only the button itself is a hit target, so the target and the floor
// around it are never a slot by accident. Clicking the target backs out (closes at the root); clicking anywhere else
// that isn't a button closes the wheel and lets the click through, so the host can pick what was clicked.
//
// Menus: { title, slots: { 1..6: { what, odds?, role?, icon?, sub?(), full?(), off?, self?, back? } } }. Slot 1 is
// at 12 o'clock, clockwise. Inside a submenu slot 4 is Back. Leaves go to onLeaf(slot); the wheel then closes.
//
//   const pw = createPipWheel(document.body, { onLeaf, onClose, spinMs: () => 150 });
//   pw.open(menu, () => ({ x, y, r }));   // anchor in client px, polled every frame; r = target's screen radius
//
// While open the wheel owns its clicks, keys 1-6, Esc/Backspace and right-click, in the capture phase. It never
// stops a pointerup (camera controls must see every button release); a click it used is marked `ev.pwHandled`.
// Move the pointer well away and the wheel folds (fades into the target) without closing: keys still work, and clicks
// pass through to the page. Coming back unfolds it.

const CSS = `
.pw { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 20; pointer-events: none; font: 13px/1.15 system-ui, sans-serif; }
.pw svg { position: absolute; overflow: visible; left: 0; top: 0; width: 1px; height: 1px; }
.pw .halo { fill: none; stroke: #e9e3d31f; stroke-width: 1; }
.pw .b { position: absolute; width: 0; height: 0; transition: scale .08s; }
.pw .b .c { position: absolute; display: flex; flex-direction: column; justify-content: center; min-height: 30px; box-sizing: border-box; padding: 6px 10px;
  border-radius: 12px; background: #1c1b16f2; border: 1.5px solid #4a4538; color: var(--ink, #e9e3d3); white-space: nowrap; box-shadow: 0 2px 8px #0009;
  transition: border-color .08s, background .08s; }
.pw .b .i { position: absolute; left: -17px; top: -17px; width: 34px; height: 34px; box-sizing: border-box; border-radius: 50%; display: grid; place-items: center;
  font-size: 17px; background: #14130f; border: 1.5px solid #5a5446; color: var(--gold, #d8b45a); box-shadow: 0 1px 5px #000a; transition: border-color .08s; }
.pw .b .k { position: absolute; right: -4px; top: -6px; min-width: 13px; height: 13px; padding: 0 2px; border-radius: 4px; background: #14130f;
  border: 1px solid #4a4538; color: var(--ink-dim, #9c9584); font: 600 9px/11px ui-monospace, monospace; text-align: center; }
.pw .b .w { font-weight: 600; }
.pw .b .o { color: var(--gold, #d8b45a); font-size: 11.5px; }
.pw .b .r { color: var(--ink-faint, #6b6557); font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
.pw .b .self { font-size: 9px; color: var(--party, #4fb3a4); border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; margin-left: 4px; }
.pw .b.off { opacity: .5; }
.pw .b.off .i, .pw .b.off .o { color: var(--ink-faint, #6b6557); }
.pw .b.back .i { color: var(--ink, #e9e3d3); }
.pw .b.hot { scale: 1.06; }
.pw .b.hot .c { border-color: var(--gold, #d8b45a); background: #2e2a1ef7; }
.pw .b.hot .i { border-color: var(--gold, #d8b45a); }
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
// Icons (D px) sit on a hexagon; each label chip tucks OV px under its icon's inner end, with PAD px of text clearance.
const D = 34, OV = 11, PAD = 6, GAP = 6;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createPipWheel(parent, { onLeaf = () => {}, onClose = () => {}, spinMs = () => 150 } = {}) {
  if (!document.getElementById('pw-css')) document.head.insertAdjacentHTML('beforeend', `<style id="pw-css">${CSS}</style>`);
  const el = document.createElement('div');
  el.className = 'pw'; el.hidden = true;
  parent.appendChild(el);

  let S = null; // { stack, anchor(), hot, offset, spin, grow, x, y, R, raf }
  const cur = () => S.stack[S.stack.length - 1];
  const slotOf = (k) => (S.stack.length > 1 && k === 4 ? { what: 'Back', back: true } : cur().slots[k] || null);

  function open(menu, anchor) {
    close(true);
    S = { stack: [menu], anchor, folded: false, fold: 0, hot: 0, offset: 0, spin: null, grow: { t0: performance.now(), dur: 120 }, x: 0, y: 0, R: 80 };
    el.hidden = false;
    build();
    spin(+1, .5);
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
    let html = '<svg><circle class="halo"/></svg>';
    if (S.stack.length > 1) html += `<div class="crumb">${S.stack.map((m) => m.title).join(' › ')}</div>`;
    for (let k = 1; k <= 6; k++) {
      const s = slotOf(k);
      if (!s) continue;
      const role = S.stack.length === 1 && s.role && s.role !== s.what ? `<div class="r">${s.role}</div>` : '';
      html += `<div class="b${s.off ? ' off' : ''}${s.back ? ' back' : ''}" data-k="${k}"><span class="c">${role}<div class="w">${s.what}${s.sub ? ' ▸' : ''}${s.self ? '<span class="self">self</span>' : ''}</div>${s.odds ? `<div class="o">${s.odds}</div>` : ''}</span><span class="i">${iconOf(s, k)}<span class="k">${k}</span></span></div>`;
    }
    el.innerHTML = html;
    S.btns = [...el.querySelectorAll('.b')];
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
    S.R = Math.max(48, Math.min(120, (a.r || 30) + D / 2 + GAP));
    const g = S.grow ? Math.min(1, (now - S.grow.t0) / S.grow.dur) : 1;
    if (g >= 1) S.grow = null;
    S.fold += ((S.folded ? 1 : 0) - S.fold) * .3;
    S.r = S.R * (.6 + .4 * ease(g)) * (1 - .55 * S.fold);
    el.style.opacity = 1 - S.fold;
    el.style.visibility = S.fold > .97 ? 'hidden' : '';
    // keep the ring (not every label) on screen, so it stays centred on the target as long as possible
    const padX = S.R + 40, padY = S.R + 62;
    S.x = Math.max(padX, Math.min(innerWidth - padX, a.x));
    S.y = Math.max(padY, Math.min(innerHeight - padY, a.y));
    el.style.transform = `translate(${S.x}px, ${S.y}px)`;
    place();
    S.raf = requestAnimationFrame(frame);
  }
  // Icons sit exactly on the hexagon. Each chip hangs off its icon: sideways for the side slots, above/below for 1 and 4,
  // and the attachment blends with |cos| of the angle, so a spinning ring never snaps. At rest it is the balanced layout.
  function place() {
    const r = S.r || S.R, h = D / 2 - OV;
    // if two side chips on one side would touch, push them apart (symmetrically) along y
    const ch = Math.max(0, ...S.btns.map((b) => b.querySelector('.c').offsetHeight));
    const nudge = Math.max(0, (ch + 3 - r) / 2);
    for (const b of S.btns) {
      const t = rad(slotAngle(+b.dataset.k) + S.offset), cx = Math.cos(t), cy = Math.sin(t);
      const w = smooth(.15, .8, Math.abs(cx)), sx = cx < 0 ? -1 : 1, sy = cy < 0 ? -1 : 1;
      b.style.left = r * cx + 'px'; b.style.top = r * cy + 'px';
      const c = b.firstChild.style;
      c.left = h * sx * w + 'px'; c.top = h * sy * (1 - w) + nudge * sy * w + 'px';
      c.transform = `translate(${-50 + 50 * sx * w}%, ${-50 + 50 * sy * (1 - w)}%)`;
      const near = OV + PAD - 6;
      c.padding = `${6 + near * (1 - w) * (sy > 0)}px ${10 + near * w * (sx < 0)}px ${6 + near * (1 - w) * (sy < 0)}px ${10 + near * w * (sx > 0)}px`;
      c.textAlign = w < .5 ? 'center' : sx > 0 ? 'left' : 'right';
    }
    const crumb = el.querySelector('.crumb');
    if (crumb) { crumb.style.left = '0px'; crumb.style.top = -(r + 17 + ch + 2) + 'px'; }
    el.querySelector('.halo').setAttribute('r', r);
  }

  // The slot under the pointer: its icon circle or its chip, plus a few px of slack. Else 0.
  function hit(mx, my) {
    for (const b of S.btns) {
      const i = b.querySelector('.i').getBoundingClientRect(), q = b.firstChild.getBoundingClientRect();
      if (Math.hypot(mx - (i.left + i.width / 2), my - (i.top + i.height / 2)) < i.width / 2 + 3
        || (mx > q.left - 3 && mx < q.right + 3 && my > q.top - 3 && my < q.bottom + 3)) return +b.dataset.k;
    }
    return 0;
  }
  const away = (mx, my) => Math.hypot(mx - S.x, my - S.y) - S.R;   // px beyond the ring
  function setHot(k) {
    if (S.hot === k) return;
    S.hot = k;
    for (const b of S.btns) b.classList.toggle('hot', +b.dataset.k === k);
  }

  function choose(k, shift) {
    const s = slotOf(k);
    if (!s || s.off) return;
    if (s.back) return back();
    if (shift && s.full && S.stack.length === 1) return drill(s.full());
    if (s.sub) return drill(s.sub());
    close(true);
    onLeaf(s);
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
      const k = hit(ev.clientX, ev.clientY);
      S.folded = !k && away(ev.clientX, ev.clientY) > (S.folded ? 130 : 170);   // hysteresis, so the fold doesn't flicker
      setHot(k);
    }],
    ['pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; }],
    ['pointerup', (ev) => {
      // a drag (e.g. orbiting the camera) passes through; so does a click that isn't on a button or the target
      if (!down || ev.button !== 0 || S.folded || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const k = hit(ev.clientX, ev.clientY);
      if (k) { ev.pwHandled = true; return choose(k, ev.shiftKey); }
      if (away(ev.clientX, ev.clientY) < 0) { ev.pwHandled = true; return back(); }
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

  return { open, close: () => close(), back, get isOpen() { return !!S; }, get folded() { return !!S?.folded; } };
}
