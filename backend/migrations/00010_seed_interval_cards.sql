-- +goose Up
-- +goose StatementBegin
-- GRO-rfoz: Seed type_to_intervals cards for the chord_intervals topic.
--
-- One card per chord type (7 total), not key-specific. Teaches the
-- interval structure that DEFINES each chord quality: a major chord is
-- 1-3-5, a minor chord is 1-♭3-5, and so on. Distractors are other
-- chord types' interval signatures, picked to force interval-level
-- discrimination (e.g. the major distractor pool includes minor,
-- dominant 7th, and augmented — minimally-distant variants).

INSERT INTO cards (topic, direction, key_signature, chord_type, question, correct_answer, distractors)
VALUES
    ('chord_intervals', 'type_to_intervals', '', 'major',
     '{"prompt": "What are the intervals in a major chord?", "chord_type": "major"}'::jsonb,
     '{"intervals": "1-3-5", "name": "major"}'::jsonb,
     '[
        {"intervals": "1-♭3-5", "name": "minor"},
        {"intervals": "1-3-5-♭7", "name": "dominant 7th"},
        {"intervals": "1-3-♯5", "name": "augmented"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'minor',
     '{"prompt": "What are the intervals in a minor chord?", "chord_type": "minor"}'::jsonb,
     '{"intervals": "1-♭3-5", "name": "minor"}'::jsonb,
     '[
        {"intervals": "1-3-5", "name": "major"},
        {"intervals": "1-♭3-♭5", "name": "diminished"},
        {"intervals": "1-♭3-5-♭7", "name": "minor 7th"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'dominant 7th',
     '{"prompt": "What are the intervals in a dominant 7th chord?", "chord_type": "dominant 7th"}'::jsonb,
     '{"intervals": "1-3-5-♭7", "name": "dominant 7th"}'::jsonb,
     '[
        {"intervals": "1-3-5-7", "name": "major 7th"},
        {"intervals": "1-♭3-5-♭7", "name": "minor 7th"},
        {"intervals": "1-3-5", "name": "major"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'major 7th',
     '{"prompt": "What are the intervals in a major 7th chord?", "chord_type": "major 7th"}'::jsonb,
     '{"intervals": "1-3-5-7", "name": "major 7th"}'::jsonb,
     '[
        {"intervals": "1-3-5-♭7", "name": "dominant 7th"},
        {"intervals": "1-♭3-5-♭7", "name": "minor 7th"},
        {"intervals": "1-3-♯5", "name": "augmented"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'minor 7th',
     '{"prompt": "What are the intervals in a minor 7th chord?", "chord_type": "minor 7th"}'::jsonb,
     '{"intervals": "1-♭3-5-♭7", "name": "minor 7th"}'::jsonb,
     '[
        {"intervals": "1-3-5-♭7", "name": "dominant 7th"},
        {"intervals": "1-3-5-7", "name": "major 7th"},
        {"intervals": "1-♭3-5", "name": "minor"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'diminished',
     '{"prompt": "What are the intervals in a diminished chord?", "chord_type": "diminished"}'::jsonb,
     '{"intervals": "1-♭3-♭5", "name": "diminished"}'::jsonb,
     '[
        {"intervals": "1-♭3-5", "name": "minor"},
        {"intervals": "1-3-♯5", "name": "augmented"},
        {"intervals": "1-♭3-5-♭7", "name": "minor 7th"}
     ]'::jsonb),
    ('chord_intervals', 'type_to_intervals', '', 'augmented',
     '{"prompt": "What are the intervals in an augmented chord?", "chord_type": "augmented"}'::jsonb,
     '{"intervals": "1-3-♯5", "name": "augmented"}'::jsonb,
     '[
        {"intervals": "1-3-5", "name": "major"},
        {"intervals": "1-♭3-♭5", "name": "diminished"},
        {"intervals": "1-3-5-7", "name": "major 7th"}
     ]'::jsonb);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM cards WHERE topic = 'chord_intervals';
-- +goose StatementEnd
