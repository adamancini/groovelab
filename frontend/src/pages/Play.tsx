/**
 * Play.tsx -- Track builder page with build mode and playback mode.
 *
 * Build mode: chord sequencer, drum rack, playback controls, save track.
 * Playback mode: large chord display, fretboard overlay, timeline, transport.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import ChordSequencer from "../components/play/ChordSequencer";
import DrumRack from "../components/play/DrumRack";
import PlaybackControls from "../components/play/PlaybackControls";
import PlaybackScreen from "../components/play/PlaybackScreen";
import {
  getAudioEngine,
  createDefaultDrumPattern,
  DRUM_INSTRUMENTS,
  type ChordBlock,
  type DrumPattern,
  type DrumInstrument,
  type PlaybackSettings,
  type AudioStatus,
} from "../audio/engine";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";

type Mode = "build" | "playback";

export default function Play() {
  const { user } = useAuth();

  // Track state
  const [chords, setChords] = useState<ChordBlock[]>([]);
  const [drumPattern, setDrumPattern] = useState<DrumPattern>(
    createDefaultDrumPattern(),
  );
  const [drumVolumes, setDrumVolumes] = useState<Record<DrumInstrument, number>>(
    () => {
      const vols: Partial<Record<DrumInstrument, number>> = {};
      for (const inst of DRUM_INSTRUMENTS) {
        vols[inst] = 0;
      }
      return vols as Record<DrumInstrument, number>;
    },
  );
  const [settings, setSettings] = useState<PlaybackSettings>({
    bpm: 120,
    metronome: false,
    countIn: "none",
    loopSection: "all",
  });

  // Playback state
  const [mode, setMode] = useState<Mode>("build");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChordIndex, setCurrentChordIndex] = useState(0);
  const [currentBar, setCurrentBar] = useState(0);
  const [currentStep, setCurrentStep] = useState(-1);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("initializing");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const engineRef = useRef(getAudioEngine());

  // Initialize audio engine on mount
  useEffect(() => {
    const engine = engineRef.current;
    engine.init().then((status) => {
      setAudioStatus(status);
    });
    return () => {
      engine.dispose();
    };
  }, []);

  // Sync drum volumes to engine
  const handleVolumeChange = useCallback(
    (instrument: DrumInstrument, db: number) => {
      setDrumVolumes((prev) => ({ ...prev, [instrument]: db }));
      engineRef.current.setDrumVolume(instrument, db);
    },
    [],
  );

  // Start playback
  const handlePlay = useCallback(() => {
    if (chords.length === 0) return;

    setMode("playback");
    setIsPlaying(true);
    setCurrentChordIndex(0);
    setCurrentBar(0);
    setCurrentStep(0);

    engineRef.current.play(chords, drumPattern, settings, {
      onStepChange: (step) => setCurrentStep(step),
      onChordChange: (idx) => setCurrentChordIndex(idx),
      onBarChange: (bar) => setCurrentBar(bar),
      onComplete: () => {
        setIsPlaying(false);
      },
      onError: (msg) => {
        setAudioStatus("error");
        setIsPlaying(false);
        console.error("Audio engine error:", msg);
      },
    });
  }, [chords, drumPattern, settings]);

  // Pause/resume
  const handlePause = useCallback(() => {
    if (isPlaying) {
      engineRef.current.pause();
      setIsPlaying(false);
    } else {
      // Resume: replay from current position
      // For simplicity, restart playback
      handlePlay();
    }
  }, [isPlaying, handlePlay]);

  // Stop and return to build mode
  const handleStop = useCallback(() => {
    engineRef.current.stop();
    setIsPlaying(false);
    setMode("build");
    setCurrentStep(-1);
    setCurrentBar(0);
    setCurrentChordIndex(0);
  }, []);

  // Retry audio
  const handleRetryAudio = useCallback(async () => {
    const status = await engineRef.current.retry();
    setAudioStatus(status);
  }, []);

  // Save track
  const handleSave = useCallback(async () => {
    if (!user) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      await api.saveTrack({
        chord_sequence: chords.map((c) => ({
          root: c.root,
          type: c.type,
          duration_bars: c.durationBars,
        })),
        drum_pattern: drumPattern,
        bpm: settings.bpm,
        playback_settings: {
          metronome: settings.metronome,
          count_in: settings.countIn,
          loop_section: settings.loopSection,
        },
      });
      setSaveMessage("Track saved!");
    } catch (err) {
      setSaveMessage(
        err instanceof api.ApiError
          ? err.message
          : "Failed to save track",
      );
    } finally {
      setSaving(false);
    }
  }, [user, chords, drumPattern, settings]);

  if (mode === "playback") {
    return (
      <PlaybackScreen
        chords={chords}
        currentChordIndex={currentChordIndex}
        currentBar={currentBar}
        currentStep={currentStep}
        settings={settings}
        isPlaying={isPlaying}
        audioStatus={audioStatus}
        onPause={handlePause}
        onStop={handleStop}
        onRetryAudio={handleRetryAudio}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6" data-testid="play-page">
      <h1 className="text-text-primary mb-6 text-2xl font-bold">Play</h1>

      {/* Audio status warnings */}
      {audioStatus === "visual-only" && (
        <div
          className="mb-4 rounded bg-yellow-900/50 px-4 py-2 text-sm text-yellow-200"
          role="alert"
          data-testid="visual-only-banner"
        >
          Audio playback is unavailable. The app will display chord changes and
          timing visually.
          <button
            type="button"
            onClick={handleRetryAudio}
            className="ml-2 underline"
          >
            Retry audio
          </button>
        </div>
      )}

      {/* Chord Sequence Panel */}
      <div className="mb-6">
        <ChordSequencer chords={chords} onChange={setChords} />
      </div>

      {/* Drum Rack Panel */}
      <div className="mb-6">
        <DrumRack
          pattern={drumPattern}
          onChange={setDrumPattern}
          activeStep={currentStep}
          volumes={drumVolumes}
          onVolumeChange={handleVolumeChange}
        />
      </div>

      {/* Playback Controls */}
      <div className="mb-6">
        <PlaybackControls
          settings={settings}
          onChange={setSettings}
          onPlay={handlePlay}
          disabled={chords.length === 0}
        />
      </div>

      {/* Save Track */}
      <div className="border-t border-gray-700 pt-4">
        {user ? (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || chords.length === 0}
              className="bg-accent-correct text-primary rounded px-6 py-2 text-sm font-bold transition-colors hover:opacity-90 disabled:opacity-50"
              data-testid="save-track"
            >
              {saving ? "Saving..." : "Save Track"}
            </button>
            {saveMessage && (
              <span
                className="text-sm text-text-secondary"
                data-testid="save-message"
              >
                {saveMessage}
              </span>
            )}
          </div>
        ) : (
          <p
            className="text-text-secondary text-sm"
            data-testid="save-auth-prompt"
          >
            Sign in to save tracks
          </p>
        )}
      </div>
    </div>
  );
}
