/**
 * ChordSequencer.tsx -- Horizontal chord sequence panel with drag-and-drop reorder.
 */

import { useState, useRef, useCallback } from "react";
import ChordPicker from "./ChordPicker";
import { chordName, type ChordBlock } from "../../audio/engine";

export interface ChordSequencerProps {
  chords: ChordBlock[];
  onChange: (chords: ChordBlock[]) => void;
}

export default function ChordSequencer({
  chords,
  onChange,
}: ChordSequencerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAdd = useCallback(
    (chord: ChordBlock) => {
      if (editIndex !== null) {
        const updated = [...chords];
        updated[editIndex] = chord;
        onChange(updated);
        setEditIndex(null);
      } else {
        onChange([...chords, chord]);
      }
      setShowPicker(false);
    },
    [chords, editIndex, onChange],
  );

  const handleEdit = useCallback((index: number) => {
    setEditIndex(index);
    setShowPicker(true);
  }, []);

  const handleDelete = useCallback(
    (index: number) => {
      onChange(chords.filter((_, i) => i !== index));
    },
    [chords, onChange],
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const reordered = [...chords];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);
    onChange(reordered);
    dragItem.current = null;
    dragOverItem.current = null;
  }, [chords, onChange]);

  // Long press for delete (mobile)
  const handlePointerDown = useCallback(
    (index: number) => {
      longPressTimer.current = setTimeout(() => {
        handleDelete(index);
      }, 600);
    },
    [handleDelete],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  return (
    <section aria-label="Chord Sequence" data-testid="chord-sequencer">
      <h2 className="text-text-primary mb-2 text-lg font-bold">
        Chord Sequence
      </h2>
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {chords.map((chord, index) => (
          <div
            key={chord.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => handleEdit(index)}
            onContextMenu={(e) => {
              e.preventDefault();
              handleDelete(index);
            }}
            onPointerDown={() => handlePointerDown(index)}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="bg-elevated hover:bg-accent-primary/20 flex min-w-[80px] cursor-grab flex-col items-center rounded-lg px-3 py-2 transition-colors select-none"
            role="listitem"
            aria-label={`${chordName(chord.root, chord.type)}, ${chord.durationBars} bar${chord.durationBars > 1 ? "s" : ""}`}
            data-testid={`chord-block-${index}`}
          >
            <span className="text-text-primary text-sm font-bold">
              {chordName(chord.root, chord.type)}
            </span>
            <span className="text-text-secondary text-xs">
              {chord.durationBars} bar{chord.durationBars > 1 ? "s" : ""}
            </span>
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setEditIndex(null);
            setShowPicker(true);
          }}
          className="bg-elevated hover:bg-accent-primary/30 text-accent-primary flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold transition-colors"
          aria-label="Add chord"
          data-testid="add-chord-button"
        >
          +
        </button>
      </div>

      {showPicker && (
        <ChordPicker
          editChord={editIndex !== null ? chords[editIndex] : undefined}
          onAdd={handleAdd}
          onCancel={() => {
            setShowPicker(false);
            setEditIndex(null);
          }}
        />
      )}
    </section>
  );
}
