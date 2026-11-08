// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { APP_PARAMS, APP_SECTIONS, type ColorParamDef, type NumberParamDef, type ParamDef, type ToggleParamDef } from '../app/params';
import type { EffectEntry } from '../effects/types';
import { capColour, dialRank, shortLabel, type CapColour } from './controlStyle';

/**
 * The abstract panel model (M15): what the panel holds, independent of how a skin draws it.
 * Every skin renders the same sections in the same order and maps each control kind to its
 * own controls (skins/<id>/*Panel.ts):
 *
 *   section          input | ui | visualization | presets | <effect sections> | audio | output
 *   control kind     what it is                                           TE            Braun
 *   source switch    two-position slide switch (system / mic)             slide switch  slide switch
 *   listen key       latching key with LED, starts / stops the source     LISTEN key    green power key
 *   selector group   hardware: selects a state, latching, LED            LED keys      capsule keys
 *   action key       software: triggers a command, momentary            keys          round keys
 *   dropdown         select-only combobox                                 key + OLED    VFD glass
 *   value            continuous number (0..10 scale or real units)       dial          fader / dial
 *   rotary           a few discrete choices (Sources 1..3)                radio keys    rotary selector
 *   swatch           colour                                               swatch key    capsule well
 *   display          effect, preset, source, BPM, level                   OLED          VFD
 *   live strip       LIVE + spectrum while the panel is hidden            plate         plate
 *   floating plates  show-panel and fullscreen keys                       48 px keys    48 px plates
 *   info key         opens the info module                                none          AVZ1 model name
 *
 * Jaco's rule: selector keys are hardware (they hold a state), action keys are software (they
 * run a command); a skin picks the kind by function, never by look.
 */

export type ParamControl =
  | { kind: 'value'; def: NumberParamDef; legend: string; cap: CapColour }
  | { kind: 'rotary'; def: NumberParamDef; legend: string }
  | { kind: 'selector'; def: ToggleParamDef; legend: string }
  | { kind: 'swatch'; def: ColorParamDef; legend: string };

export interface ParamSection {
  id: string;
  label: string;
  /** 1-based number across the effect's sections and audio response. */
  num: number;
  /** 'audio' for audio response, else the effect's section id. */
  role: 'effect' | 'audio';
  controls: ParamControl[];
}

/** Small integer params (Sources 1..3) are discrete choices, not continuous values. */
export const isRotary = (d: NumberParamDef) =>
  d.step === 1 && Number.isInteger(d.min) && Number.isInteger(d.max) && d.max - d.min <= 3 && !d.display;

/** Controls of one section in panel order: selectors (toggles), values (design rank), rotaries, swatches. */
function controlsOf(defs: readonly ParamDef[], effect: string): ParamControl[] {
  const legend = (d: ParamDef) => shortLabel(effect, d.id, d.label);
  const values = defs.filter((x): x is NumberParamDef => x.kind === 'number' && !isRotary(x))
    .map((def, i) => ({ def, r: dialRank(effect, def.id, i) }))
    .sort((a, b) => a.r - b.r)
    .map(({ def }): ParamControl => ({ kind: 'value', def, legend: legend(def), cap: capColour(effect, def.id) }));
  const selectors = defs.filter((x): x is ToggleParamDef => x.kind === 'toggle')
    .map((def): ParamControl => ({ kind: 'selector', def, legend: legend(def) }));
  const rotaries = defs.filter((x): x is NumberParamDef => x.kind === 'number' && isRotary(x))
    .map((def): ParamControl => ({ kind: 'rotary', def, legend: legend(def) }));
  const swatches = defs.filter((x): x is ColorParamDef => x.kind === 'color')
    .map((def): ParamControl => ({ kind: 'swatch', def, legend: legend(def) }));
  return [...selectors, ...values, ...rotaries, ...swatches];
}

/** The numbered parameter sections for an effect: its own sections, then audio response. */
export function paramSections(entry: EffectEntry): ParamSection[] {
  const out: ParamSection[] = entry.sections.map((sec, i) => ({
    id: sec.id, label: sec.label, num: i + 1, role: 'effect',
    controls: controlsOf(entry.params.filter((p) => p.section === sec.id), entry.id),
  }));
  out.push({
    id: APP_SECTIONS.audio.id, label: APP_SECTIONS.audio.label, num: out.length + 1, role: 'audio',
    controls: controlsOf(APP_PARAMS.filter((p) => p.section === 'audio'), entry.id),
  });
  return out;
}

/** Legend text for a control, in the skin's case. */
export const legendCase = (s: string, kase: 'upper' | 'lower') => (kase === 'upper' ? s.toUpperCase() : s.toLowerCase());
