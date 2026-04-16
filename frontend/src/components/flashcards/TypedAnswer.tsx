/**
 * TypedAnswer.tsx -- Typed answer input for flashcard stage 2.
 *
 * Implements a forgiving text parser:
 * - Case-insensitive
 * - Accepts commas and/or spaces as separators
 * - Order-insensitive for multi-token answers (chord tones)
 */

import { useState } from "react";

export interface TypedAnswerProps {
  /** Called when the user submits their answer. */
  onSubmit: (answer: string) => void;
  /** Placeholder text for the input. */
  placeholder?: string;
  /** Whether input is disabled. */
  disabled?: boolean;
}

/**
 * Normalize a typed answer for comparison:
 * - Lowercase
 * - Split on commas/spaces
 * - Trim whitespace
 * - Sort alphabetically
 * - Rejoin with ", "
 */
export function normalizeAnswer(input: string): string {
  return input
    .toLowerCase()
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .sort()
    .join(", ");
}

export default function TypedAnswer({
  onSubmit,
  placeholder = "Type your answer...",
  disabled = false,
}: TypedAnswerProps) {
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submitted || value.trim().length === 0) return;
    setSubmitted(true);
    onSubmit(normalizeAnswer(value));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-3"
      data-testid="typed-answer"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || submitted}
        autoFocus
        aria-label="Type your answer"
        className="flex-1 rounded-lg border border-white/10 bg-elevated px-4 py-3 text-text-primary placeholder:text-text-secondary/50 focus:border-accent-primary focus:outline-none"
        data-testid="typed-input"
      />
      <button
        type="submit"
        disabled={disabled || submitted || value.trim().length === 0}
        className="rounded-lg bg-accent-primary px-6 py-3 font-medium text-black transition-colors hover:bg-accent-primary/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        data-testid="submit-answer"
      >
        Submit
      </button>
    </form>
  );
}
