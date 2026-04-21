/**
 * Unit tests for the tuning-preset API transform.
 *
 * The backend emits camelCase `stringCount` + a `pitches` array with octave
 * numbers, low-to-high. The frontend expects `strings` + plain note names,
 * high-to-low. These tests lock that contract down.
 */

import { describe, it, expect } from "vitest";
import { transformTuningPreset } from "../lib/api";

describe("transformTuningPreset", () => {
  it("maps stringCount to strings and pitches to notes", () => {
    const raw = {
      id: "standard-4",
      name: "Standard 4",
      stringCount: 4,
      pitches: ["E1", "A1", "D2", "G2"],
      isDefault: true,
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "standard-4",
      name: "Standard 4",
      strings: 4,
      notes: ["G", "D", "A", "E"],
    });
  });

  it("handles flat note names (Bb, Eb, Db) correctly", () => {
    const raw = {
      id: "flat-6",
      name: "Flat Tuning",
      stringCount: 6,
      pitches: ["Bb0", "Eb1", "Ab1", "Db2", "Gb2", "B2"],
      isDefault: false,
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "flat-6",
      name: "Flat Tuning",
      strings: 6,
      notes: ["B", "Gb", "Db", "Ab", "Eb", "Bb"],
    });
  });

  it("passes pitches through unchanged when no octave suffix is present", () => {
    const raw = {
      id: "no-oct",
      name: "No Octave",
      stringCount: 4,
      pitches: ["E", "A", "D", "G"],
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "no-oct",
      name: "No Octave",
      strings: 4,
      notes: ["G", "D", "A", "E"],
    });
  });

  it("parses pitches supplied as a JSON-encoded string", () => {
    const raw = {
      id: "stringy",
      name: "JSON Pitches",
      stringCount: 4,
      pitches: JSON.stringify(["E1", "A1", "D2", "G2"]),
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "stringy",
      name: "JSON Pitches",
      strings: 4,
      notes: ["G", "D", "A", "E"],
    });
  });

  it("handles sharp note names (F#, C#)", () => {
    const raw = {
      id: "sharps",
      name: "Sharps",
      stringCount: 4,
      pitches: ["F#1", "C#2", "G#2", "D#3"],
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "sharps",
      name: "Sharps",
      strings: 4,
      notes: ["D#", "G#", "C#", "F#"],
    });
  });

  it("returns empty notes array when pitches JSON string is malformed", () => {
    const raw = {
      id: "bad",
      name: "Bad JSON",
      stringCount: 4,
      pitches: "not-json",
    };
    expect(transformTuningPreset(raw)).toEqual({
      id: "bad",
      name: "Bad JSON",
      strings: 4,
      notes: [],
    });
  });
});
