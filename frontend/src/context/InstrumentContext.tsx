/**
 * InstrumentContext -- shared tuning + string-count state (GRO-h5yo).
 *
 * Replaces local tuning useState scattered across pages (FretboardRef,
 * eventually flashcard input + chord diagrams) with a single source of
 * truth so every fretboard rendering reflects the user's chosen instrument.
 *
 * For authenticated users, the context hydrates from GET /api/v1/settings on
 * mount and debounces tuning/stringCount changes back to the backend via
 * PUT /api/v1/settings. Guests use defaults and never call the backend.
 *
 * Defaults: 4-string standard bass (G, D, A, E).
 *
 * The provider must live INSIDE AuthProvider so it can read the current
 * authentication state via useAuth().
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import * as api from "../lib/api";
import { DEFAULT_TUNING_PRESETS } from "../lib/music-theory";

const DEFAULT_STRING_COUNT = 4;
const DEFAULT_TUNING: string[] = ["G", "D", "A", "E"]; // Standard 4-string bass.
const SAVE_DEBOUNCE_MS = 500;

/** Public shape of the InstrumentContext. */
export interface InstrumentState {
  /** Open-string notes, ordered high-to-low (string index 0 is highest pitched). */
  tuning: string[];
  /** Number of strings on the instrument; always equals tuning.length. */
  stringCount: number;
  /** Replace the tuning array. stringCount auto-updates to the new length. */
  setTuning: (tuning: string[]) => void;
  /** Change string count. Tuning is reconciled to the new length using
   *  DEFAULT_TUNING_PRESETS as the source of standard tunings. */
  setStringCount: (count: number) => void;
}

const InstrumentContext = createContext<InstrumentState | null>(null);

/**
 * Reconcile a tuning array to a new string count.
 *
 * Strategy: prefer the standard preset for the target stringCount from
 * DEFAULT_TUNING_PRESETS. Falls back to truncate/extend on the existing
 * tuning if no preset is available (defensive -- should not happen for
 * counts 4/5/6 which the UI exposes).
 */
function reconcileTuning(current: string[], targetCount: number): string[] {
  if (current.length === targetCount) return current;

  const preset = DEFAULT_TUNING_PRESETS.find(
    (p) => p.strings === targetCount && p.name === "Standard",
  );
  if (preset) return [...preset.notes];

  if (targetCount < current.length) {
    return current.slice(0, targetCount);
  }
  // Extend with the LAST note repeated as a defensive fallback.
  const last = current[current.length - 1] ?? "E";
  return [...current, ...Array<string>(targetCount - current.length).fill(last)];
}

export function InstrumentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [tuning, setTuningState] = useState<string[]>(DEFAULT_TUNING);
  const [stringCount, setStringCountState] = useState<number>(
    DEFAULT_STRING_COUNT,
  );

  /** Snapshot of the last (tuning, stringCount) that came FROM the server
   *  -- either via fetchSettings hydration or as the initial defaults. The
   *  save effect skips when current state equals this snapshot, preventing
   *  the hydrated values from echoing back to the backend (AC #7). */
  const lastServerStateRef = useRef<{ tuning: string[]; stringCount: number }>({
    tuning: DEFAULT_TUNING,
    stringCount: DEFAULT_STRING_COUNT,
  });

  // Hydrate from /api/v1/settings on mount when authenticated. user === undefined
  // means the auth check is still in flight; null means guest; truthy means
  // authenticated.
  useEffect(() => {
    if (!user) return; // null (guest) or undefined (loading) -- skip.
    let cancelled = false;
    api
      .fetchSettings()
      .then((settings) => {
        if (cancelled) return;
        let nextTuning: string[] | null = null;
        let nextCount: number | null = null;
        if (settings.tuning && settings.tuning.length > 0) {
          nextTuning = settings.tuning;
          nextCount = settings.stringCount ?? settings.tuning.length;
        } else if (typeof settings.stringCount === "number") {
          nextCount = settings.stringCount;
          nextTuning = reconcileTuning(DEFAULT_TUNING, settings.stringCount);
        }
        if (nextTuning !== null && nextCount !== null) {
          // Record what came from the server BEFORE applying it, so the
          // save-effect's equality check sees the new state as a server
          // echo and skips persisting.
          lastServerStateRef.current = {
            tuning: nextTuning,
            stringCount: nextCount,
          };
          setTuningState(nextTuning);
          setStringCountState(nextCount);
        }
      })
      .catch(() => {
        // Defaults already in state; nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Debounced save when tuning/stringCount changes for authenticated users.
  useEffect(() => {
    if (!user) return; // Guests do not persist.
    // Skip if state matches what the server most recently gave us
    // (initial defaults or hydration response). AC #7: no echo loop.
    const last = lastServerStateRef.current;
    if (
      last.stringCount === stringCount &&
      last.tuning.length === tuning.length &&
      last.tuning.every((n, i) => n === tuning[i])
    ) {
      return;
    }

    const handle = setTimeout(() => {
      void api.saveSettings({ tuning, stringCount });
      // Mark this as the new server-known state so subsequent identical
      // re-renders do not re-trigger a save.
      lastServerStateRef.current = { tuning, stringCount };
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [user, tuning, stringCount]);

  const setTuning = useCallback((next: string[]) => {
    setTuningState(next);
    setStringCountState(next.length);
  }, []);

  const setStringCount = useCallback((count: number) => {
    setStringCountState(count);
    setTuningState((prev) => reconcileTuning(prev, count));
  }, []);

  return (
    <InstrumentContext.Provider
      value={{ tuning, stringCount, setTuning, setStringCount }}
    >
      {children}
    </InstrumentContext.Provider>
  );
}

export function useInstrument(): InstrumentState {
  const ctx = useContext(InstrumentContext);
  if (!ctx) {
    throw new Error(
      "useInstrument must be used within an InstrumentProvider",
    );
  }
  return ctx;
}
