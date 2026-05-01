/**
 * GRO-8sya: chord metadata plumbing through transformSessionCard.
 *
 * The backend already returns key_signature and chord_type on every session
 * card (backend/internal/flashcards/models.go SessionCard embeds Card). The
 * frontend transform was discarding them. These tests pin the new contract
 * that downstream stories (GRO-z1e3 ChordDiagram, GRO-nhmm render-on-card)
 * will consume:
 *
 *   - Flashcard.chordRoot      string | null   ("C", "F#", null when not chord)
 *   - Flashcard.chordDefName   string | null   library name ("Major Triad", ...)
 *   - Flashcard.topic          string | null   pass-through of session topic
 *
 * resolveChordDefName maps the human-readable wire chord_type ("major",
 * "dominant 7th") onto SCALE_CHORD_LIBRARY entries ("Major Triad",
 * "Dominant 7th"). Library entries themselves are NOT renamed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSession, resolveChordDefName } from "../lib/api";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

function stubSession(topic: string, cards: unknown[]): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        session_id: "s-test",
        topic,
        cards,
        total: cards.length,
      }),
  } as Response);
}

describe("resolveChordDefName", () => {
  it("maps each in-library chord type to its SCALE_CHORD_LIBRARY name", () => {
    expect(resolveChordDefName("major")).toBe("Major Triad");
    expect(resolveChordDefName("minor")).toBe("Minor Triad");
    expect(resolveChordDefName("dominant 7th")).toBe("Dominant 7th");
    expect(resolveChordDefName("major 7th")).toBe("Major 7th");
    expect(resolveChordDefName("minor 7th")).toBe("Minor 7th");
    expect(resolveChordDefName("diminished")).toBe("Diminished");
    expect(resolveChordDefName("augmented")).toBe("Augmented");
  });

  it("returns null for null", () => {
    expect(resolveChordDefName(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(resolveChordDefName(undefined)).toBeNull();
  });

  it("returns null for an unknown wire string", () => {
    expect(resolveChordDefName("not-a-type")).toBeNull();
    expect(resolveChordDefName("")).toBeNull();
    expect(resolveChordDefName("Major Triad")).toBeNull(); // case-sensitive: only wire strings
  });
});

describe("transformSessionCard chord metadata", () => {
  it("populates chordRoot, chordDefName, and topic for a chord card", async () => {
    stubSession("major_chords", [
      {
        id: "c-major-major",
        direction: "name_to_notes",
        question: { prompt: "What are the tones of C Major?" },
        correct_answer: { name: "C major", notes: "C E G" },
        distractors: [
          { name: "C minor", notes: "C Eb G" },
          { name: "C augmented", notes: "C E G#" },
          { name: "C diminished", notes: "C Eb Gb" },
        ],
        stage: 0,
        options: 4,
        key_signature: "C",
        chord_type: "major",
      },
    ]);

    const card = (await fetchSession("major_chords")).cards[0];
    expect(card.chordRoot).toBe("C");
    expect(card.chordDefName).toBe("Major Triad");
    expect(card.topic).toBe("major_chords");
  });

  it("maps dominant 7th wire string onto Dominant 7th library name", async () => {
    stubSession("dominant_7th_chords", [
      {
        id: "c-g-dom7",
        direction: "name_to_notes",
        question: { prompt: "What are the tones of G dominant 7th?" },
        correct_answer: { name: "G dominant 7th", notes: "G B D F" },
        distractors: [{ name: "G major", notes: "G B D" }],
        stage: 0,
        options: 2,
        key_signature: "G",
        chord_type: "dominant 7th",
      },
    ]);

    const card = (await fetchSession("dominant_7th_chords")).cards[0];
    expect(card.chordRoot).toBe("G");
    expect(card.chordDefName).toBe("Dominant 7th");
    expect(card.topic).toBe("dominant_7th_chords");
  });

  it("sets chordDefName to null when chord_type is missing", async () => {
    // Non-chord card (e.g. a scale or note-position card). The backend may
    // still emit key_signature, but chord_type will be null/absent.
    stubSession("major_scales", [
      {
        id: "c-cmajor-scale",
        direction: "name_to_notes",
        question: { prompt: "What are the notes of C major scale?" },
        correct_answer: { name: "C major scale", notes: "C D E F G A B" },
        stage: 2,
        options: 1,
        key_signature: "C",
        // chord_type intentionally omitted (non-chord card).
      },
    ]);

    const card = (await fetchSession("major_scales")).cards[0];
    expect(card.chordDefName).toBeNull();
    expect(card.chordRoot).toBe("C"); // still surfaces key_signature
    expect(card.topic).toBe("major_scales");
  });

  it("sets chordDefName to null when chord_type is explicitly null", async () => {
    stubSession("scales", [
      {
        id: "c-2",
        direction: "name_to_notes",
        question: { prompt: "x" },
        correct_answer: { notes: "C D E" },
        stage: 0,
        options: 1,
        key_signature: "D",
        chord_type: null,
      },
    ]);

    const card = (await fetchSession("scales")).cards[0];
    expect(card.chordDefName).toBeNull();
    expect(card.chordRoot).toBe("D");
  });

  it("does not throw when key_signature is missing; chordRoot becomes null", async () => {
    stubSession("intervals", [
      {
        id: "c-iv",
        direction: "type_to_intervals",
        question: { prompt: "What are the intervals in a major chord?" },
        correct_answer: { intervals: "1-3-5", name: "major" },
        distractors: [{ intervals: "1-♭3-5", name: "minor" }],
        stage: 0,
        options: 2,
        // key_signature intentionally absent (interval cards are key-agnostic).
        // chord_type also absent.
      },
    ]);

    const card = (await fetchSession("intervals")).cards[0];
    expect(card.chordRoot).toBeNull();
    expect(card.chordDefName).toBeNull();
    expect(card.topic).toBe("intervals");
  });

  it("propagates session-level topic onto each card when card.topic is absent", async () => {
    stubSession("minor_chords", [
      {
        id: "c-aminor",
        direction: "name_to_notes",
        question: { prompt: "What are the tones of A minor?" },
        correct_answer: { name: "A minor", notes: "A C E" },
        stage: 0,
        options: 1,
        key_signature: "A",
        chord_type: "minor",
        // No card-level topic; should fall back to session.topic.
      },
    ]);

    const card = (await fetchSession("minor_chords")).cards[0];
    expect(card.topic).toBe("minor_chords");
    expect(card.chordDefName).toBe("Minor Triad");
  });

  it("does not regress existing answer-key derivation or option-shuffle", async () => {
    // Same payload as the original api-flashcards test: ensure the new
    // metadata fields do not affect _answerKey, _optionAnswers, or options.
    stubSession("chord_intervals", [
      {
        id: "c-iv-2",
        direction: "type_to_intervals",
        question: { prompt: "What are the intervals in a minor chord?" },
        correct_answer: { intervals: "1-♭3-5", name: "minor" },
        distractors: [
          { intervals: "1-3-5", name: "major" },
          { intervals: "1-♭3-♭5", name: "diminished" },
          { intervals: "1-♭3-5-♭7", name: "minor 7th" },
        ],
        stage: 0,
        options: 4,
      },
    ]);

    const card = (await fetchSession("chord_intervals")).cards[0];
    expect(card._answerKey).toBe("intervals");
    expect(card.options).toEqual(
      expect.arrayContaining(["1-3-5", "1-♭3-5", "1-♭3-♭5", "1-♭3-5-♭7"]),
    );
    expect(card.options).toHaveLength(4);
    const correctPayload = JSON.parse(card._optionAnswers["1-♭3-5"]);
    expect(correctPayload.intervals).toBe("1-♭3-5");
    expect(correctPayload.name).toBe("minor");
  });
});
