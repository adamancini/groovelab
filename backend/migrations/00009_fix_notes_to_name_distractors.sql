-- +goose Up
-- +goose StatementBegin
-- GRO-4xts: Make notes_to_name distractors teach chord-quality discrimination.
--
-- Before: distractors for "Name this chord: G B Eb" were other chords with
-- different roots but the same quality (e.g., "Ab augmented", "Bb augmented",
-- "C# augmented"). A learner could match the first note of the question
-- ("G") to the first word of an option ("G augmented") and always be right.
--
-- After: distractors share the correct card's ROOT NOTE but differ in
-- QUALITY (e.g., correct "G augmented", distractors "G major", "G diminished",
-- "G major 7th"). The learner has to read the intervals.
--
-- Only notes_to_name cards are rewritten. name_to_notes cards keep their
-- cross-root distractors (which make sense for "what are the notes in X?").

WITH chord_lookup(idx, key_sig, chord_type, notes) AS (
    SELECT k.idx, k.key_sig, ct.chord_type, ct.notes_for_key[k.idx]
    FROM (VALUES
        (1,  'C'),  (2,  'C#'), (3,  'D'),  (4,  'Eb'),
        (5,  'E'),  (6,  'F'),  (7,  'F#'), (8,  'G'),
        (9,  'Ab'), (10, 'A'),  (11, 'Bb'), (12, 'B')
    ) AS k(idx, key_sig),
    (VALUES
        ('major', ARRAY[
            'C E G', 'C# F Ab', 'D F# A', 'Eb G Bb', 'E Ab B', 'F A C',
            'F# Bb C#', 'G B D', 'Ab C Eb', 'A C# E', 'Bb D F', 'B Eb F#'
        ]),
        ('minor', ARRAY[
            'C Eb G', 'C# E Ab', 'D F A', 'Eb F# Bb', 'E G B', 'F Ab C',
            'F# A C#', 'G Bb D', 'Ab B Eb', 'A C E', 'Bb C# F', 'B D F#'
        ]),
        ('dominant 7th', ARRAY[
            'C E G Bb', 'C# F Ab B', 'D F# A C', 'Eb G Bb C#', 'E Ab B D', 'F A C Eb',
            'F# Bb C# E', 'G B D F', 'Ab C Eb F#', 'A C# E G', 'Bb D F Ab', 'B Eb F# A'
        ]),
        ('major 7th', ARRAY[
            'C E G B', 'C# F Ab C', 'D F# A C#', 'Eb G Bb D', 'E Ab B Eb', 'F A C E',
            'F# Bb C# F', 'G B D F#', 'Ab C Eb G', 'A C# E Ab', 'Bb D F A', 'B Eb F# Bb'
        ]),
        ('minor 7th', ARRAY[
            'C Eb G Bb', 'C# E Ab B', 'D F A C', 'Eb F# Bb C#', 'E G B D', 'F Ab C Eb',
            'F# A C# E', 'G Bb D F', 'Ab B Eb F#', 'A C E G', 'Bb C# F Ab', 'B D F# A'
        ]),
        ('diminished', ARRAY[
            'C Eb F#', 'C# E G', 'D F Ab', 'Eb F# A', 'E G Bb', 'F Ab B',
            'F# A C', 'G Bb C#', 'Ab B D', 'A C Eb', 'Bb C# E', 'B D F'
        ]),
        ('augmented', ARRAY[
            'C E Ab', 'C# F A', 'D F# Bb', 'Eb G B', 'E Ab C', 'F A C#',
            'F# Bb D', 'G B Eb', 'Ab C E', 'A C# F', 'Bb D F#', 'B Eb G'
        ])
    ) AS ct(chord_type, notes_for_key)
),
distractor_map(correct_type, distractor_type, ord) AS (
    VALUES
        ('major',        'minor',         1),
        ('major',        'dominant 7th',  2),
        ('major',        'augmented',     3),
        ('minor',        'major',         1),
        ('minor',        'diminished',    2),
        ('minor',        'minor 7th',     3),
        ('dominant 7th', 'major 7th',     1),
        ('dominant 7th', 'minor 7th',     2),
        ('dominant 7th', 'major',         3),
        ('major 7th',    'dominant 7th',  1),
        ('major 7th',    'minor 7th',     2),
        ('major 7th',    'augmented',     3),
        ('minor 7th',    'dominant 7th',  1),
        ('minor 7th',    'major 7th',     2),
        ('minor 7th',    'minor',         3),
        ('diminished',   'minor',         1),
        ('diminished',   'augmented',     2),
        ('diminished',   'minor 7th',     3),
        ('augmented',    'major',         1),
        ('augmented',    'diminished',    2),
        ('augmented',    'major 7th',     3)
),
new_distractors AS (
    SELECT
        c.id AS card_id,
        jsonb_agg(
            jsonb_build_object(
                'name',  c.key_signature || ' ' || dm.distractor_type,
                'notes', cl.notes
            )
            ORDER BY dm.ord
        ) AS distractors_json
    FROM cards c
    JOIN distractor_map dm ON dm.correct_type = c.chord_type
    JOIN chord_lookup cl
      ON cl.key_sig = c.key_signature
     AND cl.chord_type = dm.distractor_type
    WHERE c.direction = 'notes_to_name'
    GROUP BY c.id
)
UPDATE cards
SET distractors = nd.distractors_json
FROM new_distractors nd
WHERE cards.id = nd.card_id;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Restore the original cross-root distractors (same logic as 00005 for
-- notes_to_name cards only). We reconstruct by key_signature index and
-- use the distractor-key mapping from the original seed.

WITH key_rows(idx, key_sig, distractor_keys) AS (
    VALUES
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
),
ct_rows(chord_type, notes_for_key) AS (
    VALUES
        ('major', ARRAY[
            'C E G', 'C# F Ab', 'D F# A', 'Eb G Bb', 'E Ab B', 'F A C',
            'F# Bb C#', 'G B D', 'Ab C Eb', 'A C# E', 'Bb D F', 'B Eb F#'
        ]),
        ('minor', ARRAY[
            'C Eb G', 'C# E Ab', 'D F A', 'Eb F# Bb', 'E G B', 'F Ab C',
            'F# A C#', 'G Bb D', 'Ab B Eb', 'A C E', 'Bb C# F', 'B D F#'
        ]),
        ('dominant 7th', ARRAY[
            'C E G Bb', 'C# F Ab B', 'D F# A C', 'Eb G Bb C#', 'E Ab B D', 'F A C Eb',
            'F# Bb C# E', 'G B D F', 'Ab C Eb F#', 'A C# E G', 'Bb D F Ab', 'B Eb F# A'
        ]),
        ('major 7th', ARRAY[
            'C E G B', 'C# F Ab C', 'D F# A C#', 'Eb G Bb D', 'E Ab B Eb', 'F A C E',
            'F# Bb C# F', 'G B D F#', 'Ab C Eb G', 'A C# E Ab', 'Bb D F A', 'B Eb F# Bb'
        ]),
        ('minor 7th', ARRAY[
            'C Eb G Bb', 'C# E Ab B', 'D F A C', 'Eb F# Bb C#', 'E G B D', 'F Ab C Eb',
            'F# A C# E', 'G Bb D F', 'Ab B Eb F#', 'A C E G', 'Bb C# F Ab', 'B D F# A'
        ]),
        ('diminished', ARRAY[
            'C Eb F#', 'C# E G', 'D F Ab', 'Eb F# A', 'E G Bb', 'F Ab B',
            'F# A C', 'G Bb C#', 'Ab B D', 'A C Eb', 'Bb C# E', 'B D F'
        ]),
        ('augmented', ARRAY[
            'C E Ab', 'C# F A', 'D F# Bb', 'Eb G B', 'E Ab C', 'F A C#',
            'F# Bb D', 'G B Eb', 'Ab C E', 'A C# F', 'Bb D F#', 'B Eb G'
        ])
)
UPDATE cards SET distractors = jsonb_build_array(
    jsonb_build_object(
        'notes', ct.notes_for_key[((k.idx)     % 12) + 1],
        'name',  k.distractor_keys[1] || ' ' || cards.chord_type
    ),
    jsonb_build_object(
        'notes', ct.notes_for_key[((k.idx + 3) % 12) + 1],
        'name',  k.distractor_keys[2] || ' ' || cards.chord_type
    ),
    jsonb_build_object(
        'notes', ct.notes_for_key[((k.idx + 6) % 12) + 1],
        'name',  k.distractor_keys[3] || ' ' || cards.chord_type
    )
)
FROM key_rows k, ct_rows ct
WHERE cards.direction = 'notes_to_name'
  AND k.key_sig = cards.key_signature
  AND ct.chord_type = cards.chord_type;
-- +goose StatementEnd
