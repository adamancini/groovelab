/**
 * Learn mode tests -- topic grid, flashcard session, input methods, feedback flows.
 *
 * These are integration tests using Vitest + React Testing Library.
 * API calls are intercepted at the fetch level to provide realistic responses.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import Learn from "../pages/Learn";
import FlashcardSession from "../pages/FlashcardSession";
import MultipleChoice from "../components/flashcards/MultipleChoice";
import TypedAnswer, {
  normalizeAnswer,
} from "../components/flashcards/TypedAnswer";
import FretboardTap from "../components/flashcards/FretboardTap";
import AnswerFeedback from "../components/flashcards/AnswerFeedback";
import Fretboard from "../components/Fretboard";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TOPICS = [
  {
    id: "major-chords",
    name: "Major Chords",
    keys_mastered: 5,
    keys_total: 12,
    accuracy: 72,
  },
  {
    id: "minor-scales",
    name: "Minor Scales",
    keys_mastered: 3,
    keys_total: 12,
    accuracy: 45,
  },
  {
    id: "intervals",
    name: "Intervals",
    keys_mastered: 12,
    keys_total: 12,
    accuracy: 98,
  },
];

const MOCK_SESSION = {
  session_id: "sess-001",
  topic: "major-chords",
  cards: [
    {
      id: "card-1",
      question: "What are the tones of C Major?",
      stage: 0 as const,
      options: ["C E G", "C Eb G", "C E G#", "C F G"],
    },
    {
      id: "card-2",
      question: "What are the tones of D Major?",
      stage: 1 as const,
      options: ["D F# A", "D F A", "D Gb A"],
    },
    {
      id: "card-3",
      question: "Spell E Major",
      stage: 2 as const,
    },
    {
      id: "card-4",
      question: "Tap the C Major triad on the fretboard",
      stage: 3 as const,
      fretboard_positions: [
        { string: 2, fret: 3, label: "C" },
        { string: 1, fret: 2, label: "E" },
        { string: 0, fret: 0, label: "G" },
      ],
    },
  ],
};

const MOCK_ANSWER_CORRECT = {
  correct: true,
  correct_answer: "C E G",
  explanation: "1st, 3rd, 5th of the C major scale",
  next_card: MOCK_SESSION.cards[1],
  session_progress: {
    answered: 1,
    total: 4,
    correct: 1,
    streak: 1,
    new_cards: 1,
    review_cards: 0,
  },
};

const MOCK_ANSWER_WRONG = {
  correct: false,
  correct_answer: "C E G",
  explanation: "The major triad uses the 1st, 3rd, and 5th scale degrees",
  next_card: MOCK_SESSION.cards[1],
  session_progress: {
    answered: 1,
    total: 4,
    correct: 0,
    streak: 0,
    new_cards: 1,
    review_cards: 0,
  },
  correct_positions: [
    { string: 2, fret: 3, label: "C" },
    { string: 1, fret: 2, label: "E" },
    { string: 0, fret: 0, label: "G" },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(urlMap: Record<string, unknown>) {
  return vi.fn((url: string) => {
    for (const [pattern, data] of Object.entries(urlMap)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(data),
        });
      }
    }
    // Default: 401 (for auth /me endpoint)
    return Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "not authenticated" }),
    });
  });
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>{ui}</BrowserRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Topic Grid
// ---------------------------------------------------------------------------

describe("Learn (topic grid)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({ "/flashcards/topics": MOCK_TOPICS }));
    localStorage.clear();
  });

  it("renders topic grid with API data", async () => {
    renderWithProviders(<Learn />);

    await screen.findByText("Major Chords");
    expect(screen.getByText("Minor Scales")).toBeInTheDocument();
    expect(screen.getByText("Intervals")).toBeInTheDocument();
    expect(screen.getByTestId("topic-grid")).toBeInTheDocument();
  });

  it("shows accuracy percentage for each topic", async () => {
    renderWithProviders(<Learn />);

    await screen.findByText("Major Chords");
    expect(screen.getByText("72% accuracy")).toBeInTheDocument();
    expect(screen.getByText("45% accuracy")).toBeInTheDocument();
    expect(screen.getByText("98% accuracy")).toBeInTheDocument();
  });

  it("shows mastery dots for each topic", async () => {
    renderWithProviders(<Learn />);

    await screen.findByText("Major Chords");
    // Each topic card has 12 dots
    const majorChordCard = screen.getByTestId("topic-card-major-chords");
    const dots = majorChordCard.querySelectorAll("span[aria-hidden]");
    expect(dots).toHaveLength(12);
  });

  it("links each topic to /learn/:topic", async () => {
    renderWithProviders(<Learn />);

    await screen.findByText("Major Chords");
    const link = screen.getByTestId("topic-card-major-chords");
    expect(link).toHaveAttribute("href", "/learn/major-chords");
  });

  it("shows loading state initially", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // Never resolves
    );
    renderWithProviders(<Learn />);
    expect(screen.getByText("Loading topics...")).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "server error" }),
        }),
      ),
    );
    renderWithProviders(<Learn />);
    await screen.findByText("server error");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multiple Choice Input
// ---------------------------------------------------------------------------

describe("MultipleChoice", () => {
  it("renders 4 options in 2x2 grid for stage 0", () => {
    const onSelect = vi.fn();
    render(
      <MultipleChoice
        options={["C E G", "C Eb G", "C E G#", "C F G"]}
        stage={0}
        onSelect={onSelect}
      />,
    );

    const group = screen.getByTestId("multiple-choice");
    expect(group).toBeInTheDocument();
    expect(group.classList.toString()).toContain("grid-cols-2");
    expect(screen.getByTestId("option-C E G")).toBeInTheDocument();
    expect(screen.getByTestId("option-C Eb G")).toBeInTheDocument();
    expect(screen.getByTestId("option-C E G#")).toBeInTheDocument();
    expect(screen.getByTestId("option-C F G")).toBeInTheDocument();
  });

  it("renders 3 options for stage 1", () => {
    const onSelect = vi.fn();
    render(
      <MultipleChoice
        options={["D F# A", "D F A", "D Gb A"]}
        stage={1}
        onSelect={onSelect}
      />,
    );

    const group = screen.getByTestId("multiple-choice");
    expect(group.classList.toString()).toContain("grid-cols-3");
    expect(screen.getByTestId("option-D F# A")).toBeInTheDocument();
    expect(screen.getByTestId("option-D F A")).toBeInTheDocument();
    expect(screen.getByTestId("option-D Gb A")).toBeInTheDocument();
  });

  it("calls onSelect with chosen option", () => {
    const onSelect = vi.fn();
    render(
      <MultipleChoice
        options={["A", "B", "C", "D"]}
        stage={0}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("option-B"));
    expect(onSelect).toHaveBeenCalledWith("B");
  });

  it("disables options after selection", () => {
    const onSelect = vi.fn();
    render(
      <MultipleChoice
        options={["A", "B", "C", "D"]}
        stage={0}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("option-A"));
    // Try clicking another -- should not fire again
    fireEvent.click(screen.getByTestId("option-B"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks selected option with aria-pressed", () => {
    const onSelect = vi.fn();
    render(
      <MultipleChoice
        options={["A", "B", "C", "D"]}
        stage={0}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("option-C"));
    expect(screen.getByTestId("option-C")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
// Typed Answer Input
// ---------------------------------------------------------------------------

describe("TypedAnswer", () => {
  it("renders text input and submit button", () => {
    const onSubmit = vi.fn();
    render(<TypedAnswer onSubmit={onSubmit} />);

    expect(screen.getByTestId("typed-input")).toBeInTheDocument();
    expect(screen.getByTestId("submit-answer")).toBeInTheDocument();
  });

  it("submits normalized answer on button click", () => {
    const onSubmit = vi.fn();
    render(<TypedAnswer onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("typed-input"), {
      target: { value: "C E G" },
    });
    fireEvent.click(screen.getByTestId("submit-answer"));
    expect(onSubmit).toHaveBeenCalledWith("c, e, g");
  });

  it("submits on Enter key", () => {
    const onSubmit = vi.fn();
    render(<TypedAnswer onSubmit={onSubmit} />);

    const input = screen.getByTestId("typed-input");
    fireEvent.change(input, { target: { value: "A B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("a, b");
  });

  it("does not submit empty input", () => {
    const onSubmit = vi.fn();
    render(<TypedAnswer onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("submit-answer"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables after submission", () => {
    const onSubmit = vi.fn();
    render(<TypedAnswer onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("typed-input"), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByTestId("submit-answer"));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Second click should not fire
    fireEvent.click(screen.getByTestId("submit-answer"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeAnswer (forgiving parser)", () => {
  it("is case-insensitive", () => {
    expect(normalizeAnswer("C E G")).toBe("c, e, g");
  });

  it("accepts comma separators", () => {
    expect(normalizeAnswer("c,e,g")).toBe("c, e, g");
  });

  it("accepts space separators", () => {
    expect(normalizeAnswer("c e g")).toBe("c, e, g");
  });

  it("accepts mixed comma+space separators", () => {
    expect(normalizeAnswer("c, e, g")).toBe("c, e, g");
  });

  it("is order-insensitive (sorts tokens)", () => {
    expect(normalizeAnswer("G E C")).toBe("c, e, g");
    expect(normalizeAnswer("e c g")).toBe("c, e, g");
  });

  it("trims whitespace", () => {
    expect(normalizeAnswer("  c , e , g  ")).toBe("c, e, g");
  });

  it("handles single token", () => {
    expect(normalizeAnswer("Bb")).toBe("bb");
  });

  it("handles sharp/flat notation", () => {
    expect(normalizeAnswer("F# A C#")).toBe("a, c#, f#");
  });

  it("handles multiple spaces between tokens", () => {
    expect(normalizeAnswer("c   e   g")).toBe("c, e, g");
  });
});

// ---------------------------------------------------------------------------
// Fretboard Tap Input
// ---------------------------------------------------------------------------

describe("FretboardTap", () => {
  it("renders fretboard with Submit and Clear buttons", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    expect(screen.getByTestId("fretboard-tap")).toBeInTheDocument();
    expect(screen.getByTestId("fretboard")).toBeInTheDocument();
    expect(screen.getByTestId("submit-fretboard")).toBeInTheDocument();
    expect(screen.getByTestId("clear-fretboard")).toBeInTheDocument();
  });

  it("highlights tapped positions", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    // Tap a fret position
    const fretCell = screen.getByTestId("fret-1-3");
    fireEvent.click(fretCell);

    // Should show "1 position selected"
    expect(screen.getByText("1 position selected")).toBeInTheDocument();
  });

  it("clears selected positions", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("fret-1-3"));
    expect(screen.getByText("1 position selected")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("clear-fretboard"));
    expect(screen.queryByText(/position/)).not.toBeInTheDocument();
  });

  it("submits selected positions", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("fret-0-5"));
    fireEvent.click(screen.getByTestId("fret-1-3"));
    fireEvent.click(screen.getByTestId("submit-fretboard"));

    expect(onSubmit).toHaveBeenCalledWith([
      { string: 0, fret: 5 },
      { string: 1, fret: 3 },
    ]);
  });

  it("toggles position off when tapped again", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("fret-1-3"));
    expect(screen.getByText("1 position selected")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("fret-1-3"));
    expect(screen.queryByText(/position/)).not.toBeInTheDocument();
  });

  it("disables Submit when no positions are selected", () => {
    const onSubmit = vi.fn();
    render(<FretboardTap onSubmit={onSubmit} />);

    expect(screen.getByTestId("submit-fretboard")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Fretboard SVG Renderer
// ---------------------------------------------------------------------------

describe("Fretboard", () => {
  it("renders an SVG with correct role for display-only mode", () => {
    render(<Fretboard positions={[]} />);
    const svg = screen.getByTestId("fretboard");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
  });

  it("renders with grid role when onTap is provided", () => {
    render(<Fretboard positions={[]} onTap={() => {}} />);
    const svg = screen.getByTestId("fretboard");
    expect(svg).toHaveAttribute("role", "grid");
  });

  it("renders interactive tap zones with proper labels", () => {
    render(<Fretboard positions={[]} onTap={() => {}} strings={4} frets={5} />);
    // Check for a specific fret cell
    const cell = screen.getByTestId("fret-0-3");
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveAttribute("aria-label", "String 1, fret 3");
  });

  it("renders in mini size", () => {
    render(<Fretboard positions={[]} size="mini" />);
    expect(screen.getByTestId("fretboard")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Answer Feedback
// ---------------------------------------------------------------------------

describe("AnswerFeedback", () => {
  it("shows correct answer feedback with Continue button", () => {
    const onContinue = vi.fn();
    render(
      <AnswerFeedback
        correct={true}
        correctAnswer="C E G"
        explanation="1st, 3rd, 5th of the C major scale"
        onContinue={onContinue}
      />,
    );

    expect(screen.getByTestId("feedback-correct")).toHaveTextContent("C E G");
    expect(screen.getByTestId("feedback-explanation")).toHaveTextContent(
      "1st, 3rd, 5th of the C major scale",
    );
    expect(screen.getByTestId("continue-button")).toBeInTheDocument();
  });

  it("calls onContinue when Continue is clicked", () => {
    const onContinue = vi.fn();
    render(
      <AnswerFeedback
        correct={true}
        correctAnswer="C E G"
        explanation="test"
        onContinue={onContinue}
      />,
    );

    fireEvent.click(screen.getByTestId("continue-button"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows wrong answer teaching feedback without punishment language", () => {
    const onContinue = vi.fn();
    render(
      <AnswerFeedback
        correct={false}
        correctAnswer="C E G"
        explanation="The major triad uses the 1st, 3rd, and 5th scale degrees"
        correctPositions={[
          { string: 2, fret: 3, label: "C" },
          { string: 1, fret: 2, label: "E" },
        ]}
        onContinue={onContinue}
      />,
    );

    // Teaching language
    expect(screen.getByText("The correct answer is:")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-correct-answer")).toHaveTextContent(
      "C E G",
    );
    expect(screen.getByTestId("feedback-explanation")).toBeInTheDocument();

    // "Got it" button, not "Continue"
    expect(screen.getByTestId("got-it-button")).toBeInTheDocument();
    expect(screen.queryByTestId("continue-button")).not.toBeInTheDocument();

    // No punishment language
    const feedbackEl = screen.getByTestId("answer-feedback");
    expect(feedbackEl.textContent).not.toMatch(/wrong/i);
    expect(feedbackEl.textContent).not.toMatch(/incorrect/i);
  });

  it("shows mini fretboard on wrong answer with positions", () => {
    render(
      <AnswerFeedback
        correct={false}
        correctAnswer="C E G"
        explanation="test"
        correctPositions={[
          { string: 2, fret: 3, label: "C" },
          { string: 1, fret: 2, label: "E" },
        ]}
        onContinue={() => {}}
      />,
    );

    expect(screen.getByTestId("feedback-fretboard")).toBeInTheDocument();
  });

  it("does not show fretboard when no positions provided", () => {
    render(
      <AnswerFeedback
        correct={false}
        correctAnswer="C E G"
        explanation="test"
        onContinue={() => {}}
      />,
    );

    expect(screen.queryByTestId("feedback-fretboard")).not.toBeInTheDocument();
  });

  it("has accessible status role", () => {
    render(
      <AnswerFeedback
        correct={true}
        correctAnswer="A"
        explanation="x"
        onContinue={() => {}}
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Flashcard Session Page (integration)
// ---------------------------------------------------------------------------

describe("FlashcardSession", () => {
  beforeEach(() => {
    // Set the URL to /learn/major-chords so useParams picks up the topic.
    window.history.pushState({}, "", "/learn/major-chords");
    localStorage.clear();
  });

  it("shows loading state initially", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderWithProviders(<FlashcardSession />);
    expect(screen.getByText("Loading session...")).toBeInTheDocument();
  });

  it("renders breadcrumb and session progress", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/flashcards/session": MOCK_SESSION }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("breadcrumb");
    expect(screen.getByTestId("session-progress")).toBeInTheDocument();
    expect(screen.getByText("0/4")).toBeInTheDocument();
  });

  it("displays question text from first card", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/flashcards/session": MOCK_SESSION }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("question-text");
    expect(screen.getByTestId("question-text")).toHaveTextContent(
      "What are the tones of C Major?",
    );
  });

  it("renders multiple choice input for stage 0 card", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/flashcards/session": MOCK_SESSION }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("multiple-choice");
    expect(screen.getByTestId("option-C E G")).toBeInTheDocument();
  });

  it("shows skip button on every card", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/flashcards/session": MOCK_SESSION }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("skip-button");
    expect(screen.getByTestId("skip-button")).toBeInTheDocument();
  });

  it("shows correct answer feedback after correct choice", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/flashcards/session": MOCK_SESSION,
        "/flashcards/answer": MOCK_ANSWER_CORRECT,
      }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("option-C E G");
    fireEvent.click(screen.getByTestId("option-C E G"));

    await screen.findByTestId("answer-feedback");
    expect(screen.getByTestId("feedback-correct")).toHaveTextContent("C E G");
    expect(screen.getByTestId("continue-button")).toBeInTheDocument();
  });

  it("shows teaching feedback after wrong choice without punishment language", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/flashcards/session": MOCK_SESSION,
        "/flashcards/answer": MOCK_ANSWER_WRONG,
      }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("option-C Eb G");
    fireEvent.click(screen.getByTestId("option-C Eb G"));

    await screen.findByTestId("answer-feedback");
    expect(screen.getByText("The correct answer is:")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-correct-answer")).toHaveTextContent(
      "C E G",
    );
    expect(screen.getByTestId("got-it-button")).toBeInTheDocument();

    // Verify no punishment language
    const feedback = screen.getByTestId("answer-feedback");
    expect(feedback.textContent).not.toMatch(/wrong/i);
    expect(feedback.textContent).not.toMatch(/incorrect/i);
  });

  it("advances to next card after Continue", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/flashcards/session": MOCK_SESSION,
        "/flashcards/answer": MOCK_ANSWER_CORRECT,
      }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("option-C E G");
    fireEvent.click(screen.getByTestId("option-C E G"));

    await screen.findByTestId("continue-button");
    fireEvent.click(screen.getByTestId("continue-button"));

    // The next card (stage 1) should be displayed.
    await screen.findByTestId("question-text");
    expect(screen.getByTestId("question-text")).toHaveTextContent(
      "What are the tones of D Major?",
    );
  });

  it("shows session summary with accuracy and streak after all cards", async () => {
    const finalAnswer = {
      correct: true,
      correct_answer: "C E G",
      explanation: "done",
      next_card: null,
      session_progress: {
        answered: 4,
        total: 4,
        correct: 3,
        streak: 2,
        new_cards: 3,
        review_cards: 1,
      },
    };

    // Start with a session that has only 1 card
    const singleCardSession = {
      session_id: "sess-single",
      topic: "major-chords",
      cards: [MOCK_SESSION.cards[0]],
    };

    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/flashcards/session": singleCardSession,
        "/flashcards/answer": finalAnswer,
      }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("option-C E G");
    fireEvent.click(screen.getByTestId("option-C E G"));

    await screen.findByTestId("continue-button");
    fireEvent.click(screen.getByTestId("continue-button"));

    await screen.findByTestId("session-summary");
    expect(screen.getByTestId("summary-accuracy")).toHaveTextContent("75%");
    expect(screen.getByTestId("summary-streak")).toHaveTextContent("2");
    expect(screen.getByTestId("summary-new")).toHaveTextContent("3");
    expect(screen.getByTestId("summary-reviewed")).toHaveTextContent("1");
  });

  it("shows guest sign-in prompt on session summary when not authenticated", async () => {
    const finalAnswer = {
      correct: true,
      correct_answer: "A",
      explanation: "done",
      next_card: null,
      session_progress: {
        answered: 1,
        total: 1,
        correct: 1,
        streak: 1,
        new_cards: 1,
        review_cards: 0,
      },
    };

    const singleCardSession = {
      session_id: "sess-guest",
      topic: "major-chords",
      cards: [MOCK_SESSION.cards[0]],
    };

    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/flashcards/session": singleCardSession,
        "/flashcards/answer": finalAnswer,
      }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("option-C E G");
    fireEvent.click(screen.getByTestId("option-C E G"));

    await screen.findByTestId("continue-button");
    fireEvent.click(screen.getByTestId("continue-button"));

    await screen.findByTestId("session-summary");
    expect(screen.getByTestId("guest-prompt")).toBeInTheDocument();
    expect(
      screen.getByText("Sign in to save your progress"),
    ).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "session error" }),
        }),
      ),
    );
    renderWithProviders(<FlashcardSession />);
    await screen.findByText("session error");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("skips card without counting as wrong", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/flashcards/session": MOCK_SESSION }),
    );
    renderWithProviders(<FlashcardSession />);

    await screen.findByTestId("skip-button");
    fireEvent.click(screen.getByTestId("skip-button"));

    // Should advance to the next card
    await waitFor(() => {
      expect(screen.getByTestId("question-text")).toHaveTextContent(
        "What are the tones of D Major?",
      );
    });
  });
});
