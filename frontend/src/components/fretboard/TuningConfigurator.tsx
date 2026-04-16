/**
 * TuningConfigurator.tsx -- Tuning preset and custom tuning selector.
 *
 * Supports string count toggle (4/5/6), tuning preset dropdown,
 * and per-string custom tuning when "Custom" is selected.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CHROMATIC_NOTES,
  DEFAULT_TUNING_PRESETS,
  type TuningPreset,
} from "../../lib/music-theory";
import * as api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

export interface TuningConfiguratorProps {
  /** Current number of strings. */
  stringCount: number;
  /** Current tuning (array of note names, highest-pitched first). */
  tuning: string[];
  /** Called when the string count changes. */
  onStringCountChange: (count: number) => void;
  /** Called when the tuning changes. */
  onTuningChange: (tuning: string[]) => void;
}

const STRING_COUNTS = [4, 5, 6] as const;
const CUSTOM_ID = "custom";

export default function TuningConfigurator({
  stringCount,
  tuning,
  onStringCountChange,
  onTuningChange,
}: TuningConfiguratorProps) {
  const { user } = useAuth();
  const [presets, setPresets] = useState<TuningPreset[]>(DEFAULT_TUNING_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("standard-4");
  const [isCustom, setIsCustom] = useState(false);
  const [apiLoaded, setApiLoaded] = useState(false);

  // Fetch tuning presets from API on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .fetchTuningPresets()
      .then((data) => {
        if (!cancelled && data.length > 0) {
          setPresets(data);
          setApiLoaded(true);
        }
      })
      .catch(() => {
        // Fallback to DEFAULT_TUNING_PRESETS -- already set.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter presets by current string count.
  const filteredPresets = presets.filter((p) => p.strings === stringCount);

  // When string count changes, select the first matching preset.
  const handleStringCountChange = useCallback(
    (count: number) => {
      onStringCountChange(count);
      setIsCustom(false);
      const match =
        presets.find((p) => p.strings === count && p.name === "Standard") ??
        presets.find((p) => p.strings === count);
      if (match) {
        setSelectedPresetId(match.id);
        onTuningChange(match.notes);
      }
    },
    [presets, onStringCountChange, onTuningChange],
  );

  // When a preset is selected from the dropdown.
  const handlePresetChange = useCallback(
    (presetId: string) => {
      if (presetId === CUSTOM_ID) {
        setIsCustom(true);
        setSelectedPresetId(CUSTOM_ID);
        return;
      }
      setIsCustom(false);
      setSelectedPresetId(presetId);
      const preset = presets.find((p) => p.id === presetId);
      if (preset) {
        onTuningChange(preset.notes);
        // Auto-save for authenticated users.
        if (user) {
          api.saveSettings({ tuning_preset: presetId }).catch(() => {
            // Non-critical -- silently ignore save failures.
          });
        }
      }
    },
    [presets, onTuningChange, user],
  );

  // When a custom per-string note changes.
  const handleCustomNoteChange = useCallback(
    (stringIndex: number, note: string) => {
      const next = [...tuning];
      next[stringIndex] = note;
      onTuningChange(next);
      if (user) {
        api
          .saveSettings({ tuning_preset: "custom", custom_tuning: next })
          .catch(() => {});
      }
    },
    [tuning, onTuningChange, user],
  );

  return (
    <div
      className="flex flex-wrap items-start gap-4"
      role="group"
      aria-label="Tuning configurator"
      data-testid="tuning-configurator"
    >
      {/* String count toggle */}
      <fieldset>
        <legend className="text-secondary mb-1 text-xs font-medium uppercase tracking-wide">
          Strings
        </legend>
        <div className="flex gap-1" role="radiogroup" aria-label="String count">
          {STRING_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={stringCount === count}
              onClick={() => handleStringCountChange(count)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary ${
                stringCount === count
                  ? "bg-accent-primary text-black"
                  : "bg-elevated text-secondary hover:text-primary"
              }`}
              data-testid={`string-count-${count}`}
            >
              {count}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Tuning preset dropdown */}
      <div>
        <label
          htmlFor="tuning-preset"
          className="text-secondary mb-1 block text-xs font-medium uppercase tracking-wide"
        >
          Tuning
        </label>
        <select
          id="tuning-preset"
          value={isCustom ? CUSTOM_ID : selectedPresetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="bg-elevated text-primary rounded border border-white/10 px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          data-testid="tuning-preset-select"
        >
          {filteredPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.notes.join("-")})
            </option>
          ))}
          <option value={CUSTOM_ID}>Custom</option>
        </select>
        {!apiLoaded && (
          <span className="text-secondary ml-2 text-xs" aria-live="polite">
            (using defaults)
          </span>
        )}
      </div>

      {/* Custom per-string tuning */}
      {isCustom && (
        <fieldset data-testid="custom-tuning-controls">
          <legend className="text-secondary mb-1 text-xs font-medium uppercase tracking-wide">
            Custom Tuning
          </legend>
          <div className="flex gap-2">
            {tuning.map((note, idx) => (
              <div key={idx} className="flex flex-col items-center gap-0.5">
                <span className="text-secondary text-xs">
                  S{idx + 1}
                </span>
                <select
                  aria-label={`String ${idx + 1} note`}
                  value={note}
                  onChange={(e) => handleCustomNoteChange(idx, e.target.value)}
                  className="bg-elevated text-primary rounded border border-white/10 px-1.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
                  data-testid={`custom-note-${idx}`}
                >
                  {CHROMATIC_NOTES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
