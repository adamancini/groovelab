/**
 * Flashcard tuning wiring tests (GRO-05pv).
 *
 * Verifies that FretboardTap (stage 3 input) and AnswerFeedback's mini
 * fretboard read stringCount from InstrumentContext rather than hardcoding 4.
 *
 * Acceptance scenarios:
 * - FretboardTap renders stringCount string lines + tap targets.
 * - AnswerFeedback's mini fretboard renders stringCount string lines.
 * - AnswerFeedback drops correctPositions whose string >= stringCount.
 * - Both components throw a clear error when rendered without
 *   InstrumentProvider (the useInstrument hook is the source of that throw).
 */

import { act, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ReactNode } from "react";

import { AuthProvider } from "../context/AuthContext";
import {
  InstrumentProvider,
  useInstrument,
} from "../context/InstrumentContext";
import FretboardTap from "../components/flashcards/FretboardTap";
import AnswerFeedback from "../components/flashcards/AnswerFeedback";
import * as api from "../lib/api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Render with AuthProvider + InstrumentProvider so useInstrument() resolves. */
function ProvidersWrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <InstrumentProvider>{children}</InstrumentProvider>
    </AuthProvider>
  );
}

/** Test-only consumer that switches stringCount via setStringCount, used to
 *  verify AC #3 (re-render on tuning change). */
function StringCountSwitcher({
  initial,
  next,
  trigger,
  children,
}: {
  initial: number;
  next: number;
  trigger: { current: () => void };
  children: ReactNode;
}) {
  const { stringCount, setStringCount } = useInstrument();
  // Mount: align provider state with `initial` if it differs from default.
  if (stringCount !== initial && stringCount === 4 && initial !== 4) {
    // One-shot guard: only fire on the first render where state is still
    // the default 4-string. Subsequent renders see the desired count.
    setStringCount(initial);
  }
  trigger.current = () => setStringCount(next);
  return <>{children}</>;
}

/** Count <line> elements that represent strings in a fretboard SVG.
 *  The Fretboard component emits one <line key="string-N"> per string in
 *  addition to a single nut <line> and a fret <line> per fret. We filter
 *  via the y1===y2 horizontal-line property to isolate strings. */
function countStringLines(fretboardSvg: HTMLElement): number {
  const lines = fretboardSvg.querySelectorAll("line");
  let horizontals = 0;
  lines.forEach((ln) => {
    const y1 = ln.getAttribute("y1");
    const y2 = ln.getAttribute("y2");
    if (y1 !== null && y1 === y2) {
      horizontals += 1;
    }
  });
  return horizontals;
}

// Stub the API surface InstrumentProvider touches so tests never make real
// network calls. fetchSettings returns {} -> defaults stay; saveSettings is a
// noop; fetchCurrentUser rejects with 401 so the user is treated as guest
// (no debounce save effect, simpler timing).
beforeEach(() => {
  vi.spyOn(api, "fetchSettings").mockResolvedValue({});
  vi.spyOn(api, "saveSettings").mockResolvedValue(undefined);
  vi.spyOn(api, "fetchCurrentUser").mockRejectedValue(
    new api.ApiError(401, "not authenticated"),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FretboardTap reads stringCount from InstrumentContext
// ---------------------------------------------------------------------------

describe("FretboardTap reads stringCount from InstrumentContext", () => {
  it("renders 4 string lines with the default 4-string instrument", () => {
    render(
      <ProvidersWrapper>
        <FretboardTap onSubmit={() => {}} />
      </ProvidersWrapper>,
    );

    const fretboard = screen.getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(4);
    // Tap targets: row 3 exists (4-string -> indices 0..3), row 4 does not.
    expect(within(fretboard).getByTestId("fret-3-0")).toBeInTheDocument();
    expect(
      within(fretboard).queryByTestId("fret-4-0"),
    ).not.toBeInTheDocument();
  });

  it("renders 5 string lines when stringCount is 5", () => {
    const trigger = { current: () => {} };
    render(
      <ProvidersWrapper>
        <StringCountSwitcher initial={5} next={5} trigger={trigger}>
          <FretboardTap onSubmit={() => {}} />
        </StringCountSwitcher>
      </ProvidersWrapper>,
    );

    const fretboard = screen.getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(5);
    expect(within(fretboard).getByTestId("fret-4-0")).toBeInTheDocument();
    expect(
      within(fretboard).queryByTestId("fret-5-0"),
    ).not.toBeInTheDocument();
  });

  it("renders 6 string lines when stringCount is 6", () => {
    const trigger = { current: () => {} };
    render(
      <ProvidersWrapper>
        <StringCountSwitcher initial={6} next={6} trigger={trigger}>
          <FretboardTap onSubmit={() => {}} />
        </StringCountSwitcher>
      </ProvidersWrapper>,
    );

    const fretboard = screen.getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(6);
    expect(within(fretboard).getByTestId("fret-5-0")).toBeInTheDocument();
  });

  it("re-renders with the new string count when stringCount changes", () => {
    const trigger = { current: () => {} };
    render(
      <ProvidersWrapper>
        <StringCountSwitcher initial={4} next={6} trigger={trigger}>
          <FretboardTap onSubmit={() => {}} />
        </StringCountSwitcher>
      </ProvidersWrapper>,
    );

    // Initial: 4 strings.
    let fretboard = screen.getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(4);

    // Bump to 6.
    act(() => {
      trigger.current();
    });

    fretboard = screen.getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(6);
    expect(within(fretboard).getByTestId("fret-5-0")).toBeInTheDocument();
  });

  it("throws a clear error when rendered without InstrumentProvider", () => {
    // Suppress the React error-boundary console noise.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<FretboardTap onSubmit={() => {}} />)).toThrow(
      /InstrumentProvider/,
    );
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AnswerFeedback mini fretboard reads stringCount from InstrumentContext
// ---------------------------------------------------------------------------

describe("AnswerFeedback mini fretboard reads stringCount from InstrumentContext", () => {
  it("renders all in-range correctPositions for a 4-string instrument", () => {
    const positions = [
      { string: 0, fret: 5, label: "C" },
      { string: 1, fret: 3, label: "E" },
      { string: 2, fret: 0, label: "A" },
      { string: 3, fret: 0, label: "E" },
    ];
    render(
      <ProvidersWrapper>
        <AnswerFeedback
          correct={false}
          correctAnswer="C E G"
          explanation="example"
          correctPositions={positions}
          onContinue={() => {}}
        />
      </ProvidersWrapper>,
    );

    const fretboard = within(
      screen.getByTestId("feedback-fretboard"),
    ).getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(4);

    // All four position labels should render in the SVG.
    expect(fretboard.textContent).toContain("C");
    expect(fretboard.textContent).toContain("E");
    expect(fretboard.textContent).toContain("A");
  });

  it("filters out positions with string >= stringCount (4-string default)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const positions = [
      { string: 0, fret: 5, label: "C" },
      { string: 1, fret: 3, label: "E" },
      // string=4 is out of range for a 4-string instrument; must not render.
      { string: 4, fret: 7, label: "OFFBOARD" },
    ];

    expect(() =>
      render(
        <ProvidersWrapper>
          <AnswerFeedback
            correct={false}
            correctAnswer="C E G"
            explanation="example"
            correctPositions={positions}
            onContinue={() => {}}
          />
        </ProvidersWrapper>,
      ),
    ).not.toThrow();

    const fretboard = within(
      screen.getByTestId("feedback-fretboard"),
    ).getByTestId("fretboard");
    // The off-board label must NOT appear in the rendered SVG.
    expect(fretboard.textContent).not.toContain("OFFBOARD");
    // Still 4 string lines (the filter only drops the dot, not the layout).
    expect(countStringLines(fretboard)).toBe(4);

    warnSpy.mockRestore();
  });

  it("renders 5 string lines when stringCount is 5", () => {
    const trigger = { current: () => {} };
    render(
      <ProvidersWrapper>
        <StringCountSwitcher initial={5} next={5} trigger={trigger}>
          <AnswerFeedback
            correct={false}
            correctAnswer="x"
            explanation="example"
            correctPositions={[
              { string: 0, fret: 0, label: "G" },
              { string: 4, fret: 0, label: "B" },
            ]}
            onContinue={() => {}}
          />
        </StringCountSwitcher>
      </ProvidersWrapper>,
    );

    const fretboard = within(
      screen.getByTestId("feedback-fretboard"),
    ).getByTestId("fretboard");
    expect(countStringLines(fretboard)).toBe(5);
  });

  it("throws a clear error when rendered without InstrumentProvider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <AnswerFeedback
          correct={false}
          correctAnswer="x"
          explanation="example"
          correctPositions={[{ string: 0, fret: 0, label: "G" }]}
          onContinue={() => {}}
        />,
      ),
    ).toThrow(/InstrumentProvider/);
    errSpy.mockRestore();
  });
});
