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
          {topics.map((topic) => (
            <Link
              key={topic.id}
              to={`/learn/${encodeURIComponent(topic.id)}`}
              className="bg-elevated rounded-lg border border-white/10 p-5 transition-colors hover:border-accent-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
              data-testid={`topic-card-${topic.id}`}
            >
              <h2 className="text-text-primary text-lg font-semibold">
                {topic.name}
              </h2>

              {/* Mastery dots */}
              <div
                className="mt-3 flex gap-1"
                aria-label={`${topic.keys_mastered} of ${topic.keys_total} keys mastered`}
              >
                {Array.from({ length: topic.keys_total }, (_, i) => (
                  <span
                    key={i}
                    className={`inline-block h-2 w-2 rounded-full ${
                      i < topic.keys_mastered
                        ? "bg-accent-correct"
                        : "bg-accent-locked/40"
                    }`}
                    aria-hidden="true"
                  />
                ))}
              </div>

              {/* Accuracy */}
              <p className="text-text-secondary mt-2 text-sm">
                {topic.accuracy}% accuracy
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
