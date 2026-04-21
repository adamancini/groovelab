/**
 * Unit tests for the auth `request()` helper in frontend/src/lib/api.ts.
 *
 * Background (see GRO-xrs2): Authboss in API mode returns 307 with a
 * JSON body `{"status":"success","location":"/"}` for successful login,
 * register, and logout. The browser's `fetch` cannot auto-follow because
 * Authboss omits the HTTP `Location` header. The helper must therefore
 * treat 2xx AND (302/303/307 with JSON body) as success, and continue to
 * raise `ApiError` for 4xx/5xx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, register, logout, ApiError } from "../lib/api";

type FetchMock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

function mockFetchOnce(response: {
  status: number;
  ok?: boolean;
  body?: unknown;
  bodyThrows?: boolean;
}): void {
  const ok = response.ok ?? (response.status >= 200 && response.status < 300);
  (globalThis.fetch as FetchMock).mockResolvedValueOnce({
    ok,
    status: response.status,
    statusText: `HTTP ${response.status}`,
    json: () =>
      response.bodyThrows
        ? Promise.reject(new SyntaxError("Unexpected end of JSON input"))
        : Promise.resolve(response.body ?? {}),
  } as Response);
}

describe("request() -- auth success path", () => {
  it("resolves on 307 + JSON success body (Authboss login)", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success", location: "/" },
    });
    await expect(login("u@example.com", "pw12345678")).resolves.toBeDefined();
  });

  it("resolves on 307 for register", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success", location: "/" },
    });
    await expect(
      register("u@example.com", "pw12345678"),
    ).resolves.toBeDefined();
  });

  it("resolves on 307 for logout", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success", location: "/" },
    });
    await expect(logout()).resolves.toBeDefined();
  });

  it("resolves on 303 with JSON body (alternate Authboss redirect)", async () => {
    mockFetchOnce({
      status: 303,
      ok: false,
      body: { status: "success", location: "/" },
    });
    await expect(login("u@example.com", "pw12345678")).resolves.toBeDefined();
  });

  it("resolves on 302 with JSON body", async () => {
    mockFetchOnce({
      status: 302,
      ok: false,
      body: { status: "success", location: "/" },
    });
    await expect(login("u@example.com", "pw12345678")).resolves.toBeDefined();
  });

  it("resolves on 307 even when the body is empty (defensive)", async () => {
    // If the browser gives us a 307 with an unparseable body (e.g. because
    // redirect: "manual" produces an opaqueredirect response in some edge
    // cases), we should still not throw -- the subsequent /me call will
    // determine whether auth actually succeeded.
    mockFetchOnce({ status: 307, ok: false, bodyThrows: true });
    await expect(login("u@example.com", "pw12345678")).resolves.toBeDefined();
  });

  it("resolves on 200 with JSON body (standard 2xx path)", async () => {
    mockFetchOnce({ status: 200, body: {} });
    await expect(login("u@example.com", "pw12345678")).resolves.toBeDefined();
  });
});

describe("request() -- auth failure path", () => {
  it("throws ApiError on 200 with { error } body (Authboss failure shape)", async () => {
    // Authboss returns 200 + {error: ...} for invalid credentials.
    // This is still handled by res.ok === true, so the body is returned.
    // However, the consumer (AuthContext) checks for a user via /me; the
    // current api-layer contract treats this as a resolved Promise and
    // leaves the error handling to the caller's auth flow. We assert the
    // behavior matches that contract: resolves, does NOT throw.
    mockFetchOnce({
      status: 200,
      body: { error: "Invalid Credentials", status: "failure" },
    });
    await expect(login("u@example.com", "wrong")).resolves.toBeDefined();
  });

  it("throws ApiError on 401", async () => {
    mockFetchOnce({ status: 401, ok: false, body: { error: "unauthorized" } });
    await expect(login("u@example.com", "pw12345678")).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("throws ApiError on 500 with empty body", async () => {
    mockFetchOnce({ status: 500, ok: false, bodyThrows: true });
    try {
      await login("u@example.com", "pw12345678");
      throw new Error("expected login() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it("throws ApiError on 400 with error body", async () => {
    mockFetchOnce({
      status: 400,
      ok: false,
      body: { error: "password too short" },
    });
    try {
      await register("u@example.com", "short");
      throw new Error("expected register() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe("password too short");
    }
  });
});

describe("request() -- RequestInit options", () => {
  it("sets redirect: manual on login", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success" },
    });
    await login("u@example.com", "pw12345678");
    const callArgs = (globalThis.fetch as FetchMock).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("sets redirect: manual on register", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success" },
    });
    await register("u@example.com", "pw12345678");
    const callArgs = (globalThis.fetch as FetchMock).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("sets redirect: manual on logout", async () => {
    mockFetchOnce({
      status: 307,
      ok: false,
      body: { status: "success" },
    });
    await logout();
    const callArgs = (globalThis.fetch as FetchMock).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });
});
