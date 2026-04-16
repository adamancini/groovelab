/**
 * Progress.tsx -- Progress dashboard page (requires authentication).
 *
 * Displays:
 * - Overall accuracy percentage
 * - Current daily streak and best streak
 * - Cards mastered / total
 * - Mastery by topic (horizontal bar chart)
 * - Weak areas (cards with < 50% accuracy)
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";

export default function Progress() {
  const { user, loading: authLoading } = useAuth();
  const [dashboard, setDashboard] = useState<api.ProgressDashboard | null>(
    null,
  );
  const [streaks, setStreaks] = useState<api.StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([api.fetchProgressDashboard(), api.fetchStreaks()])
      .then(([dashData, streakData]) => {
        if (!cancelled) {
          setDashboard(dashData);
          setStreaks(streakData);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof api.ApiError
              ? err.message
              : "Failed to load progress data",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Loading state.
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-secondary animate-pulse text-lg">
          Loading progress...
        </p>
      </div>
    );
  }

  // Unauthenticated state.
  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-primary text-2xl font-bold">Progress</h1>
        <p className="text-secondary mt-4">
          Sign in to track your learning progress.
        </p>
        <Link
          to="/auth/signin"
          className="bg-accent-primary hover:bg-accent-primary/80 mt-6 inline-flex items-center rounded-lg px-6 py-3 font-medium text-black transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  // Error state.
  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-primary text-2xl font-bold">Progress</h1>
        <p className="text-accent-wrong mt-4">{error}</p>
      </div>
    );
  }

  // No data yet.
  if (!dashboard || !streaks) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-primary text-2xl font-bold">Progress</h1>
        <p className="text-secondary mt-4">No progress data available yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-primary text-2xl font-bold">Progress</h1>

      {/* Summary cards */}
      <div
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="progress-summary"
      >
        <StatCard
          label="Overall Accuracy"
          value={`${dashboard.overall_accuracy}%`}
          testId="stat-accuracy"
        />
        <StatCard
          label="Daily Streak"
          value={`${streaks.current_streak} day${streaks.current_streak !== 1 ? "s" : ""}`}
          testId="stat-streak"
        />
        <StatCard
          label="Best Streak"
          value={`${streaks.best_streak} day${streaks.best_streak !== 1 ? "s" : ""}`}
          testId="stat-best-streak"
        />
        <StatCard
          label="Cards Mastered"
          value={`${dashboard.cards_mastered} / ${dashboard.cards_total}`}
          testId="stat-cards"
        />
      </div>

      {/* Mastery by topic */}
      <section className="mt-8" aria-label="Mastery by topic">
        <h2
          className="text-primary text-lg font-semibold"
          data-testid="mastery-heading"
        >
          Mastery by Topic
        </h2>
        <div className="mt-4 space-y-3" data-testid="topic-bars">
          {dashboard.topics.map((topic) => (
            <TopicBar key={topic.topic} topic={topic} />
          ))}
          {dashboard.topics.length === 0 && (
            <p className="text-secondary text-sm">
              No topic data yet. Start learning to see your progress here.
            </p>
          )}
        </div>
      </section>

      {/* Weak areas */}
      <section className="mt-8" aria-label="Weak areas">
        <h2
          className="text-primary text-lg font-semibold"
          data-testid="weak-areas-heading"
        >
          Weak Areas
        </h2>
        <div className="mt-4" data-testid="weak-cards">
          {dashboard.weak_cards.length > 0 ? (
            <ul className="space-y-2">
              {dashboard.weak_cards.map((card) => (
                <li
                  key={card.card_id}
                  className="bg-elevated flex items-center justify-between rounded-lg border border-white/10 px-4 py-3"
                  data-testid={`weak-card-${card.card_id}`}
                >
                  <div>
                    <p className="text-primary text-sm font-medium">
                      {card.question}
                    </p>
                    <p className="text-secondary text-xs">{card.topic}</p>
                  </div>
                  <span className="text-accent-wrong text-sm font-bold">
                    {card.accuracy}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary text-sm">
              No weak areas detected. Keep up the great work!
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      className="bg-elevated rounded-lg border border-white/10 p-4"
      data-testid={testId}
    >
      <p className="text-secondary text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="text-primary mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function TopicBar({ topic }: { topic: api.TopicMastery }) {
  const percentage = Math.round(topic.accuracy);
  return (
    <div data-testid={`topic-bar-${topic.topic}`}>
      <div className="flex items-center justify-between">
        <span className="text-primary text-sm font-medium">{topic.topic}</span>
        <span className="text-secondary text-sm">{percentage}%</span>
      </div>
      <div className="bg-primary/20 mt-1 h-2.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-accent-primary transition-all"
          style={{ width: `${Math.min(percentage, 100)}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${topic.topic} mastery: ${percentage}%`}
        />
      </div>
    </div>
  );
}
