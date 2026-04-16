-- name: CreateTrack :one
INSERT INTO tracks (user_id, name, chord_sequence, drum_pattern, bpm, playback_settings)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at;

-- name: GetTrackByID :one
SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
FROM tracks
WHERE id = $1;

-- name: ListTracksByUser :many
SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
FROM tracks
WHERE user_id = $1
ORDER BY updated_at DESC;

-- name: ListAllTracks :many
SELECT id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at
FROM tracks
ORDER BY updated_at DESC;

-- name: UpdateTrack :one
UPDATE tracks
SET name = $2,
    chord_sequence = $3,
    drum_pattern = $4,
    bpm = $5,
    playback_settings = $6,
    updated_at = now()
WHERE id = $1
RETURNING id, user_id, name, chord_sequence, drum_pattern, bpm, playback_settings, created_at, updated_at;

-- name: DeleteTrack :exec
DELETE FROM tracks WHERE id = $1;
