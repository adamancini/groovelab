/**
 * FretboardTap.tsx -- Interactive fretboard input for flashcard stage 3.
 *
 * Users tap positions on the fretboard to build their answer,
 * with Submit and Clear buttons.
 */

import { useState } from "react";
import Fretboard from "../Fretboard";
import type { FretboardPosition } from "../../lib/api";

export interface FretboardTapProps {
  /** Called when the user submits their selected positions. */
  onSubmit: (positions: FretboardPosition[]) => void;
  /** Whether input is disabled. */
  disabled?: boolean;
}

export default function FretboardTap({
  onSubmit,
  disabled = false,
}: FretboardTapProps) {
  const [selected, setSelected] = useState<FretboardPosition[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const handleTap = (position: FretboardPosition) => {
    if (disabled || submitted) return;

    setSelected((prev) => {
      // Toggle: remove if already selected, add otherwise.
      const existing = prev.findIndex(
        (p) => p.string === position.string && p.fret === position.fret,
      );
      if (existing >= 0) {
        return prev.filter((_, i) => i !== existing);
      }
      return [...prev, position];
    });
  };

  const handleClear = () => {
    if (disabled || submitted) return;
    setSelected([]);
  };

  const handleSubmit = () => {
    if (disabled || submitted || selected.length === 0) return;
    setSubmitted(true);
    onSubmit(selected);
  };

  return (
    <div data-testid="fretboard-tap" className="space-y-4">
      <Fretboard
        strings={4}
        frets={12}
        selectedPositions={selected}
        onTap={handleTap}
        size="full"
      />
      <div className="flex gap-3 justify-center">
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || submitted || selected.length === 0}
          className="rounded-lg border border-white/10 bg-elevated px-6 py-2 font-medium text-text-primary transition-colors hover:bg-elevated/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          data-testid="clear-fretboard"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || submitted || selected.length === 0}
          className="rounded-lg bg-accent-primary px-6 py-2 font-medium text-black transition-colors hover:bg-accent-primary/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          data-testid="submit-fretboard"
        >
          Submit
        </button>
      </div>
      {selected.length > 0 && !submitted && (
        <p className="text-text-secondary text-center text-sm">
          {selected.length} position{selected.length !== 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}
