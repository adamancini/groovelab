/**
 * PlaybackControls.tsx -- BPM, tap tempo, metronome, count-in, and loop controls.
 */

import { useState, useCallback, useRef } from "react";
import type { PlaybackSettings } from "../../audio/engine";

export interface PlaybackControlsProps {
  settings: PlaybackSettings;
  onChange: (settings: PlaybackSettings) => void;
  onPlay: () => void;
  disabled?: boolean;
}

export default function PlaybackControls({
  settings,
  onChange,
  onPlay,
  disabled = false,
}: PlaybackControlsProps) {
  const tapTimestamps = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);

  const handleBpmChange = useCallback(
    (value: number) => {
      const bpm = Math.max(40, Math.min(300, value));
      onChange({ ...settings, bpm });
    },
    [settings, onChange],
  );

  const handleTapTempo = useCallback(() => {
    const now = performance.now();
    const timestamps = tapTimestamps.current;

    // Reset if last tap was more than 2 seconds ago
    if (timestamps.length > 0 && now - timestamps[timestamps.length - 1] > 2000) {
      timestamps.length = 0;
    }

    timestamps.push(now);
    setTapCount(timestamps.length);

    // Calculate BPM from 4+ taps
    if (timestamps.length >= 4) {
      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
      }
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avgInterval);
      handleBpmChange(bpm);
    }

    // Keep only last 8 taps
    if (timestamps.length > 8) {
      timestamps.splice(0, timestamps.length - 8);
    }
  }, [handleBpmChange]);

  return (
    <section
      aria-label="Playback Controls"
      data-testid="playback-controls"
      className="flex flex-wrap items-center gap-4"
    >
      {/* BPM */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="bpm-input"
          className="text-text-secondary text-sm font-medium"
        >
          BPM
        </label>
        <input
          id="bpm-input"
          type="number"
          min={40}
          max={300}
          value={settings.bpm}
          onChange={(e) => handleBpmChange(Number(e.target.value))}
          className="bg-elevated text-text-primary w-20 rounded border border-gray-600 px-2 py-1 text-center text-sm"
          data-testid="bpm-input"
        />
      </div>

      {/* Tap Tempo */}
      <button
        type="button"
        onClick={handleTapTempo}
        className="bg-elevated hover:bg-accent-primary/30 text-text-primary rounded px-3 py-1.5 text-sm font-medium transition-colors"
        data-testid="tap-tempo"
      >
        Tap Tempo {tapCount >= 4 ? "" : `(${tapCount}/4)`}
      </button>

      {/* Metronome */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.metronome}
          onChange={(e) =>
            onChange({ ...settings, metronome: e.target.checked })
          }
          className="accent-accent-primary"
          data-testid="metronome-toggle"
        />
        <span className="text-text-primary">Metronome</span>
      </label>

      {/* Count-in */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="count-in"
          className="text-text-secondary text-sm font-medium"
        >
          Count-in
        </label>
        <select
          id="count-in"
          value={settings.countIn}
          onChange={(e) =>
            onChange({
              ...settings,
              countIn: e.target.value as PlaybackSettings["countIn"],
            })
          }
          className="bg-elevated text-text-primary rounded border border-gray-600 px-2 py-1 text-sm"
          data-testid="count-in-select"
        >
          <option value="none">None</option>
          <option value="1bar">1 bar</option>
          <option value="2bars">2 bars</option>
        </select>
      </div>

      {/* Loop */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="loop-section"
          className="text-text-secondary text-sm font-medium"
        >
          Loop
        </label>
        <select
          id="loop-section"
          value={settings.loopSection}
          onChange={(e) =>
            onChange({
              ...settings,
              loopSection: e.target.value as PlaybackSettings["loopSection"],
            })
          }
          className="bg-elevated text-text-primary rounded border border-gray-600 px-2 py-1 text-sm"
          data-testid="loop-select"
        >
          <option value="all">All</option>
          <option value="chord">Current chord</option>
        </select>
      </div>

      {/* Play button */}
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        className="bg-accent-primary text-primary rounded-lg px-6 py-2 text-sm font-bold transition-colors hover:opacity-90 disabled:opacity-50"
        data-testid="play-button"
      >
        Play
      </button>
    </section>
  );
}
