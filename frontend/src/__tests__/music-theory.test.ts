/**
 * Music theory utility tests -- note calculation, intervals, scale/chord membership.
 *
 * Pure unit tests -- no DOM, no React, no fetch mocking needed.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeNote,
  noteIndex,
  noteAtFret,
  intervalName,
  SCALE_CHORD_LIBRARY,
  getScaleChordNotes,
  DEFAULT_TUNING_PRESETS,
  buildFretboardNotes,
  stringName,
} from "../lib/music-theory";

// ---------------------------------------------------------------------------
// normalizeNote
// ---------------------------------------------------------------------------

describe("normalizeNote", () => {
  it("returns sharp-form notes unchanged", () => {
    expect(normalizeNote("C")).toBe("C");
    expect(normalizeNote("C#")).toBe("C#");
    expect(normalizeNote("F#")).toBe("F#");
  });

  it("converts flats to sharps", () => {
    expect(normalizeNote("Db")).toBe("C#");
    expect(normalizeNote("Eb")).toBe("D#");
    expect(normalizeNote("Gb")).toBe("F#");
    expect(normalizeNote("Ab")).toBe("G#");
    expect(normalizeNote("Bb")).toBe("A#");
  });

  it("handles enharmonic edge cases", () => {
    expect(normalizeNote("Fb")).toBe("E");
    expect(normalizeNote("Cb")).toBe("B");
    expect(normalizeNote("E#")).toBe("F");
    expect(normalizeNote("B#")).toBe("C");
  });

  it("throws on unknown notes", () => {
    expect(() => normalizeNote("X")).toThrow("Unknown note: X");
    expect(() => normalizeNote("H")).toThrow("Unknown note: H");
  });
});

// ---------------------------------------------------------------------------
// noteIndex
// ---------------------------------------------------------------------------

describe("noteIndex", () => {
  it("returns correct chromatic index", () => {
    expect(noteIndex("C")).toBe(0);
    expect(noteIndex("E")).toBe(4);
    expect(noteIndex("A")).toBe(9);
    expect(noteIndex("B")).toBe(11);
  });

  it("works with flats via normalization", () => {
    expect(noteIndex("Bb")).toBe(10);
    expect(noteIndex("Eb")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// noteAtFret
// ---------------------------------------------------------------------------

describe("noteAtFret", () => {
  it("fret 0 returns the open string note", () => {
    expect(noteAtFret("E", 0)).toBe("E");
    expect(noteAtFret("A", 0)).toBe("A");
    expect(noteAtFret("G", 0)).toBe("G");
  });

  it("correctly calculates notes up the fretboard", () => {
    // E string: E, F, F#, G, G#, A, A#, B, C, C#, D, D#, E
    expect(noteAtFret("E", 1)).toBe("F");
    expect(noteAtFret("E", 3)).toBe("G");
    expect(noteAtFret("E", 5)).toBe("A");
    expect(noteAtFret("E", 7)).toBe("B");
    expect(noteAtFret("E", 12)).toBe("E"); // octave
  });

  it("wraps around the chromatic scale", () => {
    // B + 1 semitone = C
    expect(noteAtFret("B", 1)).toBe("C");
    // G# + 3 = B
    expect(noteAtFret("G#", 3)).toBe("B");
  });

  it("calculates standard 4-string bass tuning correctly", () => {
    // Standard bass: G(0), D(1), A(2), E(3)
    // G string, fret 2 = A
    expect(noteAtFret("G", 2)).toBe("A");
    // D string, fret 2 = E
    expect(noteAtFret("D", 2)).toBe("E");
    // A string, fret 3 = C
    expect(noteAtFret("A", 3)).toBe("C");
    // E string, fret 5 = A
    expect(noteAtFret("E", 5)).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// intervalName
// ---------------------------------------------------------------------------

describe("intervalName", () => {
  it("returns Unison for the same note", () => {
    expect(intervalName("C", "C")).toBe("Unison");
    expect(intervalName("A", "A")).toBe("Unison");
  });

  it("returns correct interval names", () => {
    expect(intervalName("C", "E")).toBe("Major 3rd");
    expect(intervalName("C", "G")).toBe("Perfect 5th");
    expect(intervalName("C", "F")).toBe("Perfect 4th");
    expect(intervalName("C", "B")).toBe("Major 7th");
    expect(intervalName("C", "D")).toBe("Major 2nd");
  });

  it("handles non-C tonics", () => {
    expect(intervalName("A", "C#")).toBe("Major 3rd");
    expect(intervalName("A", "E")).toBe("Perfect 5th");
    expect(intervalName("E", "B")).toBe("Perfect 5th");
  });

  it("handles flats via normalization", () => {
    expect(intervalName("C", "Eb")).toBe("Minor 3rd");
    expect(intervalName("C", "Bb")).toBe("Minor 7th");
  });
});

// ---------------------------------------------------------------------------
// getScaleChordNotes
// ---------------------------------------------------------------------------

describe("getScaleChordNotes", () => {
  it("returns correct C Major scale notes", () => {
    const major = SCALE_CHORD_LIBRARY.find((d) => d.name === "Major")!;
    const notes = getScaleChordNotes(major, "C");
    expect(notes).toEqual(new Set(["C", "D", "E", "F", "G", "A", "B"]));
  });

  it("returns correct A Minor Pentatonic notes", () => {
    const minPent = SCALE_CHORD_LIBRARY.find(
      (d) => d.name === "Minor Pentatonic",
    )!;
    const notes = getScaleChordNotes(minPent, "A");
    expect(notes).toEqual(new Set(["A", "C", "D", "E", "G"]));
  });

  it("returns correct C Major Triad notes", () => {
    const triad = SCALE_CHORD_LIBRARY.find(
      (d) => d.name === "Major Triad",
    )!;
    const notes = getScaleChordNotes(triad, "C");
    expect(notes).toEqual(new Set(["C", "E", "G"]));
  });

  it("returns correct G Dominant 7th notes", () => {
    const dom7 = SCALE_CHORD_LIBRARY.find(
      (d) => d.name === "Dominant 7th",
    )!;
    const notes = getScaleChordNotes(dom7, "G");
    // G B D F
    expect(notes).toEqual(new Set(["G", "B", "D", "F"]));
  });

  it("handles keys with sharps correctly", () => {
    const major = SCALE_CHORD_LIBRARY.find((d) => d.name === "Major")!;
    const notes = getScaleChordNotes(major, "G");
    // G Major: G A B C D E F#
    expect(notes).toEqual(new Set(["G", "A", "B", "C", "D", "E", "F#"]));
  });
});

// ---------------------------------------------------------------------------
// buildFretboardNotes
// ---------------------------------------------------------------------------

describe("buildFretboardNotes", () => {
  it("builds correct notes for standard 4-string tuning", () => {
    const tuning = ["G", "D", "A", "E"];
    const notes = buildFretboardNotes(tuning, 12);

    // 4 strings
    expect(notes.length).toBe(4);
    // Each string has 13 notes (fret 0 through 12)
    expect(notes[0].length).toBe(13);

    // G string fret 0 = G
    expect(notes[0][0]).toBe("G");
    // G string fret 12 = G (octave)
    expect(notes[0][12]).toBe("G");

    // E string fret 0 = E
    expect(notes[3][0]).toBe("E");
    // E string fret 5 = A
    expect(notes[3][5]).toBe("A");
  });

  it("builds correct notes for all 7 seeded tuning presets", () => {
    for (const preset of DEFAULT_TUNING_PRESETS) {
      const notes = buildFretboardNotes(preset.notes, 12);
      expect(notes.length).toBe(preset.strings);

      // Each string should have 13 frets (0-12)
      for (const stringNotes of notes) {
        expect(stringNotes.length).toBe(13);
      }

      // Fret 0 should match the open string note
      for (let s = 0; s < preset.notes.length; s++) {
        const expected = normalizeNote(preset.notes[s]);
        expect(notes[s][0]).toBe(expected);
      }

      // Fret 12 should be the same note as fret 0 (octave)
      for (let s = 0; s < preset.notes.length; s++) {
        expect(notes[s][12]).toBe(notes[s][0]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// stringName
// ---------------------------------------------------------------------------

describe("stringName", () => {
  it("returns the tuning note for valid string indices", () => {
    const tuning = ["G", "D", "A", "E"];
    expect(stringName(tuning, 0)).toBe("G");
    expect(stringName(tuning, 3)).toBe("E");
  });

  it("returns fallback name for out-of-range index", () => {
    const tuning = ["G", "D", "A", "E"];
    expect(stringName(tuning, 10)).toBe("String 11");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_TUNING_PRESETS
// ---------------------------------------------------------------------------

describe("DEFAULT_TUNING_PRESETS", () => {
  it("contains exactly 7 presets", () => {
    expect(DEFAULT_TUNING_PRESETS.length).toBe(7);
  });

  it("has presets for 4, 5, and 6 string instruments", () => {
    const counts = new Set(DEFAULT_TUNING_PRESETS.map((p) => p.strings));
    expect(counts).toEqual(new Set([4, 5, 6]));
  });

  it("each preset has matching string count and notes array length", () => {
    for (const preset of DEFAULT_TUNING_PRESETS) {
      expect(preset.notes.length).toBe(preset.strings);
    }
  });

  it("each note in presets is a valid chromatic note or enharmonic", () => {
    for (const preset of DEFAULT_TUNING_PRESETS) {
      for (const note of preset.notes) {
        // Should not throw
        expect(() => normalizeNote(note)).not.toThrow();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SCALE_CHORD_LIBRARY
// ---------------------------------------------------------------------------

describe("SCALE_CHORD_LIBRARY", () => {
  it("contains both scales and chords", () => {
    const types = new Set(SCALE_CHORD_LIBRARY.map((d) => d.type));
    expect(types).toEqual(new Set(["scale", "chord"]));
  });

  it("all definitions include root (interval 0)", () => {
    for (const def of SCALE_CHORD_LIBRARY) {
      expect(def.intervals[0]).toBe(0);
    }
  });

  it("all intervals are within 0-11 range", () => {
    for (const def of SCALE_CHORD_LIBRARY) {
      for (const interval of def.intervals) {
        expect(interval).toBeGreaterThanOrEqual(0);
        expect(interval).toBeLessThanOrEqual(11);
      }
    }
  });
});
