// Pip wheel: small labelled pips on a ring around the target, the middle left empty so the target stays visible.
// Picking is by direction (Blender pie menus / Maya marking menus): anywhere in a slot's 60° wedge, past a dead
// zone over the target, counts as that slot, so the targets are huge while the pips stay small.
//
// Menus: { title, slots: { 1..6: { what, odds?, role?, sub?(), full?(), off?, self?, back? } } }. Slot 1 is at
// 12 o'clock, clockwise. Inside a submenu slot 4 is Back. Leaves go to onLeaf(slot); the wheel then closes.
//
//   const pw = createPipWheel(document.body, { onLeaf, onClose, spinMs: () => 150 });
//   pw.open(menu, () => ({ x, y, r }));   // anchor in client px, polled every frame; r = target's screen radius
//
// While open the wheel owns clicks (not drags), keys 1-6, Esc/Backspace and right-click, in the capture phase. It never
// stops a pointerup (camera controls must see every button release); a click it used is marked `ev.pwHandled`.
// Move the pointer well away and the wheel folds (fades into the target) without closing: keys still work, and clicks
// pass through to the page, so the host can pick something else. Coming back unfolds it.

const CSS = `
.pw { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 20; pointer-events: none; font: 12px/1.2 system-ui, sans-serif; }
.pw svg { position: absolute; overflow: visible; left: 0; top: 0; width: 1px; height: 1px; }
.pw .tick { fill: none; stroke: var(--gold, #d8b45a); stroke-width: 3; stroke-linecap: round; opacity: 0; transition: opacity .08s; }
.pw .halo { fill: none; stroke: #e9e3d322; stroke-width: 1; }
.pw .pip { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: #1c1b16f2;
  border: 1.5px solid #5a5446; color: var(--ink-dim, #9c9584); display: grid; place-items: center; font: 600 11px ui-monospace, monospace;
  box-shadow: 0 1px 6px #0008; transition: transform .08s, border-color .08s, background .08s; }
.pw .pip.sub::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 1px dashed #5a5446; }
.pw .pip.back { color: var(--ink, #e9e3d3); font-size: 14px; }
.pw .pip.off { opacity: .45; }
.pw .pip.hot { transform: scale(1.18); border-color: var(--gold, #d8b45a); color: var(--gold, #d8b45a); background: #2e2a1ef5; }
.pw .chip { position: absolute; white-space: nowrap; padding: 3px 7px; border-radius: 5px; background: #1c1b16e6; border: 1px solid #34312a;
  color: var(--ink, #e9e3d3); box-shadow: 0 1px 6px #0007; transition: border-color .08s; }
.pw .chip .w { font-weight: 600; }
.pw .chip .o { color: var(--gold, #d8b45a); font-size: 11px; }
.pw .chip .r { color: var(--ink-faint, #6b6557); font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; }
.pw .chip .self { font-size: 9px; color: var(--party, #4fb3a4); border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; margin-left: 4px; }
.pw .chip.off { color: var(--ink-faint, #6b6557); }
.pw .chip.off .o { color: var(--ink-faint, #6b6557); }
.pw .chip.hot { border-color: var(--gold, #d8b45a); }
.pw .crumb { position: absolute; white-space: nowrap; transform: translate(-50%, -100%); color: var(--ink-dim, #9c9584); font-size: 11px;
  background: #14130fcc; padding: 1px 6px; border-radius: 4px; }
`;

const ease = (t) => 1 - Math.pow(1 - t, 3);
const rad = (a) => a * Math.PI / 180;
const slotAngle = (k) => -90 + (k - 1) * 60;

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
    let html = `<svg><circle class="halo"/><path class="tick"/></svg>`;
    if (S.stack.length > 1) html += `<div class="crumb">${S.stack.map((m) => m.title).join(' › ')}</div>`;
    for (let k = 1; k <= 6; k++) {
      const s = slotOf(k);
      if (!s) continue;
      const cls = `${s.off ? ' off' : ''}${s.back ? ' back' : ''}${s.sub ? ' sub' : ''}`;
      html += `<div class="pip${cls}" data-k="${k}">${s.back ? '↶' : k}</div>`;
      if (s.back) continue;
      const role = S.stack.length === 1 && s.role && s.role !== s.what ? `<div class="r">${s.role}</div>` : '';
      html += `<div class="chip${s.off ? ' off' : ''}" data-k="${k}">${role}<div class="w">${s.what}${s.sub ? ' ▸' : ''}${s.self ? '<span class="self">self</span>' : ''}</div>${s.odds ? `<div class="o">${s.odds}</div>` : ''}</div>`;
    }
    el.innerHTML = html;
    S.pips = [...el.querySelectorAll('.pip')];
    S.chips = Object.fromEntries([...el.querySelectorAll('.chip')].map((c) => [c.dataset.k, c]));
    S.hot = 0;
    place();
    if (last) { const a = aim(last.x, last.y); setHot(a.zone === 'ring' ? a.k : 0); } // stay aimed after a drill
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
    S.R = Math.max(62, Math.min(130, (a.r || 30) + 30));
    const g = S.grow ? Math.min(1, (now - S.grow.t0) / S.grow.dur) : 1;
    if (g >= 1) S.grow = null;
    S.fold += ((S.folded ? 1 : 0) - S.fold) * .3;
    S.r = S.R * (.6 + .4 * ease(g)) * (1 - .55 * S.fold);
    el.style.opacity = 1 - S.fold;
    el.style.visibility = S.fold > .97 ? 'hidden' : '';    // keep the pips (not every chip) on screen, so the ring stays centred on the target as long as possible
    const padX = S.R + 18, padY = S.R + 18;
    S.x = Math.max(padX, Math.min(innerWidth - padX, a.x));
    S.y = Math.max(padY, Math.min(innerHeight - padY, a.y));
    el.style.transform = `translate(${S.x}px, ${S.y}px)`;
    place();
    S.raf = requestAnimationFrame(frame);
  }
  function place() {
    const r = S.r || S.R;
    for (const p of S.pips) {
      const k = +p.dataset.k, t = rad(slotAngle(k) + S.offset);
      const px = r * Math.cos(t), py = r * Math.sin(t);
      p.style.left = px + 'px'; p.style.top = py + 'px';
      const c = S.chips[k];
      if (!c) continue;
      // chips sit outward from their pip: right side reads rightward, left side leftward, top above, bottom below
      const cx = Math.cos(t), cy = Math.sin(t);
      let tx, ty;
      if (Math.abs(cx) < .35) { tx = '-50%'; ty = cy < 0 ? 'calc(-100% - 20px)' : '20px'; c.style.textAlign = 'center'; }
      else { tx = cx > 0 ? '21px' : 'calc(-100% - 21px)'; ty = '-50%'; c.style.textAlign = cx > 0 ? 'left' : 'right'; }
      c.style.left = px + 'px'; c.style.top = py + 'px';
      c.style.transform = `translate(${tx}, ${ty})`;
    }
    const crumb = el.querySelector('.crumb');
    if (crumb) { crumb.style.left = '0px'; crumb.style.top = -(r + 62) + 'px'; }
    el.querySelector('.halo').setAttribute('r', r);
  }

  // Which slot the pointer is aiming at: none in the dead zone over the target, none far outside the wheel.
  function aim(mx, my) {
    const dx = mx - S.x, dy = my - S.y, d = Math.hypot(dx, dy);
    if (d < S.R * .5) return { zone: 'dead' };
    if (d > S.R + (S.folded ? 110 : 150)) return { zone: 'out' };   // hysteresis, so the fold doesn't flicker
    const ang = Math.atan2(dy, dx) * 180 / Math.PI - S.offset;
    const k = ((Math.round((ang + 90) / 60) % 6) + 6) % 6 + 1;
    return { zone: 'ring', k: slotOf(k) ? k : 0 };
  }
  function setHot(k) {
    if (S.hot === k) return;
    S.hot = k;
    for (const p of S.pips) p.classList.toggle('hot', +p.dataset.k === k);
    for (const [kk, c] of Object.entries(S.chips)) c.classList.toggle('hot', +kk === k);
    const tick = el.querySelector('.tick');
    if (!k) { tick.style.opacity = 0; return; }
    const ri = S.R * .5, a0 = rad(slotAngle(k) - 22), a1 = rad(slotAngle(k) + 22);
    tick.setAttribute('d', `M ${ri * Math.cos(a0)} ${ri * Math.sin(a0)} A ${ri} ${ri} 0 0 1 ${ri * Math.cos(a1)} ${ri * Math.sin(a1)}`);
    tick.style.opacity = 1;
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
      const a = aim(ev.clientX, ev.clientY);
      S.folded = a.zone === 'out';
      setHot(a.zone === 'ring' ? a.k : 0);
    }],
    ['pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; }],
    ['pointerup', (ev) => {
      // a drag (e.g. orbiting the camera) passes through; a click is ours
      if (!down || ev.button !== 0 || S.folded || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      const a = aim(ev.clientX, ev.clientY);
      if (a.zone === 'out') return;
      ev.pwHandled = true;
      if (a.zone === 'dead') back();
      else if (a.k) choose(a.k, ev.shiftKey);
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
