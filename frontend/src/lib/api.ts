// api.ts -- Thin wrapper around the backend REST API.
// All endpoints are relative to /api/v1 and proxied by nginx in production.

export interface User {
  id: string;
  email: string;
  role: string; // "user" | "admin"
}

export interface AuthError {
  error: string;
}

/** A topic in the flashcard system with mastery information. */
export interface FlashcardTopic {
  id: string;
  name: string;
  /** Number of keys mastered (0-12). */
  keys_mastered: number;
  /** Total possible keys (always 12). */
  keys_total: number;
  /** Accuracy percentage 0-100. */
  accuracy: number;
}

/** A single flashcard in a session. */
export interface Flashcard {
  id: string;
  question: string;
  /** Mastery stage: 0=4-choice, 1=3-choice, 2=typed, 3=fretboard. */
  stage: 0 | 1 | 2 | 3;
  /** Options for multiple choice stages (0 and 1). */
  options?: string[];
  /** Fretboard positions for stage 3 display. */
  fretboard_positions?: FretboardPosition[];
}

/** A position on the fretboard. */
export interface FretboardPosition {
  string: number;
  fret: number;
  label?: string;
}

/** Response from POST /api/v1/flashcards/answer. */
export interface AnswerResult {
  correct: boolean;
  correct_answer: string;
  explanation: string;
  /** Next card in the session, or null if session is complete. */
  next_card: Flashcard | null;
  session_progress: SessionProgress;
  /** Fretboard positions for the correct answer (for teaching feedback). */
  correct_positions?: FretboardPosition[];
}

/** Progress tracking within a session. */
export interface SessionProgress {
  answered: number;
  total: number;
  correct: number;
  streak: number;
  new_cards: number;
  review_cards: number;
}

/** A flashcard session with an initial set of cards. */
export interface FlashcardSession {
  session_id: string;
  topic: string;
  cards: Flashcard[];
}

const BASE = "/api/v1/auth";
const API_BASE = "/api/v1";

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as AuthError).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as AuthError).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** POST /api/v1/auth/login */
export function login(email: string, password: string): Promise<void> {
  return request("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/v1/auth/register */
export function register(email: string, password: string): Promise<void> {
  return request("/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/v1/auth/logout */
export function logout(): Promise<void> {
  return request("/logout", { method: "POST" });
}

/** GET /api/v1/auth/me -- returns current user or throws 401 */
export function fetchCurrentUser(): Promise<User> {
  return request<User>("/me");
}

// --------------- Flashcard endpoints ---------------

/** GET /api/v1/flashcards/topics -- list topics with mastery data. */
export function fetchTopics(): Promise<FlashcardTopic[]> {
  return apiRequest<FlashcardTopic[]>("/flashcards/topics");
}

/** GET /api/v1/flashcards/session?topic=TOPIC -- start or resume a session. */
export function fetchSession(topic: string): Promise<FlashcardSession> {
  return apiRequest<FlashcardSession>(
    `/flashcards/session?topic=${encodeURIComponent(topic)}`,
  );
}

/** POST /api/v1/flashcards/answer -- submit an answer. */
export function submitAnswer(
  cardId: string,
  answer: string,
  inputMethod: "multiple_choice" | "typed" | "fretboard",
): Promise<AnswerResult> {
  return apiRequest<AnswerResult>("/flashcards/answer", {
    method: "POST",
    body: JSON.stringify({
      card_id: cardId,
      answer,
      input_method: inputMethod,
    }),
  });
}
