// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
/** Unsmoothed band values: 0..1 after adaptive normalisation, times sensitivity (0..3). */
export interface BandValues {
  bass: number;
  mid: number;
  high: number;
}

/**
 * Per-frame audio features handed to effects. All values 0..1 unless noted.
 * Bands: bass 20-150 Hz, mid 150-2000 Hz, high 2000-12000 Hz. Each band is normalised
 * against its own slowly decaying running max, so quiet and loud material both use the range.
 */
export interface AudioFrame {
  /** Smoothed band energies (asymmetric rise/fall), times sensitivity: 0..1 at 1, up to 3 at 3. */
  bass: number;
  mid: number;
  high: number;
  /** Normalised RMS level, smoothed. */
  level: number;
  /** Peak-hold of `level`: holds ~0.8s, then falls. Meant for meters. */
  peak: number;
  /** True for exactly one frame when an onset is detected. */
  beat: boolean;
  /** Strength of the most recent beat (set on the beat frame), decaying with a ~250ms time constant. */
  beatStrength: number;
  /** Band values before rise/fall smoothing. Same scale as bass/mid/high. */
  raw: BandValues;
  /** True while a source is listening (system audio or mic). */
  playing: boolean;
  /** Seconds since listening started, 0 when idle. */
  time: number;
}

export function silentFrame(): AudioFrame {
  return {
    bass: 0, mid: 0, high: 0, level: 0, peak: 0, beat: false, beatStrength: 0,
    raw: { bass: 0, mid: 0, high: 0 }, playing: false, time: 0,
  };
}

/** Audio sources: system audio (getDisplayMedia) and the microphone (getUserMedia). */
export type SourceKind = 'system' | 'mic';

/** Tunables from the "Audio response" param section. */
export interface AudioResponse {
  bassSens: number;
  midSens: number;
  highSens: number;
  /** Attack time constant, seconds. */
  smoothRise: number;
  /** Release time constant, seconds. */
  smoothFall: number;
  /** 0..1. Higher = fewer beats. 0.6 is the default. */
  beatThreshold: number;
}

export interface ListenState {
  /** The source that is listening, null when idle. */
  source: SourceKind | null;
  /** What is shared (entire screen, chrome tab, a window title) or the mic device label. Lower case is up to the skin. */
  label: string;
  /** True while a source is live. */
  playing: boolean;
}

export interface AudioEvents {
  level: (level: number, peak: number) => void;
  /** Fired from getFrame() on the frame an onset is detected. bpm is 0 while unknown. */
  beat: (strength: number, bpm: number) => void;
  state: (state: Readonly<ListenState>) => void;
  error: (err: Error) => void;
}

/** Why a source could not start. Skins word these (see ui/listen.ts LISTEN_MSG). */
export type SourceErrorCode =
  | 'noAudio' | 'cancelled' | 'systemUnsupported' | 'micDenied' | 'micMissing' | 'micUnsupported';

/** User-facing error from listen(): a code, and a default lower-case message. */
export class AudioSourceError extends Error {
  constructor(readonly code: SourceErrorCode) {
    super(SOURCE_ERRORS[code]);
    this.name = 'AudioSourceError';
  }
}

export const SOURCE_ERRORS: Record<SourceErrorCode, string> = {
  noAudio: 'no audio shared, switch on share system audio',
  cancelled: 'sharing cancelled',
  systemUnsupported: 'system audio needs chrome or edge on a computer',
  micDenied: 'microphone blocked, allow it in the address bar',
  micMissing: 'no microphone found',
  micUnsupported: 'this browser cannot use the microphone here',
};
