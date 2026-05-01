/**
 * AnswerFeedback.tsx -- Correct/wrong answer feedback with teaching moments.
 *
 * Correct: green checkmark, correct answer, explanation, Continue button.
 * Wrong: teaching feedback with correct answer prominently, explanation,
 *        mini fretboard with correct positions, "Got it" button.
 *        No punishment language (no "Wrong!" or "Incorrect!").
 */

import Fretboard from "../Fretboard";
import ChordDiagram from "./ChordDiagram";
import { useInstrument } from "../../context/InstrumentContext";
import type { FretboardPosition } from "../../lib/api";

export interface AnswerFeedbackProps {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
  /** Fretboard positions for the correct answer (shown on wrong answers). */
  correctPositions?: FretboardPosition[];
  /** Chord root for the chord-shape teaching-moment hint (GRO-nhmm).
   *  Null on non-chord cards. The hint renders only on wrong answers, and
   *  only when both chordRoot AND chordDefName are non-null. */
  chordRoot?: string | null;
  /** SCALE_CHORD_LIBRARY entry name for the teaching-moment hint (GRO-nhmm).
   *  Null on non-chord cards. */
  chordDefName?: string | null;
  /** Called when the user clicks Continue/Got it. */
  onContinue: () => void;
}

export default function AnswerFeedback({
  correct,
  correctAnswer,
  explanation,
  correctPositions,
  chordRoot,
  chordDefName,
  onContinue,
}: AnswerFeedbackProps) {
  // GRO-05pv: read stringCount from InstrumentContext so the mini fretboard
  // matches the user's instrument. The hook throws when used outside an
  // InstrumentProvider, which is the desired failure mode.
  const { stringCount } = useInstrument();

  // AC #4: silently filter out any position whose string index is out of
  // range for the current instrument. The backend currently emits positions
  // assuming a 4-string layout; once it is tuning-aware we can drop this
  // filter. We log a console.warn in dev to make the drop observable.
  // TODO(GRO): make backend correctPositions tuning-aware so this filter
  // becomes a no-op. See parent epic GRO-95ng.
  const safePositions = correctPositions?.filter((p) => {
    if (p.string >= stringCount) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[AnswerFeedback] dropping correct position string=${p.string} (>= stringCount ${stringCount})`,
        );
      }
      return false;
    }
    return true;
  });

  return (
    <div
      className={`rounded-lg border p-6 ${
        correct
          ? "border-accent-correct/30 bg-accent-correct/10"
          : "border-accent-tonic/30 bg-accent-tonic/10"
      }`}
      role="status"
      aria-live="polite"
      data-testid="answer-feedback"
    >
      {correct ? (
        <>
          {/* Correct answer feedback */}
          <div className="flex items-center gap-3 mb-3">
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8 text-accent-correct"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
            </svg>
            <span
              className="text-accent-correct text-lg font-bold"
              data-testid="feedback-correct"
            >
              {correctAnswer}
            </span>
          </div>
          <p className="text-text-secondary text-sm" data-testid="feedback-explanation">
            {explanation}
          </p>
          <button
            type="button"
            onClick={onContinue}
            autoFocus
            className="mt-4 rounded-lg bg-accent-correct px-6 py-2 font-medium text-black transition-colors hover:bg-accent-correct/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-correct"
            data-testid="continue-button"
          >
            Continue
          </button>
        </>
      ) : (
        <>
          {/* Wrong answer teaching feedback -- no punishment language */}
          <p className="text-accent-tonic text-sm font-medium mb-1">
            The correct answer is:
          </p>
          <p
            className="text-text-primary text-xl font-bold mb-3"
            data-testid="feedback-correct-answer"
          >
            {correctAnswer}
          </p>
          <p className="text-text-secondary text-sm mb-4" data-testid="feedback-explanation">
            {explanation}
          </p>
          {safePositions && safePositions.length > 0 && (
            <div className="mb-4" data-testid="feedback-fretboard">
              <Fretboard
                positions={safePositions}
                size="mini"
                strings={stringCount}
                frets={12}
                showFretNumbers={false}
                className="max-w-md mx-auto"
              />
            </div>
          )}
          {/* Teaching-moment chord-shape hint (GRO-nhmm). Only on wrong
              answers (we're already in the !correct branch) AND only when
              the card carries chord metadata. The diagram is in addition
              to (not in place of) the correctPositions mini fretboard. */}
          {chordRoot && chordDefName && (
            <div className="mb-4">
              <ChordDiagram
                chordRoot={chordRoot}
                chordDefName={chordDefName}
                maxVoicings={3}
              />
            </div>
          )}
          <button
            type="button"
            onClick={onContinue}
            autoFocus
            className="rounded-lg bg-accent-tonic px-6 py-2 font-medium text-black transition-colors hover:bg-accent-tonic/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-tonic"
            data-testid="got-it-button"
          >
            Got it
          </button>
        </>
      )}
    </div>
  );
}
