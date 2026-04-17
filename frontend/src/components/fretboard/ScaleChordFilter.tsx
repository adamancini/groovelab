/**
 * ScaleChordFilter.tsx -- Dropdown filter for selecting a scale or chord type
 * plus a key, to highlight member notes on the fretboard.
 */

import { useCallback } from "react";
import {
  CHROMATIC_NOTES,
  SCALE_CHORD_LIBRARY,
  type ScaleChordDef,
} from "../../lib/music-theory";

export interface ScaleChordFilterProps {
  /** Currently selected scale/chord definition, or null for "None". */
  selectedDef: ScaleChordDef | null;
  /** Currently selected key (root note). */
  selectedKey: string;
  /** Called when the scale/chord selection changes. */
  onDefChange: (def: ScaleChordDef | null) => void;
  /** Called when the key changes. */
  onKeyChange: (key: string) => void;
}

export default function ScaleChordFilter({
  selectedDef,
  selectedKey,
  onDefChange,
  onKeyChange,
}: ScaleChordFilterProps) {
  const scales = SCALE_CHORD_LIBRARY.filter((d) => d.type === "scale");
  const chords = SCALE_CHORD_LIBRARY.filter((d) => d.type === "chord");

  const handleDefChange = useCallback(
    (value: string) => {
      if (value === "") {
        onDefChange(null);
        return;
      }
      const def = SCALE_CHORD_LIBRARY.find((d) => d.name === value);
      onDefChange(def ?? null);
    },
    [onDefChange],
  );

  return (
    <div
      className="flex flex-wrap items-end gap-4"
      role="group"
      aria-label="Scale and chord filter"
      data-testid="scale-chord-filter"
    >
      {/* Scale/Chord type selector */}
      <div>
        <label
          htmlFor="scale-chord-select"
          className="text-text-secondary mb-1 block text-xs font-medium uppercase tracking-wide"
        >
          Scale / Chord
        </label>
        <select
          id="scale-chord-select"
          value={selectedDef?.name ?? ""}
          onChange={(e) => handleDefChange(e.target.value)}
          className="bg-elevated text-text-primary rounded border border-white/10 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          data-testid="scale-chord-select"
        >
          <option value="">None</option>
          <optgroup label="Scales">
            {scales.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Chords">
            {chords.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Key selector */}
      <div>
        <label
          htmlFor="key-select"
          className="text-text-secondary mb-1 block text-xs font-medium uppercase tracking-wide"
        >
          Key
        </label>
        <select
          id="key-select"
          value={selectedKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="bg-elevated text-text-primary rounded border border-white/10 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          data-testid="key-select"
        >
          {CHROMATIC_NOTES.map((note) => (
            <option key={note} value={note}>
              {note}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
