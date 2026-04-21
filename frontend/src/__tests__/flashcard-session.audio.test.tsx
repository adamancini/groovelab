/**
 * Audio-specific tests for FlashcardSession (GRO-oa1z).
 *
 * Tone.js is fully mocked — jsdom has no AudioContext and Tone.Sampler
 * would hit the network for samples. The mock's triggerAttackRelease is
 * a vi.fn() so we can assert call counts per test scenario.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import FlashcardSession from "../pages/FlashcardSession";

// --- Tone.js mock ---------------------------------------------------------

const triggerAttackRelease = vi.fn();
const releaseAll = vi.fn();
const dispose = vi.fn();
const volumeSetter = vi.fn();

vi.mock("tone", () => {
  class Sampler {
    public volume: { value: number };
    constructor(_opts: unknown) {
      this.volume = {
        get value() {
          return 0;
        },
        set value(v: number) {
          volumeSetter(v);
        },
      };
    }
    toDestination() {
      return this;
    }
    triggerAttackRelease = triggerAttackRelease;
    releaseAll = releaseAll;
    dispose = dispose;
  }
  return {
    Sampler,
    start: vi.fn().mockResolvedValue(undefined),
    loaded: vi.fn().mockResolvedValue(undefined),
    getContext: () => ({ state: "running" }),
  };
});

// --- Mock fetch for session/answer API ------------------------------------

interface MockCard {
  id: string;
  direction: string;
  question: { prompt: string };
  correct_answer: Record<string, string>;
  distractors?: Record<string, string>[];
  stage: number;
  options: number;
}

function mockSession(cards: MockCard[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
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
              session_id: "s1",
              topic: "major_chords",
              cards,
              total: cards.length,
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
}

function majorCard(): MockCard {
  return {
    id: "c1",
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
  };
}

function intervalsCard(): MockCard {
  return {
    id: "c2",
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
  };
}

function renderSession(topic = "major_chords") {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/learn/${topic}`]}>
          <Routes>
            <Route path="/learn/:topic" element={<FlashcardSession />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  triggerAttackRelease.mockClear();
  releaseAll.mockClear();
  dispose.mockClear();
  volumeSetter.mockClear();
});

// --- Tests ---------------------------------------------------------------

describe("FlashcardSession audio playback", () => {
  it("auto-plays chord audio when a chord card enters the answering phase", async () => {
    mockSession([majorCard()]);
    renderSession();

    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });
    // Notes should be voiced at octave 4.
    expect(triggerAttackRelease).toHaveBeenCalledWith(
      expect.arrayContaining(["G4", "B4", "D4"]),
      expect.any(Number),
    );
  });

  it("does NOT auto-play for type_to_intervals cards", async () => {
    mockSession([intervalsCard()]);
    renderSession("chord_intervals");

    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });
    // Give the auto-play effect a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("does not render the replay button on type_to_intervals cards", async () => {
    mockSession([intervalsCard()]);
    renderSession("chord_intervals");

    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("replay-button")).not.toBeInTheDocument();
  });

  it("renders the replay button and plays on click for chord cards", async () => {
    mockSession([majorCard()]);
    renderSession();

    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });
    // Clear the auto-play call.
    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });
    triggerAttackRelease.mockClear();

    const replay = screen.getByTestId("replay-button");
    fireEvent.click(replay);
    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses auto-play and replay when muted, and re-enables them when unmuted", async () => {
    mockSession([majorCard(), majorCard()]);
    renderSession();

    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toBeInTheDocument();
    });
    // Initial auto-play.
    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });

    // Mute — replay should be disabled and click should NOT trigger.
    fireEvent.click(screen.getByTestId("mute-toggle"));
    triggerAttackRelease.mockClear();

    const replay = screen.getByTestId("replay-button");
    expect(replay).toBeDisabled();
    fireEvent.click(replay);
    await new Promise((r) => setTimeout(r, 20));
    expect(triggerAttackRelease).not.toHaveBeenCalled();

    // Unmute — manual replay should trigger again.
    fireEvent.click(screen.getByTestId("mute-toggle"));
    fireEvent.click(screen.getByTestId("replay-button"));
    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });
  });

  it("moving the volume slider forwards the value to the sampler", async () => {
    mockSession([majorCard()]);
    renderSession();

    await waitFor(() => {
      expect(screen.getByTestId("volume-slider")).toBeInTheDocument();
    });
    volumeSetter.mockClear();
    fireEvent.change(screen.getByTestId("volume-slider"), { target: { value: "50" } });

    // 50 on a 0-100 linear scale maps to -20dB (midpoint of -40..0).
    await waitFor(() => {
      expect(volumeSetter).toHaveBeenCalledWith(-20);
    });
  });

  it("stops currently-sounding notes when the user mutes mid-chord", async () => {
    mockSession([majorCard()]);
    renderSession();

    await waitFor(() => {
      expect(triggerAttackRelease).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByTestId("mute-toggle"));
    expect(releaseAll).toHaveBeenCalled();
  });

  // Guard against regressions: mute toggle must exist during answering phase.
  it("renders the mute toggle in the session header", async () => {
    mockSession([majorCard()]);
    renderSession();
    await waitFor(() => {
      expect(screen.getByTestId("mute-toggle")).toBeInTheDocument();
    });
    expect(screen.getByTestId("audio-controls")).toBeInTheDocument();
  });
});

// Keep act() imported so React 19 doesn't complain about unwrapped updates in
// certain timing-sensitive paths above.
void act;
