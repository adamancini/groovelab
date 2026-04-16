/**
 * MultipleChoice.tsx -- Multiple choice input for flashcard stages 0 and 1.
 *
 * Stage 0: 4 options in a 2x2 grid.
 * Stage 1: 3 options in a row.
 */

import { useState } from "react";

export interface MultipleChoiceProps {
  options: string[];
  /** Mastery stage (0 = 4-choice 2x2, 1 = 3-choice row). */
  stage: 0 | 1;
  /** Called when the user selects an option. */
  onSelect: (answer: string) => void;
  /** Whether input is disabled (e.g. after answering). */
  disabled?: boolean;
}

export default function MultipleChoice({
  options,
  stage,
  onSelect,
  disabled = false,
}: MultipleChoiceProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleClick = (option: string) => {
    if (disabled || selected !== null) return;
    setSelected(option);
    onSelect(option);
  };

  const gridClass =
    stage === 0
      ? "grid grid-cols-2 gap-3"
      : "grid grid-cols-3 gap-3";

  return (
    <div
      className={gridClass}
      role="group"
      aria-label="Answer options"
      data-testid="multiple-choice"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => handleClick(option)}
          disabled={disabled || selected !== null}
          aria-pressed={selected === option}
          className={`rounded-lg border px-4 py-3 text-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary ${
            selected === option
              ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
              : "border-white/10 bg-elevated text-text-primary hover:border-accent-primary/40 hover:bg-elevated/80"
          } ${disabled && selected !== option ? "opacity-50" : ""}`}
          data-testid={`option-${option}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
