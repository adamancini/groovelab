-- name: UpsertStreak :one
INSERT INTO streaks (user_id, practice_date, session_correct_streak, session_best_streak)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, practice_date)
DO UPDATE SET
    session_correct_streak = $3,
    session_best_streak = GREATEST(streaks.session_best_streak, $4)
RETURNING id, user_id, practice_date, session_correct_streak, session_best_streak;

-- name: GetStreaksByUser :many
SELECT id, user_id, practice_date, session_correct_streak, session_best_streak
FROM streaks
WHERE user_id = $1
ORDER BY practice_date DESC;

-- name: GetStreakByDate :one
SELECT id, user_id, practice_date, session_correct_streak, session_best_streak
FROM streaks
WHERE user_id = $1 AND practice_date = $2;

-- name: GetDailyStreakCount :one
-- Counts consecutive days of practice ending at the most recent practice day.
-- This uses a recursive CTE to walk backwards from the latest date.
WITH RECURSIVE streak_chain AS (
    SELECT practice_date, 1 AS streak_length
    FROM streaks
    WHERE user_id = $1
    AND practice_date = (SELECT MAX(practice_date) FROM streaks WHERE user_id = $1)

    UNION ALL

    SELECT s.practice_date, sc.streak_length + 1
    FROM streaks s
    JOIN streak_chain sc ON s.practice_date = sc.practice_date - INTERVAL '1 day'
    WHERE s.user_id = $1
)
SELECT COALESCE(MAX(streak_length), 0)::int AS current_streak
FROM streak_chain;

-- name: GetBestDailyStreak :one
-- Finds the longest consecutive-day streak for a user.
WITH practice_gaps AS (
    SELECT practice_date,
           practice_date - (ROW_NUMBER() OVER (ORDER BY practice_date))::int AS grp
    FROM streaks
    WHERE user_id = $1
),
streak_groups AS (
    SELECT grp, COUNT(*) AS streak_length
    FROM practice_gaps
    GROUP BY grp
)
SELECT COALESCE(MAX(streak_length), 0)::int AS best_streak
FROM streak_groups;
