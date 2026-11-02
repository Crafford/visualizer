import {
  BLEND_OPTIONS, N10, color, kilo, n10, num, secs, times, toggle,
  type AppParams, type ParamDef, type SectionDef, type ValuesOf,
} from '../../app/params';

export const SMOKE_SECTIONS: readonly SectionDef[] = [
  { id: 'plume', label: 'Plume' },
  { id: 'look', label: 'Look' },
];

const SOURCES_2 = { visibleWhen: { id: 'emitters', min: 2 } };
const SOURCES_3 = { visibleWhen: { id: 'emitters', min: 3 } };

// Ranges and defaults are real units. Params with `display` show 0..10 on the panel.
// Shared meanings with Ink: Count, Emission, Lifespan, Speed, Turbulence, Swirl, Drag, Sources,
// Contrast, Grain. Smoke defaults to larger, slower curls (lower Swirl) and a longer life.
//            id                    label           section  min    max     step    default
export const SMOKE_PARAMS = [
  num('particleCount',      'Count',        'plume', 10000, 500000, 10000, 250000, { format: kilo, defaultMobile: 50000 }),
  num('emissionRate',       'Emission',     'plume', 0,     1,      0.01,  0.5,    n10()),
  num('lifespan',           'Lifespan',     'plume', 1,     15,     0.1,   9,      { format: secs(1) }),
  num('speed',              'Speed',        'plume', 0.1,   2,      0.05,  1,      { format: times }),
  num('rise',               'Rise',         'plume', 0,     1,      0.01,  0.4,    n10()),
  num('turbulenceStrength', 'Turbulence',   'plume', 0,     3,      0.01,  1.2,    n10()),
  num('turbulenceScale',    'Swirl',        'plume', 0.2,   4,      0.01,  0.58,   n10()),
  num('drag',               'Drag',         'plume', 0,     1,      0.01,  0.5,    n10()),
  num('emitters',           'Sources',      'plume', 1,     3,      1,     3),
  toggle('blend',           'Blend mode',   'look',  BLEND_OPTIONS, 'multiply'),
  num('density',            'Density',      'look',  0.005, 0.4,    0.001, 0.1,    n10()),
  num('softness',           'Softness',     'look',  0,     1,      0.01,  0.5,    n10()),
  num('haze',               'Haze',         'look',  0,     1,      0.01,  0.5,    n10()),
  color('smokeColor1',      'Smoke colour 1', 'look', '#00BBFF'),
  color('smokeColor2',      'Smoke colour 2', 'look', '#EC008C', SOURCES_2),
  color('smokeColor3',      'Smoke colour 3', 'look', '#FFF200', SOURCES_3),
  color('background',       'Background',   'look',  '#F7F7F5'),
  num('contrast',           'Contrast',     'look',  0.5,   3,      0.01,  1.25,   { control: 'knob', display: N10 }),
  num('grain',              'Grain',        'look',  0,     1,      0.01,  0.1,    n10()),
] as const satisfies readonly ParamDef[];

export type SmokeParams = AppParams & ValuesOf<typeof SMOKE_PARAMS>;

/**
 * Presets saved before M11 stored Smoke's blend as `mode: 'light' | 'dark'`. Light was the
 * subtractive composite (now Multiply), dark the additive one (now Screen).
 */
export const LEGACY_SMOKE_MODE: Record<string, 'multiply' | 'screen'> = { light: 'multiply', dark: 'screen' };

/** Old Smoke preset params -> current ids (`mode` -> `blend`). */
export function migrateSmokeParams(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!('mode' in raw) || 'blend' in raw) return { ...raw };
  const { mode, ...rest } = raw;
  const blend = typeof mode === 'string' ? LEGACY_SMOKE_MODE[mode] : undefined;
  return blend ? { ...rest, blend } : rest;
}
