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
