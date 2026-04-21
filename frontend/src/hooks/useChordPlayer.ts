/**
 * useChordPlayer -- Tone.js-backed chord playback hook.
 *
 * Lazily initializes a Tone.Sampler loaded with piano samples from
 * `gleitz/midi-js-soundfonts` (MIT, CDN-hosted). The sampler is not
 * created until the first call to playChord(); this avoids loading
 * anything on page mount and keeps the audio context suspended until
 * the user actually triggers playback (a Web Audio best practice).
 *
 * Expected caller contract:
 * - Pass chordNotes as a space-separated string like "G B Eb".
 * - Notes are voiced at octave 4 (mid-range piano).
 * - Calling with null/empty chordNotes is a no-op.
 */

import { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";

/**
 * CDN base for acoustic grand piano samples. The Tone.Sampler will request
 * individual note MP3s from this directory lazily — only notes referenced
 * in our URL map are downloaded.
 */
const SAMPLE_BASE = "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3/";

/**
 * A small map of reference samples the sampler interpolates between. We
 * only need a handful of real samples to cover the range we care about
 * (roughly octave 3-5); Tone.Sampler pitch-shifts to cover gaps.
 */
const SAMPLE_URLS: Record<string, string> = {
  C3: "C3.mp3",
  C4: "C4.mp3",
  C5: "C5.mp3",
  "F#3": "Fs3.mp3",
  "F#4": "Fs4.mp3",
  "F#5": "Fs5.mp3",
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
      // Resume the audio context on the first user-triggered play.
      if (Tone.getContext().state !== "running") {
        void Tone.start();
      }
      // Wait for samples to load before triggering (no-op if already loaded).
      void Tone.loaded().then(() => {
        sampler.triggerAttackRelease(notes, CHORD_RELEASE_SECONDS);
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
