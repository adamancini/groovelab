/**
 * ChordDiagram.tsx -- Display-only grid of mini fretboards for a chord (GRO-z1e3).
 *
 * Given a chord root + chord-def name (e.g. "C" + "Major Triad"), looks up the
 * matching ScaleChordDef in SCALE_CHORD_LIBRARY, computes voicings via
 * getChordVoicings against the user's current tuning (from InstrumentContext),
 * and renders one mini Fretboard per voicing in a responsive grid.
 *
 * This is a pure consumer of:
 *   - lib/music-theory: SCALE_CHORD_LIBRARY, getChordVoicings, VoicingPosition
 *   - context/InstrumentContext: useInstrument() for tuning + stringCount
 *   - components/Fretboard: existing SVG renderer in size="mini" mode
 *
 * It does NOT modify any of those modules. It does NOT fetch data, hold state
 * beyond memoized voicings, or know anything about flashcards. The component
 * is intended to be embedded inside flashcard pages (FretboardSession,
 * AnswerFeedback) by GRO-nhmm.
 *
 * Behavior:
 *   - chordDefName must resolve to a chord (def.type === "chord") in
 *     SCALE_CHORD_LIBRARY. If not, returns null (renders nothing).
 *   - When voicings is empty (e.g. tight maxFret with no playable shapes in
 *     the current tuning), renders the section with a single secondary-text
 *     caption "No voicing in current tuning".
 *   - Voicings are memoized on (chordRoot, chordDefName, tuning, stringCount,
 *     maxFret, maxVoicings). When InstrumentContext.tuning or stringCount
 *     changes, voicings re-compute and stale fretboards never persist.
 */

import { useMemo } from "react";
import Fretboard from "../Fretboard";
import { useInstrument } from "../../context/InstrumentContext";
import {
  SCALE_CHORD_LIBRARY,
  getChordVoicings,
  type VoicingPosition,
} from "../../lib/music-theory";

export interface ChordDiagramProps {
  /** Chord root, e.g. "C" or "F#". Passed to getChordVoicings. */
  chordRoot: string;
  /** Name matching an entry in SCALE_CHORD_LIBRARY whose type is "chord"
   *  (e.g. "Major Triad", "Dominant 7th"). */
  chordDefName: string;
  /** Maximum number of voicings to render. Default 3. */
  maxVoicings?: number;
  /** Maximum fret to search (passed through to getChordVoicings). Default 12. */
  maxFret?: number;
  /** Optional class for the wrapping <section>. */
  className?: string;
}

const DEFAULT_MAX_VOICINGS = 3;
const DEFAULT_MAX_FRET = 12;

export default function ChordDiagram({
  chordRoot,
  chordDefName,
  maxVoicings = DEFAULT_MAX_VOICINGS,
  maxFret = DEFAULT_MAX_FRET,
  className = "",
}: ChordDiagramProps) {
  const { tuning, stringCount } = useInstrument();

  // Look up the chord definition. We bail out early (return null below) if it
  // isn't a chord, but we still call useMemo unconditionally to keep the hook
  // call order stable between renders.
  const def = useMemo(
    () =>
      SCALE_CHORD_LIBRARY.find(
        (entry) => entry.name === chordDefName && entry.type === "chord",
      ) ?? null,
    [chordDefName],
  );

  const voicings: VoicingPosition[][] = useMemo(() => {
    if (!def) return [];
    return getChordVoicings(chordRoot, def, tuning, {
      maxFret,
      limit: maxVoicings,
    });
    // tuning is included by-reference; setTuning replaces the array, so the
    // identity changes when the user switches tuning. stringCount is included
    // explicitly per the story spec for clarity and as a safety net even
    // though it always equals tuning.length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, chordRoot, tuning, stringCount, maxFret, maxVoicings]);

  if (!def) {
    return null;
  }

  const ariaLabel = `Chord shapes for ${chordRoot} ${chordDefName}`;

  return (
    <section
      aria-label={ariaLabel}
      data-testid="chord-diagram"
      className={className}
    >
      {voicings.length === 0 ? (
        <p className="text-sm text-[var(--color-text-text-secondary)]">
          No voicing in current tuning
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {voicings.map((voicing, idx) => {
            const nonOpenFrets = voicing
              .map((p) => p.fret)
              .filter((f) => f > 0);
            const lowestFret =
              nonOpenFrets.length > 0 ? Math.min(...nonOpenFrets) : 0;
            return (
              <div
                key={`voicing-${idx}`}
                className="rounded-lg border border-white/10 bg-[var(--color-elevated)] p-2"
                data-testid={`chord-voicing-${idx}`}
              >
                <Fretboard
                  positions={voicing}
                  strings={stringCount}
                  frets={maxFret}
                  size="mini"
                  showFretNumbers={false}
                  className="w-full"
                />
                <span className="sr-only">
                  {chordRoot} {def.name}
                </span>
                <p className="mt-1 text-center text-xs text-[var(--color-text-text-secondary)]">
                  fret {lowestFret}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
