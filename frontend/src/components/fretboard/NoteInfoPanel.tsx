/**
 * NoteInfoPanel.tsx -- Displays the tapped note name and interval relationship
 * to the current tonic (if a key is selected).
 */

import { intervalName } from "../../lib/music-theory";

export interface NoteInfoPanelProps {
  /** The currently tapped note name, or null if nothing is tapped. */
  tappedNote: string | null;
  /** The current tonic/key, or null if no key is selected. */
  tonic: string | null;
}

export default function NoteInfoPanel({
  tappedNote,
  tonic,
}: NoteInfoPanelProps) {
  if (!tappedNote) {
    return (
      <div
        className="bg-elevated rounded-lg border border-white/10 px-4 py-3 text-center"
        role="status"
        aria-label="Note information"
        data-testid="note-info-panel"
      >
        <p className="text-secondary text-sm">
          Tap a note on the fretboard to see details
        </p>
      </div>
    );
  }

  const interval = tonic ? intervalName(tonic, tappedNote) : null;

  return (
    <div
      className="bg-elevated rounded-lg border border-white/10 px-4 py-3"
      role="status"
      aria-live="polite"
      aria-label="Note information"
      data-testid="note-info-panel"
    >
      <div className="flex items-center gap-6">
        <div>
          <span className="text-secondary text-xs font-medium uppercase tracking-wide">
            Note
          </span>
          <p
            className="text-primary text-2xl font-bold"
            data-testid="tapped-note-name"
          >
            {tappedNote}
          </p>
        </div>
        {interval && tonic && (
          <div>
            <span className="text-secondary text-xs font-medium uppercase tracking-wide">
              Interval from {tonic}
            </span>
            <p
              className="text-primary text-lg font-semibold"
              data-testid="tapped-note-interval"
            >
              {interval}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
