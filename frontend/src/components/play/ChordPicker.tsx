/**
 * ChordPicker.tsx -- Modal for selecting root note, chord type, and duration.
 */

import { useState } from "react";
import {
  ROOT_NOTES,
  CHORD_TYPES,
  chordName,
  chordNotes,
  generateId,
  type ChordBlock,
  type ChordType,
} from "../../audio/engine";

export interface ChordPickerProps {
  /** If provided, we are editing an existing chord. */
  editChord?: ChordBlock;
  onAdd: (chord: ChordBlock) => void;
  onCancel: () => void;
}

export default function ChordPicker({
  editChord,
  onAdd,
  onCancel,
}: ChordPickerProps) {
  const [root, setRoot] = useState(editChord?.root ?? "C");
  const [type, setType] = useState<ChordType>(editChord?.type ?? "Major");
  const [duration, setDuration] = useState(editChord?.durationBars ?? 1);

  const name = chordName(root, type);
  const notes = chordNotes(root, type);

  const handleSubmit = () => {
    onAdd({
      id: editChord?.id ?? generateId(),
      root,
      type,
      durationBars: duration,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-label="Chord picker"
      aria-modal="true"
      data-testid="chord-picker-modal"
    >
      <div className="bg-surface mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
        <h2 className="text-text-primary mb-4 text-xl font-bold">
          {editChord ? "Edit Chord" : "Add Chord"}
        </h2>

        {/* Root note selection */}
        <fieldset className="mb-4">
          <legend className="text-text-secondary mb-2 text-sm font-medium">
            Root Note
          </legend>
          <div className="grid grid-cols-6 gap-2" role="radiogroup">
            {ROOT_NOTES.map((note) => (
              <button
                key={note}
                type="button"
                onClick={() => setRoot(note)}
                className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${
                  root === note
                    ? "bg-accent-primary text-primary"
                    : "bg-elevated text-text-primary hover:bg-accent-primary/30"
                }`}
                role="radio"
                aria-checked={root === note}
                data-testid={`root-${note}`}
              >
                {note}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Chord type selection */}
        <fieldset className="mb-4">
          <legend className="text-text-secondary mb-2 text-sm font-medium">
            Chord Type
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {CHORD_TYPES.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setType(ct)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  type === ct
                    ? "bg-accent-primary text-primary"
                    : "bg-elevated text-text-primary hover:bg-accent-primary/30"
                }`}
                role="radio"
                aria-checked={type === ct}
                data-testid={`type-${ct}`}
              >
                {ct}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Duration */}
        <div className="mb-4">
          <label
            htmlFor="chord-duration"
            className="text-text-secondary mb-2 block text-sm font-medium"
          >
            Duration (bars)
          </label>
          <input
            id="chord-duration"
            type="number"
            min={1}
            max={16}
            value={duration}
            onChange={(e) =>
              setDuration(Math.max(1, Math.min(16, Number(e.target.value))))
            }
            className="bg-elevated text-text-primary w-20 rounded border border-gray-600 px-3 py-1.5 text-sm"
            data-testid="chord-duration"
          />
        </div>

        {/* Preview */}
        <div
          className="bg-elevated mb-4 rounded p-3"
          data-testid="chord-preview"
        >
          <p className="text-text-primary text-lg font-bold">{name}</p>
          <p className="text-text-secondary text-sm">
            Notes: {notes.join(", ")}
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary rounded px-4 py-2 text-sm"
            data-testid="chord-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="bg-accent-primary text-primary rounded px-4 py-2 text-sm font-medium"
            data-testid="chord-add"
          >
            {editChord ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
