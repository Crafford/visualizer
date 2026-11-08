// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import './te-tokens.css';
import './te.css';
import { APP_SECTIONS, type NumberParamDef, type ToggleParamDef } from '../../../app/params';
import type { ParamStore } from '../../../app/store';
import { h, svg, Disposer, type Component } from '../../dom';
import { createDial } from '../../components/Dial';
import { createSwatch } from '../../components/Swatch';
import { createKey, createKeyGroup, setDisabled } from '../../components/Key';
import { createDropdown } from '../../components/Dropdown';
import { createPresetsSection, type PresetsLook } from '../../PresetsSection';
import { paramSections, type ParamControl } from '../../model';
import { createPanelShell, crossFade } from '../../shell';
import { THEMES, type ThemeMode } from '../../themes';
import { ICONS } from '../../icons';
import type { Skin, SkinContext, SkinPanel } from '../types';
import { createTeDisplay } from './TeDisplay';
import { createTeInput } from './TeInput';
import { buildTeInfo, teInfoKey } from './TeInfo';
import { attachInfo } from '../../info';

/** Rotaries (Sources 1..3) and selectors (Blend mode) as rows of LED keys. */
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

/** TE mapping of the abstract controls: values as dials (grid), rotaries and selectors as LED keys, swatches. */
function fillControls(body: HTMLElement, controls: readonly ParamControl[], store: ParamStore, d: Disposer): void {
  const watchVisible = (c: ParamControl, el: HTMLElement) => {
    const vw = c.def.visibleWhen;
    if (vw) d.add(store.watch<number>(vw.id, (n) => { el.hidden = n < vw.min; }));
  };
  const values = controls.filter((c) => c.kind === 'value');
  for (const c of controls.filter((x) => x.kind === 'selector')) {
    const k = keyRow(c.def, store, c.legend.toUpperCase());
    d.add(k.dispose);
    body.append(k.el);
  }
  if (values.length) {
    const grid = h('div', { class: 'dial-grid' });
    grid.style.setProperty('--cols', String(values.length % 4 === 0 ? 4 : 3));
    for (const c of values) {
      if (c.kind !== 'value') continue;
      const dial = createDial(c.def, store, c.legend.toUpperCase(), c.cap);
      d.add(dial.dispose);
      watchVisible(c, dial.el);
      grid.append(dial.el);
    }
    body.append(grid);
  }
  for (const c of controls.filter((x) => x.kind === 'rotary')) {
    const k = keyRow(c.def, store, c.legend.toUpperCase());
    d.add(k.dispose);
    body.append(k.el);
  }
  const swatches = controls.filter((c) => c.kind === 'swatch');
  if (swatches.length) {
    const row = h('div', { class: 'swatch-row' });
    for (const c of swatches) {
      if (c.kind !== 'swatch') continue;
      const sw = createSwatch(c.def, store, c.legend.toUpperCase());
      d.add(sw.dispose);
      watchVisible(c, sw.el);
      row.append(sw.el);
    }
    body.append(row);
  }
}

function section(id: string, label: string, num: number | null): { el: HTMLElement; body: HTMLElement } {
  const headId = `sec-${id}`;
  const body = h('div', { class: 'section-body' });
  const el = h('section', { class: `section section-${id}`, 'aria-labelledby': headId },
    h('h2', { class: 'section-label', id: headId },
      num !== null ? h('span', { class: 'section-num' }, String(num).padStart(2, '0')) : null,
      h('span', { class: 'section-title' }, label),
      h('span', { class: 'section-rule', 'aria-hidden': 'true' })),
    body,
  );
  return { el, body };
}

const TE_KEYS = { reset: 'RST', save: 'SAVE', delete: 'DEL', export: 'EXP', import: 'IMP', cancel: 'CNCL', confirmSave: 'SAVE', confirmDelete: 'DEL' } as const;

const tePresetsLook: PresetsLook = {
  kase: 'upper',
  dropdown: (onChange) => createDropdown('Preset', onChange, 'dd-preset'),
  key: (which, onClick, tip) => createKey({ label: TE_KEYS[which], onClick, tip, cls: which === 'reset' ? 'key-rst' : 'key-act' }),
  nameField: (num, input, cursor) => { num.className = 'oled-dim'; return h('label', { class: 'oled-field name-field' }, num, input, cursor); },
  idle: (k) => [h('span', { class: 'key-pair' }, k.save, k.del), h('span', { class: 'key-pair' }, k.exp, k.imp)],
  saving: (field, save, cancel) => [field, save, cancel],
  deleting: (q, yes, cancel) => [h('span', { class: 'preset-confirm' }, q), yes, cancel],
  status: () => {
    const text = h('span');
    const el = h('p', { class: 'preset-status', role: 'status', 'aria-live': 'polite', hidden: true },
      h('span', { class: 'status-led', 'aria-hidden': 'true' }), text);
    return { el, set: (msg, error) => { text.textContent = msg; el.hidden = !msg; el.classList.toggle('is-error', error); } };
  },
  msg: {
    saved: (_n, name) => `Saved “${name}”`,
    deleted: (name) => `Deleted “${name}”`,
    imported: (n, name) => (n === 1 ? `Imported “${name}”` : `Imported ${n} presets`),
    ask: (name) => `Delete “${name}”?`,
  },
  frame: (p) => h('div', { class: 'group group-presets' },
    h('span', { class: 'group-label' }, 'Presets'),
    h('div', { class: 'preset-row' }, p.dropdown, p.reset),
    p.actions, p.status, p.file),
};

/**
 * The TE panel (design 84:11263): title row (VZ-01 info key), OLED, Input / UI / Visualization /
 * Presets groups, then the numbered parameter sections (from the abstract model) and Output;
 * the info module (TeInfo.ts) docks right of it.
 */
function createTePanel(ctx: SkinContext): SkinPanel {
  const { store, engine, presets, effects, prefs, listen, actions } = ctx;
  const d = new Disposer();

  const hideBtn = h('button', {
    type: 'button', class: 'icon-btn', 'aria-label': 'Hide panel', 'aria-controls': 'panel', 'aria-expanded': 'true',
    'data-tip': 'Hide panel (H)', onclick: () => actions.hide(),
  }, svg(ICONS.sidebar));
  // VZ-01 is the info key (M16), as VZ1 is in Braun.
  const model = teInfoKey();
  const titleRow = h('div', { class: 'title-row' },
    hideBtn, h('h1', { class: 'te-model-h' }, model), h('span', { class: 'spacer' }),
    h('span', { class: 'panel-version' }, `V${ctx.version}`));

  const display = createTeDisplay(engine, listen);
  d.add(display.dispose);

  const theme = createDropdown('UI theme', (id) => crossFade(() => prefs.set({ theme: id })), 'dd-theme');
  theme.setItems(THEMES.map((t) => ({ value: t.id, label: t.label.toUpperCase() })), prefs.get().theme);
  const modeKeys = createKeyGroup<ThemeMode>(
    [{ value: 'light', label: 'LT', ariaLabel: 'Light' }, { value: 'dark', label: 'DRK', ariaLabel: 'Dark' }],
    prefs.get().mode, (m) => crossFade(() => prefs.set({ mode: m })), 'UI brightness', { cls: 'key-pair' },
  );
  d.add(prefs.watch((p) => { theme.set(p.theme); modeKeys.set(p.mode); }));
  d.add(theme.dispose);
  const uiGroup = h('div', { class: 'group group-ui' },
    h('span', { class: 'group-label' }, 'UI'), h('div', { class: 'ui-row' }, theme.el, modeKeys.el));

  const input = createTeInput(listen);
  d.add(input.dispose);

  const vis = createDropdown('Visualization', (id) => actions.setEffect(id), 'dd-vis');
  vis.setItems(effects.map((e) => ({ value: e.id, label: e.label.toUpperCase() })), store.effectId);
  d.add(vis.dispose);
  const visGroup = h('div', { class: 'group group-vis' }, h('span', { class: 'group-label' }, 'Visualization'), vis.el);

  const presetGroup = createPresetsSection(store, presets, actions.setEffect, (num, name) => display.setPreset(num, name), tePresetsLook);
  d.add(presetGroup.dispose);

  // M16: Input first, then UI.
  const head = h('header', { class: 'panel-head' }, titleRow, display.el, input.el, uiGroup, visGroup, presetGroup.el);

  const host = h('div', { class: 'param-sections' });
  let effectD = new Disposer();
  const renderEffect = () => {
    effectD.dispose();
    effectD = new Disposer();
    const entry = effects.find((e) => e.id === store.effectId)!;
    host.replaceChildren();
    host.dataset.effect = entry.id;
    for (const sec of paramSections(entry)) {
      const s = section(sec.id, sec.label, sec.num);
      fillControls(s.body, sec.controls, store, effectD);
      host.append(s.el);
    }
    vis.set(entry.id);
    display.setEffect(entry.label);
  };
  renderEffect();
  d.add(store.onEffect(renderEffect));
  d.add(() => effectD.dispose());

  const output = section(APP_SECTIONS.output.id, APP_SECTIONS.output.label, null);
  const rec = createKey({ label: 'REC CLIP', icon: ICONS.record, tip: 'Coming soon', cls: 'key-wide' });
  setDisabled(rec, true);
  output.body.append(h('div', { class: 'output-row' },
    rec,
    createKey({ label: 'SCREENSHOT', icon: ICONS.dot, primary: true, cls: 'key-wide', tip: 'Save a PNG of the canvas', onClick: actions.screenshot }),
  ));

  const shell = createPanelShell('te', [head, host, output.el], hideBtn.firstElementChild!, actions.toggle);
  d.add(shell.dispose);

  // Info module, docked right of the panel (shared behaviour: ui/info.ts).
  const info = attachInfo({ panel: shell.el, trigger: model, build: (onClose) => buildTeInfo(ctx.version, onClose) });
  d.add(info.dispose);

  return {
    el: shell.el, dispose: () => d.dispose(),
    setOpen: (open, instant) => { if (!open) info.setOpen(false); shell.setOpen(open, instant); },
    hideButton: hideBtn, showKey: shell.showKey, openRight: shell.openRight,
    escape: info.escape,
  };
}

export const TE_SKIN: Skin = { id: 'te', label: 'teenage eng.', createPanel: createTePanel };
