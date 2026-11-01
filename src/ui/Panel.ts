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

export interface PanelActions {
  screenshot(): void;
  /** Switch the active effect (store, stage); the panel re-renders itself from the store. */
  setEffect(id: string): void;
  /** Hide the panel (the floating key brings it back). */
  hide(): void;
}

const VERSION = 'V0.3';

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
): Component {
  const d = new Disposer();
  const el = h('aside', { class: 'panel', id: 'panel', 'aria-label': 'Controls' });

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
  theme.setItems(THEMES.map((t) => ({ value: t.id, label: t.label.toUpperCase() })), prefs.get().theme);
  const modeKeys = createKeyGroup<ThemeMode>(
    [{ value: 'light', label: 'LT', ariaLabel: 'Light' }, { value: 'dark', label: 'DRK', ariaLabel: 'Dark' }],
    prefs.get().mode, (m) => prefs.set({ mode: m }), 'UI brightness', { cls: 'key-pair' },
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

  el.append(h('header', { class: 'panel-head' }, titleRow, display.el, uiGroup, input.el, visGroup, presetGroup.el));

  // ---- effect sections + audio response (numbered together), rebuilt per effect
  const host = h('div', { class: 'param-sections' });
  el.append(host);
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
  el.append(output.el);

  return { el, dispose: () => d.dispose() };
}
