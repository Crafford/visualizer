# Architecture

Static site, no backend. TypeScript + Vite + three.js (WebGL2) + Web Audio. No UI framework.

## Module map

```
src/
  main.ts                 composition root: store, engine, UI prefs, panel, floating keys, transport, stage, shortcuts
  app/
    params.ts             ParamDef schema + helpers (num/color/toggle, n10), APP_PARAMS (audio response),
                          ValuesOf<>, defaults, quantize/format/parse/sanitize, uiScale
    store.ts              ParamStore: app params + the active effect's params, validated against the
                          schema; setEffect() swaps the effect set and keeps each effect's last values
    loop.ts               rAF loop, fixed-timestep accumulator (60 Hz step, per-frame render)
    stage.ts              canvas + WebGLRenderer, ResizeObserver, DPR cap, active Effect, screenshot
  audio/
    types.ts              AudioFrame, SourceKind/SourcePayloads, AudioResponse, TransportState
    AudioEngine.ts        AudioContext, sources, play/pause/seek, getFrame(), events, getSpectrum() (UI meters)
    analysis.ts           FeatureExtractor: bands, rise/fall smoothing, beat detection
  effects/
    types.ts              Effect contract, EffectEntry
    registry.ts           EFFECTS: { id, label, params, sections, create, linked? }[] (Ink, Smoke)
    shared/               Attractors (wandering sources), PingPongState (float MRT ping-pong particle
                          state + sim pass), FullscreenPass, shaders/ (noise + curl + hash,
                          fullscreen triangle + MAX_ATTRACTORS, two-layer blur header)
    ink/                  ink effect: params.ts (INK_PARAMS, sections), InkEffect (TUNE, audio
                          mapping), ParticleSim, InkTrails (density/trail/composite), shaders/
    smoke/                smoke effect: params.ts (SMOKE_PARAMS, mode-linked colours), SmokeEffect
                          (TUNE, audio mapping, splat), SmokeTrails (trail, light/dark composite), shaders/
  ui/
    tokens.css            theme-independent tokens (Geist Mono type scale, geometry, motion)
    themes/te.css         TE light / dark tokens (colours, key bevels, OLED, dial, plate shadows)
    themes.ts             theme registry, per-viewer UI prefs (theme, LT/DRK, panel open) in localStorage
    app.css               component styles (reads tokens only)
    dom.ts                h(), Component, Disposer
    controlStyle.ts       per-param dial legend (COUNT, EMIT...), cap colour, dial order
    Panel.ts              floating panel: header groups + numbered param sections + Output
    Display.ts            header OLED: effect tag, preset, source, spectrum, LVL, BPM, time
    InputSection.ts       CAP / LNK / UPL / MIC keys and their panes
    PresetsSection.ts     preset dropdown, RST, SAVE (naming) / DEL / EXP / IMP
    Transport.ts          floating transport: play key + OLED strip with segmented seek bar
    components/           Key (+ radio key group), Dropdown, Dial, Swatch, Tooltip
  presets/
    types.ts              Preset, PresetStorage, PresetFile, PRESET_SCHEMA
    store.ts              PresetBank: built-in Default per effect (from the schema), user presets in
                          localStorage, JSON export/import with validation, filtered by effect
```

Dependency direction: `ui -> app, audio`; `app/stage -> effects, audio, app/store`;
`effects -> (types only) audio, app/params`. Effects never import UI, store or engine.

## Data flow per frame

```
rAF tick (Loop)
  frame():  audio = engine.getFrame()          // analyser read, smoothing, beat; emits 'level', 'beat'
            params = store.all                 // live read-only view, no copy
  step() x N  (N = accumulated time / 1/60, max 4)
            effect.step({ audio, time, dt: 1/60, params, renderer, size })
  render(): effect.render({ ..., dt: frameDt })
            pending screenshot -> canvas.toBlob (same task, no preserveDrawingBuffer)

UI input -> store.set(id, v) -> sanitize (clamp, snap, hex, toggle value) -> listeners
            -> effect entry linked(id) (e.g. Smoke Mode swaps default colours; not during preset load)
  - controls repaint themselves (store.watch)
  - audio response keys -> engine.configure()
  - effect.onParamChange?(id) for expensive changes (e.g. particleCount realloc)
ResizeObserver(stage container) -> renderer.setSize(w, h, false), dpr = min(devicePixelRatio, 2)
  -> effect.resize(size)
```

Audio is sampled once per display frame and shared by all fixed steps in that frame.

## Effect contract

```ts
interface EffectContext<P = ParamValues> {
  audio: Readonly<AudioFrame>;   // see Audio below
  time: number;                  // simulation clock, seconds
  dt: number;                    // 1/60 in step(), wall-clock delta in render()
  params: Readonly<P>;           // APP_PARAMS + the effect's own params
  renderer: WebGLRenderer;
  size: Readonly<RenderSize>;    // CSS px width/height + applied dpr
}

interface Effect<P = ParamValues> {
  readonly id: string;
  readonly label: string;
  step(ctx: EffectContext<P>): void;      // 0..N times per frame, fixed dt
  render(ctx: EffectContext<P>): void;    // once per frame, to the default framebuffer
  resize(size: Readonly<RenderSize>, renderer: WebGLRenderer): void;
  onParamChange?(id: string, params: Readonly<P>): void;
  dispose(): void;
}
type EffectFactory = (renderer: WebGLRenderer, params: Readonly<ParamValues>) => Effect;

interface EffectEntry {                    // one line in registry.ts
  id: string; label: string;
  params: readonly ParamDef[];             // the effect's own params (APP_PARAMS are added)
  sections: readonly SectionDef[];         // panel sections for them, in order
  create: EffectFactory;
  linked?(id, values): ParamValues | null; // values to apply after a user change
}
```

Rules: the app owns renderer, canvas, audio and params. An effect owns only the GPU
resources it creates and must free them all in `dispose()`. Context objects are reused
between frames: read them, never keep references. A new effect is a folder with a
`params.ts` (its PARAMS and sections) and the effect class, plus one entry in `registry.ts`;
each effect types its params as `AppParams & ValuesOf<typeof ITS_PARAMS>`.

Switching effect (Visualization dropdown, `setEffect(id)` in main.ts): the store saves the
outgoing effect's values and loads the incoming effect's last values (defaults the first
time; app params are untouched), then the stage disposes the old effect and creates the new
one (new trails, so the canvas starts empty), and the panel rebuilds the effect sections.

## Parameter schema

```ts
type SectionId = string;   // app: 'input' | 'audio' | 'output'; effects declare their own

interface NumberParamDef<Id extends string = string> {
  kind: 'number'; id: Id; label: string; section: SectionId;
  min: number; max: number; step: number; default: number;
  defaultMobile?: number; unit?: string; format?: (v: number) => string;
  control?: 'slider' | 'knob';
  display?: { scale: 'norm10'; curve?: 'linear' | 'pow' | 'log'; exponent?: number; pole?: number };
  visibleWhen?: { id: string; min: number };   // e.g. colour 2 only with Sources >= 2
}
interface ColorParamDef<Id extends string = string> {
  kind: 'color'; id: Id; label: string; section: SectionId; default: string; visibleWhen?: ...;
}
interface ToggleParamDef<Id extends string = string, V extends string = string> {
  kind: 'toggle'; id: Id; label: string; section: SectionId;
  options: readonly { value: V; label: string }[]; default: V;   // panel: segmented control
}
type ParamDef<Id extends string = string> = NumberParamDef<Id> | ColorParamDef<Id> | ToggleParamDef<Id>;
```

`APP_PARAMS` (params.ts: bassSens, midSens, highSens, smoothRise, smoothFall, burstSize) and
each effect's `INK_PARAMS` / `SMOKE_PARAMS` are `const` arrays built with the `num(...)`,
`color(...)` and `toggle(...)` helpers, so ids stay literal types; `ValuesOf<typeof X>` gives
the value bag. Adding a parameter is one line in the effect's list; the panel control, store
validation, reset, presets and `ctx.params.<id>` follow automatically. Effects may reuse ids
with the same meaning (Count, Emission, Lifespan, Speed, Turbulence, Swirl, Drag, Sources,
Contrast, Grain); values are kept per effect.

### Panel scale (0..10)

Params with `display: { scale: 'norm10' }` show 0..10 with one decimal on the panel, like a
hardware knob. The store, the effect and presets always hold the real value; only the
controls convert (`uiScale(def)` in params.ts: range, step, text, `toUi`, `fromUi`). Slider,
knob, value field and keyboard all go through it, so the mapping is in one place. Typing
into the value field takes a 0..10 number (clamped); arrows nudge 0.1 (Shift 1.0) from the
shown value; the hover title shows the real value. The real `step` of norm10 params is at
most 1/100 of the range so every 0.1 display step lands on a distinct real value.

Curves (t = display / 10):

| Curve | Real value | Used by |
|-------|-----------|---------|
| linear (default) | `min + (max - min) t` | all norm10 params except Persistence |
| log, pole p | `p + sign * exp(lerp(log abs(min - p), log abs(max - p), t^exponent))` | Persistence (`trailFade`, pole 1) |
| pow | `min + (max - min) t^exponent` | none yet |

Persistence: the trail length goes as 1 / (1 - fade) (6.7 steps at 0.85, 100 at 0.99), so
log(1 - fade) is linear in the display: each 0.1 multiplies the trail length by the same
factor (1.028). The default 0.92 sits at 2.3.

Real units stay for Count (k), Lifespan (s), Speed (x), Sources and the colours.

## Ink effect

Metaphor: drops of ink from a dropper landing on art paper. A drop splatters, then bleeds into
the paper and stops, feathering at the edges. Wetness turns dry card into wet watercolour paper.

1. Particle state in three RGBA32F ping-pong MRT textures, sqrt(count) square, 200k desktop,
   50k mobile (`defaultMobile`):
   - A: pos.xy, vel.xy
   - B: age, life (< 0 = dormant), seed, source index
   - C: bleed centre.xy, bleed reach R, bleed angle (set at birth, see Bleed below)
   Particles start dormant (culled in the draw pass) and return to dormant when age > life or
   they leave the view, so the pool feeds both seep and drops.
2. Simulation pass (fullscreen triangle, `shaders/sim.glsl.ts`), all in simulation seconds
   (dt x `speed`):
   - Seep: each dormant particle wakes with probability `emissionRate * 0.15 * (1 + 2 bass) * dt`
     in a disc (r 0.02) at a random source with a slow outward velocity (0.03).
   - Drop: on a beat, `burstSize * max(bs, 0.25) * 0.15` of all particles respawn at every source:
     a dense disc (r 0.03..0.05 by strength, landing up to 0.1 from the source) with a radial
     launch proportional to the distance from the centre, carrying ~`0.035 * (0.5 + bs)`, plus
     3-7 satellite spatters (20% of the drop's particles, small discs stretched along their
     direction, 0.08-0.25 from the centre, same colour). Life x 1.2. With no beat for 2 s
     (real time), each source drips on its own every 1.4-3.4 s of sim time (strength 0.3-0.65,
     `0.15 * emissionRate` of all particles), so the idle canvas still shows drops.
   - Bleed: the medium velocity is `dir(angle + fibre) * bleedRate * R * f^2`, f = 1 - d / R,
     d = distance from the bleed centre (C.xy), so the bleed slows and stops at R. R is set at
     birth as `d0 * (1 + grow * g * m)`: the landing disc scales up as a whole (an additive
     offset would hollow it into a ring); m varies with angle (low + high frequency noise,
     lobed ragged edge); 8% of particles are fibre tendrils (g 1.4-2.8). The bleed angle is bent
     by a static high-frequency noise field (`feather` 0.7 rad, frequency 45): paper fibres,
     so the bleed front is ragged.
   - Curl noise (two octaves) is added to the medium velocity: `turbulenceStrength * 0.035`
     view half-heights/s x wetness influence x (1 + 1.5 mid).
   - The particle velocity relaxes toward the medium at `6 * (0.25 + drag) * wetRelax` per second,
     which is also what kills a splat launch (dry: ~0.1 s).
   - Sources (`shared/Attractors.ts`, CPU) wander at phase rate 0.4 x `speed` x (1 + bass): a full
     traverse of the central 60% of the view takes 40-60 s.
   All tuning lives in `TUNE` (InkEffect.ts), exposed as `stage.effect.tune` with `?debug`.
3. Splat pass (`shaders/points.glsl.ts`): `gl.LINES`, two vertices per particle, no
   attributes (`gl_VertexID >> 1` indexes the state). Each particle draws the segment it
   travelled in its last step (min 1 device px). Ink per particle is constant
   (per-pixel ink = ink / length). Additive into an RGBA16F density target:
   rgb = ink * absorbance of the particle's source colour (-ln of its sRGB value), a = ink.
   Render-time audio response (real clock, never moves the simulated particles, so ink is moved
   in place, not carried away): kick, shiver, breath (see Audio mapping).
4. Feedback (`InkTrails.ts`, `shaders/trail.glsl.ts`): two RGBA16F layers in one MRT
   ping-pong pair, same rgb/a layout as the density.
   - line: fade `trailFade`, blur `0.6px * pointSize * wetLineBlur`, deposit x `pointSize^0.6`.
   - wash: longer memory (derived from `trailFade` and wetness), blur `trailBlur * wetWashBlur`,
     drift `trailDrift * 2 * wetDrift` px per step outward from the sources (direction blended
     over all sources) with a slow swirl.
   Fade, blur and drift are applied per real-time step (not scaled by `speed`), so the look is
   refresh-rate independent.
5. Composite: coverage from the a channels (line + capped wash x `wetWashGain`, contrast
   S-curve). Ink colour = exp(-K), K = per-layer mean absorbance rgb / a, layers weighted by
   coverage, so overlapping inks mix subtractively. Result = mix(paper, ink colour, coverage) +
   paper texture + grain.

Shared with Smoke (`effects/shared/`): Attractors, PingPongState (ParticleSim maps SimInputs
onto the uniforms and runs it), FullscreenPass, noise/curl/hash GLSL, fullscreen triangle and
the blur header. These were moved, not changed: the Ink shaders are textually identical and
a 10 s fake-clock still matches the pre-M7 build (mean abs diff 0.004 / 255, the same as two
runs of the old build).

Per-source colours: `inkColor1..3` (defaults #000000, #0091FF, #FF0000); the panel shows colour
2 and 3 only when Sources (`emitters`) >= 2 / 3.

### Wetness

`wetness` (0..1, default 0.35) interpolates linearly between the dry and wet columns:

| Quantity | Dry (0) | Wet (1) | Where |
|----------|---------|---------|-------|
| velocity relaxation (drag) | x 2.6 | x 0.8 | sim: splat dies within ~0.1 s when dry, carries further when wet |
| curl influence | x 0.15 | x 0.7 | sim: dry ink stays put, wet ink drifts and swirls |
| bleed reach | x 1 | x 3 | sim: short bleed vs bloom |
| bleed rate (1/s) | 2.2 | 0.7 | sim: wet bleed is slower and keeps going |
| lifespan | x 1 | x 1.6 | sim: wet ink lingers in motion |
| ink per particle | x 1 | x 0.7 | draw: watercolour is more translucent |
| line blur | x 1.3 | x 2.6 | trails: crisp feathered edge vs soft pigment |
| wash blur | x 0.3 | x 1.2 | trails: little halo vs wide soft bloom |
| wash gain | x 0.5 | x 0.65 | composite |
| wash drift | x 0.15 | x 1 | trails |
| wash memory ratio | 0.6 | 0.25 | trails: washFade = 1 - (1 - trailFade) * ratio (lower = longer) |

### Speed

`speed` (0.1..2, default 1) scales the simulation clock: sim dt (motion, bleed, splat decay,
ageing, seep probability, curl field evolution, idle drips) and the source wander. It does not
scale trail fade, blur and drift, or the render-time audio response, which stay real-time so
the ink stays responsive to music at any speed.

### Audio mapping

Bands arrive already multiplied by their sensitivity slider (0 = off, 1 = nominal, 3 = up to
3x; the engine clamps the normalised band to 0..1 before applying sensitivity). `bs` is
`beatStrength` (0.25..1 on the beat frame, decays with tau 250 ms).

| Input | Drives | Mapping |
|-------|--------|---------|
| beat (one frame) | drop | `burstSize * max(bs, 0.25) * 0.15` of all particles respawn as a splat + satellites at every source (above) |
| bs | kick (render only) | positions drawn expanded about the nearest source by `bs * 0.25 * (0.5 + burstSize)`, fading out by d = 0.8 |
| bs | shiver (render only) | curl displacement `bs * 0.005 * (0.5 + burstSize)` at 3.5x the curl frequency, field evolving at 7x real time: all ink, including ink that has bled and stopped, wobbles in place |
| bs | wash swell | wash gain x `(1 + 1.2 bs)`, wash blur x `(1 + 0.8 bs)` (`trailFade` untouched) |
| bass | breathing (render only) | radial scale about the nearest source `1 + 0.015 bass`, fading out by d = 1.2 |
| bass | seep, wander | seep rate x `(1 + 2 bass)`, wander speed x `(1 + bass)` |
| mid | turbulence | curl velocity x `(1 + 1.5 mid)` |
| high | noise scale, ink | `turbulenceScale` x `(1 + high)`, ink per particle x `(1 + 0.5 high)` |

The OLED shows the `engine.bpm` estimate (from the engine's `beat` event) next to the LVL meter.

## Smoke effect

Metaphor: buoyant smoke from 1-3 slowly wandering sources (the ink Attractors, shifted down:
y x 0.7 - 0.32). No drops, bleed or wetness. State: shared PingPongState, 3 attachments:
A pos.xy vel.xy; B age, life (< 0 dormant), seed, source (+ 4 = puff smoke); C ring centre.xy,
roll speed, puff flag. Tuning in `TUNE` (SmokeEffect.ts) and `SMOKE_LOOK` (SmokeTrails.ts).

1. Emission = rings: a dormant particle wakes at `emissionRate * 0.15 * (1 + 2 bass) * dt` on a
   ring (r 0.03) around a random source, moving outward (0.03) + rolling along the ring (0.05 x a
   per-source sign that drifts between left and right over a few seconds) + upward at the
   terminal rise speed, so the stream curls off the source and never pools there.
2. Beat = puff: `burstSize * max(bs, 0.25) * 0.07` of all particles respawn on the ring at every
   source, launched outward at `0.4 * (0.5 + bs)` (lobed around the ring, new shape per puff) +
   rolling 0.1 + half the rise speed; life x 0.8. Puffs keep rolling about the ring centre
   (decay 1.4 s), drag slows the ring, then turbulence breaks it up. No rays, no jets.
3. Motion (sim seconds, x Speed): medium = three-octave curl noise, frequency `turbulenceScale x
   1.2`, `turbulenceStrength x 0.12 x (1 + 1.5 mid)`; the finer octaves ramp in over 2.5 s of
   age (laminar near the source, wisps further up). The curl field itself rises at half the
   terminal rise speed, so eddies travel with the smoke and nothing gets trapped circling one.
   Widening: lateral spread `rise x 0.5` 1/s away from the emission x, above the source.
   Velocity relaxes toward the medium at `2 x (0.25 + drag)`; buoyancy adds `rise x 1.2` up per
   s^2 (terminal ~0.32 view half-heights/s at the defaults). Death at end of life or outside.
4. Splat (`shaders/points.glsl.ts`, copy of ink's): line segments, additive; rgb = ink x the
   source's colour vector (absorbance on light paper, the colour itself in dark mode), a = ink.
   Cooling: ink x (1 - age/life)^1.6, thinning all its life (ink only fades in its last 30%);
   the stream fades in over 1.2 s, puffs at once and x 1.5. Kick, shiver and breath as ink (render only).
5. Trails (`SmokeTrails`): line layer fade 0.82/step, blur `lerp(0.5, 3, softness)` CSS px; wash
   fade 0.975/step, blur `lerp(0.6, 3.5, haze)`, drifting up 0.35 CSS px/step with a slow sway.
   Beat swell on the wash as ink. Mode change clears the trails (the rgb encoding changes).
6. Composite: Light paper = ink's subtractive composite (wash gain `lerp(0.1, 0.8, haze)`, cap
   0.55, contrast S-curve, paper texture). Dark = additive light: per channel
   E = line.rgb + wash.rgb x washGain, light = contrast(1 - exp(-E)),
   result = background + (1 - background) x light. Grain as ink in both.

Mode (`toggle`): switching swaps every colour still at the other mode's default to this
mode's default (light: #2B2B2B #3A4A5A #5A3A3A on #F7F7F5; dark: #E8E8E8 #9FB8D0 #D0A090 on
#0B0B0C); custom colours stay. Presets apply values without this link.

Audio: bass -> emission x (1 + 2 bass) and wander x (1 + bass); mid -> turbulence x (1 + 1.5 mid);
high -> curl frequency x (1 + high), ink x (1 + 0.5 high); beat -> puff, kick, shiver, wash swell.

## Audio

`setSource(kind, payload)` is typed per kind via `SourcePayloads`; `stop()` returns to idle.
Switching source tears the previous one down (stop tracks, disconnect nodes, revoke object
URLs). The AudioContext and a single AnalyserNode (fftSize 2048, smoothingTimeConstant 0)
are created lazily on the first `setSource()` (a user gesture) and resumed on every play/start.

| Source  | Input                                                        | Audible            | Transport          |
|---------|--------------------------------------------------------------|--------------------|--------------------|
| file    | `<audio>` (or `<video>` for video/* so MP4 uses its audio)   | yes, to destination | play/pause, seek   |
| url     | `<audio crossOrigin="anonymous">`                            | yes                | play/pause, seek   |
| mic     | `getUserMedia` with AEC/NS/AGC off -> MediaStreamSource      | no (feedback)      | "Live"             |
| capture | `getDisplayMedia({video, audio})`, video tracks stopped      | no (tab already plays) | "Live"         |

Failure handling: a link that fails to load (no CORS headers, 404, not audio) reports via the
element `error` event; a link that plays pure digital zeros for 2 s (tainted element) reports
"This host blocks cross-origin audio. Try the Capture tab." Streaming hosts (Spotify, YouTube...)
are rejected up front. Capture with no audio track, or outside Chromium desktop, gets its own
message; the audio track's `ended` event (user clicked "Stop sharing", mic unplugged) returns to idle.

```ts
interface AudioFrame {
  bass: number; mid: number; high: number;   // smoothed, 0..1 x sensitivity (0..3)
  level: number;                             // normalised RMS, smoothed
  peak: number;                              // peak-hold of level (0.8 s hold), for meters
  beat: boolean;                             // true for exactly one frame per onset
  beatStrength: number;                      // set on the beat frame, decays (tau 250 ms)
  raw: { bass: number; mid: number; high: number };  // before rise/fall smoothing
  playing: boolean;
  time: number;                              // media time, or seconds since live start
  duration: number;                          // media duration, 0 for live/unknown
}
```

`FeatureExtractor` (analysis.ts), once per display frame while playing:

1. Bands from the real sampleRate: bass 20-150 Hz, mid 150-2000, high 2000-12000. Bin powers
   are averaged linearly and converted to dB above a -100 dBFS floor (a plain mean of dB values
   would bury a narrow tone in a wide band).
2. Per-band adaptive normaliser: running max with a 4 s half-life, floored at 50 dB above the
   floor; the 30 dB window below the max maps to 0..1, so silence stays 0.
3. Sensitivity (`bassSens` etc., applied after the 0..1 clamp so 3 means up to 3x), then asymmetric exponential smoothing with time constants
   `smoothRise` / `smoothFall` (framerate independent). `raw` is the value before this step.
4. Level: time-domain RMS in dBFS through the same kind of normaliser; peak hold 0.8 s, then
   falls 0.6/s.
5. Beats: spectral flux over 20-400 Hz on log(1 + 10|X|) magnitudes. Fire when flux >
   mean + k * std of the last 1.5 s (k = 0.25 + 2.5 * `beatThreshold`, so 0.6 -> 1.75), total
   region energy is rising (rejects note-offs), and 120 ms have passed since the last beat.
   `engine.bpm` is a rolling median-interval tempo estimate (0 when unknown).

When nothing is playing the bands, level and beatStrength decay to 0 with the fall constant.
Add `?debug` to the URL to expose `engine`, `store` and `stage` on `window` in production builds.

## UI

Design source: Figma "Viz", page TE (84:9754), the Teenage Engineering panel in light
(84:11263) and dark (84:15590), its state frames (84:11937 presets, 84:11990 input and
level, 84:12396 components) and the floating controls (84:18473 / 84:18642). Effects and
rendering are untouched by the UI: it only reads and writes the store and the engine.

Layout (`main.ts`, all CSS): the stage is `position: fixed; inset: 0`, so the canvas always
fills the window and the panel never resizes it (the ResizeObserver still sizes the
renderer). Over it float:
- the panel: 340 px card, 24 px from the top-left, `max-height: 100dvh - 48px`, scrolls
  internally (gradient with `background-attachment: local`);
- top-left: the show-panel key (side-panel icon, LED), visible only while the panel is
  hidden; top-right: the fullscreen key (LED lit in fullscreen, icon flips to exit);
- bottom-centre: the transport plate. With the panel open it shifts right when the window
  is too narrow to keep it clear of the panel.

Show / hide: the side-panel icon left of the "VZ-01" title, the floating key, or H (ignored
while typing in a text field, or with modifiers). 180 ms fade + 12 px slide (0 ms with
`prefers-reduced-motion`); the hidden panel is `inert`. Focus moves to the key that brings
it back. Fullscreen targets `document.documentElement`, so the panel stays toggleable.

Themes (`themes.ts`, `themes/te.css`): `<html data-theme="<theme>-<light|dark>">`. Every
colour, gradient and shadow is a token from the design; components read tokens only. The
UI row in the header is a theme dropdown (TEENAGE ENGINEERING is the only entry; a theme is
one CSS file with the same tokens plus one `THEMES` entry) and LT / DRK keys. This is UI
chrome only, the visualizer's own colours are params. Theme, brightness and panel open
state persist per viewer in `localStorage['visualizer.ui.v1']` (guarded; defaults on
failure), applied before the first render.

Panel, top to bottom:
- Title row: side-panel icon, VZ-01, version.
- OLED (`Display.ts`): effect tag (INK / SMOKE), preset (P01 DEFAULT), source title (NO FILE,
  FILE, LINK, MIC, TAB AUDIO) and hint (file name, host, device), a 52-bar spectrum
  (log-spaced 40 Hz..14 kHz from `engine.getSpectrum()`, a blue marker bar every 11th, orange
  above 86% = peaking; a faint idle comb when nothing plays), the LVL meter (16 segments,
  top 3 hot, a peak-hold segment), the tempo estimate + BPM and the elapsed time in green.
  Updated from the engine's per-frame `level` event; no extra rAF loop.
- UI: theme dropdown + LT / DRK.
- Input: CAP / LNK / UPL / MIC radio keys with LEDs, then the source's pane: Start/Stop
  capture or microphone (status inline in orange while on, hint below while off), OLED link
  field + LOAD, CHOOSE FILE + file name. Errors go to a status line. A file dropped anywhere
  loads and selects UPL; a source started elsewhere selects its key.
- Visualization: INK / SMOKE dropdown (replaces the header segmented control).
- Presets (see Presets).
- Parameter sections, numbered across the active effect's sections and Audio response
  (Ink: 01 PARTICLES, 02 TRAILS, 03 LOOK, 04 AUDIO RESPONSE; Smoke: 01 PLUME, 02 LOOK,
  03 AUDIO RESPONSE): number tag, title, rule. Built from the schema by `fillControls`:
  toggles as LED keys (Smoke MODE: LIGHT / DARK) first, then every number as a dial in a
  grid (4 columns when the count is a multiple of 4, else 3), small integer params (Sources
  1..3) as radio keys with the LED outside, then colours as swatch keys (legend + hex; click
  opens the native picker). `controlStyle.ts` holds the short legends, cap colours (orange /
  black / grey per the design for Ink; Smoke by analogy: Count and Density orange, motion
  black, the softening dials grey) and the Ink Look order (INK, CONTRAST, SIZE, GRAIN).
- Output: REC CLIP (disabled, "Coming soon" tooltip) and SCREENSHOT (primary key).

Components:
- Key: 30 px bevelled key; hover wash, pressed (sunk, 1 px down, inner shadow), on (orange
  legend + lit LED via `aria-checked` / `aria-pressed`), disabled via `aria-disabled` (45%,
  still shows its tooltip). Primary: orange (light) / light grey (dark).
  `createKeyGroup`: radio group with roving tabindex and arrow keys.
- Dropdown: select-only combobox (key + chevron) with an OLED listbox; selected item orange
  with a dot; Up/Down/Home/End, Enter/Space, Escape/Tab; closes on outside pointer.
- Dial: 58 px encoder: 11-dot scale over 270 degrees (min, centre and max dots larger) lit
  up to the value, sunk well, cap, pointer, legend, value chip (same text as before:
  0..10 for norm10 params, 350K, 5.5S, 1.05X). Vertical drag (200 px per sweep, Shift = 5x
  finer), wheel (one step per notch), arrow keys / PageUp / PageDown / Home / End on the
  visually hidden native range input (Shift = x10), double-click resets, click the chip to
  type (Enter commits, Escape cancels; "200k" works). Hover / turning lifts the cap 1 px.
- Swatch, Tooltip (one OLED bubble for every `[data-tip]`, on hover after 450 ms and on
  keyboard focus; the text is also `aria-description`).

Transport (`Transport.ts`): play / pause key (primary), OLED strip: state triangle (orange
while playing), elapsed, 36 cells (played cells lit, the playhead cell orange and taller;
click or drag to seek, arrow keys +-5 s, Home / End; `role="slider"`), total. Live sources
show LIVE (orange), hide the total and turn the cells into a level bar. No volume control.

Keyboard: Space plays / pauses unless focus is in a control; H toggles the panel.

## Presets

`PresetBank` (presets/store.ts). Each effect has a built-in "Default" generated from its
schema (`builtin:default:<effect>`, env-aware). User presets live in localStorage under
`visualizer.presets.v1` as `{ schema: 1, presets: Preset[] }`, each preset
`{ version, id, name, effect, params, createdAt }` with `params` as REAL values keyed by param
id: the app params plus that effect's params. The shape did not change in M7, so the schema
stays 1; a stored or imported preset without `effect` is an Ink preset (all M6 presets were),
and stored presets of unknown effects are kept but not shown. Loading resolves a preset over the defaults: unknown ids are ignored, missing or
invalid values come from the defaults, and the store clamps and snaps. Save overwrites a
user preset of the same name; "Default" is reserved. Storage failures fall back to memory.

Panel: dropdown "P01 · DEFAULT" then the active effect's user presets numbered P02... in list
order (the selection is remembered per effect for the session; the OLED shows it), RST
(reload the selected preset), SAVE (the row becomes an OLED name field showing the number
the preset will get, an orange block cursor, SAVE / CNCL; Enter / Escape), DEL (user presets
only, inline confirm), EXP (the selected preset as `preset-<name>.json`,
`{ format: 'visualizer/presets', schema: 1, presets: [...] }`) and IMP (validates the format
and values, adds every valid preset with a de-duplicated name, then selects and loads the
first, switching effect when it belongs to another one). A status line with a green LED
(orange on error) reports the result. Names are unique per effect. The page always starts
on Ink with Default.

## Output

Screenshot: the next rendered frame is read with `canvas.toBlob` in the same task as the
draw (no preserveDrawingBuffer), at the drawing-buffer size (CSS size x dpr, dpr capped at
2), composited on the paper colour; saved as `<effect>-YYYYMMDD-HHMMSS.png` (local time).
Fullscreen targets the whole document, so the panel, floating keys and transport stay (the
panel can still be hidden with H); the ResizeObserver reallocates the trail targets (cleared).

## Milestones

M0/M1 architecture, scaffold, panel shell. M2 GPU ink effect, mic/link/capture.
M3-M5b ink effect, trails, audio response. M6 0..10 panel scale, presets (localStorage +
JSON file), output checks, "Visualizer" title. M7 effect selector, per-effect params and presets,
shared effect infrastructure, Smoke effect (light paper / dark). M8-M9 Smoke rebuilds.
M10 TE UI: full-window canvas, floating panel / keys / transport, light and dark UI themes,
dials, OLED display. Next: performance tiers, mobile sheet, REC CLIP.
