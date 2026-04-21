/**
 * FlashcardSession.tsx -- Flashcard session page at /learn/:topic.
 *
 * Manages the full session lifecycle:
 * 1. Fetch session from API
 * 2. Display cards with appropriate input method based on stage
 * 3. Handle answer submission and feedback
 * 4. Show session summary at completion
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import MultipleChoice from "../components/flashcards/MultipleChoice";
import TypedAnswer from "../components/flashcards/TypedAnswer";
import FretboardTap from "../components/flashcards/FretboardTap";
import AnswerFeedback from "../components/flashcards/AnswerFeedback";
import type { FretboardPosition } from "../lib/api";
import { useChordPlayer } from "../hooks/useChordPlayer";

type SessionState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "answering" }
  | { phase: "feedback"; result: api.AnswerResult }
  | { phase: "summary" };

export default function FlashcardSession() {
  const { topic } = useParams<{ topic: string }>();
  const { user } = useAuth();

  const [session, setSession] = useState<api.FlashcardSession | null>(null);
  const [currentCard, setCurrentCard] = useState<api.Flashcard | null>(null);
  const [state, setState] = useState<SessionState>({ phase: "loading" });
  const [progress, setProgress] = useState<api.SessionProgress>({
    answered: 0,
    total: 20,
    correct: 0,
    streak: 0,
    new_cards: 0,
    review_cards: 0,
  });
  const [cardIndex, setCardIndex] = useState(0);

  // Audio controls for chord playback (GRO-oa1z).
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const { playChord, setVolume: setPlayerVolume, stopPlayback } = useChordPlayer();
  // Ref-cached mute flag so the auto-play effect can read the current
  // value without re-firing when isMuted toggles. We want auto-play to
  // only fire when a NEW card enters the answering phase, not on every
  // mute/unmute click.
  const mutedRef = useRef(false);

  // Fetch session on mount.
  useEffect(() => {
    if (!topic) return;
    let cancelled = false;

    api
      .fetchSession(topic)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        if (data.cards.length > 0) {
          setCurrentCard(data.cards[0]);
          setProgress((p) => ({ ...p, total: data.cards.length }));
          setState({ phase: "answering" });
        } else {
          setState({ phase: "summary" });
        }
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            phase: "error",
            message:
              err instanceof api.ApiError ? err.message : "Failed to load session",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [topic]);

  const handleAnswer = useCallback(
    async (answer: string, inputMethod: "multiple_choice" | "typed" | "fretboard") => {
      if (!currentCard) return;
      if (!session) return;

      try {
        // GRO-uzk3: session.session_id MUST be threaded through every
        // submitAnswer call, or the backend returns 404 and, prior to
        // the fix, would have silently returned zeroed session_progress.
        const result = await api.submitAnswer(
          currentCard.id,
          answer,
          inputMethod,
          session.session_id,
        );
        setProgress(result.session_progress);
        setState({ phase: "feedback", result });
      } catch (err) {
        setState({
          phase: "error",
          message:
            err instanceof api.ApiError ? err.message : "Failed to submit answer",
        });
      }
    },
    [currentCard, session],
  );

  const handleMultipleChoiceSelect = useCallback(
    (option: string) => {
      // _optionAnswers maps the display label → JSON answer payload the backend expects.
      const answerJson =
        currentCard?._optionAnswers?.[option] ?? JSON.stringify({ notes: option });
      handleAnswer(answerJson, "multiple_choice");
    },
    [handleAnswer, currentCard],
  );

  const handleTypedSubmit = useCallback(
    (answer: string) => {
      // _answerKey is "name" or "notes" depending on card direction.
      const key = currentCard?._answerKey ?? "notes";
      handleAnswer(JSON.stringify({ [key]: answer }), "typed");
    },
    [handleAnswer, currentCard],
  );

  const handleFretboardSubmit = useCallback(
    (positions: FretboardPosition[]) => {
      const answer = positions
        .map((p) => `${p.string}:${p.fret}`)
        .join(",");
      handleAnswer(answer, "fretboard");
    },
    [handleAnswer],
  );

  const handleSkip = useCallback(async () => {
    // Skip moves to the next card without counting as wrong.
    if (!session) return;
    const nextIndex = cardIndex + 1;
    if (nextIndex < session.cards.length) {
      setCardIndex(nextIndex);
      setCurrentCard(session.cards[nextIndex]);
      setState({ phase: "answering" });
    } else {
      setState({ phase: "summary" });
    }
  }, [session, cardIndex]);

  const handleContinue = useCallback(() => {
    if (state.phase !== "feedback") return;
    const result = state.result;

    if (result.next_card) {
      setCurrentCard(result.next_card);
      setCardIndex((i) => i + 1);
      setState({ phase: "answering" });
    } else if (session) {
      // Check remaining cards in the local array.
      const nextIndex = cardIndex + 1;
      if (nextIndex < session.cards.length) {
        setCurrentCard(session.cards[nextIndex]);
        setCardIndex(nextIndex);
        setState({ phase: "answering" });
      } else {
        setState({ phase: "summary" });
      }
    } else {
      setState({ phase: "summary" });
    }
  }, [state, session, cardIndex]);

  // Auto-play chord audio when a new card enters the answering phase.
  // Muted cards, feedback phase, and type_to_intervals cards (null chordNotes)
  // are intentional no-ops. isMuted is read from a ref so toggling mute
  // does not cause the current card to replay.
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (mutedRef.current) return;
    if (state.phase !== "answering") return;
    if (!currentCard?.chordNotes) return;
    playChord(currentCard.chordNotes);
  }, [currentCard, state.phase, playChord]);

  // Forward volume changes into the sampler.
  useEffect(() => {
    setPlayerVolume(volume);
  }, [volume, setPlayerVolume]);

  // Stop any in-flight playback the instant the user mutes.
  useEffect(() => {
    if (isMuted) stopPlayback();
  }, [isMuted, stopPlayback]);

  const handleReplay = useCallback(() => {
    if (isMuted) return;
    if (!currentCard?.chordNotes) return;
    playChord(currentCard.chordNotes);
  }, [currentCard, isMuted, playChord]);

  const topicName = topic
    ? decodeURIComponent(topic).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Session";

  // --- Loading ---
  if (state.phase === "loading") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-text-secondary animate-pulse text-lg">
          Loading session...
        </p>
      </div>
    );
  }

  // --- Error ---
  if (state.phase === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-text-primary text-2xl font-bold">{topicName}</h1>
        <p className="text-accent-wrong mt-4" role="alert">
          {state.message}
        </p>
        <Link
          to="/learn"
          className="text-accent-primary mt-4 inline-block hover:underline"
        >
          Back to topics
        </Link>
      </div>
    );
  }

  // --- Session Summary ---
  if (state.phase === "summary") {
    const accuracy =
      progress.answered > 0
        ? Math.round((progress.correct / progress.answered) * 100)
        : 0;

    return (
      <div className="mx-auto max-w-2xl px-4 py-8" data-testid="session-summary">
        <h1 className="text-text-primary text-2xl font-bold mb-6">
          Session Complete
        </h1>

        <div className="bg-elevated rounded-lg border border-white/10 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-text-secondary text-sm">Accuracy</p>
              <p
                className="text-accent-correct text-3xl font-bold"
                data-testid="summary-accuracy"
              >
                {accuracy}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-text-secondary text-sm">Best streak</p>
              <p
                className="text-accent-primary text-3xl font-bold"
                data-testid="summary-streak"
              >
                {progress.streak}
              </p>
            </div>
            <div className="text-center">
              <p className="text-text-secondary text-sm">New cards</p>
              <p className="text-text-primary text-xl font-semibold" data-testid="summary-new">
                {progress.new_cards}
              </p>
            </div>
            <div className="text-center">
              <p className="text-text-secondary text-sm">Reviewed</p>
              <p className="text-text-primary text-xl font-semibold" data-testid="summary-reviewed">
                {progress.review_cards}
              </p>
            </div>
          </div>
        </div>

        {/* Guest prompt */}
        {!user && (
          <div
            className="mt-6 rounded-lg border border-accent-tonic/30 bg-accent-tonic/10 p-4 text-center"
            data-testid="guest-prompt"
          >
            <p className="text-text-primary font-medium">
              Sign in to save your progress
            </p>
            <Link
              to="/auth/signin"
              className="text-accent-primary mt-2 inline-block hover:underline"
            >
              Sign in
            </Link>
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-center">
          <Link
            to="/learn"
            className="rounded-lg border border-white/10 bg-elevated px-6 py-2 font-medium text-text-primary transition-colors hover:bg-elevated/80"
          >
            Back to topics
          </Link>
          <Link
            to={`/learn/${topic}`}
            onClick={() => window.location.reload()}
            className="rounded-lg bg-accent-primary px-6 py-2 font-medium text-black transition-colors hover:bg-accent-primary/80"
          >
            Practice again
          </Link>
        </div>
      </div>
    );
  }

  // --- Answering / Feedback ---
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Breadcrumb + audio controls */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <nav aria-label="Breadcrumb" data-testid="breadcrumb">
          <ol className="flex items-center gap-2 text-sm text-text-secondary">
            <li>
              <Link to="/learn" className="hover:text-accent-primary transition-colors">
                Learn
              </Link>
            </li>
            <li aria-hidden="true">&gt;</li>
            <li className="text-text-primary font-medium">{topicName}</li>
          </ol>
        </nav>
        <div className="flex items-center gap-2" data-testid="audio-controls">
          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            aria-label={isMuted ? "Unmute chord audio" : "Mute chord audio"}
            aria-pressed={isMuted}
            className="rounded border border-white/10 bg-elevated px-2 py-1 text-sm text-text-primary hover:bg-elevated/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            data-testid="mute-toggle"
          >
            {isMuted ? "🔇" : "🔊"}
          </button>
          {!isMuted && (
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Chord playback volume"
              className="w-24"
              data-testid="volume-slider"
            />
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 flex items-center justify-between" data-testid="session-progress">
        <span className="text-text-primary font-mono text-sm">
          {progress.answered}/{progress.total}
        </span>
        <div className="mx-4 flex-1 h-2 rounded-full bg-elevated overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-primary transition-all duration-300"
            style={{
              width: `${progress.total > 0 ? (progress.answered / progress.total) * 100 : 0}%`,
            }}
          />
        </div>
        <span
          className="text-accent-primary font-mono text-sm"
          data-testid="streak-counter"
          title="Current streak"
        >
          {progress.streak > 0 ? `${progress.streak} streak` : ""}
        </span>
      </div>

      {/* Question */}
      {currentCard && (
        <div className="mb-8">
          <h2
            className="text-text-primary text-xl font-bold text-center mb-6"
            data-testid="question-text"
          >
            {currentCard.question}
          </h2>

          {/* Replay chord audio (hidden when no audio applies — e.g. type_to_intervals) */}
          {state.phase === "answering" && currentCard.chordNotes && (
            <div className="mb-4 text-center">
              <button
                type="button"
                onClick={handleReplay}
                disabled={isMuted}
                aria-label="Replay chord"
                className="rounded border border-white/10 bg-elevated px-3 py-1 text-sm text-text-secondary hover:text-accent-primary disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
                data-testid="replay-button"
              >
                ♪ Replay chord
              </button>
            </div>
          )}

          {/* Input area -- varies by stage */}
          {state.phase === "answering" && (
            <div className="mb-4">
              {(currentCard.stage === 0 || currentCard.stage === 1) &&
                currentCard.options && (
                  <MultipleChoice
                    options={currentCard.options}
                    stage={currentCard.stage}
                    onSelect={handleMultipleChoiceSelect}
                  />
                )}

              {currentCard.stage === 2 && (
                <TypedAnswer
                  onSubmit={handleTypedSubmit}
                  placeholder="Type your answer..."
                />
              )}

              {currentCard.stage === 3 && (
                <FretboardTap onSubmit={handleFretboardSubmit} />
              )}

              {/* Skip button */}
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleSkip}
                  className="text-text-secondary text-sm hover:text-text-primary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary rounded px-2 py-1"
                  data-testid="skip-button"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Feedback */}
          {state.phase === "feedback" && (
            <AnswerFeedback
              correct={state.result.correct}
              correctAnswer={state.result.correct_answer}
              explanation={state.result.explanation}
              correctPositions={state.result.correct_positions}
              onContinue={handleContinue}
            />
          )}
        </div>
      )}
    </div>
  );
}
