/**
 * Unit tests for fetchSession's transformSessionCard (the raw-to-display
 * transform for flashcards). Covers the type_to_intervals direction
 * added in GRO-rfoz.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSession } from "../lib/api";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

function stubSession(cards: unknown[]): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        session_id: "s1",
        topic: "chord_intervals",
        cards,
        total: cards.length,
      }),
  } as Response);
}

describe("transformSessionCard (via fetchSession)", () => {
  it("sets _answerKey to 'intervals' for type_to_intervals cards", async () => {
    stubSession([
      {
        id: "c1",
        direction: "type_to_intervals",
        question: { prompt: "What are the intervals in a major chord?" },
        correct_answer: { intervals: "1-3-5", name: "major" },
        distractors: [
          { intervals: "1-♭3-5", name: "minor" },
          { intervals: "1-♭3-♭5", name: "diminished" },
          { intervals: "1-3-♯5", name: "augmented" },
        ],
        stage: 0,
        options: 4,
      },
    ]);

    const session = await fetchSession("chord_intervals");
    const card = session.cards[0];

    expect(card._answerKey).toBe("intervals");
    // All four interval strings should be present as options.
    expect(card.options).toBeDefined();
    expect(card.options).toEqual(
      expect.arrayContaining(["1-3-5", "1-♭3-5", "1-♭3-♭5", "1-3-♯5"]),
    );
    expect(card.options).toHaveLength(4);
  });

  it("sets _answerKey to 'name' for notes_to_name cards", async () => {
    stubSession([
      {
        id: "c2",
        direction: "notes_to_name",
        question: { prompt: "Name this chord: G B D" },
        correct_answer: { name: "G major", notes: "G B D" },
        distractors: [
          { name: "G minor", notes: "G Bb D" },
          { name: "G dominant 7th", notes: "G B D F" },
          { name: "G augmented", notes: "G B Eb" },
        ],
        stage: 0,
        options: 4,
      },
    ]);

    const card = (await fetchSession("major_chords")).cards[0];
    expect(card._answerKey).toBe("name");
    expect(card.options).toEqual(
      expect.arrayContaining(["G major", "G minor", "G dominant 7th", "G augmented"]),
    );
  });

  it("sets _answerKey to 'notes' for name_to_notes cards", async () => {
    stubSession([
      {
        id: "c3",
        direction: "name_to_notes",
        question: { prompt: "What are the notes in G major?" },
        correct_answer: { name: "G major", notes: "G B D" },
        distractors: [
          { name: "Ab major", notes: "Ab C Eb" },
          { name: "A major", notes: "A C# E" },
          { name: "Bb major", notes: "Bb D F" },
        ],
        stage: 0,
        options: 4,
      },
    ]);

    const card = (await fetchSession("major_chords")).cards[0];
    expect(card._answerKey).toBe("notes");
    expect(card.options).toEqual(
      expect.arrayContaining(["G B D", "Ab C Eb", "A C# E", "Bb D F"]),
    );
  });

  it("builds _optionAnswers map back to the original JSON payloads", async () => {
    stubSession([
      {
        id: "c4",
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
    // Clicking "1-♭3-5" should POST the full correct-answer JSON object.
    const correctPayload = JSON.parse(card._optionAnswers["1-♭3-5"]);
    expect(correctPayload.intervals).toBe("1-♭3-5");
    expect(correctPayload.name).toBe("minor");
  });
});
