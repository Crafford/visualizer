// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { FeatureExtractor } from './analysis';
import {
  AudioSourceError, silentFrame,
  type AudioEvents, type AudioFrame, type AudioResponse, type ListenState, type SourceKind,
} from './types';

const DEFAULT_RESPONSE: AudioResponse = {
  bassSens: 1, midSens: 1, highSens: 1, smoothRise: 0.02, smoothFall: 0.25, beatThreshold: 0,
};

type Teardown = () => void;

/**
 * Owns the AudioContext, the listening source and analysis. Two sources (M15):
 * - system: getDisplayMedia with audio (Chrome / Edge on a computer). The video track only
 *   names what is shared and is stopped at once; the audio is analysed, never played.
 * - mic: getUserMedia with AEC / NS / AGC off.
 * Graph: stream source -> analyser only (never audible: no feedback, no double audio).
 * The AudioContext is created lazily on the first listen() (a user gesture) and resumed on every start.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private extractor: FeatureExtractor | null = null;
  private liveStart = 0;
  private teardown: Teardown[] = [];
  /** Bumped on every source change; async work from an older request checks it and bails. */
  private generation = 0;

  private response: AudioResponse = { ...DEFAULT_RESPONSE };
  private frame: AudioFrame = silentFrame();
  private lastFrameTime = 0;

  private readonly handlers: { [K in keyof AudioEvents]: Set<AudioEvents[K]> } = {
    level: new Set(), beat: new Set(), state: new Set(), error: new Set(),
  };

  private _state: ListenState = { source: null, label: '', playing: false };

  get state(): Readonly<ListenState> { return this._state; }

  /** Rolling tempo estimate from detected beats, 0 when unknown. */
  get bpm(): number { return this.extractor?.bpm ?? 0; }

  /**
   * System audio needs getDisplayMedia with audio, which only Chromium on a computer gives.
   * Safari and Firefox share no system audio; phones and tablets have no getDisplayMedia audio.
   */
  static get systemSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    const md = navigator.mediaDevices;
    if (!md || typeof md.getDisplayMedia !== 'function') return false;
    const ua = navigator.userAgent;
    if (/firefox|fxios/i.test(ua)) return false;
    if (/safari/i.test(ua) && !/chrome|chromium|crios|edg|android/i.test(ua)) return false;
    try {
      // Touch-only devices (no fine pointer anywhere).
      if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return false;
    } catch { /* no matchMedia: assume a computer */ }
    return true;
  }

  on<K extends keyof AudioEvents>(type: K, fn: AudioEvents[K]): () => void {
    this.handlers[type].add(fn);
    return () => this.handlers[type].delete(fn);
  }

  configure(patch: Partial<AudioResponse>): void {
    Object.assign(this.response, patch);
  }

  /**
   * Start listening to `kind`, replacing the current source (handover). Resolves when live;
   * rejects with an AudioSourceError (code + message) when it could not start, after
   * returning to idle. A newer listen() or stop() while a prompt is open wins: the older
   * request resolves without effect.
   */
  async listen(kind: SourceKind): Promise<void> {
    try {
      if (kind === 'system') await this.startSystem();
      else await this.startMic();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.fire('error', e);
      throw e;
    }
  }

  /** Stop and release the current source; back to idle. Also cancels a pending listen(). */
  stop(): void {
    this.teardownSource();
  }

  /** Call once per animation frame. Returns a reused object; copy if you need to keep it. */
  getFrame(): AudioFrame {
    const now = performance.now() / 1000;
    const dt = this.lastFrameTime ? Math.min(0.1, Math.max(0, now - this.lastFrameTime)) : 1 / 60;
    this.lastFrameTime = now;

    const f = this.frame;
    const playing = this._state.playing;
    f.playing = playing;
    f.time = playing && this.ctx ? this.ctx.currentTime - this.liveStart : 0;
    if (!this.extractor) return f;
    this.extractor.extract(dt, this.response, playing, f);
    this.fire('level', f.level, f.peak);
    if (f.beat) this.fire('beat', f.beatStrength, this.bpm);
    return f;
  }

  /** Analyser bin count (fftSize / 2), 0 before the first source. */
  get spectrumSize(): number { return this.analyser?.frequencyBinCount ?? 0; }
  /** Sample rate of the AudioContext, 0 before the first source. */
  get sampleRate(): number { return this.ctx?.sampleRate ?? 0; }

  /**
   * Byte magnitudes (0..255 over the analyser's dB range) of the current block, for UI meters.
   * Reads the analyser without touching the feature extractor (smoothingTimeConstant is 0,
   * so an extra read has no side effects). Returns false when there is no analyser yet.
   */
  getSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(out);
    return true;
  }

  dispose(): void {
    this.teardownSource();
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---------------------------------------------------------------- sources

  private async startMic(): Promise<void> {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) throw new AudioSourceError('micUnsupported');
    const ctx = this.ensureContext();
    this.teardownSource();
    const gen = this.generation;
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      if (gen !== this.generation) return;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new AudioSourceError('micDenied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new AudioSourceError('micMissing');
      throw err;
    }
    if (gen !== this.generation) { stopStream(stream); return; } // superseded while the prompt was open
    const track = stream.getAudioTracks()[0];
    this.attachStream(stream, ctx, 'mic', track?.label || 'default microphone');
    await ctx.resume();
  }

  private async startSystem(): Promise<void> {
    if (!AudioEngine.systemSupported) throw new AudioSourceError('systemUnsupported');
    const ctx = this.ensureContext();
    this.teardownSource();
    const gen = this.generation;
    let stream: MediaStream;
    try {
      // Chrome only shares audio when video is requested too: ask for the smallest video.
      // displaySurface 'monitor' pre-selects the Entire Screen pane, where "Share system
      // audio" lives; the other keys are Chrome hints (ignored elsewhere).
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor', width: 160, height: 90, frameRate: 1 },
        audio: true,
        systemAudio: 'include',
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      if (gen !== this.generation) return;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') throw new AudioSourceError('cancelled');
      if (name === 'NotSupportedError' || name === 'TypeError') throw new AudioSourceError('systemUnsupported');
      throw err;
    }
    // Name what is shared from the video track, then stop it: only the audio is used.
    const what = describeSurface(stream.getVideoTracks()[0]);
    for (const t of stream.getVideoTracks()) t.stop();
    if (gen !== this.generation) { stopStream(stream); return; }
    if (!stream.getAudioTracks()[0]) {
      stopStream(stream);
      throw new AudioSourceError('noAudio');
    }
    this.attachStream(stream, ctx, 'system', what);
    await ctx.resume();
  }

  // ---------------------------------------------------------------- internals

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0; // we smooth ourselves with rise/fall
    this.ctx = ctx;
    this.analyser = analyser;
    this.extractor = new FeatureExtractor(analyser);
    return ctx;
  }

  private attachStream(stream: MediaStream, ctx: AudioContext, kind: SourceKind, label: string): void {
    const node = ctx.createMediaStreamSource(stream);
    node.connect(this.analyser!); // analyser only: never to destination
    const track = stream.getAudioTracks()[0];
    // Mic unplugged, permission revoked, or "Stop sharing" clicked: back to idle.
    const onEnded = () => { if (this._state.source === kind) this.teardownSource(); };
    track?.addEventListener('ended', onEnded);
    this.teardown.push(() => {
      track?.removeEventListener('ended', onEnded);
      node.disconnect();
      stopStream(stream);
    });
    this.liveStart = ctx.currentTime;
    this.updateState({ source: kind, label, playing: true });
  }

  private teardownSource(): void {
    this.generation++;
    for (const fn of this.teardown.splice(0).reverse()) {
      try { fn(); } catch { /* best effort */ }
    }
    this.extractor?.reset();
    if (this._state.source !== null || this._state.playing) this.updateState({ source: null, label: '', playing: false });
  }

  private updateState(patch: Partial<ListenState>): void {
    Object.assign(this._state, patch);
    this.fire('state', this._state);
  }

  private fire<K extends keyof AudioEvents>(type: K, ...args: Parameters<AudioEvents[K]>): void {
    for (const fn of this.handlers[type]) (fn as (...a: unknown[]) => void)(...args);
  }
}

/**
 * What a system-audio share is, as far as the browser tells: the surface type from the
 * video track's settings, and for a window (or a tab, when it carries one) the title in the
 * track label. Chrome labels tabs "web-contents-media-stream://..." and screens / windows
 * "screen:..." / "window:...", which are ids, not names. Lower case; skins set the case.
 */
export function describeSurface(track: MediaStreamTrack | undefined): string {
  if (!track) return 'entire screen';
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  const label = track.label.trim();
  const meaningful = !!label && !/^(web-contents-media-stream:|screen:|window:|tab:)/i.test(label) && !/^[\w-]+:\d+(:\d+)?$/.test(label);
  if (surface === 'monitor' || !surface) return 'entire screen';
  if (surface === 'window') return meaningful ? label : 'app window';
  return meaningful ? label : 'chrome tab';
}

function stopStream(s: MediaStream): void {
  for (const t of s.getTracks()) t.stop();
}
