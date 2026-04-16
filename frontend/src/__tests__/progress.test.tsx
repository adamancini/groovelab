/**
 * Progress dashboard integration tests.
 *
 * Tests dashboard rendering, API data display, stat cards,
 * mastery bars, weak areas, and auth-gated behavior.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import Progress from "../pages/Progress";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_USER = {
  id: "user-1",
  email: "test@example.com",
  role: "user",
};

const MOCK_DASHBOARD = {
  overall_accuracy: 75,
  cards_mastered: 24,
  cards_total: 60,
  topics: [
    {
      topic: "Major Chords",
      accuracy: 85,
      cards_mastered: 10,
      cards_total: 12,
    },
    {
      topic: "Minor Scales",
      accuracy: 62,
      cards_mastered: 7,
      cards_total: 12,
    },
    {
      topic: "Intervals",
      accuracy: 45,
      cards_mastered: 3,
      cards_total: 12,
    },
  ],
  weak_cards: [
    {
      card_id: "wc-1",
      question: "What are the tones of Gb Major?",
      accuracy: 30,
      topic: "Major Chords",
    },
    {
      card_id: "wc-2",
      question: "Spell the B Minor scale",
      accuracy: 40,
      topic: "Minor Scales",
    },
  ],
};

const MOCK_STREAKS = {
  current_streak: 5,
  best_streak: 12,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function renderProgress() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/progress"]}>
          <Routes>
            <Route path="/progress" element={<Progress />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

function setupAuthenticatedMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_USER),
        });
      }
      if (url.includes("/progress/dashboard")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_DASHBOARD),
        });
      }
      if (url.includes("/progress/streaks")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_STREAKS),
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

function setupUnauthenticatedMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "not authenticated" }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Unauthenticated behavior
// ---------------------------------------------------------------------------

describe("Progress page (unauthenticated)", () => {
  beforeEach(() => {
    setupUnauthenticatedMock();
  });

  it("shows sign-in prompt for unauthenticated users", async () => {
    renderProgress();
    await waitFor(() => {
      expect(
        screen.getByText("Sign in to track your learning progress."),
      ).toBeInTheDocument();
    });
  });

  it("has a link to the sign-in page", async () => {
    renderProgress();
    await waitFor(() => {
      const signInLink = screen.getByRole("link", { name: "Sign in" });
      expect(signInLink).toHaveAttribute("href", "/auth/signin");
    });
  });
});

// ---------------------------------------------------------------------------
// Authenticated behavior -- summary stats
// ---------------------------------------------------------------------------

describe("Progress page (authenticated)", () => {
  beforeEach(() => {
    setupAuthenticatedMock();
  });

  it("renders the page heading", async () => {
    renderProgress();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Progress" }),
      ).toBeInTheDocument();
    });
  });

  it("shows overall accuracy", async () => {
    renderProgress();
    await waitFor(() => {
      const stat = screen.getByTestId("stat-accuracy");
      expect(stat).toHaveTextContent("75%");
    });
  });

  it("shows daily streak", async () => {
    renderProgress();
    await waitFor(() => {
      const stat = screen.getByTestId("stat-streak");
      expect(stat).toHaveTextContent("5 days");
    });
  });

  it("shows best streak", async () => {
    renderProgress();
    await waitFor(() => {
      const stat = screen.getByTestId("stat-best-streak");
      expect(stat).toHaveTextContent("12 days");
    });
  });

  it("shows cards mastered / total", async () => {
    renderProgress();
    await waitFor(() => {
      const stat = screen.getByTestId("stat-cards");
      expect(stat).toHaveTextContent("24 / 60");
    });
  });
});

// ---------------------------------------------------------------------------
// Mastery by topic
// ---------------------------------------------------------------------------

describe("Progress page -- mastery by topic", () => {
  beforeEach(() => {
    setupAuthenticatedMock();
  });

  it("renders mastery heading", async () => {
    renderProgress();
    await waitFor(() => {
      expect(screen.getByTestId("mastery-heading")).toHaveTextContent(
        "Mastery by Topic",
      );
    });
  });

  it("renders a bar for each topic", async () => {
    renderProgress();
    await waitFor(() => {
      expect(
        screen.getByTestId("topic-bar-Major Chords"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("topic-bar-Minor Scales"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("topic-bar-Intervals")).toBeInTheDocument();
    });
  });

  it("each bar shows the topic name and percentage", async () => {
    renderProgress();
    await waitFor(() => {
      const majorBar = screen.getByTestId("topic-bar-Major Chords");
      expect(majorBar).toHaveTextContent("Major Chords");
      expect(majorBar).toHaveTextContent("85%");
    });
  });

  it("each bar has a progressbar role with correct value", async () => {
    renderProgress();
    await waitFor(() => {
      const progressbars = screen.getAllByRole("progressbar");
      expect(progressbars.length).toBe(3);
      // Major Chords = 85%
      const majorBar = progressbars.find(
        (bar) => bar.getAttribute("aria-valuenow") === "85",
      );
      expect(majorBar).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Weak areas
// ---------------------------------------------------------------------------

describe("Progress page -- weak areas", () => {
  beforeEach(() => {
    setupAuthenticatedMock();
  });

  it("renders weak areas heading", async () => {
    renderProgress();
    await waitFor(() => {
      expect(screen.getByTestId("weak-areas-heading")).toHaveTextContent(
        "Weak Areas",
      );
    });
  });

  it("lists cards with < 50% accuracy", async () => {
    renderProgress();
    await waitFor(() => {
      expect(screen.getByTestId("weak-card-wc-1")).toBeInTheDocument();
      expect(screen.getByTestId("weak-card-wc-2")).toBeInTheDocument();
    });
  });

  it("shows card question and accuracy", async () => {
    renderProgress();
    await waitFor(() => {
      const card = screen.getByTestId("weak-card-wc-1");
      expect(card).toHaveTextContent("What are the tones of Gb Major?");
      expect(card).toHaveTextContent("30%");
    });
  });

  it("shows card topic", async () => {
    renderProgress();
    await waitFor(() => {
      const card = screen.getByTestId("weak-card-wc-1");
      expect(card).toHaveTextContent("Major Chords");
    });
  });
});

// ---------------------------------------------------------------------------
// API error handling
// ---------------------------------------------------------------------------

describe("Progress page -- error handling", () => {
  it("shows error message when API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_USER),
          });
        }
        // Progress endpoints fail.
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Internal server error" }),
        });
      }),
    );

    renderProgress();
    await waitFor(() => {
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    });
  });
});
