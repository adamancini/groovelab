/**
 * useChordPlayer -- Tone.js-backed chord playback hook.
 *
 * Lazily initializes a Tone.Sampler loaded with the Salamander Grand Piano
 * sample set (CDN-hosted on tonejs.github.io — the canonical Tone.js
 * sample set, every URL in the map is verified to exist). The sampler is
 * not created until the first call to playChord(); this avoids loading
 * anything on page mount and keeps the audio context suspended until the
 * user actually triggers playback (a Web Audio best practice).
 *
 * Expected caller contract:
 * - Pass chordNotes as a space-separated string like "G B Eb".
 * - Notes are voiced at octave 4 (mid-range piano).
 * - Calling with null/empty chordNotes is a no-op.
 *
 * Browser autoplay policy: AudioContext can only start from a user
 * gesture (click/keypress). The first playChord() call on page mount
 * will fail silently to resume the context; any subsequent user
 * interaction primes it and later cards play normally.
 */

import { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";

/**
 * Canonical Tone.js sample set. Every note in the URL map has a matching
 * MP3 on the CDN — confirmed in Tone.js docs and examples.
 */
const SAMPLE_BASE = "https://tonejs.github.io/audio/salamander/";

/**
 * Reference A-octave samples the sampler interpolates between. Five
 * anchors from A1..A5 cover three-plus octaves of chord range; Tone.Sampler
 * pitch-shifts to cover in-between notes.
 */
const SAMPLE_URLS: Record<string, string> = {
  A1: "A1.mp3",
  A2: "A2.mp3",
  A3: "A3.mp3",
  A4: "A4.mp3",
  A5: "A5.mp3",
};

const CHORD_RELEASE_SECONDS = 2;
const DEFAULT_VOLUME = 100; // 0-100 scale
const MIN_DB = -40;
const MAX_DB = 0;

/** Map a 0-100 linear volume to Tone's dB scale. 100 = 0dB, 0 = -40dB. */
function volumeToDb(volume: number): number {
  const clamped = Math.max(0, Math.min(100, volume));
  return MIN_DB + (clamped / 100) * (MAX_DB - MIN_DB);
}

/** Append octave 4 to every note in a space-separated chord string. */
function voiceChord(chordNotes: string): string[] {
  return chordNotes
    .split(/\s+/)
    .filter((n) => n.length > 0)
    .map((n) => `${n}4`);
}

export interface ChordPlayer {
  /** Play a chord. No-op when notes is empty/null. */
  playChord: (chordNotes: string | null) => void;
  /** Set volume on a 0-100 scale. */
  setVolume: (volume: number) => void;
  /** Stop all currently-sounding notes immediately. */
  stopPlayback: () => void;
}

export function useChordPlayer(): ChordPlayer {
  const samplerRef = useRef<Tone.Sampler | null>(null);
  const volumeRef = useRef<number>(DEFAULT_VOLUME);

  // Clean up the sampler on unmount.
  useEffect(() => {
    return () => {
      samplerRef.current?.dispose();
      samplerRef.current = null;
    };
  }, []);

  const ensureSampler = useCallback((): Tone.Sampler => {
    if (!samplerRef.current) {
      samplerRef.current = new Tone.Sampler({
        urls: SAMPLE_URLS,
        baseUrl: SAMPLE_BASE,
      }).toDestination();
      samplerRef.current.volume.value = volumeToDb(volumeRef.current);
    }
    return samplerRef.current;
  }, []);

  const playChord = useCallback(
    (chordNotes: string | null) => {
      if (!chordNotes) return;
      const notes = voiceChord(chordNotes);
      if (notes.length === 0) return;

      const sampler = ensureSampler();
      // Try to resume the audio context. The browser only allows resume
      // from a direct user gesture, so this silently no-ops on auto-play
      // paths. A subsequent user click (replay, answer, skip) will prime
      // the context and later calls succeed.
      if (Tone.getContext().state !== "running") {
        void Tone.start().catch(() => {
          /* no user gesture yet; later interactions will prime the context */
        });
      }
      // Wait for samples to load, then trigger. Swallow load failures so
      // a 404 on the CDN doesn't break the UI.
      void Tone.loaded()
        .then(() => {
          // If the context still can't start, skip this play rather than
          // throwing "buffer not loaded" into the console.
          if (Tone.getContext().state !== "running") return;
          sampler.triggerAttackRelease(notes, CHORD_RELEASE_SECONDS);
        })
        .catch((err) => {
          console.warn("[chord-player] playback skipped:", err);
        });
    },
    [ensureSampler],
  );

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (samplerRef.current) {
      samplerRef.current.volume.value = volumeToDb(volume);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (samplerRef.current) {
      samplerRef.current.releaseAll();
    }
  }, []);

  return { playChord, setVolume, stopPlayback };
}
