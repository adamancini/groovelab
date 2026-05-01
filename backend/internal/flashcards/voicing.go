package flashcards

import (
	"encoding/json"
	"strings"
)

// chromaticNotes is the canonical sharp-form 12-tone chromatic scale,
// matching CHROMATIC_NOTES in frontend/src/lib/music-theory.ts.
var chromaticNotes = [12]string{
	"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
}

// enharmonicMap normalizes flat-spelled note names into their sharp-form
// equivalents. The seed data emits flats for several chord tones (e.g. "C#
// major" -> "C# F Ab"), so the resolver must accept them.
var enharmonicMap = map[string]string{
	"Db": "C#",
	"Eb": "D#",
	"Fb": "E",
	"Gb": "F#",
	"Ab": "G#",
	"Bb": "A#",
	"Cb": "B",
	"E#": "F",
	"B#": "C",
}

// defaultTuning is the canonical 4-string bass tuning (high-to-low),
// matching DEFAULT_TUNING_PRESETS[id="standard-4"] in
// frontend/src/lib/music-theory.ts. String 0 is G (highest), string 3 is E
// (lowest). The teaching mini fretboard is rendered against this layout
// today; tuning-awareness is deferred (see GRO-95ng).
var defaultTuning = [4]string{"G", "D", "A", "E"}

// maxFret bounds the search window for canonical voicings. The
// teaching-moment mini fretboard renders 12 frets (see AnswerFeedback.tsx),
// so positions beyond fret 12 would not be visible.
const maxFret = 12

// noteIndex returns the 0-11 chromatic index of a note name, normalising
// flats. Returns -1 for unknown notes.
func noteIndex(note string) int {
	n := strings.TrimSpace(note)
	if mapped, ok := enharmonicMap[n]; ok {
		n = mapped
	}
	for i, name := range chromaticNotes {
		if name == n {
			return i
		}
	}
	return -1
}

// ComputeChordPositions returns a canonical voicing for a chord-quality card,
// suitable for the AnswerFeedback teaching mini fretboard.
//
// Returns nil for any card that is not a chord card -- specifically, cards
// whose ChordType is nil or empty, or whose CorrectAnswer carries no `notes`
// field. This keeps the wire payload lean: AnswerResponse.CorrectPositions
// is tagged `omitempty`, so a nil slice drops the key entirely.
//
// The voicing is computed against the default 4-string bass tuning
// (defaultTuning). Each chord tone is assigned to a distinct string at the
// lowest fret in [0, maxFret] that produces it. Strings without an assigned
// tone are skipped. The result is deterministic given the input.
//
// Intentional limitations (deferred to GRO-95ng follow-ups):
//   - Tuning is fixed to standard 4-string bass. The frontend
//     AnswerFeedback already filters out positions whose string >=
//     stringCount, so emitting against a 4-string layout is safe even when
//     the user has selected a 5- or 6-string instrument.
//   - Voicings are picked greedily (lowest fret per chord tone, distinct
//     strings); we do not attempt to optimise for span. A learner-friendly
//     "first-position" voicing falls out naturally for triads in C/G/D/A/E.
func ComputeChordPositions(card *Card) []FretboardPosition {
	if card == nil {
		return nil
	}
	if card.ChordType == nil || strings.TrimSpace(*card.ChordType) == "" {
		return nil
	}

	// Extract the chord tones from the correct_answer.notes field. The seed
	// data emits notes as space-separated names (e.g. "C E G").
	var ca struct {
		Notes string `json:"notes"`
	}
	if err := json.Unmarshal(card.CorrectAnswer, &ca); err != nil {
		return nil
	}
	if strings.TrimSpace(ca.Notes) == "" {
		return nil
	}
	tones := strings.Fields(ca.Notes)
	if len(tones) == 0 {
		return nil
	}

	// Normalise each tone to its sharp-form chromatic name. Drop unknown
	// tokens defensively rather than crash.
	type chordTone struct {
		raw    string // original spelling (used for the position label)
		canon  string // canonical sharp-form name
		idx    int    // chromatic index (0-11)
	}
	chordTones := make([]chordTone, 0, len(tones))
	seen := make(map[string]bool)
	for _, t := range tones {
		idx := noteIndex(t)
		if idx < 0 {
			continue
		}
		canon := chromaticNotes[idx]
		if seen[canon] {
			continue // dedupe accidental repeats
		}
		seen[canon] = true
		chordTones = append(chordTones, chordTone{raw: t, canon: canon, idx: idx})
	}
	if len(chordTones) == 0 {
		return nil
	}

	// Assign each chord tone to a distinct string with the lowest matching
	// fret. We iterate strings high-to-low (string 0 = G is highest) and
	// for each string pick the chord tone whose lowest matching fret is
	// smallest, breaking ties by tone order. This produces compact,
	// learner-friendly voicings for the seven seeded chord types.
	assigned := make([]bool, len(chordTones))
	positions := make([]FretboardPosition, 0, len(chordTones))

	for stringIdx := 0; stringIdx < len(defaultTuning); stringIdx++ {
		bestTone := -1
		bestFret := maxFret + 1
		for i, ct := range chordTones {
			if assigned[i] {
				continue
			}
			// Lowest fret on this string that produces tone ct.canon.
			openIdx := noteIndex(defaultTuning[stringIdx])
			if openIdx < 0 {
				continue
			}
			delta := (ct.idx - openIdx + 12) % 12
			// delta is in [0, 11]; since maxFret >= 11 it is always in range.
			if delta < bestFret {
				bestFret = delta
				bestTone = i
			}
		}
		if bestTone < 0 {
			continue
		}
		ct := chordTones[bestTone]
		positions = append(positions, FretboardPosition{
			String: stringIdx,
			Fret:   bestFret,
			Label:  ct.raw,
		})
		assigned[bestTone] = true

		// Stop once every chord tone is placed.
		allAssigned := true
		for _, a := range assigned {
			if !a {
				allAssigned = false
				break
			}
		}
		if allAssigned {
			break
		}
	}

	if len(positions) == 0 {
		return nil
	}
	return positions
}
