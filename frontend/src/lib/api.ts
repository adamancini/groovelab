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

/** A topic in the flashcard system with optional mastery information. */
export interface FlashcardTopic {
  /** Slug identifier, e.g. "major_chords". */
  topic: string;
  card_count: number;
  /** Average card accuracy (0.0–1.0). Only present for authenticated users. */
  mastery_pct?: number;
  /** Number of distinct cards practiced. Only present for authenticated users. */
  practiced_count?: number;
}

/** A single flashcard in a session (frontend view — transformed from raw backend). */
export interface Flashcard {
  id: string;
  /** Human-readable prompt text, extracted from the backend question object. */
  question: string;
  /** Mastery stage: 0=4-choice, 1=3-choice, 2=typed, 3=fretboard. */
  stage: 0 | 1 | 2 | 3;
  /** Shuffled display strings for multiple choice stages (0 and 1). */
  options?: string[];
  /** Fretboard positions for stage 3 display. */
  fretboard_positions?: FretboardPosition[];
  /** Which answer field to submit ("notes" | "name" | "intervals"). Derived from card direction. */
  _answerKey: string;
  /** Maps each display option string to the JSON answer payload to POST. */
  _optionAnswers: Record<string, string>;
  /**
   * Space-separated chord notes (e.g. "G B Eb"), used by the audio player.
   * Null for type_to_intervals cards, which are key-agnostic.
   */
  chordNotes: string | null;
  /** Card direction ("name_to_notes" | "notes_to_name" | "type_to_intervals"). */
  direction: string;
  /**
   * Chord root note (e.g. "C", "F#"), sourced from the backend
   * key_signature field. Null when the card has no key (e.g. interval
   * cards). Consumers: ChordDiagram (GRO-z1e3, GRO-nhmm).
   */
  chordRoot: string | null;
  /**
   * SCALE_CHORD_LIBRARY entry name (e.g. "Major Triad", "Dominant 7th").
   * Null when the card is not a chord card or the wire chord_type is
   * unrecognised. Resolved from backend chord_type via resolveChordDefName.
   */
  chordDefName: string | null;
  /**
   * Topic slug this card belongs to (e.g. "major_chords", "intervals").
   * Falls back to the session-level topic when the card itself does not
   * carry one. Surfaced to support topic-aware UI affordances.
   */
  topic: string | null;
}

// --------------- Raw backend wire types (not exported) ---------------

interface RawAnswerData {
  name?: string;
  notes?: string;
  [key: string]: unknown;
}

interface RawSessionCard {
  id: string;
  direction: string;
  question: { prompt: string; display_name?: string };
  correct_answer: RawAnswerData;
  distractors?: RawAnswerData[];
  stage: number;
  options: number; // count, NOT an array
  /** Chord root, e.g. "C", "F#". Sent on every session card by the backend
   *  (SessionCard embeds Card -- see backend/internal/flashcards/models.go).
   *  May be empty for non-keyed cards. */
  key_signature?: string;
  /** Human-readable chord type, e.g. "major", "dominant 7th". Null/absent
   *  for non-chord cards (scales, note positions). */
  chord_type?: string | null;
  /** Optional per-card topic override. When absent, the card inherits the
   *  session-level topic. */
  topic?: string;
}

interface RawSessionResponse {
  session_id: string;
  topic: string;
  cards: RawSessionCard[];
  total: number;
}

interface RawAnswerResponse {
  correct: boolean;
  correct_answer: RawAnswerData;
  explanation: string;
  next_card?: RawSessionCard;
  session_progress: { answered: number; total: number; correct: number; incorrect: number };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Map the backend's human-readable chord_type wire string onto the entry
 * name used by SCALE_CHORD_LIBRARY in src/lib/music-theory.ts. Returns
 * null for null/undefined/unknown inputs so callers can branch without
 * throwing.
 *
 * The mapping is intentionally one-way and case-sensitive: only the seven
 * wire strings the backend emits are accepted. Library entries themselves
 * are not renamed (see GRO-8sya). Adding a new chord type means adding it
 * here and in the SCALE_CHORD_LIBRARY -- but never renaming an existing
 * library entry.
 */
export function resolveChordDefName(
  wireChordType: string | null | undefined,
): string | null {
  if (wireChordType == null) return null;
  switch (wireChordType) {
    case "major":
      return "Major Triad";
    case "minor":
      return "Minor Triad";
    case "dominant 7th":
      return "Dominant 7th";
    case "major 7th":
      return "Major 7th";
    case "minor 7th":
      return "Minor 7th";
    case "diminished":
      return "Diminished";
    case "augmented":
      return "Augmented";
    default:
      return null;
  }
}

function transformSessionCard(
  raw: RawSessionCard,
  sessionTopic: string | null = null,
): Flashcard {
  const questionText = raw.question.prompt;
  // Answer axis varies by direction:
  //   name_to_notes    -> options are notes strings
  //   notes_to_name    -> options are chord-name strings
  //   type_to_intervals -> options are interval-signature strings (e.g. "1-3-5")
  let answerKey: string;
  if (raw.direction === "type_to_intervals") {
    answerKey = "intervals";
  } else if (raw.direction === "notes_to_name") {
    answerKey = "name";
  } else {
    answerKey = "notes";
  }

  const optionAnswers: Record<string, string> = {};
  const labels: string[] = [];

  const addOption = (d: RawAnswerData) => {
    const label = (d[answerKey] as string | undefined) ?? d.name ?? d.notes ?? JSON.stringify(d);
    optionAnswers[label] = JSON.stringify(d);
    labels.push(label);
  };

  addOption(raw.correct_answer);
  for (const d of (raw.distractors ?? []).slice(0, raw.options - 1)) addOption(d);

  const shuffled = shuffle(labels);
  const stage = Math.min(Math.max(raw.stage, 0), 3) as 0 | 1 | 2 | 3;

  // Chord notes for audio playback. type_to_intervals cards are key-agnostic
  // and intentionally produce no audio.
  const chordNotes =
    raw.direction === "type_to_intervals"
      ? null
      : ((raw.correct_answer.notes as string | undefined) ?? null);

  // Chord metadata for downstream chord-rendering UI (GRO-z1e3, GRO-nhmm).
  // The backend ALWAYS emits key_signature on session cards, but it may be
  // an empty string for key-agnostic cards (e.g. type_to_intervals). Treat
  // an empty string the same as missing -- chordRoot becomes null.
  const rawRoot = raw.key_signature;
  const chordRoot = rawRoot != null && rawRoot !== "" ? rawRoot : null;
  const chordDefName = resolveChordDefName(raw.chord_type);
  // Card-level topic wins; otherwise inherit the session topic.
  const topic = raw.topic ?? sessionTopic;

  return {
    id: raw.id,
    question: questionText,
    stage,
    options: stage <= 1 ? shuffled : undefined,
    _answerKey: answerKey,
    _optionAnswers: optionAnswers,
    chordNotes,
    direction: raw.direction,
    chordRoot,
    chordDefName,
    topic,
  };
}

function transformAnswerResponse(raw: RawAnswerResponse): AnswerResult {
  const ca = raw.correct_answer;
  const caDisplay = (ca?.notes as string | undefined) ?? (ca?.name as string | undefined) ?? JSON.stringify(ca);
  return {
    correct: raw.correct,
    correct_answer: caDisplay,
    explanation: raw.explanation ?? "",
    next_card: raw.next_card ? transformSessionCard(raw.next_card) : null,
    session_progress: {
      answered: raw.session_progress?.answered ?? 0,
      total: raw.session_progress?.total ?? 0,
      correct: raw.session_progress?.correct ?? 0,
      streak: 0,
      new_cards: 0,
      review_cards: 0,
    },
  };
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

/**
 * Authboss in API mode returns 307 (with a JSON body and no HTTP Location
 * header) on successful /login, /register, and /logout. Because the
 * redirect target is carried in the body, the browser's fetch cannot
 * auto-follow. Treat such 3xx responses with a JSON body as success, not
 * as an error. 4xx/5xx still throw ApiError. See GRO-xrs2.
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });

  // 2xx: standard success. 3xx (specifically 302/303/307 from Authboss):
  // success-with-body. Everything else is an error.
  const isAuthbossRedirect =
    res.status === 302 || res.status === 303 || res.status === 307;
  if (!res.ok && !isAuthbossRedirect) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as AuthError).error ?? res.statusText);
  }

  // Parse the body if there is one; empty bodies (e.g. 204, or a 3xx with
  // no payload) resolve to an empty object cast to T.
  return (await res.json().catch(() => ({}))) as T;
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

/** POST /api/v1/auth/login
 *
 * redirect: "manual" prevents the browser from attempting to auto-follow
 * Authboss's 307 response. Authboss carries the redirect target in the
 * JSON body, not the Location header, so an auto-follow would fail.
 */
export function login(email: string, password: string): Promise<void> {
  return request("/login", {
    method: "POST",
    redirect: "manual",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/v1/auth/register -- see login() for redirect: "manual" rationale. */
export function register(email: string, password: string): Promise<void> {
  return request("/register", {
    method: "POST",
    redirect: "manual",
    body: JSON.stringify({ email, password }),
  });
}

/** POST /api/v1/auth/logout -- see login() for redirect: "manual" rationale. */
export function logout(): Promise<void> {
  return request("/logout", { method: "POST", redirect: "manual" });
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
export async function fetchSession(topic: string): Promise<FlashcardSession> {
  const raw = await apiRequest<RawSessionResponse>(
    `/flashcards/session?topic=${encodeURIComponent(topic)}`,
  );
  return {
    session_id: raw.session_id,
    topic: raw.topic,
    cards: raw.cards.map((c) => transformSessionCard(c, raw.topic ?? null)),
  };
}

/** POST /api/v1/flashcards/answer -- submit an answer.
 *
 *  session_id MUST be passed (threaded from the FlashcardSession returned
 *  by fetchSession). Without it the backend returns 404 -- before GRO-uzk3
 *  was fixed the backend silently returned 200 with zeroed progress, which
 *  broke the Session Complete screen (HAR captured 2026-04-21 showed
 *  3/3 correct answers rendering as "Accuracy 0%" because the frontend
 *  never carried the session_id through).
 *
 *  answerJson: the JSON-serialised answer payload built by the caller from
 *  Flashcard._optionAnswers (MC) or Flashcard._answerKey (typed/fretboard).
 */
export async function submitAnswer(
  cardId: string,
  answerJson: string,
  inputMethod: "multiple_choice" | "typed" | "fretboard",
  sessionId: string,
): Promise<AnswerResult> {
  const raw = await apiRequest<RawAnswerResponse>(
    `/flashcards/answer?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        card_id: cardId,
        answer: JSON.parse(answerJson),
        input_method: inputMethod,
      }),
    },
  );
  return transformAnswerResponse(raw);
}

// --------------- Fretboard endpoints ---------------

/** A tuning preset returned by the backend. */
export interface TuningPreset {
  id: string;
  name: string;
  strings: number;
  notes: string[];
}

/**
 * Raw tuning preset as sent by the backend. The Go struct tags emit
 * camelCase `stringCount` and `pitches` (a JSONB array of low-to-high
 * pitches with octave numbers, e.g. `["E1","A1","D2","G2"]`). We must
 * transform this into the frontend `TuningPreset` shape (`strings`,
 * `notes` without octaves, high-to-low).
 */
interface RawTuningPreset {
  id: string;
  name: string;
  stringCount: number;
  pitches: string[] | string;
  isDefault?: boolean;
}

/** Strip an optional trailing octave number from a pitch string (e.g. "Eb1" -> "Eb"). */
function stripOctave(pitch: string): string {
  const match = pitch.match(/^([A-Ga-g][#b]?)\d*$/);
  return match ? match[1] : pitch;
}

/**
 * Map an API-shaped tuning preset to the frontend shape. Handles both
 * array-typed and string-typed (not-yet-parsed) `pitches`, strips octave
 * numbers, and reverses low-to-high -> high-to-low ordering.
 */
export function transformTuningPreset(raw: RawTuningPreset): TuningPreset {
  let pitches: string[];
  if (Array.isArray(raw.pitches)) {
    pitches = raw.pitches;
  } else if (typeof raw.pitches === "string") {
    try {
      const parsed: unknown = JSON.parse(raw.pitches);
      pitches = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      pitches = [];
    }
  } else {
    pitches = [];
  }

  // Low-to-high -> high-to-low; strip octaves.
  const notes = pitches.map(stripOctave).reverse();

  return {
    id: raw.id,
    name: raw.name,
    strings: raw.stringCount,
    notes,
  };
}

/** GET /api/v1/fretboard/tunings -- list tuning presets. */
export async function fetchTuningPresets(): Promise<TuningPreset[]> {
  const raw = await apiRequest<RawTuningPreset[]>("/fretboard/tunings");
  return raw.map(transformTuningPreset);
}

/** PUT /api/v1/settings -- save user settings (e.g. tuning preference). */
export function saveSettings(
  settings: Record<string, unknown>,
): Promise<void> {
  return apiRequest<void>("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** Settings payload returned by GET /api/v1/settings. */
export interface UserSettings {
  tuning?: string[];
  stringCount?: number;
}

/** GET /api/v1/settings -- fetch the current user's saved settings.
 *
 *  Returns an empty object if the backend has not yet implemented this
 *  endpoint (404). Other errors propagate so callers can decide how to
 *  surface them.
 */
export async function fetchSettings(): Promise<UserSettings> {
  try {
    return await apiRequest<UserSettings>("/settings");
  } catch (err) {
    // 404 = backend has not implemented the endpoint yet; treat as
    // "no saved settings" so the caller falls back to defaults.
    if (err instanceof ApiError && err.status === 404) {
      const empty: UserSettings = {};
      return empty;
    }
    throw err;
  }
}

// --------------- Progress endpoints ---------------

/** A single topic mastery entry. */
export interface TopicMastery {
  topic: string;
  accuracy: number;
  cards_mastered: number;
  cards_total: number;
}

/** A weak card entry (< 50% accuracy). */
export interface WeakCard {
  card_id: string;
  question: string;
  accuracy: number;
  topic: string;
}

/** Dashboard data from GET /api/v1/progress/dashboard. */
export interface ProgressDashboard {
  overall_accuracy: number;
  cards_mastered: number;
  cards_total: number;
  topics: TopicMastery[];
  weak_cards: WeakCard[];
}

/** Streak data from GET /api/v1/progress/streaks. */
export interface StreakData {
  current_streak: number;
  best_streak: number;
}

/** GET /api/v1/progress/dashboard -- progress dashboard data. */
export function fetchProgressDashboard(): Promise<ProgressDashboard> {
  return apiRequest<ProgressDashboard>("/progress/dashboard");
}

/** GET /api/v1/progress/streaks -- streak data. */
export function fetchStreaks(): Promise<StreakData> {
  return apiRequest<StreakData>("/progress/streaks");
}
