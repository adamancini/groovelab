/**
 * ChordDiagram tests (GRO-z1e3).
 *
 * Verifies the public behavior of the ChordDiagram component:
 * - Renders one mini fretboard per voicing returned by getChordVoicings.
 * - Returns null when chordDefName does not resolve to a chord in
 *   SCALE_CHORD_LIBRARY (e.g. typo, scale name).
 * - Caps voicings at maxVoicings.
 * - Re-renders correctly when stringCount/tuning changes (re-computed
 *   voicings, no stale state).
 * - Shows "No voicing in current tuning" caption when the search yields
 *   zero voicings (forced via tight maxFret).
 * - Wraps the section in an aria-label that references both root and
 *   chord-def name for accessibility.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import ChordDiagram from "../components/flashcards/ChordDiagram";
import { InstrumentProvider, useInstrument } from "../context/InstrumentContext";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Stub fetchCurrentUser as a guest so InstrumentProvider stays on defaults
 *  and never tries to call /api/v1/settings. */
function stubGuestUser() {
  vi.spyOn(api, "fetchCurrentUser").mockRejectedValue(
    new api.ApiError(401, "not authenticated"),
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <InstrumentProvider>{children}</InstrumentProvider>
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.spyOn(api, "saveSettings").mockResolvedValue(undefined);
  vi.spyOn(api, "fetchSettings").mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC #1, #8: renders a grid of mini fretboards (one per voicing).
// ---------------------------------------------------------------------------

describe("ChordDiagram: rendering", () => {
  it("renders the chord-diagram section and at least one fretboard for C Major Triad on default tuning", () => {
    stubGuestUser();
    render(
      <Wrapper>
        <ChordDiagram chordRoot="C" chordDefName="Major Triad" />
      </Wrapper>,
    );

    const section = screen.getByTestId("chord-diagram");
    expect(section).toBeInTheDocument();

    const fretboards = screen.getAllByTestId("fretboard");
    expect(fretboards.length).toBeGreaterThan(0);
  });

  // AC #7: aria-label mentions both root and def name.
  it("section has an aria-label referencing the chord root and chord-def name", () => {
    stubGuestUser();
    render(
      <Wrapper>
        <ChordDiagram chordRoot="C" chordDefName="Major Triad" />
      </Wrapper>,
    );

    const section = screen.getByTestId("chord-diagram");
    const ariaLabel = section.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toMatch(/C/);
    expect(ariaLabel).toMatch(/Major Triad/);
  });

  // AC #4: maxVoicings caps the number of fretboards rendered.
  it("renders at most maxVoicings fretboards when maxVoicings is provided", () => {
    stubGuestUser();
    render(
      <Wrapper>
        <ChordDiagram chordRoot="C" chordDefName="Major Triad" maxVoicings={2} />
      </Wrapper>,
    );

    const fretboards = screen.getAllByTestId("fretboard");
    expect(fretboards.length).toBeLessThanOrEqual(2);
    expect(fretboards.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC #6: returns null when chordDefName cannot be resolved.
// ---------------------------------------------------------------------------

describe("ChordDiagram: unresolved chord def", () => {
  it("renders nothing for a chordDefName not present in SCALE_CHORD_LIBRARY", () => {
    stubGuestUser();
    const { container } = render(
      <Wrapper>
        <ChordDiagram chordRoot="C" chordDefName="Nonexistent Chord" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("chord-diagram")).toBeNull();
    expect(container.querySelector("[data-testid='fretboard']")).toBeNull();
  });

  it("renders nothing when chordDefName resolves to a scale (def.type !== 'chord')", () => {
    stubGuestUser();
    render(
      <Wrapper>
        {/* "Major" is a scale, not a chord, in SCALE_CHORD_LIBRARY. */}
        <ChordDiagram chordRoot="C" chordDefName="Major" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("chord-diagram")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty-state caption when getChordVoicings returns [].
// ---------------------------------------------------------------------------

describe("ChordDiagram: no voicings in tuning", () => {
  it("renders the 'No voicing in current tuning' caption when no voicings fit", () => {
    stubGuestUser();
    // C Major Triad needs 3 chord tones across 3 strings, but maxFret=0 only
    // exposes the four open strings (G, D, A, E) which contain G but not C
    // or E -- so getChordVoicings returns []. (Power Chord on C with maxFret=0
    // is similarly impossible -- no open C string in default tuning.)
    render(
      <Wrapper>
        <ChordDiagram
          chordRoot="C"
          chordDefName="Major Triad"
          maxFret={0}
        />
      </Wrapper>,
    );

    const section = screen.getByTestId("chord-diagram");
    expect(section).toBeInTheDocument();
    expect(section.textContent ?? "").toMatch(/No voicing in current tuning/i);
    // No fretboards should be rendered in the empty-state branch.
    expect(screen.queryAllByTestId("fretboard")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC #3, #5: stringCount changes propagate -- no stale voicings.
// ---------------------------------------------------------------------------

describe("ChordDiagram: tuning/stringCount changes", () => {
  /** Helper child that captures setStringCount from the InstrumentContext so
   *  the test can mutate it from outside the render tree. */
  let setStringCountFromCtx: ((n: number) => void) | null = null;
  function StringCountCapturer() {
    const { setStringCount } = useInstrument();
    setStringCountFromCtx = setStringCount;
    return null;
  }

  beforeEach(() => {
    setStringCountFromCtx = null;
  });

  it("re-renders fretboards with the new string count when InstrumentContext.stringCount changes from 4 to 5", () => {
    stubGuestUser();
    render(
      <Wrapper>
        <StringCountCapturer />
        <ChordDiagram chordRoot="C" chordDefName="Major Triad" />
      </Wrapper>,
    );

    const fretboardsBefore = screen.getAllByTestId("fretboard");
    expect(fretboardsBefore.length).toBeGreaterThan(0);

    // Snapshot the voicing dot count rendered for the 4-string fretboards;
    // moving to a 5-string tuning should re-compute voicings (different note
    // mappings on the new B string) so the rendered output is not bit-for-bit
    // identical to the 4-string output.
    const beforeMarkup = fretboardsBefore.map((f) => f.outerHTML).join("|");

    expect(setStringCountFromCtx).not.toBeNull();
    act(() => {
      setStringCountFromCtx!(5);
    });

    const fretboardsAfter = screen.getAllByTestId("fretboard");
    expect(fretboardsAfter.length).toBeGreaterThan(0);

    const afterMarkup = fretboardsAfter.map((f) => f.outerHTML).join("|");
    // The re-rendered fretboards must reflect the new instrument state, so
    // the markup must change. (5-string fretboards have an extra string row
    // and possibly more/different voicings.)
    expect(afterMarkup).not.toBe(beforeMarkup);
  });
});
