/**
 * InstrumentContext tests (GRO-h5yo).
 *
 * Verifies the public API of InstrumentContext:
 * - Default tuning + stringCount
 * - setTuning/setStringCount reconciliation
 * - Throw when used outside provider
 * - Hydration via fetchSettings for authenticated users only
 * - Debounced saveSettings on changes for authenticated users
 * - No echo loop during hydration
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/** Flush queued microtasks/promises a few times to allow useEffect chains
 *  to run when fake timers are installed (waitFor relies on real timers,
 *  so we cannot use it here). */
async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

import {
  InstrumentProvider,
  useInstrument,
} from "../context/InstrumentContext";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Wrapper that pretends the user is authenticated by stubbing fetchCurrentUser. */
function AuthedWrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <InstrumentProvider>{children}</InstrumentProvider>
    </AuthProvider>
  );
}

/** Wrapper that does NOT mount AuthProvider; user defaults to undefined/null in
 *  the InstrumentProvider implementation when AuthProvider is absent. To keep the
 *  provider self-contained for unit tests of pure state behaviour, we wrap with
 *  AuthProvider but stub fetchCurrentUser to reject (-> guest).
 */
function GuestWrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <InstrumentProvider>{children}</InstrumentProvider>
    </AuthProvider>
  );
}

// ---------------------------------------------------------------------------
// API stubs
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(api, "saveSettings").mockResolvedValue(undefined);
  vi.spyOn(api, "fetchSettings").mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubGuestUser() {
  vi.spyOn(api, "fetchCurrentUser").mockRejectedValue(
    new api.ApiError(401, "not authenticated"),
  );
}

function stubAuthedUser() {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue({
    id: "user-1",
    email: "u@example.com",
    role: "user",
  });
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

describe("InstrumentContext: defaults", () => {
  it("exposes default tuning ['G','D','A','E'] and stringCount 4 on first render", () => {
    stubGuestUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: GuestWrapper,
    });

    expect(result.current.tuning).toEqual(["G", "D", "A", "E"]);
    expect(result.current.stringCount).toBe(4);
  });

  it("setTuning(['C','G','D','A','E','B']) updates tuning AND stringCount to 6", async () => {
    stubGuestUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: GuestWrapper,
    });

    act(() => {
      result.current.setTuning(["C", "G", "D", "A", "E", "B"]);
    });

    expect(result.current.tuning).toEqual(["C", "G", "D", "A", "E", "B"]);
    expect(result.current.stringCount).toBe(6);
  });

  it("setStringCount(5) reconciles tuning to length 5 using 5-string standard preset", () => {
    stubGuestUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: GuestWrapper,
    });

    act(() => {
      result.current.setStringCount(5);
    });

    expect(result.current.stringCount).toBe(5);
    expect(result.current.tuning).toEqual(["G", "D", "A", "E", "B"]);
  });

  it("setStringCount(6) reconciles tuning to length 6 using 6-string standard preset", () => {
    stubGuestUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: GuestWrapper,
    });

    act(() => {
      result.current.setStringCount(6);
    });

    expect(result.current.stringCount).toBe(6);
    expect(result.current.tuning).toEqual(["C", "G", "D", "A", "E", "B"]);
  });
});

// ---------------------------------------------------------------------------
// Provider boundary
// ---------------------------------------------------------------------------

describe("useInstrument outside provider", () => {
  it("throws a descriptive error", () => {
    // Suppress React's error boundary noise.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useInstrument())).toThrow(
      /useInstrument must be used within an InstrumentProvider/,
    );
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Persistence: guests do not save
// ---------------------------------------------------------------------------

describe("InstrumentContext: guest persistence", () => {
  it("does not call fetchSettings for unauthenticated users", async () => {
    stubGuestUser();
    render(
      <GuestWrapper>
        <span data-testid="ready">ok</span>
      </GuestWrapper>,
    );

    // Let the auth promise reject and provider settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("ready")).toBeInTheDocument();
    expect(api.fetchSettings).not.toHaveBeenCalled();
  });

  it("does not call saveSettings when a guest changes tuning", async () => {
    stubGuestUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: GuestWrapper,
    });

    // Wait for AuthProvider to mark user as null.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.setTuning(["C", "G", "D", "A"]);
    });

    // Advance well past the debounce window.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(api.saveSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Persistence: authenticated users
// ---------------------------------------------------------------------------

describe("InstrumentContext: authenticated persistence", () => {
  it("calls fetchSettings on mount when user is authenticated", async () => {
    stubAuthedUser();

    render(
      <AuthedWrapper>
        <span data-testid="ready">ok</span>
      </AuthedWrapper>,
    );

    await act(async () => {
      await flushAsync();
    });

    expect(api.fetchSettings).toHaveBeenCalledTimes(1);
  });

  it("applies saved tuning/stringCount from fetchSettings response", async () => {
    stubAuthedUser();
    vi.mocked(api.fetchSettings).mockResolvedValue({
      tuning: ["C", "G", "D", "A", "E", "B"],
      stringCount: 6,
    });

    const { result } = renderHook(() => useInstrument(), {
      wrapper: AuthedWrapper,
    });

    await act(async () => {
      await flushAsync();
    });

    expect(result.current.stringCount).toBe(6);
    expect(result.current.tuning).toEqual(["C", "G", "D", "A", "E", "B"]);
  });

  it("falls back to defaults if fetchSettings rejects (e.g. 404)", async () => {
    stubAuthedUser();
    vi.mocked(api.fetchSettings).mockRejectedValue(
      new api.ApiError(404, "not found"),
    );

    const { result } = renderHook(() => useInstrument(), {
      wrapper: AuthedWrapper,
    });

    // Wait for the rejected fetchSettings to settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.tuning).toEqual(["G", "D", "A", "E"]);
    expect(result.current.stringCount).toBe(4);
  });

  it("debounces saveSettings: one call per 500ms window", async () => {
    stubAuthedUser();
    const { result } = renderHook(() => useInstrument(), {
      wrapper: AuthedWrapper,
    });

    // Wait for hydration to complete.
    await act(async () => {
      await flushAsync();
    });
    expect(api.fetchSettings).toHaveBeenCalled();

    // Three rapid changes; debounce should collapse them.
    act(() => {
      result.current.setTuning(["A", "D", "A", "E"]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setTuning(["B", "D", "A", "E"]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setTuning(["C", "D", "A", "E"]);
    });

    // Before debounce window expires: no call yet.
    expect(api.saveSettings).not.toHaveBeenCalled();

    // Advance past the 500ms window from the LAST change.
    await act(async () => {
      vi.advanceTimersByTime(600);
      await flushAsync();
    });

    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({
      tuning: ["C", "D", "A", "E"],
      stringCount: 4,
    });
  });

  it("does not write to backend during hydration (no echo loop)", async () => {
    stubAuthedUser();
    vi.mocked(api.fetchSettings).mockResolvedValue({
      tuning: ["C", "G", "D", "A", "E", "B"],
      stringCount: 6,
    });

    renderHook(() => useInstrument(), { wrapper: AuthedWrapper });

    // Let hydration apply, then advance past the debounce window.
    await act(async () => {
      await flushAsync();
    });
    expect(api.fetchSettings).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await flushAsync();
    });

    expect(api.saveSettings).not.toHaveBeenCalled();
  });
});
