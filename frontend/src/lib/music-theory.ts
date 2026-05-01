/**
 * music-theory.ts -- Pure music theory utilities for fretboard note calculation,
 * interval naming, scale/chord definitions, and tuning presets.
 *
 * All note calculation is pure frontend logic -- no API calls needed for
 * computing note positions on the fretboard.
 */

// Chromatic scale using sharps (canonical ordering).
export const CHROMATIC_NOTES = [
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

export type NoteName = (typeof CHROMATIC_NOTES)[number];

/** Map of enharmonic equivalents (flats to sharps) for normalization. */
const ENHARMONIC_MAP: Record<string, NoteName> = {
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  "E#": "F",
  "B#": "C",
};

/** Normalize a note name to its sharp-based canonical form. */
export function normalizeNote(note: string): NoteName {
  const trimmed = note.trim();
  if (CHROMATIC_NOTES.includes(trimmed as NoteName)) {
    return trimmed as NoteName;
  }
  const mapped = ENHARMONIC_MAP[trimmed];
  if (mapped) return mapped;
  throw new Error(`Unknown note: ${note}`);
}

/** Get the index (0-11) of a note in the chromatic scale. */
export function noteIndex(note: string): number {
  return CHROMATIC_NOTES.indexOf(normalizeNote(note));
}

/**
 * Calculate the note at a given fret on a string with a given open tuning.
 * Fret 0 = open string = the tuning note itself.
 */
export function noteAtFret(openNote: string, fret: number): NoteName {
  const base = noteIndex(openNote);
  return CHROMATIC_NOTES[(base + fret) % 12];
}

/**
 * Interval names from unison through octave.
 * Index = number of semitones.
 */
export const INTERVAL_NAMES: readonly string[] = [
  "Unison",
  "Minor 2nd",
  "Major 2nd",
  "Minor 3rd",
  "Major 3rd",
  "Perfect 4th",
  "Tritone",
  "Perfect 5th",
  "Minor 6th",
  "Major 6th",
  "Minor 7th",
  "Major 7th",
  "Octave",
];

/** Get the interval name between a tonic and a target note. */
export function intervalName(tonic: string, target: string): string {
  const tonicIdx = noteIndex(tonic);
  const targetIdx = noteIndex(target);
  const semitones = (targetIdx - tonicIdx + 12) % 12;
  return INTERVAL_NAMES[semitones];
}

// ---------------------------------------------------------------------------
// Scale and chord definitions
// ---------------------------------------------------------------------------

/** A scale or chord pattern defined by semitone intervals from root. */
export interface ScaleChordDef {
  name: string;
  type: "scale" | "chord";
  /** Semitone offsets from root (root = 0 is always included). */
  intervals: number[];
}

export const SCALE_CHORD_LIBRARY: ScaleChordDef[] = [
  // Scales
  { name: "Major", type: "scale", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Natural Minor", type: "scale", intervals: [0, 2, 3, 5, 7, 8, 10] },
  {
    name: "Major Pentatonic",
    type: "scale",
    intervals: [0, 2, 4, 7, 9],
  },
  {
    name: "Minor Pentatonic",
    type: "scale",
    intervals: [0, 3, 5, 7, 10],
  },
  { name: "Blues", type: "scale", intervals: [0, 3, 5, 6, 7, 10] },
  {
    name: "Dorian",
    type: "scale",
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  {
    name: "Mixolydian",
    type: "scale",
    intervals: [0, 2, 4, 5, 7, 9, 10],
  },

  // Chords
  { name: "Major Triad", type: "chord", intervals: [0, 4, 7] },
  { name: "Minor Triad", type: "chord", intervals: [0, 3, 7] },
  { name: "Dominant 7th", type: "chord", intervals: [0, 4, 7, 10] },
  { name: "Major 7th", type: "chord", intervals: [0, 4, 7, 11] },
  { name: "Minor 7th", type: "chord", intervals: [0, 3, 7, 10] },
  { name: "Diminished", type: "chord", intervals: [0, 3, 6] },
  { name: "Augmented", type: "chord", intervals: [0, 4, 8] },
  { name: "Power Chord", type: "chord", intervals: [0, 7] },
];

/**
 * Get the set of notes that belong to a scale or chord in a given key.
 * Returns the chromatic note names that are members.
 */
export function getScaleChordNotes(
  def: ScaleChordDef,
  key: string,
): Set<NoteName> {
  const rootIdx = noteIndex(key);
  return new Set(
    def.intervals.map((interval) => CHROMATIC_NOTES[(rootIdx + interval) % 12]),
  );
}

// ---------------------------------------------------------------------------
// Tuning definitions (client-side fallback when API is unavailable)
// ---------------------------------------------------------------------------

export interface TuningPreset {
  id: string;
  name: string;
  strings: number;
  notes: string[];
}

/**
 * Default tuning presets. These are used as a client-side fallback;
 * the canonical list comes from GET /api/v1/fretboard/tunings.
 */
export const DEFAULT_TUNING_PRESETS: TuningPreset[] = [
  { id: "standard-4", name: "Standard", strings: 4, notes: ["G", "D", "A", "E"] },
  { id: "drop-d-4", name: "Drop D", strings: 4, notes: ["G", "D", "A", "D"] },
  { id: "half-step-down-4", name: "Half Step Down", strings: 4, notes: ["Gb", "Db", "Ab", "Eb"] },
  { id: "standard-5", name: "Standard", strings: 5, notes: ["G", "D", "A", "E", "B"] },
  { id: "drop-a-5", name: "Drop A", strings: 5, notes: ["G", "D", "A", "E", "A"] },
  { id: "standard-6", name: "Standard", strings: 6, notes: ["C", "G", "D", "A", "E", "B"] },
  { id: "drop-b-6", name: "Drop B", strings: 6, notes: ["C", "G", "D", "A", "E", "A"] },
];

/**
 * Build the complete fretboard note map for a given tuning.
 * Returns a 2D array: [stringIndex][fretNumber] -> NoteName.
 * String 0 is the highest-pitched string (closest to floor when playing).
 */
export function buildFretboardNotes(
  tuning: string[],
  frets: number,
): NoteName[][] {
  return tuning.map((openNote) =>
    Array.from({ length: frets + 1 }, (_, fret) => noteAtFret(openNote, fret)),
  );
}

/**
 * Standard string names for display (bass guitar convention).
 * String 0 = G (thinnest), String 3 = E (thickest) for 4-string.
 */
export function stringName(tuning: string[], stringIndex: number): string {
  return tuning[stringIndex] ?? `String ${stringIndex + 1}`;
}

// ---------------------------------------------------------------------------
// Chord voicings (fretboard shapes)
// ---------------------------------------------------------------------------

/** A single position on the fretboard. Mirrors the type in lib/api.ts so
 *  this module stays pure (no cross-module type import needed at runtime). */
export interface VoicingPosition {
  string: number;
  fret: number;
  label?: string;
}

/** Options for getChordVoicings. */
export interface VoicingOptions {
  /** Maximum fret (inclusive) to search. Default 12. */
  maxFret?: number;
  /** Minimum fret. Default 0 (open strings allowed). */
  minFret?: number;
  /** Max span in frets across a single voicing (not counting open strings). Default 4. */
  maxSpan?: number;
  /** Maximum number of voicings to return. Default 8. */
  limit?: number;
}

/**
 * Enumerate playable voicings of a chord across a given tuning.
 *
 * A voicing is a set of fretboard positions, one per chord tone, on distinct
 * strings, where every chord tone appears exactly once. Non-open positions
 * fit within a maxSpan-fret window; open strings (fret 0) are always allowed.
 *
 * Returns voicings sorted by (lowest fret ascending, total span ascending),
 * deduplicated by their sorted `${string}:${fret}` token set, and capped at
 * opts.limit (default 8).
 *
 * Pure function: no side effects, no I/O, deterministic in its inputs.
 */
export function getChordVoicings(
  root: string,
  def: ScaleChordDef,
  tuning: string[],
  opts?: VoicingOptions,
): VoicingPosition[][] {
  const maxFret = opts?.maxFret ?? 12;
  const minFret = opts?.minFret ?? 0;
  const maxSpan = opts?.maxSpan ?? 4;
  const limit = opts?.limit ?? 8;

  // Chord tones (as canonical sharp-form note names).
  const chordTones = [...getScaleChordNotes(def, root)];
  const N = chordTones.length;
  const numStrings = tuning.length;
  if (N === 0 || N > numStrings) return [];

  // Pre-compute, for each string, the frets within [minFret, maxFret] that
  // produce each chord tone. Open strings are always allowed regardless of
  // window placement (we filter by chord-tone membership only).
  const stringFretsForTone: Map<NoteName, number[]>[] = tuning.map(
    (openNote) => {
      const map = new Map<NoteName, number[]>();
      for (let f = minFret; f <= maxFret; f++) {
        const note = noteAtFret(openNote, f);
        if (!chordTones.includes(note)) continue;
        const list = map.get(note);
        if (list) list.push(f);
        else map.set(note, [f]);
      }
      // Open string (fret 0) is always allowed even if minFret > 0.
      if (minFret > 0) {
        const openNoteVal = noteAtFret(openNote, 0);
        if (chordTones.includes(openNoteVal)) {
          const list = map.get(openNoteVal);
          if (list) {
            if (!list.includes(0)) list.unshift(0);
          } else {
            map.set(openNoteVal, [0]);
          }
        }
      }
      return map;
    },
  );

  // Enumerate all combinations of N strings (ordered by ascending string index).
  const stringCombos: number[][] = [];
  const pickStrings = (start: number, picked: number[]): void => {
    if (picked.length === N) {
      stringCombos.push([...picked]);
      return;
    }
    for (let s = start; s < numStrings; s++) {
      picked.push(s);
      pickStrings(s + 1, picked);
      picked.pop();
    }
  };
  pickStrings(0, []);

  // For each combination, enumerate every permutation of chord tones across
  // those strings (a string can take any one chord tone). For each
  // assignment, expand the per-string fret choices and validate the span.
  const voicings: VoicingPosition[][] = [];
  const seen = new Set<string>();

  const permute = (
    arr: NoteName[],
    out: NoteName[][],
    used: boolean[] = [],
    cur: NoteName[] = [],
  ): void => {
    if (cur.length === arr.length) {
      out.push([...cur]);
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(arr[i]);
      permute(arr, out, used, cur);
      cur.pop();
      used[i] = false;
    }
  };

  const tonePerms: NoteName[][] = [];
  permute(chordTones as NoteName[], tonePerms);

  const recordIfValid = (positions: VoicingPosition[]): void => {
    // Validate span on non-open positions.
    const nonOpenFrets = positions.filter((p) => p.fret > 0).map((p) => p.fret);
    if (nonOpenFrets.length > 0) {
      const span =
        Math.max(...nonOpenFrets) - Math.min(...nonOpenFrets);
      if (span > maxSpan) return;
    }
    // Validate every position fret is within the global [minFret, maxFret]
    // OR is an open string (fret 0).
    for (const p of positions) {
      if (p.fret === 0) continue;
      if (p.fret < minFret || p.fret > maxFret) return;
    }
    // Deduplicate by sorted "string:fret" tokens.
    const key = positions
      .map((p) => `${p.string}:${p.fret}`)
      .slice()
      .sort()
      .join("|");
    if (seen.has(key)) return;
    seen.add(key);
    voicings.push(positions);
  };

  for (const strings of stringCombos) {
    for (const perm of tonePerms) {
      // Each string in `strings` is assigned chord tone perm[i].
      // For each string, gather candidate frets producing that tone.
      const choices: number[][] = [];
      let feasible = true;
      for (let i = 0; i < N; i++) {
        const s = strings[i];
        const tone = perm[i];
        const frets = stringFretsForTone[s].get(tone);
        if (!frets || frets.length === 0) {
          feasible = false;
          break;
        }
        choices.push(frets);
      }
      if (!feasible) continue;

      // Expand the cartesian product of fret choices.
      const expand = (idx: number, accum: number[]): void => {
        if (idx === N) {
          const positions: VoicingPosition[] = strings.map((s, i) => ({
            string: s,
            fret: accum[i],
            label: perm[i],
          }));
          recordIfValid(positions);
          return;
        }
        for (const f of choices[idx]) {
          accum.push(f);
          expand(idx + 1, accum);
          accum.pop();
        }
      };
      expand(0, []);
    }
  }

  // Sort by (lowest fret asc, total span asc).
  voicings.sort((a, b) => {
    const aLow = Math.min(...a.map((p) => p.fret));
    const bLow = Math.min(...b.map((p) => p.fret));
    if (aLow !== bLow) return aLow - bLow;
    const aSpan =
      Math.max(...a.map((p) => p.fret)) - Math.min(...a.map((p) => p.fret));
    const bSpan =
      Math.max(...b.map((p) => p.fret)) - Math.min(...b.map((p) => p.fret));
    return aSpan - bSpan;
  });

  return voicings.slice(0, limit);
}
