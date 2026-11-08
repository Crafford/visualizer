# Architecture

Static site, no backend. TypeScript + Vite + three.js (WebGL2) + Web Audio. No UI framework.

## Module map

```
src/
  main.ts                 composition root: store, engine, listen controller, UI prefs, skin host (mounts
                          the active skin's panel, re-mounts on a skin switch), floating keys, LIVE strip,
                          stage, shortcuts (H, Space, Escape), input modality (focus rings), canvas mode
  app/
    canvasMode.ts         UI mode -> canvas: CIELAB lightness mirror of the background, Blend mode per mode
    params.ts             ParamDef schema + helpers (num/color/toggle, n10), APP_PARAMS (audio response),
                          ValuesOf<>, defaults, quantize/format/parse/sanitize, uiScale
    store.ts              ParamStore: app params + the active effect's params, validated against the
                          schema; setEffect() swaps the effect set and keeps each effect's last values
    loop.ts               rAF loop, fixed-timestep accumulator (60 Hz step, per-frame render)
    stage.ts              canvas + WebGLRenderer, ResizeObserver, DPR cap, active Effect, screenshot
  audio/
    types.ts              AudioFrame, SourceKind ('system' | 'mic'), ListenState, AudioResponse,
                          AudioSourceError + SourceErrorCode / SOURCE_ERRORS
    AudioEngine.ts        AudioContext, listen(kind) / stop(), getFrame(), events, getSpectrum() (UI meters)
    analysis.ts           FeatureExtractor: bands, rise/fall smoothing, beat detection
  effects/
    types.ts              Effect contract, EffectEntry
    registry.ts           EFFECTS: { id, label, params, sections, create, background?, migrate? }[] (Ink, Smoke)
    shared/               Attractors (wandering sources), PingPongState (float MRT ping-pong particle
                          state + sim pass), FullscreenPass, shaders/ (noise + curl + hash,
                          fullscreen triangle + MAX_ATTRACTORS, two-layer blur header)
    ink/                  ink effect: params.ts (INK_PARAMS, sections), InkEffect (TUNE, audio
                          mapping), ParticleSim, InkTrails (density/trail/composite), shaders/
    smoke/                smoke effect: params.ts (SMOKE_PARAMS, legacy `mode` preset migration), SmokeEffect
                          (TUNE, audio mapping, splat), SmokeTrails (trail, Multiply/Screen composite), shaders/
  ui/
    info.ts               the info module shared by the skins: content (about, note, help; lower case)
                          and behaviour (attachInfo: docking, info key, close, Escape, focus)
    tokens.css            skin-independent tokens (TE type scale, geometry, motion, --edge)
    shell.css / shell.ts  the shared panel card (scroll, overlay thumb, edge fades, minimise morph via
                          PanelMorph.ts), floating keys, LIVE strip, tooltip, spectrum bars; crossFade()
    themes.ts             THEMES (skin ids + dropdown labels), per-viewer prefs (skin, panel open; LT / DRK
                          per visit from the system scheme) in localStorage; <html data-theme data-skin>
    listen.ts             ListenController: the input model shared by every skin (switch + listen key)
    model.ts              the abstract panel model: sections and control kinds, paramSections(entry)
    PresetsSection.ts     preset behaviour (dropdown, reset, save naming, delete, export / import); each
                          skin passes a PresetsLook (keys, field, rows, status, messages)
    LiveStrip.ts          LIVE + spectrum plate while listening with the panel hidden
    Spectrum.ts           52 log-spaced spectrum bars (TE OLED and the LIVE strip)
    dom.ts, icons.ts, controlStyle.ts (short legends, TE cap colours, dial order)
    components/           Key (+ radio key group), Dropdown (skinnable via DropdownLook), Dial, Swatch,
                          SlideSwitch (system / mic, shared), Tooltip
    skins/
      types.ts            Skin, SkinContext, SkinPanel, PanelActions
      index.ts            SKINS registry: te (default), braun
      te/                 te-tokens.css, te.css, TePanel.ts, TeDisplay.ts (OLED), TeInput.ts, TeInfo.ts
      braun/              braun-tokens.css (generated 1:1 from the Figma variables + effect styles),
                          braun.css, BraunPanel.ts, controls.ts (faders, dials, A1 rotary, keys, swatch,
                          VFD dropdown look), Vfd.ts (display, seven-segment BPM, clip meter),
                          InfoModule.ts (markup)
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
LT / DRK -> prefs -> main.ts applyCanvasMode -> store.patchEffect(each effect, canvasPatch(...))
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
  background?: string;                     // id of the colour the canvas is painted on (UI mode mirror)
  migrate?(params): Record<string, unknown>; // rewrite params of presets from older versions
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

Blend mode (`blend` toggle in Render, formerly Look, M11): Multiply is the composite above, unchanged (a 10 s
fake-clock still is pixel-identical to M10: mean abs diff 0, max 0). Screen is additive light
for dark paper: the splat carries ink x the source's sRGB colour instead of its absorbance
(InkEffect.updateAbsorb), so rgb / a is the mean ink colour of a layer; coverage is exactly
Multiply's (same exposure, wash cap, glazes, contrast S-curve), the colour is the coverage-
weighted mean of the two layers, and result = paper + (1 - paper) x colour x coverage, plus the
same paper texture and grain. An ink at full coverage shows exactly its swatch colour (a per-
channel tone curve was tried first and pushed #00BBFF to cyan and #EC008C to pink). Changing
the blend clears the trails (the density encoding changes).

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
   source's colour vector (absorbance for Multiply, the colour itself for Screen), a = ink.
   Cooling: ink x (1 - age/life)^1.6, thinning all its life (ink only fades in its last 30%);
   the stream fades in over 1.2 s, puffs at once and x 1.5. Kick, shiver and breath as ink (render only).
5. Trails (`SmokeTrails`): line layer fade 0.82/step, blur `lerp(0.5, 3, softness)` CSS px; wash
   fade 0.975/step, blur `lerp(0.6, 3.5, haze)`, drifting up 0.35 CSS px/step with a slow sway.
   Beat swell on the wash as ink. A blend mode change clears the trails (the rgb encoding changes).
6. Composite: Blend mode Multiply = ink's subtractive composite (wash gain `lerp(0.1, 0.8, haze)`,
   cap 0.55, contrast S-curve, paper texture). Screen = additive light: per channel
   E = line.rgb + wash.rgb x washGain, light = contrast(1 - exp(-E)),
   result = background + (1 - background) x light. Grain as ink in both.

Blend mode (`blend`: `multiply` | `screen`, M11) replaces the old Mode toggle (`mode`: light |
dark) and its default-colour swapping, which is gone: colours never change with the blend.
Presets saved with `mode` load through `migrateSmokeParams` (light -> multiply, dark -> screen).
The blend sets the density encoding (absorbance vs colour), so changing it clears the trails.

Audio: bass -> emission x (1 + 2 bass) and wander x (1 + bass); mid -> turbulence x (1 + 1.5 mid);
high -> curl frequency x (1 + high), ink x (1 + 0.5 high); beat -> puff, kick, shiver, wash swell.

## Audio

Sources (M15): system audio and the microphone only. Link, upload, drag-and-drop and the file
player (play / pause, seek, time) are gone, with their engine paths.

`listen(kind)` starts a source and replaces the current one (handover); `stop()` returns to
idle and also cancels a pending start (a generation counter makes an older prompt resolve
without effect). The AudioContext and a single AnalyserNode (fftSize 2048,
smoothingTimeConstant 0) are created lazily on the first `listen()` (a user gesture). Both
sources feed the analyser only, never the destination.

| Source | Input | Label |
|--------|-------|-------|
| system | `getDisplayMedia({ video: { displaySurface: 'monitor', width 160, height 90, frameRate 1 }, audio: true, systemAudio: 'include', monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })`; video tracks stopped at once | `describeSurface(videoTrack)`: monitor -> entire screen, window -> its title (else app window), browser -> the tab title (else chrome tab); Chrome's id labels are ignored |
| mic | `getUserMedia` with AEC / NS / AGC off | the device label |

`displaySurface: 'monitor'` pre-selects Chrome's Entire Screen pane, where "Share system audio"
lives. Failures are `AudioSourceError(code)`: `cancelled` (dialog dismissed), `noAudio` (a
share without an audio track), `systemUnsupported`, `micDenied`, `micMissing`,
`micUnsupported`; `SOURCE_ERRORS` holds the default (lower-case) wording and skins set the
case. `AudioEngine.systemSupported` feature-detects getDisplayMedia and treats Safari, Firefox
and touch-only devices as unsupported. The audio track's `ended` event ("Stop sharing", mic
unplugged) returns to idle.

### Input model (ui/listen.ts)

Shared by every skin: a two-position source switch (system / mic, default system where
supported, remembered per browser in `visualizer.source.v1`) and a latching listen key.

- The switch only selects. Listen (and Space, when focus is not in a control) starts / stops
  the selected source.
- Flipping the switch while listening hands over to the other source.
- Cancelling the share dialog stops listening (LED off), no error. A share without audio stops
  listening and shows `noAudio` in the display.
- Unsupported: the switch is locked to mic and the system end dimmed; the display (TE) / the
  switch tooltip says "system audio needs chrome or edge on a computer".

The switch (`components/SlideSwitch.ts`, M16): a legend click selects its side; a press on the
switch body without travel toggles; a drag (mouse, pen, touch) moves the slider live and snaps
to the nearer end on release; arrows / Home / End select, Space / Enter flip.

`ListenView`: `{ selected, systemSupported, latched, source, label, error }`.

```ts
interface AudioFrame {
  bass: number; mid: number; high: number;   // smoothed, 0..1 x sensitivity (0..3)
  level: number;                             // normalised RMS, smoothed
  peak: number;                              // peak-hold of level (0.8 s hold), for meters
  beat: boolean;                             // true for exactly one frame per onset
  beatStrength: number;                      // set on the beat frame, decays (tau 250 ms)
  raw: { bass: number; mid: number; high: number };  // before rise/fall smoothing
  playing: boolean;                          // listening
  time: number;                              // seconds since listening started
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

When nothing is listening the bands, level and beatStrength decay to 0 with the fall constant.
Add `?debug` to the URL to expose `engine`, `store` and `stage` on `window` in production builds.

## UI

Design source: Figma "Viz" (4r1GeX617Dw5sO6bGEsAgM). TE skin: page TE (84:9754), the panel in
light (84:11263) and dark (137:6), its state frames (84:11937 presets, 84:11990 input and
level, 84:12396 components, 141:3 focus) and the floating controls (84:18411). Braun skin:
page Braun (168:2), library page "Braun — Components" (250:2). Effects and rendering are
untouched by the UI: it only reads and writes the store, the engine and the listen controller.

### Skins (M15)

A skin decides structure, not just colours. `skins/index.ts` registers them; each provides
tokens CSS (light / dark), its component CSS, fonts (`loadFonts`, optional) and
`createPanel(ctx: SkinContext): SkinPanel`. The context holds the store, engine, presets,
effects, prefs, the listen controller and the panel actions; the panel returns its element,
`setOpen`, the hide button / show key (focus targets), `openRight` (for the LIVE strip) and an
optional `escape()` (close an overlay). Skins render; they own no app state.

The abstract panel model (`model.ts`): sections input, ui, visualization, presets, the
effect's sections (from the param schema), audio response, output; control kinds source
switch, listen key, selector key group (hardware: holds a state, latching, LED), action key
(software: a momentary command), dropdown, value, rotary (discrete choices), swatch, display,
LIVE strip, floating plates, info key. Selector vs action is chosen by function in every
skin. `paramSections(entry)` turns the schema into numbered sections of `value`, `rotary`,
`selector` and `swatch` controls with their legends; each skin maps them:

| Kind | TE | Braun |
|------|----|-------|
| value | dial (grid of 3 or 4) | tall fader in section 1 (particles / plume), short fader in audio response, Atelier dial elsewhere |
| rotary | radio keys, LED outside | A1 rotary selector |
| selector | LED keys | capsule selector keys |
| swatch | swatch key (hex as its tooltip, M16) | capsule well |

Switching skin (UI theme dropdown, "TEENAGE ENG." / "braun" in each skin's case): main.ts
disposes the panel and mounts the new skin's panel in place. Values, LT / DRK, the panel open
state, the preset selection (module-level in PresetsSection.ts) and the listening source are
app state and survive; the skin persists in prefs (`theme`). index.html applies the stored
skin before the first paint (`data-theme="<skin>-<mode>"`, `data-skin`) and starts the
Braun fonts early when it is stored; otherwise they load on the first switch.

Shared by every skin (shell.ts / shell.css / main.ts): the card and its scroll, the minimise
morph into the show key (the plate's look comes from the skin's `--float-key-*` tokens), 20 px
edges, keyboard-only focus rings (`data-input`), ~180 ms transitions and reduced motion, wake
lock in fullscreen, canvas mirroring + blend mode on LT / DRK, LIVE strip rules, tooltips, H,
Space (listen), Escape (skin overlay).

### Braun skin

Tokens: `braun-tokens.css` is generated 1:1 from the Figma "skin" variable collection (modes
light / dark; `case/deck panel` -> `--case-deck-panel`) and its effect styles
(`--fx-style-<name>`, colours bound to the `fx/*` variables) plus glows (`--glow-*`). Unbound
design values (knob, key-face and dome gradient stops) are written in braun.css as in the
components. Fonts: Host Grotesk 400 (500 for VZ1) and Share Tech Mono (the VFD), Google Fonts
with preconnect and `display=swap`, loaded only when the skin is used.

Panel (Panel 258:2624): 3 px case, deck at 90% (light) / 85% (dark), case shadow; header with
the hide-panel icon key and the VZ1 model name (the info key: on hover / focus / open a
recessed well grows to the left, the name slides left, the info icon fades in, 200 ms
ease-out); the VFD (source LEDs, ink chip + preset, BPM in slanted seven-segment SVG digits
with ghost 8s and glow, status line and surface / device, a 12-segment clip meter from the
level); input (slide switch + green power listen key with LED); ui (VFD dropdown + lt / drk
selector keys); visualization; presets (VFD dropdown, round action keys reset / save / delete /
import / export, LED list, naming field with a green caret, saved window); the effect sections
and audio response (see the table); output (record clip disabled, screenshot, left aligned).
Faders and dials: role="slider" with value text, track drag (faders) or vertical drag (dials),
arrows (0.1, Shift x10), Page / Home / End, double-click resets, touch, no wheel. The A1
selector turns its pointer to the detents (31 / 76 / 120 degrees), click a number or step with
a click on the knob, drag around it, arrows.

Info module (230:640): a second case with a VFD window (VZ1 and the version from
package.json), about (maker, jaco.studio, x.com/jcrafford, licence with the source link), the
note, help. Dropdown carets sit 12 px from the right edge in every VFD dropdown (257:1369).
Section rules (`rule/section`) have the same colour in light and dark (M16).

Info module, both skins (`ui/info.ts`, M16): the content is shared (lower case; TE sets upper
case in CSS; the audio response help names the skin's controls, faders / dials). `attachInfo`
mounts the skin's markup in the shell, docked 20 px right of the panel (`.info-module` in
shell.css; over the panel below 760 px wide). The model name toggles it (aria-expanded,
`is-open`); the close key and Escape close it (focus returns to the model name); hiding the
panel closes it. Links open in a new tab (`rel="noopener"`).

Layout (`main.ts`, all CSS): the stage is `position: fixed; inset: 0`, so the canvas always
fills the window and the panel never resizes it (the ResizeObserver still sizes the
renderer). Over it float:
- the panel: 340 px card, 20 px (--edge) from the top-left, `max-height: 100dvh - 40px`; its content
  scrolls inside it (`.panel-scroll`, see Scrolling);
- top-left: the show-panel key (the minimised panel), visible only while the panel is
  hidden; top-right: the fullscreen key (icon flips to exit);
- bottom-centre: the LIVE strip (see LIVE strip). It is centred in the window, or in the
  space right of the open panel when centring would overlap it.

Show / hide: the side-panel icon left of the "VZ-01" title, the floating key, or H (ignored
while typing in a text field, or with modifiers). 180 ms fade + 12 px slide (0 ms with
`prefers-reduced-motion`); the hidden panel is `inert`. Focus moves to the key that brings
it back. Fullscreen targets `document.documentElement`, so the panel stays toggleable.

Skins and modes (`themes.ts`, `skins/*/…-tokens.css`): `<html data-theme="<skin>-<light|dark>"
data-skin="<skin>">`. Every colour, gradient and shadow is a token from the design; components
read tokens only. The UI row in the header is the skin dropdown and LT / DRK keys. This is UI
chrome only, the visualizer's own colours are params. Theme, brightness and panel open
state persist per viewer in `localStorage['visualizer.ui.v1']` (guarded; defaults on
failure), applied before the first render.

Scrolling (M11): the card is static, `.panel-scroll` inside it scrolls (wheel, trackpad,
touch, keyboard as before). The native scroll bar is hidden (`scrollbar-width: none`); an
overlay thumb (4 px, rounded, `--scroll-thumb` = the theme's muted colour, transparent track)
follows scrollTop, can be dragged, and fades in over 200 ms while the pointer is over the
panel (on touch screens: while scrolling), fading out on leave. Soft 28 px fade masks at the
top and bottom of the scrolling area appear only when there is more content in that
direction (`.can-up` / `.can-down`, animated through registered `--fade-top` / `--fade-bottom`).

Type (M11): every size is the design's + 1 px (tokens.css: 13 / 21 / 11 / 10 / 9 px), line
heights + 1 px; RST is 42 px wide and the theme key shows TEENAGE ENG. (the list shows the
full name) so nothing truncates.

Dark theme (M11): the deck is #393734 (warm dark grey) instead of the design's near-black;
keys (#4A4845 -> #3D3B38), wells (#1B1A18), chips (#2B2927), caps, rules, borders, plates and
shadows are derived from it on the same warm hue. Text is #F2F2EE at 82% (secondary 55%,
dial ticks and pointers likewise). The OLED internals are unchanged.

Focus (M11): rings are for keyboard users only. main.ts sets `<html data-input>` to `pointer`
on every pointerdown (mouse, pen, touch) and to `keyboard` on navigation keys (Tab, arrows,
Page/Home/End, Enter, Escape, Space); with `pointer`, no `:focus-visible` style shows, so the
programmatic focus of a dial's range input on tap or drag never paints the orange ring. On
coarse pointers the dial ring never shows.

Motion (M11): hover, on, LED, swatch, dropdown, dial-sheen and scroll-thumb changes ease over
`--t-ui` (180 ms, `cubic-bezier(0.2, 0, 0, 1)`); presses take `--t-press` (80 ms) and release
over `--t-ui`. Key and floating-key hover / press shades are a `::before` overlay (a
background-color transitions, a gradient does not). Dials never move: hover and turning only
shade the cap (sheen overlay + deeper shadow). LT / DRK switches run inside a View Transition
(a 180 ms cross-fade of the page, canvas included) where supported. `prefers-reduced-motion`
sets every duration to 0 and skips the cross-fade.

Canvas follows the UI mode (M11, `app/canvasMode.ts`, applied in main.ts): on a LT / DRK change,
for every effect (the active one through the store, the others in their kept values, so
switching effect stays consistent): Blend mode -> Screen for DRK, Multiply for LT; and the
background (Ink `paperColor`, Smoke `background`, `EffectEntry.background`) is mirrored when its
CIELAB L* is above 50 (to DRK) or below 50 (to LT): same LCh hue and chroma, L*' = 100 - L*,
chroma bisected down until the colour fits sRGB. A mirrored colour remembers its source, so
LT -> DRK -> LT returns the exact hex. Examples: #F7F7F5 (L* 97.2) -> #0A0A08 (2.7);
#000000 -> #FFFFFF; #1E3A5F -> #A6BCE9; #00BBFF -> #004966 (chroma clamped). L* rather than
OKLab L because L*'s linear toe keeps mirrored darks distinguishable (OKLab sends #F7F7F5 to
#000000 and drifts on the way back). A page opened in DRK applies it once at start. Changing a
colour or the blend by hand never changes the UI mode; presets loaded later keep their colours.

TE panel, top to bottom:
- Title row: side-panel icon, VZ-01 (the info key, M16, Figma TE 290:2: on hover / keyboard
  focus / open a recessed well grows right behind the name and the info icon fades in, orange
  while open, 200 ms ease-out; the name never moves), version.
- Info module (`TeInfo.ts`, 290:6 light / 290:148 dark, over canvas 291:101): a TE panel card
  with INFO and CLOSE, an OLED window (INFO tag, version, VZ-01, tagline), ABOUT and HELP as
  TE sections; legends and text upper case.
- OLED (`skins/te/TeDisplay.ts`, M15 84:11269): effect tag (INK / SMOKE), preset (P01
  DEFAULT); the main row: source title (SYSTEM AUDIO / MIC) over its state (LISTENING in orange
  · the surface or device; an error in orange; idle: empty, or the unsupported reason, dim) and the big BPM (--- until a
  tempo); a 52-bar spectrum (`Spectrum.ts`) (log-spaced 40 Hz..14 kHz, a blue marker bar every
  11th, orange above 86% = peaking; a faint idle comb when idle) and the LVL meter (16
  segments, top 3 hot, a peak-hold segment). No track time. Updated from the engine's
  per-frame `level` event; no extra rAF loop.
- Input (`TeInput.ts`, 84:11369): SYSTEM [slide switch] MIC, the LISTEN key (LED, orange
  legend while latched). No hint line (M16): the OLED shows the state.
- UI: skin dropdown + LT / DRK (after Input since M16).
- Visualization: INK / SMOKE dropdown (replaces the header segmented control).
- Presets (see Presets).
- Parameter sections, numbered across the active effect's sections and Audio response
  (Ink: 01 PARTICLES, 02 TRAILS, 03 RENDER, 04 AUDIO RESPONSE; Smoke: 01 PLUME, 02 RENDER,
  03 AUDIO RESPONSE): number tag, title, rule. Built from the schema by `fillControls`:
  toggles as LED keys (BLEND MODE: MULTIPLY / SCREEN, Ink and Smoke) first, then every number as a dial in a
  grid (4 columns when the count is a multiple of 4, else 3), small integer params (Sources
  1..3) as radio keys with the LED outside, then colours as swatch keys (legend only, the
  hex is the tooltip; 20 px below the dials; click opens the native picker). `controlStyle.ts` holds the short legends, cap colours (orange /
  black / grey per the design for Ink; Smoke by analogy: Count and Density orange, motion
  black, the softening dials grey) and the Ink Render order (INK, CONTRAST, SIZE, GRAIN). The section was called Look before
  M16 (section id `render`; param ids unchanged, so presets load as before).
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
  type (Enter commits, Escape cancels; "200k" works). Hover / turning shades the cap (no movement).
- Swatch, Tooltip (one OLED bubble for every `[data-tip]`, on hover after 450 ms and on
  keyboard focus; the text is also `aria-description`).

LIVE strip (`LiveStrip.ts`): shown only while listening with the panel hidden (the panel's
display shows the same): the plate around a display strip with LIVE and the spectrum bars.
There is no transport (M15: no file player; a page cannot pause another app). Placement:
centred in the window when that keeps 16 px clear of the open panel, else centred in the space
right of it. It fades in place and only slides (left, 180 ms) on panel toggles while visible.
TE: orange LIVE, OLED bars; Braun: a smoked VFD window, "live" and green VFD bars.

Keyboard: H toggles the panel; Space toggles listening unless focus is in a control; Escape
closes the info module.

## Presets

`PresetBank` (presets/store.ts). Each effect has a built-in "Default" generated from its
schema (`builtin:default:<effect>`, env-aware). User presets live in localStorage under
`visualizer.presets.v1` as `{ schema: 1, presets: Preset[] }`, each preset
`{ version, id, name, effect, params, createdAt }` with `params` as REAL values keyed by param
id: the app params plus that effect's params. The shape did not change in M7, so the schema
stays 1; a stored or imported preset without `effect` is an Ink preset (all M6 presets were),
and stored presets of unknown effects are kept but not shown. An effect's `migrate` rewrites
renamed ids on read and import (Smoke `mode` light / dark -> `blend` multiply / screen, M11). Loading resolves a preset over the defaults: unknown ids are ignored, missing or
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
Fullscreen targets the whole document, so the panel, floating keys and LIVE strip stay (the
panel can still be hidden with H); the ResizeObserver reallocates the trail targets (cleared).

## Milestones

M0/M1 architecture, scaffold, panel shell. M2 GPU ink effect, mic/link/capture.
M3-M5b ink effect, trails, audio response. M6 0..10 panel scale, presets (localStorage +
JSON file), output checks, "Visualizer" title. M7 effect selector, per-effect params and presets,
shared effect infrastructure, Smoke effect (light paper / dark). M8-M9 Smoke rebuilds.
M10 TE UI: full-window canvas, floating panel / keys / transport, light and dark UI themes,
dials, OLED display. M11 UI refinements: +1 px type, warm dark deck, keyboard-only focus rings,
static dials, eased transitions, overlay scroll bar with edge fades, canvas follows LT / DRK
(lightness mirror + Blend mode), Ink Screen composite, Smoke Mode -> Blend mode, looping media,
per-family transport, SYSTEM AUDIO labels. M12-M14 TE refinements (dark deck, focus states,
minimise morph, wake lock, panel opacity, LT / DRK per visit). M15 input model (system audio /
mic + listen; file, link and the transport removed), skin system (registry, abstract panel
model, runtime switching), Braun skin from Figma variables, info module. M16 Braun fixes
(dropdown carets, switch drag and click, section rules equal in LT / DRK), shared info module and
the TE info module, TE Input before UI, no input hint, no swatch hex, Look renamed Render.
Next: performance tiers, mobile sheet, REC CLIP.
