/**
 * DrumRack.tsx -- 16-step drum grid with 8 instrument rows and per-instrument volume.
 */

import { useCallback } from "react";
import {
  DRUM_INSTRUMENTS,
  DRUM_LABELS,
  type DrumPattern,
  type DrumInstrument,
} from "../../audio/engine";

export interface DrumRackProps {
  pattern: DrumPattern;
  onChange: (pattern: DrumPattern) => void;
  /** Currently active step (0-15) during playback, or -1 if not playing. */
  activeStep?: number;
  /** Per-instrument volumes in dB (-60 to 0). */
  volumes: Record<DrumInstrument, number>;
  onVolumeChange: (instrument: DrumInstrument, db: number) => void;
}

export default function DrumRack({
  pattern,
  onChange,
  activeStep = -1,
  volumes,
  onVolumeChange,
}: DrumRackProps) {
  const toggleStep = useCallback(
    (instrument: DrumInstrument, step: number) => {
      const updated = { ...pattern };
      updated[instrument] = [...updated[instrument]];
      updated[instrument][step] = !updated[instrument][step];
      onChange(updated);
    },
    [pattern, onChange],
  );

  return (
    <section aria-label="Drum Rack" data-testid="drum-rack">
      <h2 className="text-text-primary mb-2 text-lg font-bold">Drum Rack</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" role="grid">
          <thead>
            <tr>
              <th className="text-text-secondary w-28 py-1 text-left text-xs">
                Instrument
              </th>
              {Array.from({ length: 16 }, (_, i) => (
                <th
                  key={i}
                  className={`w-8 py-1 text-center text-xs ${
                    i === activeStep
                      ? "text-accent-primary font-bold"
                      : "text-text-secondary"
                  } ${i % 4 === 0 ? "border-l border-gray-600" : ""}`}
                >
                  {i + 1}
                </th>
              ))}
              <th className="text-text-secondary w-24 py-1 text-center text-xs">
                Vol
              </th>
            </tr>
          </thead>
          <tbody>
            {DRUM_INSTRUMENTS.map((inst) => (
              <tr key={inst} data-testid={`drum-row-${inst}`}>
                <td className="text-text-primary py-1 pr-2 text-xs font-medium">
                  {DRUM_LABELS[inst]}
                </td>
                {pattern[inst].map((active, step) => (
                  <td
                    key={step}
                    className={`p-0.5 text-center ${step % 4 === 0 ? "border-l border-gray-600" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleStep(inst, step)}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                        step === activeStep
                          ? "ring-accent-primary ring-2"
                          : ""
                      } ${
                        active
                          ? "bg-accent-primary"
                          : "bg-elevated hover:bg-accent-primary/30"
                      }`}
                      aria-label={`${DRUM_LABELS[inst]} step ${step + 1}${active ? " active" : " inactive"}`}
                      aria-pressed={active}
                      data-testid={`drum-${inst}-${step}`}
                    >
                      <span
                        className={`block h-3 w-3 rounded-full ${
                          active ? "bg-primary" : "border border-gray-500"
                        }`}
                      />
                    </button>
                  </td>
                ))}
                <td className="px-2 py-1">
                  <input
                    type="range"
                    min={-60}
                    max={0}
                    value={volumes[inst]}
                    onChange={(e) =>
                      onVolumeChange(inst, Number(e.target.value))
                    }
                    className="h-1 w-16"
                    aria-label={`${DRUM_LABELS[inst]} volume`}
                    data-testid={`drum-vol-${inst}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
