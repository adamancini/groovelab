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

const BASE = "/api/v1/auth";

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
