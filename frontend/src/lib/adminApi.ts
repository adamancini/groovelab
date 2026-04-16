// adminApi.ts -- Admin API client for user management and track moderation.

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminTrack {
  id: string;
  name: string;
  user_id: string;
  user_email: string;
  chord_count: number;
  created_at: string;
  updated_at: string;
}

export class AdminApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

const ADMIN_BASE = "/api/v1/admin";

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new AdminApiError(
      res.status,
      (body as { error: string }).error ?? res.statusText,
    );
  }

  // 204 No Content has no body.
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/** GET /api/v1/admin/users -- list all users */
export function listUsers(): Promise<AdminUser[]> {
  return adminRequest<AdminUser[]>("/users");
}

/** PUT /api/v1/admin/users/:id -- update user role and/or enabled status */
export function updateUser(
  id: string,
  updates: { role?: string; enabled?: boolean },
): Promise<AdminUser> {
  return adminRequest<AdminUser>(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

/** GET /api/v1/admin/tracks -- list all tracks */
export function listTracks(): Promise<AdminTrack[]> {
  return adminRequest<AdminTrack[]>("/tracks");
}

/** DELETE /api/v1/admin/tracks/:id -- delete a track */
export function deleteTrack(id: string): Promise<void> {
  return adminRequest<void>(`/tracks/${id}`, {
    method: "DELETE",
  });
}
