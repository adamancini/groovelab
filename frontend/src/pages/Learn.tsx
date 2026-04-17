/**
 * Learn.tsx -- Topic selection grid page.
 *
 * Renders a grid of topic cards fetched from the API. Each card shows:
 * - Topic name
 * - Mastery dots (filled per key mastered, empty per key not mastered)
 * - Accuracy percentage
 *
 * Clicking a topic navigates to /learn/:topic to start a flashcard session.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import * as api from "../lib/api";

export default function Learn() {
  const [topics, setTopics] = useState<api.FlashcardTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchTopics()
      .then((data) => {
        if (!cancelled) setTopics(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof api.ApiError ? err.message : "Failed to load topics",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-text-primary text-2xl font-bold mb-8">Learn</h1>

      {loading && (
        <p className="text-text-secondary animate-pulse text-lg text-center py-8">
          Loading topics...
        </p>
      )}

      {error && (
        <p className="text-accent-wrong mt-4 text-center" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="topic-grid"
        >
          {topics.map((topic) => {
            const displayName = topic.topic
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
            const accuracyPct = topic.mastery_pct != null
              ? Math.round(topic.mastery_pct * 100)
              : null;
            const practiced = topic.practiced_count ?? 0;
            return (
            <Link
              key={topic.topic}
              to={`/learn/${encodeURIComponent(topic.topic)}`}
              className="bg-elevated rounded-lg border border-white/10 p-5 transition-colors hover:border-accent-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
              data-testid={`topic-card-${topic.topic}`}
            >
              <h2 className="text-text-primary text-lg font-semibold">
                {displayName}
              </h2>

              {/* Card count / progress */}
              <p className="text-text-secondary mt-1 text-xs">
                {topic.card_count} cards
                {practiced > 0 && ` · ${practiced} practiced`}
              </p>

              {/* Accuracy — only shown once user has practiced */}
              <p className="text-text-secondary mt-2 text-sm">
                {accuracyPct !== null ? `${accuracyPct}% accuracy` : "Not started"}
              </p>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
