// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
/**
 * Panel presentation of params that the schema does not carry: the short uppercase legend
 * printed under a dial or swatch, and the dial cap colour (TE design 84:11263).
 * Keyed by "<effect>:<id>" first, then by id. Anything missing falls back to the label
 * uppercased and a black cap, so a new param still renders.
 */
export type CapColour = 'orange' | 'black' | 'grey';

interface Style { short?: string; cap?: CapColour; /** Position among the section's dials when it differs from the schema order. */ rank?: number }

const BY_ID: Record<string, Style> = {
  // Shared meanings (Ink and Smoke)
  particleCount: { short: 'COUNT', cap: 'orange' },
  emissionRate: { short: 'EMIT', cap: 'black' },
  lifespan: { short: 'LIFE', cap: 'black' },
  speed: { short: 'SPEED', cap: 'black' },
  turbulenceStrength: { short: 'TURB', cap: 'black' },
  turbulenceScale: { short: 'SWIRL', cap: 'black' },
  drag: { short: 'DRAG', cap: 'black' },
  emitters: { short: 'SOURCES' },
  blend: { short: 'BLEND MODE' },
  contrast: { short: 'CONTRAST', cap: 'grey' },
  grain: { short: 'GRAIN', cap: 'grey' },
  // App: audio response (design: three black, two grey, Surge orange)
  bassSens: { short: 'BASS', cap: 'black' },
  midSens: { short: 'MID', cap: 'black' },
  highSens: { short: 'HIGH', cap: 'black' },
  smoothRise: { short: 'ATTACK', cap: 'grey' },
  smoothFall: { short: 'RELEASE', cap: 'grey' },
  burstSize: { short: 'SURGE', cap: 'orange' },
};

const BY_EFFECT: Record<string, Style> = {
  // Ink, as designed
  'ink:wetness': { short: 'WET', cap: 'black' },
  'ink:trailFade': { short: 'PERSIST', cap: 'grey' },
  'ink:trailBlur': { short: 'BLUR', cap: 'grey' },
  'ink:trailDrift': { short: 'DRIFT', cap: 'grey' },
  'ink:pointOpacity': { short: 'INK', cap: 'orange', rank: 0 },
  'ink:contrast': { rank: 1 },
  'ink:pointSize': { short: 'SIZE', cap: 'grey', rank: 2 },
  'ink:grain': { rank: 3 },
  'ink:inkColor1': { short: 'INK 1' },
  'ink:inkColor2': { short: 'INK 2' },
  'ink:inkColor3': { short: 'INK 3' },
  'ink:paperColor': { short: 'PAPER' },
  // Smoke, by analogy: Plume = Particles (Count orange, motion black), Look = Look
  // (Density plays Ink's role: orange; the softening dials grey like Trails).
  'smoke:rise': { short: 'RISE', cap: 'black' },
  'smoke:density': { short: 'DENSITY', cap: 'orange' },
  'smoke:softness': { short: 'SOFT', cap: 'grey' },
  'smoke:haze': { short: 'HAZE', cap: 'grey' },
  'smoke:smokeColor1': { short: 'SMOKE 1' },
  'smoke:smokeColor2': { short: 'SMOKE 2' },
  'smoke:smokeColor3': { short: 'SMOKE 3' },
  'smoke:background': { short: 'BG' },
};

const style = (effect: string, id: string): Style => ({ ...BY_ID[id], ...BY_EFFECT[`${effect}:${id}`] });

export const shortLabel = (effect: string, id: string, label: string): string =>
  style(effect, id).short ?? label.toUpperCase();

export const capColour = (effect: string, id: string): CapColour => style(effect, id).cap ?? 'black';

/** Dial order within a section: the design's rank when given, else the schema order. */
export const dialRank = (effect: string, id: string, index: number): number => style(effect, id).rank ?? index;
