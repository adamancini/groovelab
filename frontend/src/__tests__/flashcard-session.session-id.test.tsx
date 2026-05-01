/**
 * Tests for GRO-uzk3 (session_id threading).
 *
 * Primary regression: the frontend did not pass session_id on
 * POST /api/v1/flashcards/answer, so the backend's
 * `r.URL.Query().Get("session_id")` returned "" and session_progress
 * came back {0,0,0,0} for every answer. This test exercises the
 * submitAnswer() contract directly (fetch-mock, URL assertion) and
 * the FlashcardSession component (component mount -> click answer ->
 * assert the URL the component POSTed to carries the session_id
 * that was returned by the originating /flashcards/session call).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { InstrumentProvider } from "../context/InstrumentContext";
import { ThemeProvider } from "../context/ThemeContext";
import FlashcardSession from "../pages/FlashcardSession";
import { submitAnswer } from "../lib/api";

// --- Tone.js mock: jsdom has no AudioContext; avoid network for samples. ---
vi.mock("tone", () => {
  class Sampler {
    public volume = { value: 0 };
    toDestination() {
      return this;
    }
    triggerAttackRelease() {}
    releaseAll() {}
    dispose() {}
  }
  return {
    Sampler,
    start: vi.fn().mockResolvedValue(undefined),
    loaded: vi.fn().mockResolvedValue(undefined),
    getContext: () => ({ state: "running" }),
  };
});

// ---------- submitAnswer() unit tests -------------------------------------

describe("submitAnswer (GRO-uzk3 session_id threading)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("appends ?session_id=<encoded> to the POST URL", async () => {
    const mock = globalThis.fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          correct: true,
          correct_answer: { name: "G major" },
          explanation: "Correct!",
          session_progress: { answered: 1, total: 3, correct: 1, incorrect: 0 },
        }),
    } as Response);

    await submitAnswer(
      "card-1",
      JSON.stringify({ name: "G major" }),
      "multiple_choice",
      "sess-abc-123",
    );

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("/api/v1/flashcards/answer?session_id=sess-abc-123");
    expect(init).toMatchObject({ method: "POST" });
    const body = JSON.parse(init.body as string);
    expect(body.card_id).toBe("card-1");
    expect(body.input_method).toBe("multiple_choice");
    expect(body.answer).toEqual({ name: "G major" });
  });

  it("url-encodes session_id characters that need escaping", async () => {
    const mock = globalThis.fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          correct: false,
          correct_answer: {},
          explanation: "Incorrect.",
          session_progress: { answered: 1, total: 1, correct: 0, incorrect: 1 },
        }),
    } as Response);

    await submitAnswer(
      "card-2",
      JSON.stringify({ name: "?" }),
      "multiple_choice",
      "weird id/with&chars",
    );

    const [url] = mock.mock.calls[0];
    // encodeURIComponent("weird id/with&chars") -> "weird%20id%2Fwith%26chars"
    expect(url).toBe(
      "/api/v1/flashcards/answer?session_id=weird%20id%2Fwith%26chars",
    );
  });
});

// ---------- Component-level test ------------------------------------------

interface MockCard {
  id: string;
  direction: string;
  question: { prompt: string };
  correct_answer: Record<string, string>;
  distractors?: Record<string, string>[];
  stage: number;
  options: number;
}

function majorCard(id: string): MockCard {
  return {
    id,
    direction: "name_to_notes",
    question: { prompt: `What are the notes in G major? (${id})` },
    correct_answer: { name: "G major", notes: "G B D" },
    distractors: [
      { name: "Ab major", notes: "Ab C Eb" },
      { name: "A major", notes: "A C# E" },
      { name: "Bb major", notes: "Bb D F" },
    ],
    stage: 0,
    options: 4,
  };
}

function renderSession() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <InstrumentProvider>
          <MemoryRouter initialEntries={["/learn/major_chords"]}>
            <Routes>
              <Route path="/learn/:topic" element={<FlashcardSession />} />
            </Routes>
          </MemoryRouter>
        </InstrumentProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe("FlashcardSession threads session_id to submitAnswer (GRO-uzk3)", () => {
  it("POSTs to /flashcards/answer?session_id=<id from GET /session>", async () => {
    // answerUrls captures every /flashcards/answer URL the component POSTs.
    // Assertion: each URL contains the session_id that was returned by the
    // initial /flashcards/session response.
    const answerUrls: string[] = [];
    const SESSION_ID = "sess-under-test-xyz";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: "not authenticated" }),
          });
        }
        if (url.includes("/flashcards/session")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                session_id: SESSION_ID,
                topic: "major_chords",
                cards: [majorCard("card-1"), majorCard("card-2")],
                total: 2,
              }),
          });
        }
        if (url.includes("/flashcards/answer")) {
          answerUrls.push(url);
          expect(init?.method).toBe("POST");
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                correct: true,
                correct_answer: { name: "G major", notes: "G B D" },
                explanation: "Correct!",
                session_progress: {
                  answered: 1,
                  total: 2,
                  correct: 1,
                  incorrect: 0,
                },
              }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "not found" }),
        });
      }),
    );

    renderSession();

    // Wait for the question to render (session GET completed).
    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });

    // Click the correct answer.
    const correctBtn = await screen.findByRole("button", { name: /G B D/ });
    fireEvent.click(correctBtn);

    await waitFor(() => {
      expect(answerUrls.length).toBeGreaterThanOrEqual(1);
    });

    // The POST URL must carry the session_id returned by /flashcards/session.
    expect(answerUrls[0]).toBe(
      `/api/v1/flashcards/answer?session_id=${SESSION_ID}`,
    );
  });
});
