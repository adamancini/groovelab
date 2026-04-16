/**
 * engine.ts -- Tone.js audio engine for Play mode.
 *
 * Manages Transport, drum Sampler/Players, chord PolySynth, metronome,
 * and visual-only fallback when Web Audio is unavailable.
 */

import * as Tone from "tone";

// ---------- Types ----------

export interface ChordBlock {
  id: string;
  root: string; // e.g. "C", "F#"
  type: ChordType;
  durationBars: number;
}

export type ChordType =
  | "Major"
  | "Minor"
  | "Dom7"
  | "Maj7"
  | "Min7"
  | "Dim"
  | "Aug";

export type DrumInstrument =
  | "Kick"
  | "Snare"
  | "HiHatClosed"
  | "HiHatOpen"
  | "TomHigh"
  | "TomLow"
  | "Crash"
  | "Ride";

export const DRUM_INSTRUMENTS: DrumInstrument[] = [
  "Kick",
  "Snare",
  "HiHatClosed",
  "HiHatOpen",
  "TomHigh",
  "TomLow",
  "Crash",
  "Ride",
];

export const DRUM_LABELS: Record<DrumInstrument, string> = {
  Kick: "Kick",
  Snare: "Snare",
  HiHatClosed: "Hi-hat (closed)",
  HiHatOpen: "Hi-hat (open)",
  TomHigh: "Tom High",
  TomLow: "Tom Low",
  Crash: "Crash",
  Ride: "Ride",
};

/** 16-step pattern per instrument. */
export type DrumPattern = Record<DrumInstrument, boolean[]>;

export interface PlaybackSettings {
  bpm: number;
  metronome: boolean;
  countIn: "none" | "1bar" | "2bars";
  loopSection: "all" | "chord"; // "all" = loop entire track, "chord" = loop current chord
}

export type AudioStatus = "ready" | "visual-only" | "error" | "initializing";

// ---------- Chromatic note helpers ----------

const CHROMATIC_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const ROOT_NOTES = [...CHROMATIC_NOTES];

/** Semitone intervals from root for each chord type. */
const CHORD_INTERVALS: Record<ChordType, number[]> = {
  Major: [0, 4, 7],
  Minor: [0, 3, 7],
  Dom7: [0, 4, 7, 10],
  Maj7: [0, 4, 7, 11],
  Min7: [0, 3, 7, 10],
  Dim: [0, 3, 6],
  Aug: [0, 4, 8],
};

export const CHORD_TYPES: ChordType[] = [
  "Major",
  "Minor",
  "Dom7",
  "Maj7",
  "Min7",
  "Dim",
  "Aug",
];

/** Get note names for a chord (octave 3 for bass). */
export function chordNotes(root: string, type: ChordType): string[] {
  const rootIndex = CHROMATIC_NOTES.indexOf(
    root as (typeof CHROMATIC_NOTES)[number],
  );
  if (rootIndex === -1) return [];
  const intervals = CHORD_INTERVALS[type];
  return intervals.map((interval) => {
    const noteIndex = (rootIndex + interval) % 12;
    const octave = rootIndex + interval >= 12 ? 4 : 3;
    return `${CHROMATIC_NOTES[noteIndex]}${octave}`;
  });
}

/** Human-readable chord name. */
export function chordName(root: string, type: ChordType): string {
  const suffixes: Record<ChordType, string> = {
    Major: "",
    Minor: "m",
    Dom7: "7",
    Maj7: "maj7",
    Min7: "m7",
    Dim: "dim",
    Aug: "aug",
  };
  return `${root}${suffixes[type]}`;
}

/** Get fretboard positions for a chord on a 4-string bass (standard tuning E-A-D-G). */
export function chordFretboardPositions(
  root: string,
  type: ChordType,
): { string: number; fret: number; label?: string; isTonic?: boolean }[] {
  const BASS_TUNING = ["E", "A", "D", "G"]; // string 0=E (low), 3=G (high)
  const intervals = CHORD_INTERVALS[type];
  const rootIndex = CHROMATIC_NOTES.indexOf(
    root as (typeof CHROMATIC_NOTES)[number],
  );
  if (rootIndex === -1) return [];

  const positions: {
    string: number;
    fret: number;
    label?: string;
    isTonic?: boolean;
  }[] = [];
  for (let s = 0; s < BASS_TUNING.length; s++) {
    const openIndex = CHROMATIC_NOTES.indexOf(
      BASS_TUNING[s] as (typeof CHROMATIC_NOTES)[number],
    );
    for (const interval of intervals) {
      const targetIndex = (rootIndex + interval) % 12;
      let fret = (targetIndex - openIndex + 12) % 12;
      // Keep within first 12 frets
      if (fret > 12) continue;
      const noteName = CHROMATIC_NOTES[targetIndex];
      positions.push({
        string: s,
        fret,
        label: noteName,
        isTonic: interval === 0,
      });
    }
  }
  return positions;
}

// ---------- Unique ID generator ----------

let _idCounter = 0;
export function generateId(): string {
  return `chord-${Date.now()}-${_idCounter++}`;
}

// ---------- Default patterns ----------

export function createEmptyDrumPattern(): DrumPattern {
  const pattern: Partial<DrumPattern> = {};
  for (const inst of DRUM_INSTRUMENTS) {
    pattern[inst] = Array(16).fill(false);
  }
  return pattern as DrumPattern;
}

export function createDefaultDrumPattern(): DrumPattern {
  const p = createEmptyDrumPattern();
  // Basic rock beat
  p.Kick = [
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
  ];
  p.Snare = [
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
  ];
  p.HiHatClosed = [
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
  ];
  return p;
}

// ---------- Audio Engine ----------

/** Drum sample URLs (relative to /samples/). */
const DRUM_SAMPLE_URLS: Record<DrumInstrument, string> = {
  Kick: "/samples/kick.ogg",
  Snare: "/samples/snare.ogg",
  HiHatClosed: "/samples/hihat-closed.ogg",
  HiHatOpen: "/samples/hihat-open.ogg",
  TomHigh: "/samples/tom-high.ogg",
  TomLow: "/samples/tom-low.ogg",
  Crash: "/samples/crash.ogg",
  Ride: "/samples/ride.ogg",
};

export interface EngineCallbacks {
  onStepChange: (step: number) => void;
  onChordChange: (chordIndex: number) => void;
  onBarChange: (bar: number) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export class AudioEngine {
  private _status: AudioStatus = "initializing";
  private _drumPlayers: Tone.Players | null = null;
  private _chordSynth: Tone.PolySynth | null = null;
  private _metronome: Tone.Synth | null = null;
  private _drumVolumes: Record<DrumInstrument, Tone.Volume> = {} as Record<
    DrumInstrument,
    Tone.Volume
  >;
  private _scheduledIds: number[] = [];
  private _callbacks: EngineCallbacks | null = null;

  // Visual-only timer fallback
  private _visualTimer: ReturnType<typeof setInterval> | null = null;
  private _visualStartTime = 0;

  get status(): AudioStatus {
    return this._status;
  }

  /** Initialize audio context. Must be called from a user gesture. */
  async init(): Promise<AudioStatus> {
    try {
      await Tone.start();

      // Create drum players
      this._drumPlayers = new Tone.Players(
        Object.fromEntries(
          DRUM_INSTRUMENTS.map((inst) => [inst, DRUM_SAMPLE_URLS[inst]]),
        ),
      );

      // Create per-instrument volume nodes
      for (const inst of DRUM_INSTRUMENTS) {
        const vol = new Tone.Volume(0).toDestination();
        this._drumVolumes[inst] = vol;
      }

      // Connect each player to its volume node once loaded
      await Tone.loaded();
      for (const inst of DRUM_INSTRUMENTS) {
        if (this._drumPlayers.has(inst)) {
          this._drumPlayers.player(inst).connect(this._drumVolumes[inst]);
        }
      }

      // Chord synth
      this._chordSynth = new Tone.PolySynth(Tone.Synth, {
        volume: -12,
        oscillator: { type: "triangle" },
        envelope: {
          attack: 0.05,
          decay: 0.3,
          sustain: 0.4,
          release: 0.8,
        },
      }).toDestination();

      // Metronome
      this._metronome = new Tone.Synth({
        volume: -6,
        oscillator: { type: "sine" },
        envelope: {
          attack: 0.001,
          decay: 0.1,
          sustain: 0,
          release: 0.1,
        },
      }).toDestination();

      this._status = "ready";
      return "ready";
    } catch {
      this._status = "visual-only";
      return "visual-only";
    }
  }

  /** Set volume for a drum instrument (-60 to 0 dB). */
  setDrumVolume(instrument: DrumInstrument, db: number): void {
    if (this._drumVolumes[instrument]) {
      this._drumVolumes[instrument].volume.value = db;
    }
  }

  /** Start playback. */
  play(
    chords: ChordBlock[],
    drumPattern: DrumPattern,
    settings: PlaybackSettings,
    callbacks: EngineCallbacks,
  ): void {
    this._callbacks = callbacks;

    if (this._status === "visual-only" || this._status === "initializing") {
      this._playVisualOnly(chords, settings, callbacks);
      return;
    }

    this._stopInternal();

    const transport = Tone.getTransport();
    transport.bpm.value = settings.bpm;
    transport.timeSignature = 4;

    // Calculate total bars
    const totalBars = chords.reduce((sum, c) => sum + c.durationBars, 0);

    // Schedule drum pattern (one bar loop, repeating)
    for (let step = 0; step < 16; step++) {
      const time = `0:0:${step}`; // 16th note position within a bar
      const id = transport.scheduleRepeat(
        (t: number) => {
          // Trigger active drums
          for (const inst of DRUM_INSTRUMENTS) {
            if (drumPattern[inst][step] && this._drumPlayers?.has(inst)) {
              this._drumPlayers.player(inst).start(t, 0, "32n");
            }
          }
          callbacks.onStepChange(step);
        },
        "1m", // repeat every measure
        time,
      );
      this._scheduledIds.push(id);
    }

    // Schedule metronome
    if (settings.metronome) {
      const metId = transport.scheduleRepeat(
        (t: number) => {
          if (this._metronome) {
            // Accent on beat 1
            const beat = Math.round(
              transport.getSecondsAtTime(t) *
                (settings.bpm / 60),
            ) % 4;
            const freq = beat === 0 ? 1000 : 800;
            this._metronome.triggerAttackRelease(freq, "32n", t);
          }
        },
        "4n",
        "0:0:0",
      );
      this._scheduledIds.push(metId);
    }

    // Schedule chord changes
    let barOffset = 0;
    for (let i = 0; i < chords.length; i++) {
      const chord = chords[i];
      const chordIndex = i;
      const startTime = `${barOffset}:0:0`;

      const chordId = transport.schedule((t: number) => {
        // Play chord on synth
        const notes = chordNotes(chord.root, chord.type);
        if (this._chordSynth && notes.length > 0) {
          this._chordSynth.triggerAttackRelease(
            notes,
            `${chord.durationBars}m`,
            t,
          );
        }
        callbacks.onChordChange(chordIndex);
      }, startTime);
      this._scheduledIds.push(chordId);

      // Bar change callbacks for each bar in this chord
      for (let b = 0; b < chord.durationBars; b++) {
        const barTime = `${barOffset + b}:0:0`;
        const barNum = barOffset + b;
        const barId = transport.schedule(() => {
          callbacks.onBarChange(barNum);
        }, barTime);
        this._scheduledIds.push(barId);
      }

      barOffset += chord.durationBars;
    }

    // Schedule completion
    const endTime = `${totalBars}:0:0`;
    if (settings.loopSection === "all") {
      transport.loop = true;
      transport.loopStart = "0:0:0";
      transport.loopEnd = endTime;
    } else {
      transport.loop = false;
      const completeId = transport.schedule(() => {
        callbacks.onComplete();
        this.stop();
      }, endTime);
      this._scheduledIds.push(completeId);
    }

    // Count-in
    const countInBars =
      settings.countIn === "1bar" ? 1 : settings.countIn === "2bars" ? 2 : 0;
    if (countInBars > 0) {
      transport.position = `-${countInBars}:0:0`;
    }

    transport.start();
  }

  /** Visual-only fallback using setInterval. */
  private _playVisualOnly(
    chords: ChordBlock[],
    settings: PlaybackSettings,
    callbacks: EngineCallbacks,
  ): void {
    const barDurationMs = (60 / settings.bpm) * 4 * 1000; // 4 beats per bar
    const stepDurationMs = barDurationMs / 16;
    const totalBars = chords.reduce((sum, c) => sum + c.durationBars, 0);
    const totalSteps = totalBars * 16;

    let currentStep = 0;
    let currentChordIndex = 0;
    let chordStartBar = 0;

    callbacks.onChordChange(0);
    callbacks.onBarChange(0);
    callbacks.onStepChange(0);

    this._visualTimer = setInterval(() => {
      currentStep++;
      if (currentStep >= totalSteps) {
        if (settings.loopSection === "all") {
          currentStep = 0;
          currentChordIndex = 0;
          chordStartBar = 0;
          callbacks.onChordChange(0);
          callbacks.onBarChange(0);
        } else {
          callbacks.onComplete();
          this.stop();
          return;
        }
      }

      const bar = Math.floor(currentStep / 16);
      const stepInBar = currentStep % 16;

      callbacks.onStepChange(stepInBar);

      // Check if bar changed
      if (currentStep % 16 === 0) {
        callbacks.onBarChange(bar);
      }

      // Check if chord changed
      while (
        currentChordIndex < chords.length - 1 &&
        bar >= chordStartBar + chords[currentChordIndex].durationBars
      ) {
        chordStartBar += chords[currentChordIndex].durationBars;
        currentChordIndex++;
        callbacks.onChordChange(currentChordIndex);
      }
    }, stepDurationMs);
  }

  /** Stop playback. */
  stop(): void {
    this._stopInternal();
  }

  /** Pause playback. */
  pause(): void {
    if (this._status === "ready") {
      Tone.getTransport().pause();
    }
    if (this._visualTimer) {
      clearInterval(this._visualTimer);
      this._visualTimer = null;
    }
  }

  private _stopInternal(): void {
    if (this._status === "ready") {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      transport.loop = false;
      transport.position = "0:0:0";
    }
    for (const id of this._scheduledIds) {
      try {
        Tone.getTransport().clear(id);
      } catch {
        // ignore -- already cleared
      }
    }
    this._scheduledIds = [];

    if (this._visualTimer) {
      clearInterval(this._visualTimer);
      this._visualTimer = null;
    }
  }

  /** Retry audio initialization. */
  async retry(): Promise<AudioStatus> {
    this._status = "initializing";
    return this.init();
  }

  /** Clean up all resources. */
  dispose(): void {
    this._stopInternal();
    this._drumPlayers?.dispose();
    this._chordSynth?.dispose();
    this._metronome?.dispose();
    for (const vol of Object.values(this._drumVolumes)) {
      vol.dispose();
    }
    this._drumPlayers = null;
    this._chordSynth = null;
    this._metronome = null;
  }
}

/** Singleton engine instance. */
let _engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!_engine) {
    _engine = new AudioEngine();
  }
  return _engine;
}

/** Reset singleton (for testing). */
export function resetAudioEngine(): void {
  if (_engine) {
    _engine.dispose();
    _engine = null;
  }
}
