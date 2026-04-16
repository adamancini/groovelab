/**
 * FretboardRef.tsx -- Interactive fretboard reference page.
 *
 * Features:
 * - Tuning configurator (string count toggle, preset dropdown, custom per-string)
 * - Scale/chord overlay filter with key selection
 * - Note tap highlighting (all occurrences of tapped note in cyan)
 * - Tonic displayed in amber when a key is selected
 * - Info panel showing tapped note name and interval to tonic
 * - ARIA-labeled fretboard positions
 * - Horizontal scroll on narrow screens
 */

import { useCallback, useMemo, useState } from "react";
import TuningConfigurator from "../components/fretboard/TuningConfigurator";
import NoteInfoPanel from "../components/fretboard/NoteInfoPanel";
import ScaleChordFilter from "../components/fretboard/ScaleChordFilter";
import type { FretboardPosition } from "../lib/api";
import {
  buildFretboardNotes,
  getScaleChordNotes,
  type NoteName,
  type ScaleChordDef,
} from "../lib/music-theory";

const DEFAULT_FRETS = 12;
const DEFAULT_STRING_COUNT = 4;
const DEFAULT_TUNING = ["G", "D", "A", "E"]; // Standard 4-string bass

/** Visual styles for fretboard note dots. */
type NoteStyle = "tonic" | "highlighted" | "dimmed" | "tapped";

export default function FretboardRef() {
  const [stringCount, setStringCount] = useState(DEFAULT_STRING_COUNT);
  const [tuning, setTuning] = useState<string[]>(DEFAULT_TUNING);
  const [tappedNote, setTappedNote] = useState<string | null>(null);
  const [selectedDef, setSelectedDef] = useState<ScaleChordDef | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("C");

  // Build the complete note map for the current tuning.
  const noteMap = useMemo(
    () => buildFretboardNotes(tuning, DEFAULT_FRETS),
    [tuning],
  );

  // Get scale/chord member notes if a filter is active.
  const memberNotes = useMemo<Set<NoteName> | null>(() => {
    if (!selectedDef) return null;
    return getScaleChordNotes(selectedDef, selectedKey);
  }, [selectedDef, selectedKey]);

  // The effective tonic: only relevant when a scale/chord + key is selected.
  const activeTonic = selectedDef ? selectedKey : null;

  // Determine the style for each position (used for custom rendering).
  const getPositionStyle = useCallback(
    (note: NoteName): NoteStyle => {
      const isTapped = tappedNote !== null && note === tappedNote;
      const isTonic = activeTonic !== null && note === activeTonic;
      const isMember = memberNotes ? memberNotes.has(note) : true;

      if (isTonic) return "tonic";
      if (isTapped) return "tapped";
      if (memberNotes && !isMember) return "dimmed";
      return "highlighted";
    },
    [tappedNote, activeTonic, memberNotes],
  );

  // Handle fretboard position tap.
  const handleTap = useCallback(
    (pos: FretboardPosition) => {
      const note = noteMap[pos.string]?.[pos.fret];
      if (note) {
        // Toggle: tapping the same note clears the selection.
        setTappedNote((prev) => (prev === note ? null : note));
      }
    },
    [noteMap],
  );

  // Handle tuning change.
  const handleTuningChange = useCallback((newTuning: string[]) => {
    setTuning(newTuning);
    setTappedNote(null); // Clear tapped note when tuning changes.
  }, []);

  // Handle string count change.
  const handleStringCountChange = useCallback((count: number) => {
    setStringCount(count);
    setTappedNote(null);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-primary text-2xl font-bold">Fretboard</h1>
      <p className="text-secondary mt-1 text-sm">
        Explore notes, scales, and chords on the bass fretboard.
      </p>

      {/* Controls */}
      <div className="mt-6 space-y-4">
        <TuningConfigurator
          stringCount={stringCount}
          tuning={tuning}
          onStringCountChange={handleStringCountChange}
          onTuningChange={handleTuningChange}
        />
        <ScaleChordFilter
          selectedDef={selectedDef}
          selectedKey={selectedKey}
          onDefChange={setSelectedDef}
          onKeyChange={setSelectedKey}
        />
      </div>

      {/* Fretboard (horizontally scrollable on narrow screens) */}
      <div
        className="mt-6 overflow-x-auto"
        data-testid="fretboard-scroll-container"
      >
        <div className="min-w-[700px]">
          <FretboardRefSVG
            tuning={tuning}
            frets={DEFAULT_FRETS}
            noteMap={noteMap}
            tappedNote={tappedNote}
            activeTonic={activeTonic}
            onTap={handleTap}
            getPositionStyle={getPositionStyle}
          />
        </div>
      </div>

      {/* Note info panel */}
      <div className="mt-4">
        <NoteInfoPanel tappedNote={tappedNote} tonic={activeTonic} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom SVG fretboard with proper styling for reference mode
// ---------------------------------------------------------------------------

interface FretboardRefSVGProps {
  tuning: string[];
  frets: number;
  noteMap: NoteName[][];
  tappedNote: string | null;
  activeTonic: string | null;
  onTap: (pos: FretboardPosition) => void;
  getPositionStyle: (note: NoteName) => NoteStyle;
}

const FRET_MARKERS = [3, 5, 7, 9, 12];

/**
 * Custom fretboard SVG that renders notes with proper styling:
 * - Tonic: amber (#f0a500) with double ring (larger circle)
 * - Highlighted (member): cyan (#53d8fb) filled circle
 * - Dimmed (non-member): gray, smaller/unfilled circle
 * - Tapped: cyan filled circle (all occurrences)
 *
 * Color distinctions are NOT color-only -- shapes differ:
 * - Tonic: double ring (outer + inner circle)
 * - Highlighted: filled circle
 * - Dimmed: unfilled/smaller circle with stroke only
 */
function FretboardRefSVG({
  tuning,
  frets,
  noteMap,
  tappedNote,
  activeTonic,
  onTap,
  getPositionStyle,
}: FretboardRefSVGProps) {
  const strings = tuning.length;
  const stringSpacing = 28;
  const fretSpacing = 56;
  const paddingLeft = 40;
  const paddingTop = 28;
  const dotRadius = 11;

  const width = paddingLeft + frets * fretSpacing + 20;
  const height = paddingTop + (strings - 1) * stringSpacing + 40;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="grid"
      aria-label="Interactive fretboard reference"
      data-testid="fretboard-ref"
      className="w-full"
    >
      {/* Nut */}
      <line
        x1={paddingLeft}
        y1={paddingTop - 6}
        x2={paddingLeft}
        y2={paddingTop + (strings - 1) * stringSpacing + 6}
        stroke="var(--color-text-primary)"
        strokeWidth={3}
      />

      {/* Fret lines */}
      {Array.from({ length: frets }, (_, i) => i + 1).map((fret) => (
        <line
          key={`fret-${fret}`}
          x1={paddingLeft + fret * fretSpacing}
          y1={paddingTop - 6}
          x2={paddingLeft + fret * fretSpacing}
          y2={paddingTop + (strings - 1) * stringSpacing + 6}
          stroke="var(--color-text-secondary)"
          strokeWidth={1}
          opacity={0.4}
        />
      ))}

      {/* Strings */}
      {Array.from({ length: strings }, (_, i) => i).map((s) => (
        <line
          key={`string-${s}`}
          x1={paddingLeft}
          y1={paddingTop + s * stringSpacing}
          x2={paddingLeft + frets * fretSpacing}
          y2={paddingTop + s * stringSpacing}
          stroke="var(--color-text-secondary)"
          strokeWidth={1 + s * 0.3}
          opacity={0.6}
        />
      ))}

      {/* Fret markers (dots at 3, 5, 7, 9, 12) */}
      {FRET_MARKERS.filter((f) => f <= frets).map((fret) => (
        <circle
          key={`marker-${fret}`}
          cx={paddingLeft + (fret - 0.5) * fretSpacing}
          cy={paddingTop + ((strings - 1) * stringSpacing) / 2}
          r={3}
          fill="var(--color-text-secondary)"
          opacity={0.3}
        />
      ))}

      {/* Fret numbers */}
      {Array.from({ length: frets }, (_, i) => i + 1).map((fret) => (
        <text
          key={`fretnum-${fret}`}
          x={paddingLeft + (fret - 0.5) * fretSpacing}
          y={height - 4}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          fontSize={10}
          opacity={0.5}
        >
          {fret}
        </text>
      ))}

      {/* Note positions (interactive) */}
      {noteMap.map((stringNotes, s) =>
        stringNotes.map((note, f) => {
          const cx =
            f === 0
              ? paddingLeft - 18
              : paddingLeft + (f - 0.5) * fretSpacing;
          const cy = paddingTop + s * stringSpacing;

          const style = getPositionStyle(note);
          const isTapped = tappedNote !== null && note === tappedNote;
          const isTonic =
            activeTonic !== null && note === activeTonic;

          // Determine visual properties based on style.
          let fillColor: string;
          let strokeColor: string | undefined;
          let strokeWidth = 0;
          let radius = dotRadius;
          let textColor = "black";
          let opacity = 1;
          let fillOpacity = 0.9;

          switch (style) {
            case "tonic":
              fillColor = "#f0a500";
              radius = dotRadius + 2;
              break;
            case "tapped":
              fillColor = "var(--color-accent-primary)";
              break;
            case "dimmed":
              fillColor = "transparent";
              strokeColor = "var(--color-text-secondary)";
              strokeWidth = 1;
              radius = dotRadius - 3;
              textColor = "var(--color-text-secondary)";
              opacity = 0.5;
              fillOpacity = 0;
              break;
            case "highlighted":
            default:
              fillColor = "var(--color-accent-primary)";
              fillOpacity = 0.9;
              break;
          }

          // If the note is tapped AND is also the tonic, tapped wins visually
          // but with a tonic indicator.
          if (isTapped && isTonic) {
            fillColor = "#f0a500";
            radius = dotRadius + 2;
          } else if (isTapped) {
            fillColor = "var(--color-accent-primary)";
            radius = dotRadius;
          }

          // Build the ARIA label: e.g., "A string, 3rd fret, C"
          const stringLabel = tuning[s] ?? `String ${s + 1}`;
          const fretLabel =
            f === 0
              ? "open"
              : `${f}${f === 1 ? "st" : f === 2 ? "nd" : f === 3 ? "rd" : "th"} fret`;
          const ariaLabel = `${stringLabel} string, ${fretLabel}, ${note}`;

          return (
            <g key={`note-${s}-${f}`} role="row">
              {/* Tap target */}
              <circle
                cx={cx}
                cy={cy}
                r={dotRadius + 4}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => onTap({ string: s, fret: f })}
                role="button"
                aria-label={ariaLabel}
                data-testid={`fret-${s}-${f}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTap({ string: s, fret: f });
                  }
                }}
              />

              {/* Tonic double ring (outer ring for tonic) */}
              {isTonic && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius + 3}
                  fill="none"
                  stroke="#f0a500"
                  strokeWidth={2}
                  opacity={0.8}
                  style={{ pointerEvents: "none" }}
                  data-testid={`tonic-ring-${s}-${f}`}
                />
              )}

              {/* Note dot */}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={fillColor}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                opacity={opacity}
                style={{ pointerEvents: "none" }}
                data-testid={`dot-${s}-${f}`}
              />

              {/* Note label */}
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fill={textColor}
                fontSize={style === "dimmed" ? 7 : 9}
                fontWeight="bold"
                style={{ pointerEvents: "none" }}
                opacity={style === "dimmed" ? 0.5 : 1}
              >
                {note}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}
