/**
 * play.test.tsx -- Integration tests for Play mode.
 *
 * Covers: chord picker, chord sequencer, drum rack, playback controls,
 * playback screen, visual-only fallback, save flow, ARIA accessibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import Play from "../pages/Play";
import ChordPicker from "../components/play/ChordPicker";
import ChordSequencer from "../components/play/ChordSequencer";
import DrumRack from "../components/play/DrumRack";
import PlaybackControls from "../components/play/PlaybackControls";
import PlaybackScreen from "../components/play/PlaybackScreen";
import {
  chordNotes,
  chordName,
  chordFretboardPositions,
  createEmptyDrumPattern,
  createDefaultDrumPattern,
  DRUM_INSTRUMENTS,
  CHORD_TYPES,
  ROOT_NOTES,
  type ChordBlock,
  type PlaybackSettings,
  type DrumInstrument,
} from "../audio/engine";

// ---------- Mock Tone.js (Web Audio not available in jsdom) ----------

vi.mock("tone", () => ({
  start: vi.fn().mockRejectedValue(new Error("No AudioContext in jsdom")),
  loaded: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    bpm: { value: 120, rampTo: vi.fn() },
    timeSignature: 4,
    loop: false,
    loopStart: "0:0:0",
    loopEnd: "4:0:0",
    position: "0:0:0",
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    schedule: vi.fn(() => 0),
    scheduleRepeat: vi.fn(() => 0),
    scheduleOnce: vi.fn(() => 0),
    getSecondsAtTime: vi.fn(() => 0),
  })),
  Players: vi.fn().mockImplementation(() => ({
    has: vi.fn(() => false),
    player: vi.fn(() => ({
      start: vi.fn(),
      connect: vi.fn(),
    })),
    dispose: vi.fn(),
  })),
  PolySynth: vi.fn().mockImplementation(() => ({
    triggerAttackRelease: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
    dispose: vi.fn(),
  })),
  Synth: vi.fn().mockImplementation(() => ({
    triggerAttackRelease: vi.fn(),
    toDestination: vi.fn().mockReturnThis(),
    dispose: vi.fn(),
  })),
  Volume: vi.fn().mockImplementation(() => ({
    volume: { value: 0 },
    toDestination: vi.fn().mockReturnThis(),
    dispose: vi.fn(),
  })),
}));

// ---------- Mock fetch for auth and API calls ----------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockUnauthenticatedUser() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/auth/me")) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Not authenticated" }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
}

function mockAuthenticatedUser() {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/auth/me")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ id: "u1", email: "test@test.com", role: "user" }),
      });
    }
    if (url.includes("/tracks") && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "track-1",
            user_id: "u1",
            chord_sequence: [],
            drum_pattern: {},
            bpm: 120,
            playback_settings: {},
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });
}

function renderPlayPage(initialPath = "/play") {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/play" element={<Play />} />
            <Route path="/play/:id" element={<Play />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

// ---------- Music theory unit tests ----------

describe("Music theory helpers", () => {
  it("chordNotes returns correct notes for C Major", () => {
    const notes = chordNotes("C", "Major");
    expect(notes).toEqual(["C3", "E3", "G3"]);
  });

  it("chordNotes returns correct notes for A Minor", () => {
    const notes = chordNotes("A", "Minor");
    expect(notes).toEqual(["A3", "C4", "E4"]);
  });

  it("chordNotes returns correct notes for G Dom7", () => {
    const notes = chordNotes("G", "Dom7");
    expect(notes).toEqual(["G3", "B3", "D4", "F4"]);
  });

  it("chordName formats chord names correctly", () => {
    expect(chordName("C", "Major")).toBe("C");
    expect(chordName("A", "Minor")).toBe("Am");
    expect(chordName("G", "Dom7")).toBe("G7");
    expect(chordName("F", "Maj7")).toBe("Fmaj7");
    expect(chordName("D", "Min7")).toBe("Dm7");
    expect(chordName("B", "Dim")).toBe("Bdim");
    expect(chordName("C", "Aug")).toBe("Caug");
  });

  it("chordFretboardPositions returns positions on 4-string bass", () => {
    const positions = chordFretboardPositions("C", "Major");
    expect(positions.length).toBeGreaterThan(0);
    // Should have tonic positions marked
    const tonics = positions.filter((p) => p.isTonic);
    expect(tonics.length).toBeGreaterThan(0);
    // All positions should have string 0-3 and fret 0-12
    for (const p of positions) {
      expect(p.string).toBeGreaterThanOrEqual(0);
      expect(p.string).toBeLessThanOrEqual(3);
      expect(p.fret).toBeGreaterThanOrEqual(0);
      expect(p.fret).toBeLessThanOrEqual(12);
    }
  });

  it("createEmptyDrumPattern has all 8 instruments with 16 steps", () => {
    const p = createEmptyDrumPattern();
    expect(Object.keys(p)).toHaveLength(8);
    for (const inst of DRUM_INSTRUMENTS) {
      expect(p[inst]).toHaveLength(16);
      expect(p[inst].every((v) => v === false)).toBe(true);
    }
  });

  it("createDefaultDrumPattern has active steps", () => {
    const p = createDefaultDrumPattern();
    // Kick should have some active steps
    expect(p.Kick.some((v) => v === true)).toBe(true);
    // Snare should have some active steps
    expect(p.Snare.some((v) => v === true)).toBe(true);
  });

  it("ROOT_NOTES contains all 12 chromatic notes", () => {
    expect(ROOT_NOTES).toHaveLength(12);
    expect(ROOT_NOTES).toContain("C");
    expect(ROOT_NOTES).toContain("F#");
    expect(ROOT_NOTES).toContain("B");
  });

  it("CHORD_TYPES contains all 7 types", () => {
    expect(CHORD_TYPES).toHaveLength(7);
    expect(CHORD_TYPES).toContain("Major");
    expect(CHORD_TYPES).toContain("Minor");
    expect(CHORD_TYPES).toContain("Dom7");
    expect(CHORD_TYPES).toContain("Maj7");
    expect(CHORD_TYPES).toContain("Min7");
    expect(CHORD_TYPES).toContain("Dim");
    expect(CHORD_TYPES).toContain("Aug");
  });
});

// ---------- ChordPicker component tests ----------

describe("ChordPicker", () => {
  it("renders root note buttons, type buttons, duration input, and preview", () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    render(<ChordPicker onAdd={onAdd} onCancel={onCancel} />);

    // 12 root note buttons
    for (const note of ROOT_NOTES) {
      expect(screen.getByTestId(`root-${note}`)).toBeInTheDocument();
    }

    // 7 chord type buttons
    for (const ct of CHORD_TYPES) {
      expect(screen.getByTestId(`type-${ct}`)).toBeInTheDocument();
    }

    // Duration input
    expect(screen.getByTestId("chord-duration")).toBeInTheDocument();

    // Preview
    expect(screen.getByTestId("chord-preview")).toBeInTheDocument();
  });

  it("creates correct chord block on Add", () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    render(<ChordPicker onAdd={onAdd} onCancel={onCancel} />);

    // Select root A
    fireEvent.click(screen.getByTestId("root-A"));
    // Select type Minor
    fireEvent.click(screen.getByTestId("type-Minor"));
    // Set duration to 2
    fireEvent.change(screen.getByTestId("chord-duration"), {
      target: { value: "2" },
    });

    // Check preview shows Am
    const preview = screen.getByTestId("chord-preview");
    expect(within(preview).getByText("Am")).toBeInTheDocument();

    // Click Add
    fireEvent.click(screen.getByTestId("chord-add"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const chord = onAdd.mock.calls[0][0];
    expect(chord.root).toBe("A");
    expect(chord.type).toBe("Minor");
    expect(chord.durationBars).toBe(2);
    expect(chord.id).toBeTruthy();
  });

  it("calls onCancel when Cancel clicked", () => {
    const onAdd = vi.fn();
    const onCancel = vi.fn();
    render(<ChordPicker onAdd={onAdd} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("chord-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("pre-fills values when editing an existing chord", () => {
    const editChord: ChordBlock = {
      id: "edit-1",
      root: "F#",
      type: "Maj7",
      durationBars: 3,
    };
    const onAdd = vi.fn();
    render(
      <ChordPicker editChord={editChord} onAdd={onAdd} onCancel={vi.fn()} />,
    );

    // Preview should show F#maj7
    const preview = screen.getByTestId("chord-preview");
    expect(within(preview).getByText("F#maj7")).toBeInTheDocument();

    // Duration should be 3
    expect(screen.getByTestId("chord-duration")).toHaveValue(3);

    // Save (button text changes to "Save" in edit mode)
    expect(screen.getByTestId("chord-add")).toHaveTextContent("Save");
  });
});

// ---------- ChordSequencer tests ----------

describe("ChordSequencer", () => {
  it("renders empty state with add button", () => {
    const onChange = vi.fn();
    render(<ChordSequencer chords={[]} onChange={onChange} />);

    expect(screen.getByTestId("chord-sequencer")).toBeInTheDocument();
    expect(screen.getByTestId("add-chord-button")).toBeInTheDocument();
  });

  it("renders chord blocks", () => {
    const chords: ChordBlock[] = [
      { id: "1", root: "C", type: "Major", durationBars: 1 },
      { id: "2", root: "G", type: "Dom7", durationBars: 2 },
    ];
    const onChange = vi.fn();
    render(<ChordSequencer chords={chords} onChange={onChange} />);

    expect(screen.getByTestId("chord-block-0")).toBeInTheDocument();
    expect(screen.getByTestId("chord-block-1")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("G7")).toBeInTheDocument();
  });

  it("opens chord picker on add button click", () => {
    const onChange = vi.fn();
    render(<ChordSequencer chords={[]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("add-chord-button"));
    expect(screen.getByTestId("chord-picker-modal")).toBeInTheDocument();
  });

  it("adds chord to sequence", () => {
    const onChange = vi.fn();
    render(<ChordSequencer chords={[]} onChange={onChange} />);

    // Open picker
    fireEvent.click(screen.getByTestId("add-chord-button"));

    // Select C Major and add
    fireEvent.click(screen.getByTestId("root-C"));
    fireEvent.click(screen.getByTestId("type-Major"));
    fireEvent.click(screen.getByTestId("chord-add"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const newChords = onChange.mock.calls[0][0];
    expect(newChords).toHaveLength(1);
    expect(newChords[0].root).toBe("C");
    expect(newChords[0].type).toBe("Major");
  });

  it("deletes chord on right-click (context menu)", () => {
    const chords: ChordBlock[] = [
      { id: "1", root: "C", type: "Major", durationBars: 1 },
      { id: "2", root: "G", type: "Minor", durationBars: 1 },
    ];
    const onChange = vi.fn();
    render(<ChordSequencer chords={chords} onChange={onChange} />);

    // Right-click on first chord
    fireEvent.contextMenu(screen.getByTestId("chord-block-0"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const remaining = onChange.mock.calls[0][0];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].root).toBe("G");
  });

  it("opens edit picker on chord block click", () => {
    const chords: ChordBlock[] = [
      { id: "1", root: "C", type: "Major", durationBars: 1 },
    ];
    const onChange = vi.fn();
    render(<ChordSequencer chords={chords} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("chord-block-0"));
    expect(screen.getByTestId("chord-picker-modal")).toBeInTheDocument();
    // Should show "Save" instead of "Add" in edit mode
    expect(screen.getByTestId("chord-add")).toHaveTextContent("Save");
  });

  it("chord blocks are draggable", () => {
    const chords: ChordBlock[] = [
      { id: "1", root: "C", type: "Major", durationBars: 1 },
    ];
    const onChange = vi.fn();
    render(<ChordSequencer chords={chords} onChange={onChange} />);

    const block = screen.getByTestId("chord-block-0");
    expect(block).toHaveAttribute("draggable", "true");
  });
});

// ---------- DrumRack tests ----------

describe("DrumRack", () => {
  const defaultVolumes: Record<DrumInstrument, number> = {} as Record<
    DrumInstrument,
    number
  >;
  for (const inst of DRUM_INSTRUMENTS) {
    defaultVolumes[inst] = 0;
  }

  it("renders 16-step grid with 8 instrument rows", () => {
    const pattern = createEmptyDrumPattern();
    const onChange = vi.fn();
    render(
      <DrumRack
        pattern={pattern}
        onChange={onChange}
        volumes={defaultVolumes}
        onVolumeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("drum-rack")).toBeInTheDocument();

    // Check all 8 instrument rows exist
    for (const inst of DRUM_INSTRUMENTS) {
      expect(screen.getByTestId(`drum-row-${inst}`)).toBeInTheDocument();
    }
  });

  it("toggles drum step on click and persists", () => {
    const pattern = createEmptyDrumPattern();
    const onChange = vi.fn();
    render(
      <DrumRack
        pattern={pattern}
        onChange={onChange}
        volumes={defaultVolumes}
        onVolumeChange={vi.fn()}
      />,
    );

    // Click Kick step 0
    fireEvent.click(screen.getByTestId("drum-Kick-0"));
    expect(onChange).toHaveBeenCalledTimes(1);

    const updated = onChange.mock.calls[0][0];
    expect(updated.Kick[0]).toBe(true);
    // Other steps should remain false
    expect(updated.Kick[1]).toBe(false);
    // Other instruments should remain unchanged
    expect(updated.Snare[0]).toBe(false);
  });

  it("toggles off an active step", () => {
    const pattern = createDefaultDrumPattern();
    const onChange = vi.fn();
    render(
      <DrumRack
        pattern={pattern}
        onChange={onChange}
        volumes={defaultVolumes}
        onVolumeChange={vi.fn()}
      />,
    );

    // Kick step 0 is active in default pattern -- toggle it off
    fireEvent.click(screen.getByTestId("drum-Kick-0"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0];
    expect(updated.Kick[0]).toBe(false);
  });

  it("renders per-instrument volume slider", () => {
    const pattern = createEmptyDrumPattern();
    const onVolumeChange = vi.fn();
    render(
      <DrumRack
        pattern={pattern}
        onChange={vi.fn()}
        volumes={defaultVolumes}
        onVolumeChange={onVolumeChange}
      />,
    );

    for (const inst of DRUM_INSTRUMENTS) {
      expect(screen.getByTestId(`drum-vol-${inst}`)).toBeInTheDocument();
    }

    // Change Kick volume
    fireEvent.change(screen.getByTestId("drum-vol-Kick"), {
      target: { value: "-20" },
    });
    expect(onVolumeChange).toHaveBeenCalledWith("Kick", -20);
  });

  it("highlights active step during playback", () => {
    const pattern = createDefaultDrumPattern();
    render(
      <DrumRack
        pattern={pattern}
        onChange={vi.fn()}
        activeStep={3}
        volumes={defaultVolumes}
        onVolumeChange={vi.fn()}
      />,
    );

    // Step header for step 4 (index 3) should have active styling
    // The step 3 buttons should have ring styling
    const kickStep3 = screen.getByTestId("drum-Kick-3");
    // The button itself should have the ring class since step === activeStep
    expect(kickStep3.className).toContain("ring-2");
  });
});

// ---------- PlaybackControls tests ----------

describe("PlaybackControls", () => {
  const defaultSettings: PlaybackSettings = {
    bpm: 120,
    metronome: false,
    countIn: "none",
    loopSection: "all",
  };

  it("renders BPM input, tap tempo, metronome, count-in, loop, and play button", () => {
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={vi.fn()}
        onPlay={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bpm-input")).toBeInTheDocument();
    expect(screen.getByTestId("tap-tempo")).toBeInTheDocument();
    expect(screen.getByTestId("metronome-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("count-in-select")).toBeInTheDocument();
    expect(screen.getByTestId("loop-select")).toBeInTheDocument();
    expect(screen.getByTestId("play-button")).toBeInTheDocument();
  });

  it("BPM input accepts 40-300 range", () => {
    const onChange = vi.fn();
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={onChange}
        onPlay={vi.fn()}
      />,
    );

    // Set to 200
    fireEvent.change(screen.getByTestId("bpm-input"), {
      target: { value: "200" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bpm: 200 }),
    );

    // Try below 40 -- should clamp
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("bpm-input"), {
      target: { value: "10" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bpm: 40 }),
    );

    // Try above 300 -- should clamp
    onChange.mockClear();
    fireEvent.change(screen.getByTestId("bpm-input"), {
      target: { value: "500" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bpm: 300 }),
    );
  });

  it("tap tempo calculates BPM from 4+ taps", () => {
    const onChange = vi.fn();
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={onChange}
        onPlay={vi.fn()}
      />,
    );

    const tapButton = screen.getByTestId("tap-tempo");

    // Mock performance.now to control timing
    const originalNow = performance.now;
    let fakeTime = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeTime);

    // Tap 4 times at 500ms intervals (= 120 BPM)
    fireEvent.click(tapButton);
    fakeTime += 500;
    fireEvent.click(tapButton);
    fakeTime += 500;
    fireEvent.click(tapButton);
    fakeTime += 500;
    fireEvent.click(tapButton);

    // After 4 taps, BPM should be calculated
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bpm: 120 }),
    );

    performance.now = originalNow;
  });

  it("metronome toggle updates settings", () => {
    const onChange = vi.fn();
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={onChange}
        onPlay={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("metronome-toggle"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ metronome: true }),
    );
  });

  it("count-in dropdown has None/1 bar/2 bars options", () => {
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={vi.fn()}
        onPlay={vi.fn()}
      />,
    );

    const select = screen.getByTestId("count-in-select");
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("None");
    expect(options[1]).toHaveTextContent("1 bar");
    expect(options[2]).toHaveTextContent("2 bars");
  });

  it("loop dropdown has All and Current chord options", () => {
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={vi.fn()}
        onPlay={vi.fn()}
      />,
    );

    const select = screen.getByTestId("loop-select");
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("All");
    expect(options[1]).toHaveTextContent("Current chord");
  });

  it("play button is disabled when disabled prop is true", () => {
    render(
      <PlaybackControls
        settings={defaultSettings}
        onChange={vi.fn()}
        onPlay={vi.fn()}
        disabled={true}
      />,
    );

    expect(screen.getByTestId("play-button")).toBeDisabled();
  });
});

// ---------- PlaybackScreen tests ----------

describe("PlaybackScreen", () => {
  const testChords: ChordBlock[] = [
    { id: "1", root: "C", type: "Major", durationBars: 2 },
    { id: "2", root: "G", type: "Minor", durationBars: 2 },
  ];

  const defaultSettings: PlaybackSettings = {
    bpm: 120,
    metronome: false,
    countIn: "none",
    loopSection: "all",
  };

  it("shows current chord name in extra-large text", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    const chordDisplay = screen.getByTestId("current-chord-name");
    expect(chordDisplay).toHaveTextContent("C");
    // The element is an h1 with font-bold for emphasis. jsdom does not parse
    // CSS clamp() so we just verify it is a heading element (extra-large display).
    expect(chordDisplay.tagName).toBe("H1");
    expect(chordDisplay.className).toContain("font-bold");
  });

  it("fretboard overlay is toggleable", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    // Fretboard should be visible by default
    expect(screen.getByTestId("fretboard")).toBeInTheDocument();

    // Toggle it off
    fireEvent.click(screen.getByTestId("toggle-fretboard"));
    expect(screen.queryByTestId("fretboard")).not.toBeInTheDocument();

    // Toggle back on
    fireEvent.click(screen.getByTestId("toggle-fretboard"));
    expect(screen.getByTestId("fretboard")).toBeInTheDocument();
  });

  it("renders timeline with chord segments", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-segment-0")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-segment-1")).toBeInTheDocument();
    expect(screen.getByTestId("playhead")).toBeInTheDocument();
  });

  it("transport bar shows BPM, current bar/total, pause/stop buttons, loop indicator", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={{ ...defaultSettings, loopSection: "all" }}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    const transport = screen.getByTestId("transport-bar");
    expect(transport).toHaveTextContent("120 BPM");
    expect(transport).toHaveTextContent("Bar 1 / 4");
    expect(screen.getByTestId("pause-button")).toBeInTheDocument();
    expect(screen.getByTestId("stop-button")).toBeInTheDocument();
    expect(screen.getByTestId("loop-indicator")).toBeInTheDocument();
  });

  it("ARIA live region announces chord changes", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={1}
        currentBar={2}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    const announcement = screen.getByTestId("chord-announcement");
    expect(announcement).toHaveAttribute("aria-live", "assertive");
    expect(announcement).toHaveTextContent("Now playing: Gm");
  });

  it("shows visual-only banner when audio unavailable", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="visual-only"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("visual-only-banner")).toBeInTheDocument();
    expect(screen.getByTestId("retry-audio")).toBeInTheDocument();
  });

  it("shows error banner when audio interrupted", () => {
    render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={false}
        audioStatus="error"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("audio-error-banner")).toBeInTheDocument();
    expect(screen.getByTestId("audio-error-banner")).toHaveTextContent(
      "Audio playback interrupted",
    );
  });

  it("updates chord display when currentChordIndex changes", () => {
    const { rerender } = render(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={0}
        currentBar={0}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("current-chord-name")).toHaveTextContent("C");

    rerender(
      <PlaybackScreen
        chords={testChords}
        currentChordIndex={1}
        currentBar={2}
        currentStep={0}
        settings={defaultSettings}
        isPlaying={true}
        audioStatus="ready"
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRetryAudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("current-chord-name")).toHaveTextContent("Gm");
  });
});

// ---------- Full Play page integration tests ----------

describe("Play page integration", () => {
  beforeEach(() => {
    mockUnauthenticatedUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders build mode with chord sequencer, drum rack, and playback controls", async () => {
    await act(async () => {
      renderPlayPage();
    });

    expect(screen.getByTestId("play-page")).toBeInTheDocument();
    expect(screen.getByTestId("chord-sequencer")).toBeInTheDocument();
    expect(screen.getByTestId("drum-rack")).toBeInTheDocument();
    expect(screen.getByTestId("playback-controls")).toBeInTheDocument();
  });

  it("play button is disabled when no chords added", async () => {
    await act(async () => {
      renderPlayPage();
    });

    expect(screen.getByTestId("play-button")).toBeDisabled();
  });

  it("shows 'Sign in to save tracks' for guests", async () => {
    await act(async () => {
      renderPlayPage();
    });

    expect(screen.getByTestId("save-auth-prompt")).toHaveTextContent(
      "Sign in to save tracks",
    );
  });

  it("transitions to playback screen when Play is clicked with chords", async () => {
    await act(async () => {
      renderPlayPage();
    });

    // Add a chord
    fireEvent.click(screen.getByTestId("add-chord-button"));
    fireEvent.click(screen.getByTestId("root-C"));
    fireEvent.click(screen.getByTestId("type-Major"));
    fireEvent.click(screen.getByTestId("chord-add"));

    // Play button should now be enabled
    const playButton = screen.getByTestId("play-button");
    expect(playButton).not.toBeDisabled();

    // Click Play
    await act(async () => {
      fireEvent.click(playButton);
    });

    // Should now be in playback mode
    expect(screen.getByTestId("playback-screen")).toBeInTheDocument();
    expect(screen.getByTestId("current-chord-name")).toHaveTextContent("C");
  });

  it("returns to build mode when Stop is clicked", async () => {
    await act(async () => {
      renderPlayPage();
    });

    // Add a chord and play
    fireEvent.click(screen.getByTestId("add-chord-button"));
    fireEvent.click(screen.getByTestId("chord-add"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("play-button"));
    });

    expect(screen.getByTestId("playback-screen")).toBeInTheDocument();

    // Click Stop
    await act(async () => {
      fireEvent.click(screen.getByTestId("stop-button"));
    });

    // Should be back in build mode
    expect(screen.getByTestId("play-page")).toBeInTheDocument();
  });

  it("visual-only mode when Tone.js fails to start", async () => {
    // Tone.start is already mocked to reject
    await act(async () => {
      renderPlayPage();
    });

    // Should show visual-only banner in build mode
    expect(screen.getByTestId("visual-only-banner")).toBeInTheDocument();
  });
});

describe("Play page with authenticated user", () => {
  beforeEach(() => {
    mockAuthenticatedUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Save Track button for authenticated users", async () => {
    await act(async () => {
      renderPlayPage();
    });

    expect(screen.getByTestId("save-track")).toBeInTheDocument();
  });

  it("saves track via POST /api/v1/tracks", async () => {
    await act(async () => {
      renderPlayPage();
    });

    // Add a chord first
    fireEvent.click(screen.getByTestId("add-chord-button"));
    fireEvent.click(screen.getByTestId("root-C"));
    fireEvent.click(screen.getByTestId("type-Major"));
    fireEvent.click(screen.getByTestId("chord-add"));

    // Click Save
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-track"));
    });

    // Should have called POST /tracks
    const trackCalls = mockFetch.mock.calls.filter(
      ([url, opts]: [string, RequestInit | undefined]) =>
        url.includes("/tracks") && opts?.method === "POST",
    );
    expect(trackCalls.length).toBe(1);

    // Parse the body
    const body = JSON.parse(trackCalls[0][1]!.body as string);
    expect(body.chord_sequence).toHaveLength(1);
    expect(body.chord_sequence[0].root).toBe("C");
    expect(body.chord_sequence[0].type).toBe("Major");
    expect(body.bpm).toBe(120);
    expect(body.drum_pattern).toBeDefined();
    expect(body.playback_settings).toBeDefined();

    // Should show success message
    expect(screen.getByTestId("save-message")).toHaveTextContent(
      "Track saved!",
    );
  });
});
