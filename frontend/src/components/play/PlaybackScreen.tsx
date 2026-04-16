/**
 * PlaybackScreen.tsx -- Playback view with large chord display, fretboard overlay,
 * timeline, transport bar, and ARIA live region for chord announcements.
 */

import { useState, useCallback } from "react";
import Fretboard from "../Fretboard";
import {
  chordName,
  chordFretboardPositions,
  type ChordBlock,
  type PlaybackSettings,
} from "../../audio/engine";

export interface PlaybackScreenProps {
  chords: ChordBlock[];
  currentChordIndex: number;
  currentBar: number;
  currentStep: number;
  settings: PlaybackSettings;
  isPlaying: boolean;
  audioStatus: "ready" | "visual-only" | "error" | "initializing";
  onPause: () => void;
  onStop: () => void;
  onRetryAudio: () => void;
}

export default function PlaybackScreen({
  chords,
  currentChordIndex,
  currentBar,
  currentStep,
  settings,
  isPlaying,
  audioStatus,
  onPause,
  onStop,
  onRetryAudio,
}: PlaybackScreenProps) {
  const [showFretboard, setShowFretboard] = useState(true);

  const currentChord = chords[currentChordIndex];
  const totalBars = chords.reduce((sum, c) => sum + c.durationBars, 0);
  const currentChordName = currentChord
    ? chordName(currentChord.root, currentChord.type)
    : "";

  // Fretboard positions for current chord
  const fretPositions = currentChord
    ? chordFretboardPositions(currentChord.root, currentChord.type)
    : [];

  // Map to Fretboard component format with tonic coloring
  const fretboardPositions = fretPositions.map((p) => ({
    string: p.string,
    fret: p.fret,
    label: p.label,
  }));

  // Timeline progress
  const progress = totalBars > 0 ? (currentBar / totalBars) * 100 : 0;

  // Build chord segment widths for timeline
  const getChordSegments = useCallback(() => {
    return chords.map((chord, i) => ({
      width: (chord.durationBars / totalBars) * 100,
      name: chordName(chord.root, chord.type),
      active: i === currentChordIndex,
    }));
  }, [chords, totalBars, currentChordIndex]);

  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-between p-4"
      data-testid="playback-screen"
    >
      {/* Audio status banners */}
      {audioStatus === "visual-only" && (
        <div
          className="mb-4 w-full rounded bg-yellow-900/50 px-4 py-2 text-center text-sm text-yellow-200"
          role="alert"
          data-testid="visual-only-banner"
        >
          Audio playback is unavailable. The app will display chord changes and
          timing visually.
          <button
            type="button"
            onClick={onRetryAudio}
            className="ml-2 underline"
            data-testid="retry-audio"
          >
            Retry audio
          </button>
        </div>
      )}

      {audioStatus === "error" && (
        <div
          className="mb-4 w-full rounded bg-red-900/50 px-4 py-2 text-center text-sm text-red-200"
          role="alert"
          data-testid="audio-error-banner"
        >
          Audio playback interrupted. Check your audio output.
          <button
            type="button"
            onClick={onRetryAudio}
            className="ml-2 underline"
            data-testid="retry-audio-error"
          >
            Retry audio
          </button>
        </div>
      )}

      {/* ARIA live region for screen reader chord announcements */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        data-testid="chord-announcement"
      >
        {currentChordName && `Now playing: ${currentChordName}`}
      </div>

      {/* Current chord -- LARGEST element */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <h1
          className="text-text-primary mb-2 text-center font-bold"
          style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
          data-testid="current-chord-name"
        >
          {currentChordName || "--"}
        </h1>
        {currentChord && (
          <p className="text-text-secondary text-sm">
            Bar {currentBar + 1} of {totalBars}
          </p>
        )}
      </div>

      {/* Fretboard overlay (toggleable) */}
      <div className="mb-4 w-full max-w-2xl">
        <button
          type="button"
          onClick={() => setShowFretboard(!showFretboard)}
          className="text-text-secondary hover:text-text-primary mb-2 text-sm underline"
          data-testid="toggle-fretboard"
        >
          {showFretboard ? "Hide" : "Show"} Fretboard
        </button>
        {showFretboard && (
          <Fretboard
            strings={4}
            frets={12}
            positions={fretboardPositions}
            className="w-full"
          />
        )}
      </div>

      {/* Timeline */}
      <div
        className="bg-elevated mb-4 w-full max-w-2xl overflow-hidden rounded"
        data-testid="timeline"
      >
        <div className="relative flex h-8">
          {getChordSegments().map((seg, i) => (
            <div
              key={i}
              className={`flex items-center justify-center border-r border-gray-600 text-xs font-medium last:border-r-0 ${
                seg.active
                  ? "bg-accent-primary/30 text-accent-primary"
                  : "text-text-secondary"
              }`}
              style={{ width: `${seg.width}%` }}
              data-testid={`timeline-segment-${i}`}
            >
              {seg.name}
            </div>
          ))}
          {/* Playhead */}
          <div
            className="bg-accent-primary pointer-events-none absolute top-0 h-full w-0.5 transition-all"
            style={{ left: `${progress}%` }}
            data-testid="playhead"
          />
        </div>
      </div>

      {/* Transport bar */}
      <div
        className="bg-surface flex w-full max-w-2xl items-center justify-between rounded-lg px-4 py-3"
        data-testid="transport-bar"
      >
        <span className="text-text-secondary text-sm">
          {settings.bpm} BPM
        </span>
        <span className="text-text-secondary text-sm">
          Bar {currentBar + 1} / {totalBars}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPause}
            className="bg-elevated hover:bg-accent-primary/30 text-text-primary rounded px-3 py-1.5 text-sm font-medium transition-colors"
            data-testid="pause-button"
          >
            {isPlaying ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="bg-accent-wrong/20 hover:bg-accent-wrong/40 text-accent-wrong rounded px-3 py-1.5 text-sm font-medium transition-colors"
            data-testid="stop-button"
          >
            Stop
          </button>
        </div>
        {settings.loopSection === "all" && (
          <span
            className="text-accent-primary text-xs"
            data-testid="loop-indicator"
          >
            LOOP
          </span>
        )}
      </div>
    </div>
  );
}
