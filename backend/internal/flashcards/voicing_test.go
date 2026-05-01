package flashcards

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestComputeChordPositions_NilForNonChord asserts that a card whose ChordType
// is nil produces no positions. GRO-gq31 AC #1 / AC #7 require non-chord cards
// to omit correct_positions on the wire.
func TestComputeChordPositions_NilForNonChord(t *testing.T) {
	card := &Card{
		Direction: "type_to_intervals",
		// ChordType nil
		CorrectAnswer: json.RawMessage(`{"name":"major","intervals":"1-3-5"}`),
	}
	positions := ComputeChordPositions(card)
	assert.Nil(t, positions, "non-chord cards must produce no positions")
}

// TestComputeChordPositions_NilWhenChordTypeBlank guards the same omission
// when ChordType is a non-nil pointer to an empty string.
func TestComputeChordPositions_NilWhenChordTypeBlank(t *testing.T) {
	blank := ""
	card := &Card{
		Direction:     "name_to_notes",
		ChordType:     &blank,
		CorrectAnswer: json.RawMessage(`{"name":"x","notes":"C E G"}`),
	}
	positions := ComputeChordPositions(card)
	assert.Nil(t, positions, "blank chord_type must produce no positions")
}

// TestComputeChordPositions_CMajor verifies that a C major chord card produces
// a non-empty set of positions covering all three chord tones (C, E, G) on the
// default 4-string bass tuning. Each chord tone must appear at least once and
// every position label must equal one of the chord tones.
func TestComputeChordPositions_CMajor(t *testing.T) {
	chordType := "major"
	card := &Card{
		Direction:     "name_to_notes",
		KeySignature:  "C",
		ChordType:     &chordType,
		CorrectAnswer: json.RawMessage(`{"name":"C major","notes":"C E G"}`),
	}
	positions := ComputeChordPositions(card)
	require.NotNil(t, positions, "chord card must produce positions")
	require.NotEmpty(t, positions, "C major must produce at least one position")

	// Every position labels its note. Cover all three chord tones.
	got := make(map[string]bool)
	for _, p := range positions {
		assert.GreaterOrEqual(t, p.String, 0, "string index must be non-negative")
		assert.Less(t, p.String, 4, "default tuning is 4 strings (indices 0-3)")
		assert.GreaterOrEqual(t, p.Fret, 0, "fret must be non-negative")
		assert.LessOrEqual(t, p.Fret, 12, "fret must be within first 12 frets")
		assert.NotEmpty(t, p.Label, "position must label its chord tone")
		got[p.Label] = true
	}
	for _, tone := range []string{"C", "E", "G"} {
		assert.True(t, got[tone], "C major positions must cover tone %q", tone)
	}
}

// TestComputeChordPositions_DistinctStrings asserts that no two positions
// share a string. The teaching mini fretboard expects one fret per string at
// most (otherwise rendering is ambiguous).
func TestComputeChordPositions_DistinctStrings(t *testing.T) {
	chordType := "minor"
	card := &Card{
		Direction:     "name_to_notes",
		KeySignature:  "A",
		ChordType:     &chordType,
		CorrectAnswer: json.RawMessage(`{"name":"A minor","notes":"A C E"}`),
	}
	positions := ComputeChordPositions(card)
	require.NotEmpty(t, positions)

	seen := make(map[int]bool)
	for _, p := range positions {
		assert.False(t, seen[p.String], "string %d already used", p.String)
		seen[p.String] = true
	}
}

// TestComputeChordPositions_NotesToNameDirection confirms positions are
// emitted on notes_to_name cards as well -- both chord directions show the
// fretboard hint on wrong answers.
func TestComputeChordPositions_NotesToNameDirection(t *testing.T) {
	chordType := "major"
	card := &Card{
		Direction:     "notes_to_name",
		KeySignature:  "G",
		ChordType:     &chordType,
		CorrectAnswer: json.RawMessage(`{"name":"G major","notes":"G B D"}`),
	}
	positions := ComputeChordPositions(card)
	require.NotEmpty(t, positions, "notes_to_name chord cards must also emit positions")
}

// TestComputeChordPositions_EnharmonicTones tolerates flat-spelled chord tones
// in the seed data (e.g. C# major emits "C# F Ab" in seed migrations).
func TestComputeChordPositions_EnharmonicTones(t *testing.T) {
	chordType := "major"
	card := &Card{
		Direction:     "name_to_notes",
		KeySignature:  "C#",
		ChordType:     &chordType,
		CorrectAnswer: json.RawMessage(`{"name":"C# major","notes":"C# F Ab"}`),
	}
	positions := ComputeChordPositions(card)
	require.NotEmpty(t, positions, "enharmonic flats (Ab) must resolve to chord tones")
}

// TestComputeChordPositions_MissingNotesField returns nil rather than crashing
// when correct_answer has no notes field (defensive coverage for malformed seed
// data).
func TestComputeChordPositions_MissingNotesField(t *testing.T) {
	chordType := "major"
	card := &Card{
		Direction:     "name_to_notes",
		KeySignature:  "C",
		ChordType:     &chordType,
		CorrectAnswer: json.RawMessage(`{"name":"C major"}`),
	}
	positions := ComputeChordPositions(card)
	assert.Nil(t, positions, "missing notes field must produce nil, not crash")
}
