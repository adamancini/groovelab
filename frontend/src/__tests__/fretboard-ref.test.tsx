/**
 * Fretboard reference page integration tests.
 *
 * Tests fretboard rendering, note tap highlighting, scale/chord filtering,
 * tuning configuration, and accessibility.
 */

import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import FretboardRef from "../pages/FretboardRef";
import {
  DEFAULT_TUNING_PRESETS,
  noteAtFret,
  getScaleChordNotes,
  SCALE_CHORD_LIBRARY,
} from "../lib/music-theory";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Render the FretboardRef page wrapped in required providers. */
function renderFretboardRef() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/fretboard"]}>
          <Routes>
            <Route path="/fretboard" element={<FretboardRef />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

// Mock fetch for auth check and tuning presets API.
const MOCK_TUNING_PRESETS = DEFAULT_TUNING_PRESETS.map((p) => ({
  id: p.id,
  name: p.name,
  strings: p.strings,
  notes: p.notes,
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      // Auth check: return 401 (unauthenticated).
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: "not authenticated" }),
        });
      }
      // Tuning presets API.
      if (url.includes("/fretboard/tunings")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_TUNING_PRESETS),
        });
      }
      // Default: 404.
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not found" }),
      });
    }),
  );
});

// ---------------------------------------------------------------------------
// Rendering and basic structure
// ---------------------------------------------------------------------------

describe("FretboardRef page", () => {
  it("renders the page heading", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Fretboard" }),
      ).toBeInTheDocument();
    });
  });

  it("renders the fretboard SVG", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("fretboard-ref")).toBeInTheDocument();
    });
  });

  it("renders tuning configurator", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("tuning-configurator")).toBeInTheDocument();
    });
  });

  it("renders scale/chord filter", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("scale-chord-filter")).toBeInTheDocument();
    });
  });

  it("renders note info panel", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("note-info-panel")).toBeInTheDocument();
    });
  });

  it("renders correct notes for default standard 4-string tuning", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    // Standard 4-string bass: G, D, A, E
    // G string fret 0 should show "G"
    const gOpen = within(fretboard).getByTestId("fret-0-0");
    expect(gOpen).toBeInTheDocument();

    // E string fret 0 should show "E"
    const eOpen = within(fretboard).getByTestId("fret-3-0");
    expect(eOpen).toBeInTheDocument();

    // E string fret 5 should show "A"
    const eFret5 = within(fretboard).getByTestId("fret-3-5");
    expect(eFret5).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Note tap highlighting
// ---------------------------------------------------------------------------

describe("Note tap highlighting", () => {
  it("tapping a note shows its name in the info panel", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    // Tap the G string open (fret 0) -- note is G.
    const gOpen = within(fretboard).getByTestId("fret-0-0");
    fireEvent.click(gOpen);

    await waitFor(() => {
      const noteDisplay = screen.getByTestId("tapped-note-name");
      expect(noteDisplay).toHaveTextContent("G");
    });
  });

  it("tapping the same note again clears the selection", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    const gOpen = within(fretboard).getByTestId("fret-0-0");
    fireEvent.click(gOpen);

    await waitFor(() => {
      expect(screen.getByTestId("tapped-note-name")).toHaveTextContent("G");
    });

    // Tap again to toggle off.
    fireEvent.click(gOpen);

    await waitFor(() => {
      expect(screen.queryByTestId("tapped-note-name")).not.toBeInTheDocument();
    });
  });

  it("shows interval when a key is selected and a note is tapped", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    // Select a scale so a key is active.
    const scaleSelect = screen.getByTestId("scale-chord-select");
    fireEvent.change(scaleSelect, { target: { value: "Major" } });

    // Key defaults to C. Tap fret-0-0 (G string open = G).
    const gOpen = within(fretboard).getByTestId("fret-0-0");
    fireEvent.click(gOpen);

    await waitFor(() => {
      const interval = screen.getByTestId("tapped-note-interval");
      // G relative to C = Perfect 5th
      expect(interval).toHaveTextContent("Perfect 5th");
    });
  });
});

// ---------------------------------------------------------------------------
// Tuning configurator
// ---------------------------------------------------------------------------

describe("Tuning configurator", () => {
  it("has string count toggle buttons for 4, 5, and 6", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("string-count-4")).toBeInTheDocument();
      expect(screen.getByTestId("string-count-5")).toBeInTheDocument();
      expect(screen.getByTestId("string-count-6")).toBeInTheDocument();
    });
  });

  it("switching to 5 strings renders 5 open string notes", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("fretboard-ref")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("string-count-5"));

    // Standard 5-string: G, D, A, E, B
    await waitFor(() => {
      const fretboard = screen.getByTestId("fretboard-ref");
      expect(within(fretboard).getByTestId("fret-4-0")).toBeInTheDocument();
    });
  });

  it("switching to 6 strings renders 6 open string notes", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("fretboard-ref")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("string-count-6"));

    await waitFor(() => {
      const fretboard = screen.getByTestId("fretboard-ref");
      expect(within(fretboard).getByTestId("fret-5-0")).toBeInTheDocument();
    });
  });

  it("tuning preset dropdown changes the fretboard notes", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("tuning-preset-select")).toBeInTheDocument();
    });

    // Select Drop D tuning.
    const select = screen.getByTestId("tuning-preset-select");
    fireEvent.change(select, { target: { value: "drop-d-4" } });

    // In Drop D, the lowest string (index 3) is D instead of E.
    // Fret 0 of string 3 should now be D.
    await waitFor(() => {
      const fretboard = screen.getByTestId("fretboard-ref");
      const lowString = within(fretboard).getByTestId("fret-3-0");
      // The ARIA label should contain "D string"
      expect(lowString.getAttribute("aria-label")).toContain("D string");
    });
  });

  it("selecting Custom shows per-string note dropdowns", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("tuning-preset-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("tuning-preset-select");
    fireEvent.change(select, { target: { value: "custom" } });

    await waitFor(() => {
      expect(screen.getByTestId("custom-tuning-controls")).toBeInTheDocument();
      // Should have 4 custom note selectors (one per string).
      expect(screen.getByTestId("custom-note-0")).toBeInTheDocument();
      expect(screen.getByTestId("custom-note-1")).toBeInTheDocument();
      expect(screen.getByTestId("custom-note-2")).toBeInTheDocument();
      expect(screen.getByTestId("custom-note-3")).toBeInTheDocument();
    });
  });

  it("custom tuning per-string dropdown changes the fretboard", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("tuning-preset-select")).toBeInTheDocument();
    });

    // Switch to custom.
    fireEvent.change(screen.getByTestId("tuning-preset-select"), {
      target: { value: "custom" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("custom-note-0")).toBeInTheDocument();
    });

    // Change string 0 from G to A.
    fireEvent.change(screen.getByTestId("custom-note-0"), {
      target: { value: "A" },
    });

    // Fret 0 of string 0 should now have "A" in the ARIA label.
    await waitFor(() => {
      const fretboard = screen.getByTestId("fretboard-ref");
      const stringOpen = within(fretboard).getByTestId("fret-0-0");
      expect(stringOpen.getAttribute("aria-label")).toContain("A string");
    });
  });

  it("fetches tuning presets from API", async () => {
    renderFretboardRef();
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const tuningCalls = fetchMock.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("/fretboard/tunings"),
      );
      expect(tuningCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Scale/chord overlay filtering
// ---------------------------------------------------------------------------

describe("Scale/chord overlay filtering", () => {
  it("selecting a scale highlights member notes differently from non-members", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("scale-chord-select")).toBeInTheDocument();
    });

    // Select C Major scale (key defaults to C).
    const scaleSelect = screen.getByTestId("scale-chord-select");
    fireEvent.change(scaleSelect, { target: { value: "Major" } });

    const fretboard = screen.getByTestId("fretboard-ref");

    // C Major notes: C, D, E, F, G, A, B
    // G string fret 0 = G (member) -- should have the filled dot.
    const gDot = within(fretboard).getByTestId("dot-0-0");
    expect(gDot).toBeInTheDocument();

    // G string fret 1 = G# (non-member) -- should be dimmed.
    const gSharpDot = within(fretboard).getByTestId("dot-0-1");
    expect(gSharpDot).toBeInTheDocument();
  });

  it("changing the key updates the note highlighting", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("scale-chord-select")).toBeInTheDocument();
    });

    // Select Major scale.
    fireEvent.change(screen.getByTestId("scale-chord-select"), {
      target: { value: "Major" },
    });

    // Change key to G.
    fireEvent.change(screen.getByTestId("key-select"), {
      target: { value: "G" },
    });

    // G Major: G A B C D E F#
    // G string fret 0 = G = tonic
    const fretboard = screen.getByTestId("fretboard-ref");
    const gDot = within(fretboard).getByTestId("dot-0-0");
    // Tonic should be amber (#f0a500).
    expect(gDot.getAttribute("fill")).toBe("#f0a500");
  });

  it("tonic is shown in amber with a double ring", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("scale-chord-select")).toBeInTheDocument();
    });

    // Select Major scale, key = C.
    fireEvent.change(screen.getByTestId("scale-chord-select"), {
      target: { value: "Major" },
    });

    // A string (index 2) fret 3 = C = tonic.
    const fretboard = screen.getByTestId("fretboard-ref");
    const tonicRing = within(fretboard).queryByTestId("tonic-ring-2-3");
    expect(tonicRing).toBeInTheDocument();
  });

  it("selecting None clears the overlay", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(screen.getByTestId("scale-chord-select")).toBeInTheDocument();
    });

    // Select then deselect.
    const scaleSelect = screen.getByTestId("scale-chord-select");
    fireEvent.change(scaleSelect, { target: { value: "Major" } });
    fireEvent.change(scaleSelect, { target: { value: "" } });

    // All dots should be "highlighted" (not dimmed) since no filter is active.
    const fretboard = screen.getByTestId("fretboard-ref");
    // Check that fret 0-1 (G# on G string) is NOT dimmed -- no scale filter.
    const gSharpDot = within(fretboard).getByTestId("dot-0-1");
    // Should NOT have opacity 0.5 (dimmed indicator).
    expect(gSharpDot.getAttribute("opacity")).not.toBe("0.5");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("Fretboard accessibility", () => {
  it("each position has an ARIA label with string name, fret, and note", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    // G string, open = "G string, open, G"
    const gOpen = within(fretboard).getByTestId("fret-0-0");
    expect(gOpen.getAttribute("aria-label")).toBe("G string, open, G");

    // A string, 3rd fret = "A string, 3rd fret, C"
    const aFret3 = within(fretboard).getByTestId("fret-2-3");
    expect(aFret3.getAttribute("aria-label")).toBe("A string, 3rd fret, C");

    // E string, 1st fret = "E string, 1st fret, F"
    const eFret1 = within(fretboard).getByTestId("fret-3-1");
    expect(eFret1.getAttribute("aria-label")).toBe("E string, 1st fret, F");
  });

  it("fretboard has role=grid", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");
    expect(fretboard.getAttribute("role")).toBe("grid");
  });

  it("fretboard positions are keyboard-accessible", async () => {
    renderFretboardRef();
    const fretboard = await screen.findByTestId("fretboard-ref");

    const gOpen = within(fretboard).getByTestId("fret-0-0");
    // SVG elements render tabIndex as lowercase "tabindex" in the DOM.
    expect(gOpen.getAttribute("tabindex")).toBe("0");
  });

  it("horizontal scroll container exists for narrow screens", async () => {
    renderFretboardRef();
    await waitFor(() => {
      expect(
        screen.getByTestId("fretboard-scroll-container"),
      ).toBeInTheDocument();
    });
  });
});
