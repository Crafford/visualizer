import './ui/tokens.css';
import { PrefsStore, applyTheme } from './ui/themes';
import './ui/app.css';
import { ParamStore } from './app/store';
import { Stage } from './app/stage';
import { AudioEngine } from './audio/AudioEngine';
import { EFFECTS, DEFAULT_EFFECT, getEffect } from './effects/registry';
import { createPanel } from './ui/Panel';
import { createTransport } from './ui/Transport';
import { installTooltips } from './ui/components/Tooltip';
import { PresetBank } from './presets/store';
import { h, svg } from './ui/dom';
import { ICONS } from './ui/icons';
import { canvasPatch, type UiMode } from './app/canvasMode';

// UI chrome prefs (theme, panel open) first, so the first paint has the right theme.
const prefs = new PrefsStore();
applyTheme(prefs.get());

// Input modality for focus rings: keyboard users get them, pointer / touch users never do
// (a tap or drag focuses a dial's range input programmatically). See app.css.
const setInput = (kind: 'pointer' | 'keyboard') => {
  if (document.documentElement.dataset.input !== kind) document.documentElement.dataset.input = kind;
};
setInput('pointer');
window.addEventListener('pointerdown', () => setInput('pointer'), { capture: true, passive: true });
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(Tab|Arrow|Page|Home|End|Enter|Escape| )/.test(e.key)) setInput('keyboard');
}, { capture: true });

const mobile = matchMedia('(pointer: coarse)').matches;

const store = new ParamStore(getEffect(DEFAULT_EFFECT)!, { mobile });
const engine = new AudioEngine();
const presets = new PresetBank(EFFECTS, { mobile });

// Audio response params flow into the engine; everything else is read by the effect per frame.
const AUDIO_KEYS = ['bassSens', 'midSens', 'highSens', 'smoothRise', 'smoothFall'] as const;
for (const k of AUDIO_KEYS) store.watch(k, (v) => engine.configure({ [k]: v }));

const root = document.getElementById('app')!;
// The canvas fills the window; the panel, transport and keys float over it.
const stageEl = h('main', { class: 'stage', 'aria-label': 'Visualization' });

let stage: Stage | null = null;

/** Fullscreen the whole app, so the panel stays toggleable in fullscreen. */
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
};

/** Local time as YYYYMMDD-HHMMSS. */
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const screenshot = async () => {
  if (!stage) return;
  const blob = await stage.screenshot();
  const a = h('a', { href: URL.createObjectURL(blob), download: `${store.effectId}-${stamp(new Date())}.png` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** Swap the effect: the store swaps the effect params (keeping the old ones), the stage
 *  disposes the old effect and creates the new one (fresh, empty trails), the panel re-renders. */
const setEffect = (id: string) => {
  const entry = getEffect(id);
  if (!entry || entry.id === store.effectId) return;
  store.setEffect(entry);
  stage?.setEffect(entry.create);
};

// ---- panel show / hide (the panel minimises into its own show key, PanelMorph.ts)
const setPanel = (open: boolean, focus = false) => {
  prefs.set({ panel: open });
  if (focus) (open ? panel.hideButton : panel.showKey).focus({ preventScroll: true });
};

const panel = createPanel(store, engine, presets, EFFECTS, prefs, {
  screenshot: () => void screenshot(),
  setEffect,
  hide: () => setPanel(false, true),
  toggle: () => setPanel(!prefs.get().panel, true),
});

/** Floating key (design 139:2 / 139:55): bare 48 px key with a 16 px icon; LED in LT only. */
const floatKey = (cls: string, icon: string, label: string, tip: string, onClick: () => void) => {
  const btn = h('button', { type: 'button', class: 'float-key', 'aria-label': label, 'data-tip': tip, onclick: onClick },
    h('span', { class: 'led', 'aria-hidden': 'true' }), svg(icon));
  return { el: h('div', { class: `float-plate ${cls}` }, btn), btn };
};
const fs = floatKey('float-fullscreen', ICONS.fullscreen, 'Fullscreen', 'Fullscreen', toggleFullscreen);

// The transport keeps clear of the open panel's box (its target size, also mid-morph).
const transport = createTransport(engine, () => panel.openRight());
const shell = h('div', { class: 'shell' }, stageEl, panel.el, fs.el, transport.el);
root.append(shell);

let firstPanel = true;
prefs.watch((p) => {
  shell.classList.toggle('panel-open', p.panel);
  panel.setOpen(p.panel, firstPanel);
  firstPanel = false;
  panel.hideButton.setAttribute('aria-expanded', String(p.panel));
  // The transport moves alongside the morph.
  transport.setPanelOpen(p.panel);
});

/**
 * The canvas follows the UI brightness: on a LT / DRK change every effect's background is
 * mirrored in lightness when it is on the wrong side of 50% L*, and its Blend mode is set
 * for the new background (DRK -> Screen, LT -> Multiply). The active effect is updated
 * through the store (its trails restart), the other effects' kept values directly, so
 * switching effect stays consistent. Editing a colour or the blend never changes the UI.
 */
const applyCanvasMode = (mode: UiMode) => {
  for (const entry of EFFECTS) {
    store.patchEffect(entry, canvasPatch(store.effectValues(entry), entry.background, mode));
  }
};
let uiMode = prefs.get().mode;
// A page opened in DRK starts as if the user had just switched to it.
if (uiMode === 'dark') applyCanvasMode(uiMode);
prefs.watch((p) => {
  if (p.mode === uiMode) return;
  uiMode = p.mode;
  applyCanvasMode(uiMode);
});

const syncFullscreen = () => {
  const on = !!document.fullscreenElement;
  fs.el.classList.toggle('is-on', on);
  fs.btn.replaceChildren(h('span', { class: 'led', 'aria-hidden': 'true' }), svg(on ? ICONS.fullscreenExit : ICONS.fullscreen));
  fs.btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  fs.btn.dataset.tip = on ? 'Exit fullscreen' : 'Fullscreen';
};
document.addEventListener('fullscreenchange', syncFullscreen);

/**
 * Keep the screen awake (no dimming, sleep or screen saver) while in fullscreen.
 * The browser drops the lock when the tab is hidden, so it is re-requested on return.
 */
let wakeLock: WakeLockSentinel | null = null;
const syncWakeLock = async () => {
  const want = !!document.fullscreenElement && document.visibilityState === 'visible';
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* unsupported, denied or low battery: the screen saver behaves as usual */ }
  } else if (!want && wakeLock) {
    const l = wakeLock;
    wakeLock = null;
    void l.release();
  }
};
document.addEventListener('fullscreenchange', () => void syncWakeLock());
document.addEventListener('visibilitychange', () => void syncWakeLock());

installTooltips();

try {
  stage = new Stage(stageEl, store, engine, getEffect(store.effectId)!.create);
} catch (err) {
  console.error(err);
  stageEl.prepend(h('p', { class: 'stage-error' }, 'WebGL2 is not available in this browser.'));
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('input:not([type=range]):not([type=color]), textarea, select, [contenteditable=""], [contenteditable="true"]');
};

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  // H toggles the panel, except while typing.
  if (e.code === 'KeyH' && !typing(e.target)) {
    e.preventDefault();
    const open = !prefs.get().panel;
    // Keep focus somewhere visible: hiding from inside the panel lands on the show key,
    // showing from the show key lands on the hide button.
    setPanel(open, panel.el.contains(document.activeElement));
    return;
  }
  // Space toggles playback when focus is not in a control.
  if (e.code === 'Space') {
    const t = e.target as HTMLElement;
    if (t.closest('input, button, textarea, select, [role="slider"], [role="radio"], [role="combobox"], [role="listbox"]')) return;
    e.preventDefault();
    void engine.toggle();
  }
});

// Dev builds, or any build with ?debug, expose internals for the console and automated tests.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) Object.assign(window, { store, engine, stage, presets, setEffect, prefs });
