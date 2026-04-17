/**
 * Fretboard.tsx -- Reusable SVG fretboard renderer.
 *
 * Renders a guitar/bass fretboard with highlighted positions.
 * Supports both display-only mode and interactive tap mode.
 */

import type { FretboardPosition } from "../lib/api";

export interface FretboardProps {
  /** Number of strings (default 4 for bass). */
  strings?: number;
  /** Number of frets to display (default 12). */
  frets?: number;
  /** Positions to highlight. */
  positions?: FretboardPosition[];
  /** Positions selected by the user (for tap mode). */
  selectedPositions?: FretboardPosition[];
  /** Called when a position is tapped (enables interactive mode). */
  onTap?: (position: FretboardPosition) => void;
  /** Whether to show fret numbers. */
  showFretNumbers?: boolean;
  /** CSS class for the wrapper. */
  className?: string;
  /** Size variant. */
  size?: "mini" | "full";
}

const FRET_MARKERS = [3, 5, 7, 9, 12];

export default function Fretboard({
  strings = 4,
  frets = 12,
  positions = [],
  selectedPositions = [],
  onTap,
  showFretNumbers = true,
  className = "",
  size = "full",
}: FretboardProps) {
  const isMini = size === "mini";
  const stringSpacing = isMini ? 16 : 24;
  const fretSpacing = isMini ? 40 : 56;
  const paddingLeft = isMini ? 20 : 30;
  const paddingTop = isMini ? 16 : 24;
  const dotRadius = isMini ? 6 : 9;

  const width = paddingLeft + frets * fretSpacing + 10;
  const height = paddingTop + (strings - 1) * stringSpacing + (isMini ? 16 : 24);

  const isHighlighted = (s: number, f: number): boolean =>
    positions.some((p) => p.string === s && p.fret === f);

  const isSelected = (s: number, f: number): boolean =>
    selectedPositions.some((p) => p.string === s && p.fret === f);

  const getLabel = (s: number, f: number): string | undefined => {
    const pos = positions.find((p) => p.string === s && p.fret === f);
    return pos?.label;
  };

  const handleTap = (s: number, f: number) => {
    if (onTap) {
      onTap({ string: s, fret: f });
    }
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`${className}`}
      role={onTap ? "grid" : "img"}
      aria-label="Fretboard diagram"
      data-testid="fretboard"
    >
      {/* Nut */}
      <line
        x1={paddingLeft}
        y1={paddingTop - 4}
        x2={paddingLeft}
        y2={paddingTop + (strings - 1) * stringSpacing + 4}
        stroke="var(--color-text-text-primary)"
        strokeWidth={isMini ? 2 : 3}
      />

      {/* Fret lines */}
      {Array.from({ length: frets }, (_, i) => i + 1).map((fret) => (
        <line
          key={`fret-${fret}`}
          x1={paddingLeft + fret * fretSpacing}
          y1={paddingTop - 4}
          x2={paddingLeft + fret * fretSpacing}
          y2={paddingTop + (strings - 1) * stringSpacing + 4}
          stroke="var(--color-text-text-secondary)"
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
          stroke="var(--color-text-text-secondary)"
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
          r={isMini ? 2 : 3}
          fill="var(--color-text-text-secondary)"
          opacity={0.3}
        />
      ))}

      {/* Fret numbers */}
      {showFretNumbers &&
        Array.from({ length: frets }, (_, i) => i + 1).map((fret) => (
          <text
            key={`fretnum-${fret}`}
            x={paddingLeft + (fret - 0.5) * fretSpacing}
            y={height - 2}
            textAnchor="middle"
            fill="var(--color-text-text-secondary)"
            fontSize={isMini ? 8 : 10}
            opacity={0.5}
          >
            {fret}
          </text>
        ))}

      {/* Interactive tap zones or highlight dots */}
      {Array.from({ length: strings }, (_, s) =>
        Array.from({ length: frets + 1 }, (_, f) => {
          const highlighted = isHighlighted(s, f);
          const selected = isSelected(s, f);
          const label = getLabel(s, f);
          const cx =
            f === 0
              ? paddingLeft - (isMini ? 10 : 15)
              : paddingLeft + (f - 0.5) * fretSpacing;
          const cy = paddingTop + s * stringSpacing;

          if (onTap) {
            return (
              <g key={`tap-${s}-${f}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={dotRadius + 2}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleTap(s, f)}
                  role="gridcell"
                  aria-label={`String ${s + 1}, fret ${f}`}
                  data-testid={`fret-${s}-${f}`}
                />
                {(highlighted || selected) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={dotRadius}
                    fill={
                      selected
                        ? "var(--color-accent-primary)"
                        : "var(--color-accent-correct)"
                    }
                    opacity={0.9}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {label && (
                  <text
                    x={cx}
                    y={cy + (isMini ? 3 : 4)}
                    textAnchor="middle"
                    fill="black"
                    fontSize={isMini ? 7 : 9}
                    fontWeight="bold"
                    style={{ pointerEvents: "none" }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          }

          if (highlighted) {
            return (
              <g key={`dot-${s}-${f}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={dotRadius}
                  fill="var(--color-accent-correct)"
                  opacity={0.9}
                />
                {label && (
                  <text
                    x={cx}
                    y={cy + (isMini ? 3 : 4)}
                    textAnchor="middle"
                    fill="black"
                    fontSize={isMini ? 7 : 9}
                    fontWeight="bold"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          }

          return null;
        }),
      )}
    </svg>
  );
}
