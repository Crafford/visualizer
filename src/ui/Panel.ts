import { APP_PARAMS, APP_SECTIONS, type NumberParamDef, type ParamDef, type SectionDef, type ToggleParamDef } from '../app/params';
import type { ParamStore } from '../app/store';
import type { AudioEngine } from '../audio/AudioEngine';
import type { EffectEntry } from '../effects/types';
import type { PresetBank } from '../presets/store';
import { h, svg, Disposer, type Component } from './dom';
import { createDial } from './components/Dial';
import { createSwatch } from './components/Swatch';
import { createKey, createKeyGroup, setDisabled } from './components/Key';
import { createDropdown } from './components/Dropdown';
import { createDisplay } from './Display';
import { createInputSection } from './InputSection';
import { createPresetsSection } from './PresetsSection';
import { capColour, dialRank, shortLabel } from './controlStyle';
import { THEMES, type PrefsStore, type ThemeMode } from './themes';
import { ICONS } from './icons';
import { createPanelMorph, type PanelMorph } from './PanelMorph';

export interface PanelActions {
  screenshot(): void;
  /** Switch the active effect (store, stage); the panel re-renders itself from the store. */
  setEffect(id: string): void;
  /** Hide the panel (it minimises into the show key, which brings it back). */
  hide(): void;
  /** The show key (the minimised panel) was activated; mid-morph this reverses the morph. */
  toggle(): void;
}

export interface PanelApi extends Component {
  /** Open or minimise (animated unless `instant`). */
  setOpen(open: boolean, instant?: boolean): void;
  /** The header hide button and the show key (focus targets). */
  hideButton: HTMLButtonElement;
  showKey: HTMLButtonElement;
  /** Right edge of the open panel, px from the window's left (also while minimised). */
  openRight(): number;
}

const VERSION = 'V0.3';

/**
 * Run a theme change inside a short whole-page cross-fade (View Transitions) where the
 * browser has it and motion is allowed; gradients and the canvas cannot transition otherwise.
 */
function crossFade(update: () => void): void {
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  document.startViewTransition(update);
}

/** Small integer params (Sources 1..3) render as a row of radio keys instead of a dial. */
const isKeyNumber = (d: NumberParamDef) =>
  d.step === 1 && Number.isInteger(d.min) && Number.isInteger(d.max) && d.max - d.min <= 3 && !d.display;

/** Labelled row of radio keys for a small integer param (LED outside, as Sources) or a toggle. */
function keyRow(def: NumberParamDef | ToggleParamDef, store: ParamStore, legend: string): Component {
  const isToggle = def.kind === 'toggle';
  const opts = isToggle
    ? def.options.map((o) => ({ value: o.value, label: o.label.toUpperCase(), ariaLabel: o.label }))
    : Array.from({ length: def.max - def.min + 1 }, (_, i) => ({ value: String(def.min + i), label: String(def.min + i) }));
  const group = createKeyGroup<string>(opts, String(store.get(def.id)),
    (v) => store.set(def.id, isToggle ? v : Number(v)), def.label,
    { cls: isToggle ? 'key-row-toggle' : 'key-row-num', ledOutside: !isToggle, keyCls: isToggle ? 'key-mode' : 'key-num' });
  const el = h('div', { class: 'param-keys' }, h('span', { class: 'param-keys-label' }, legend), group.el);
  const unwatch = store.watch(def.id, (v) => group.set(String(v)));
  return { el, dispose: () => { unwatch(); group.dispose(); } };
}

/** Dials (grid), then key rows, then colour swatches, as in the design. */
function fillControls(body: HTMLElement, defs: readonly ParamDef[], store: ParamStore, effect: string, d: Disposer): void {
  const dials = defs.filter((x): x is NumberParamDef => x.kind === 'number' && !isKeyNumber(x))
    .map((def, i) => ({ def, r: dialRank(effect, def.id, i) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.def);
  const keys = defs.filter((x): x is NumberParamDef | ToggleParamDef => (x.kind === 'number' && isKeyNumber(x)) || x.kind === 'toggle');
  const colours = defs.filter((x) => x.kind === 'color');
  const watchVisible = (def: ParamDef, el: HTMLElement) => {
    const vw = def.visibleWhen;
    if (vw) d.add(store.watch<number>(vw.id, (n) => { el.hidden = n < vw.min; }));
  };

  // Toggles (Smoke Mode) sit above the dials, Sources below them.
  for (const def of keys.filter((k) => k.kind === 'toggle')) {
    const c = keyRow(def, store, shortLabel(effect, def.id, def.label));
    d.add(c.dispose);
    body.append(c.el);
  }
  if (dials.length) {
    const grid = h('div', { class: 'dial-grid' });
    grid.style.setProperty('--cols', String(dials.length % 4 === 0 ? 4 : 3));
    for (const def of dials) {
      const c = createDial(def, store, shortLabel(effect, def.id, def.label), capColour(effect, def.id));
      d.add(c.dispose);
      watchVisible(def, c.el);
      grid.append(c.el);
    }
    body.append(grid);
  }
  for (const def of keys.filter((k) => k.kind === 'number')) {
    const c = keyRow(def, store, shortLabel(effect, def.id, def.label));
    d.add(c.dispose);
    body.append(c.el);
  }
  if (colours.length) {
    const row = h('div', { class: 'swatch-row' });
    for (const def of colours) {
      const c = createSwatch(def as Extract<ParamDef, { kind: 'color' }>, store, shortLabel(effect, def.id, def.label));
      d.add(c.dispose);
      watchVisible(def, c.el);
      row.append(c.el);
    }
    body.append(row);
  }
}

function section(sec: SectionDef, num: number | null): { el: HTMLElement; body: HTMLElement } {
  const headId = `sec-${sec.id}`;
  const body = h('div', { class: 'section-body' });
  const el = h('section', { class: `section section-${sec.id}`, 'aria-labelledby': headId },
    h('h2', { class: 'section-label', id: headId },
      num !== null ? h('span', { class: 'section-num' }, String(num).padStart(2, '0')) : null,
      h('span', { class: 'section-title' }, sec.label),
      h('span', { class: 'section-rule', 'aria-hidden': 'true' })),
    body,
  );
  return { el, body };
}

/**
 * The floating control panel (TE design 84:11263): header with VZ-01, the OLED display and
 * the UI / Input / Visualization / Presets groups, then the numbered parameter sections
 * (the active effect's, then Audio response) and Output. Parameter sections are generated
 * from the schema and rebuilt on every effect switch.
 */
export function createPanel(
  store: ParamStore, engine: AudioEngine, presets: PresetBank, effects: readonly EffectEntry[],
  prefs: PrefsStore, actions: PanelActions,
): PanelApi {
  const d = new Disposer();
  const el = h('aside', { class: 'panel', id: 'panel', 'aria-label': 'Controls' });
  // The card stays put; its content scrolls in .panel-scroll (see installScroll).
  const scroller = h('div', { class: 'panel-scroll' });

  // ---- title row
  const hideBtn = h('button', {
    type: 'button', class: 'icon-btn', 'aria-label': 'Hide panel', 'aria-controls': 'panel', 'aria-expanded': 'true',
    'data-tip': 'Hide panel (H)', onclick: () => actions.hide(),
  }, svg(ICONS.sidebar));
  const titleRow = h('div', { class: 'title-row' },
    hideBtn,
    h('h1', { class: 'panel-title' }, 'VZ-01'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'panel-version' }, VERSION),
  );

  // ---- display
  const display = createDisplay(engine);
  d.add(display.dispose);

  // ---- UI: theme + LT / DRK
  const theme = createDropdown('UI theme', (id) => prefs.set({ theme: id }), 'dd-theme');
  theme.setItems(THEMES.map((t) => ({ value: t.id, label: t.label.toUpperCase(), short: t.short?.toUpperCase() })), prefs.get().theme);
  const modeKeys = createKeyGroup<ThemeMode>(
    [{ value: 'light', label: 'LT', ariaLabel: 'Light' }, { value: 'dark', label: 'DRK', ariaLabel: 'Dark' }],
    prefs.get().mode, (m) => crossFade(() => prefs.set({ mode: m })), 'UI brightness', { cls: 'key-pair' },
  );
  d.add(prefs.watch((p) => { theme.set(p.theme); modeKeys.set(p.mode); }));
  d.add(theme.dispose);
  const uiGroup = h('div', { class: 'group group-ui' },
    h('span', { class: 'group-label' }, 'UI'),
    h('div', { class: 'ui-row' }, theme.el, modeKeys.el),
  );

  // ---- input
  const input = createInputSection(engine);
  d.add(input.dispose);

  // ---- visualization
  const vis = createDropdown('Visualization', (id) => actions.setEffect(id), 'dd-vis');
  vis.setItems(effects.map((e) => ({ value: e.id, label: e.label.toUpperCase() })), store.effectId);
  d.add(vis.dispose);
  const visGroup = h('div', { class: 'group group-vis' }, h('span', { class: 'group-label' }, 'Visualization'), vis.el);

  // ---- presets
  const presetGroup = createPresetsSection(store, presets, actions.setEffect, (num, name) => display.setPreset(num, name));
  d.add(presetGroup.dispose);

  scroller.append(h('header', { class: 'panel-head' }, titleRow, display.el, uiGroup, input.el, visGroup, presetGroup.el));

  // ---- effect sections + audio response (numbered together), rebuilt per effect
  const host = h('div', { class: 'param-sections' });
  scroller.append(host);
  let effectD = new Disposer();
  const renderEffect = () => {
    effectD.dispose();
    effectD = new Disposer();
    const entry = effects.find((e) => e.id === store.effectId)!;
    host.replaceChildren();
    host.dataset.effect = entry.id;
    let n = 0;
    for (const sec of entry.sections) {
      const s = section(sec, ++n);
      fillControls(s.body, entry.params.filter((p) => p.section === sec.id), store, entry.id, effectD);
      host.append(s.el);
    }
    const audio = section(APP_SECTIONS.audio, ++n);
    fillControls(audio.body, APP_PARAMS.filter((p) => p.section === 'audio'), store, entry.id, effectD);
    host.append(audio.el);
    vis.set(entry.id);
    display.setEffect(entry.label);
  };
  renderEffect();
  d.add(store.onEffect(renderEffect));
  d.add(() => effectD.dispose());

  // ---- output
  const output = section(APP_SECTIONS.output, null);
  const rec = createKey({ label: 'REC CLIP', icon: ICONS.record, tip: 'Coming soon', cls: 'key-wide' });
  setDisabled(rec, true);
  output.body.append(h('div', { class: 'output-row' },
    rec,
    createKey({ label: 'SCREENSHOT', icon: ICONS.dot, primary: true, cls: 'key-wide', tip: 'Save a PNG of the canvas', onClick: actions.screenshot }),
  ));
  scroller.append(output.el);
  el.append(scroller);
  d.add(installScroll(el, scroller));
  const morph: PanelMorph = createPanelMorph(el, scroller, hideBtn.firstElementChild!, actions.toggle);
  d.add(morph.dispose);

  return {
    el, dispose: () => d.dispose(),
    setOpen: morph.set, hideButton: hideBtn, showKey: morph.key,
    openRight: () => el.offsetLeft + morph.openWidth(),
  };
}

/**
 * Overlay scroll bar and edge fades for the panel. The native bar is hidden (CSS); a 4 px
 * thumb tracks scrollTop and can be dragged. It shows while the pointer is over the panel
 * (CSS :hover), while dragging, and on touch screens briefly while scrolling. The
 * scroller gets .can-up / .can-down when there is more content above / below, which turns
 * on the soft fade mask at that edge.
 */
function installScroll(panel: HTMLElement, scroller: HTMLElement): () => void {
  const thumb = h('div', { class: 'panel-thumb' });
  const bar = h('div', { class: 'panel-scrollbar', 'aria-hidden': 'true' }, thumb);
  panel.append(bar);
  let scrollingTimer = 0;
  let raf = 0;

  const layout = () => {
    raf = 0;
    const { scrollTop: top, scrollHeight: total, clientHeight: view } = scroller;
    const max = Math.max(0, total - view);
    const needed = max > 1;
    bar.classList.toggle('is-needed', needed);
    scroller.classList.toggle('can-up', needed && top > 1);
    scroller.classList.toggle('can-down', needed && top < max - 1);
    if (!needed) return;
    const track = bar.clientHeight;
    const th = Math.max(24, Math.round(track * view / total));
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${Math.round((track - th) * (top / max))}px)`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(layout); };

  // Touch screens have no hover: show the thumb while the content moves instead.
  const noHover = matchMedia('(hover: none)');
  const onScroll = () => {
    schedule();
    if (!noHover.matches) return;
    bar.classList.add('is-scrolling');
    clearTimeout(scrollingTimer);
    scrollingTimer = window.setTimeout(() => bar.classList.remove('is-scrolling'), 700);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // Drag the thumb.
  let grabY = 0;
  let grabTop = 0;
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging');
    grabY = e.clientY;
    grabTop = scroller.scrollTop;
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!thumb.hasPointerCapture(e.pointerId)) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const travel = bar.clientHeight - thumb.offsetHeight;
    if (travel > 0) scroller.scrollTop = grabTop + (e.clientY - grabY) * (max / travel);
  });
  const release = (e: PointerEvent) => {
    if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
    bar.classList.remove('is-dragging');
  };
  thumb.addEventListener('pointerup', release);
  thumb.addEventListener('pointercancel', release);

  // Content and size changes (effect switch, input panes, window height).
  const ro = new ResizeObserver(schedule);
  ro.observe(scroller);
  const mo = new MutationObserver(schedule);
  mo.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  for (const c of scroller.children) ro.observe(c);
  schedule();
  return () => {
    ro.disconnect();
    mo.disconnect();
    clearTimeout(scrollingTimer);
    if (raf) cancelAnimationFrame(raf);
    scroller.removeEventListener('scroll', onScroll);
  };
}
