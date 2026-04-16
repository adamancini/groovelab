-- +goose Up
-- Seed flashcard data: 12 keys x 7 chord types x 2 directions = 168 cards.
-- Each card has a question (JSONB), correct_answer (JSONB), and distractors (JSONB array of 3 wrong answers).

-- Helper: generate all chord cards via a cross join of keys, chord types, and directions.
-- The notes for each chord are stored as the correct_answer. Distractors are 3 plausible
-- wrong answers drawn from neighboring keys or related chord types.

INSERT INTO cards (topic, direction, key_signature, chord_type, question, correct_answer, distractors)
SELECT
    ct.topic,
    d.direction,
    k.key_sig,
    ct.chord_type,
    -- question: what is being asked
    CASE d.direction
        WHEN 'name_to_notes' THEN
            jsonb_build_object('prompt', 'What are the notes in ' || k.key_sig || ' ' || ct.chord_type || '?', 'display_name', k.key_sig || ' ' || ct.chord_type)
        WHEN 'notes_to_name' THEN
            jsonb_build_object('prompt', 'Name this chord: ' || ct.notes_for_key[k.idx], 'display_notes', ct.notes_for_key[k.idx])
    END,
    -- correct_answer
    CASE d.direction
        WHEN 'name_to_notes' THEN
            jsonb_build_object('notes', ct.notes_for_key[k.idx], 'name', k.key_sig || ' ' || ct.chord_type)
        WHEN 'notes_to_name' THEN
            jsonb_build_object('name', k.key_sig || ' ' || ct.chord_type, 'notes', ct.notes_for_key[k.idx])
    END,
    -- distractors: 3 wrong answers from different keys for the same chord type
    jsonb_build_array(
        jsonb_build_object('notes', ct.notes_for_key[((k.idx) % 12) + 1], 'name', k.distractor_keys[1] || ' ' || ct.chord_type),
        jsonb_build_object('notes', ct.notes_for_key[((k.idx + 3) % 12) + 1], 'name', k.distractor_keys[2] || ' ' || ct.chord_type),
        jsonb_build_object('notes', ct.notes_for_key[((k.idx + 6) % 12) + 1], 'name', k.distractor_keys[3] || ' ' || ct.chord_type)
    )
FROM
    -- 12 keys with index for array lookup and 3 distractor keys
    (VALUES
        (1,  'C',  ARRAY['C#', 'Eb', 'F#']),
        (2,  'C#', ARRAY['D', 'E', 'G']),
        (3,  'D',  ARRAY['Eb', 'F', 'Ab']),
        (4,  'Eb', ARRAY['E', 'F#', 'A']),
        (5,  'E',  ARRAY['F', 'G', 'Bb']),
        (6,  'F',  ARRAY['F#', 'Ab', 'B']),
        (7,  'F#', ARRAY['G', 'A', 'C']),
        (8,  'G',  ARRAY['Ab', 'Bb', 'C#']),
        (9,  'Ab', ARRAY['A', 'B', 'D']),
        (10, 'A',  ARRAY['Bb', 'C', 'Eb']),
        (11, 'Bb', ARRAY['B', 'C#', 'E']),
        (12, 'B',  ARRAY['C', 'D', 'F'])
    ) AS k(idx, key_sig, distractor_keys),
    -- 2 directions
    (VALUES ('name_to_notes'), ('notes_to_name')) AS d(direction),
    -- 7 chord types with notes for all 12 keys (indexed 1..12 matching key order above)
    (VALUES
        ('major_chords', 'major', ARRAY[
            'C E G', 'C# F Ab', 'D F# A', 'Eb G Bb', 'E Ab B', 'F A C',
            'F# Bb C#', 'G B D', 'Ab C Eb', 'A C# E', 'Bb D F', 'B Eb F#'
        ]),
        ('minor_chords', 'minor', ARRAY[
            'C Eb G', 'C# E Ab', 'D F A', 'Eb F# Bb', 'E G B', 'F Ab C',
            'F# A C#', 'G Bb D', 'Ab B Eb', 'A C E', 'Bb C# F', 'B D F#'
        ]),
        ('dominant_7th_chords', 'dominant 7th', ARRAY[
            'C E G Bb', 'C# F Ab B', 'D F# A C', 'Eb G Bb C#', 'E Ab B D', 'F A C Eb',
            'F# Bb C# E', 'G B D F', 'Ab C Eb F#', 'A C# E G', 'Bb D F Ab', 'B Eb F# A'
        ]),
        ('major_7th_chords', 'major 7th', ARRAY[
            'C E G B', 'C# F Ab C', 'D F# A C#', 'Eb G Bb D', 'E Ab B Eb', 'F A C E',
            'F# Bb C# F', 'G B D F#', 'Ab C Eb G', 'A C# E Ab', 'Bb D F A', 'B Eb F# Bb'
        ]),
        ('minor_7th_chords', 'minor 7th', ARRAY[
            'C Eb G Bb', 'C# E Ab B', 'D F A C', 'Eb F# Bb C#', 'E G B D', 'F Ab C Eb',
            'F# A C# E', 'G Bb D F', 'Ab B Eb F#', 'A C E G', 'Bb C# F Ab', 'B D F# A'
        ]),
        ('diminished_chords', 'diminished', ARRAY[
            'C Eb F#', 'C# E G', 'D F Ab', 'Eb F# A', 'E G Bb', 'F Ab B',
            'F# A C', 'G Bb C#', 'Ab B D', 'A C Eb', 'Bb C# E', 'B D F'
        ]),
        ('augmented_chords', 'augmented', ARRAY[
            'C E Ab', 'C# F A', 'D F# Bb', 'Eb G B', 'E Ab C', 'F A C#',
            'F# Bb D', 'G B Eb', 'Ab C E', 'A C# F', 'Bb D F#', 'B Eb G'
        ])
    ) AS ct(topic, chord_type, notes_for_key);

-- +goose Down
DELETE FROM cards WHERE topic IN (
    'major_chords', 'minor_chords', 'dominant_7th_chords',
    'major_7th_chords', 'minor_7th_chords', 'diminished_chords', 'augmented_chords'
);
