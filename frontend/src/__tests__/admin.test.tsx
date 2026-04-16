import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

// Helper to create a fetch mock that handles multiple endpoints.
function createFetchMock(overrides: Record<string, unknown> = {}) {
  const adminUser = {
    id: "user-1",
    email: "admin@example.com",
    role: "admin",
    ...overrides,
  };

  return vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : String(url);
    const method = options?.method ?? "GET";

    // Auth /me endpoint -- return admin user.
    if (urlStr.includes("/api/v1/auth/me")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(adminUser),
      });
    }

    // Admin users list.
    if (urlStr.includes("/api/v1/admin/users") && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              id: "user-1",
              email: "admin@example.com",
              role: "admin",
              enabled: true,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "user-2",
              email: "user@example.com",
              role: "user",
              enabled: true,
              created_at: "2026-01-02T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
            },
          ]),
      });
    }

    // Admin users update.
    if (urlStr.includes("/api/v1/admin/users/") && method === "PUT") {
      const body = JSON.parse(options?.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "user-2",
            email: "user@example.com",
            role: body.role ?? "user",
            enabled: body.enabled ?? true,
            created_at: "2026-01-02T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          }),
      });
    }

    // Admin tracks list.
    if (urlStr.includes("/api/v1/admin/tracks") && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              id: "track-1",
              name: "My Track",
              user_id: "user-1",
              user_email: "admin@example.com",
              chord_count: 4,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "track-2",
              name: "Other Track",
              user_id: "user-2",
              user_email: "user@example.com",
              chord_count: 8,
              created_at: "2026-01-02T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
            },
          ]),
      });
    }

    // Admin track delete.
    if (urlStr.includes("/api/v1/admin/tracks/") && method === "DELETE") {
      return Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });
    }

    // Default: 404.
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not found" }),
    });
  });
}

// Helper to create a guest fetch mock (non-admin).
function createGuestFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);

    if (urlStr.includes("/api/v1/auth/me")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "user-2",
            email: "user@example.com",
            role: "user",
          }),
      });
    }

    // Admin endpoints return 403 for non-admins.
    if (urlStr.includes("/api/v1/admin/")) {
      return Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "admin access required" }),
      });
    }

    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not found" }),
    });
  });
}

describe("Admin Panel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("AdminLayout", () => {
    it("renders sidebar navigation with all items for admin users", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin");

      render(<App />);

      const sidebar = await screen.findByTestId("admin-sidebar");
      expect(sidebar).toBeInTheDocument();

      // Scope to sidebar to avoid matching page headings.
      expect(within(sidebar).getByText("Updates")).toBeInTheDocument();
      expect(within(sidebar).getByText("Users")).toBeInTheDocument();
      expect(within(sidebar).getByText("Tracks")).toBeInTheDocument();
      expect(within(sidebar).getByText("License")).toBeInTheDocument();
      expect(within(sidebar).getByText("Support")).toBeInTheDocument();
    });

    it("renders 'Back to App' link", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin");

      render(<App />);

      const backLink = await screen.findByTestId("back-to-app");
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute("href", "/");
    });

    it("shows access denied for non-admin users", async () => {
      vi.stubGlobal("fetch", createGuestFetchMock());
      window.history.pushState({}, "", "/admin");

      render(<App />);

      await screen.findByText("Access Denied");
      expect(
        screen.getByText(
          "You do not have permission to access the admin panel.",
        ),
      ).toBeInTheDocument();
    });

    it("does not show admin link in nav for non-admin users", async () => {
      vi.stubGlobal("fetch", createGuestFetchMock());
      window.history.pushState({}, "", "/");

      render(<App />);

      // Wait for auth to resolve.
      await screen.findByTestId("avatar-button");

      // Open avatar dropdown.
      fireEvent.click(screen.getByTestId("avatar-button"));

      // Admin Panel link should not be present.
      expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    });

    it("shows Admin Panel link in avatar dropdown for admin users", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/");

      render(<App />);

      // Wait for auth to resolve.
      await screen.findByTestId("avatar-button");

      // Open avatar dropdown.
      fireEvent.click(screen.getByTestId("avatar-button"));

      expect(screen.getByText("Admin Panel")).toBeInTheDocument();
      expect(screen.getByText("Admin Panel").closest("a")).toHaveAttribute(
        "href",
        "/admin",
      );
    });
  });

  describe("Updates page", () => {
    it("renders the Updates placeholder", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin");

      render(<App />);

      await screen.findByTestId("updates-placeholder");
      expect(
        screen.getByText(
          "Coming soon -- will be connected to Replicated SDK",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Users page", () => {
    it("renders a table with all users", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/users");

      render(<App />);

      const table = await screen.findByTestId("users-table");
      expect(table).toBeInTheDocument();

      expect(screen.getByText("admin@example.com")).toBeInTheDocument();
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });

    it("renders role dropdowns and enable/disable toggles", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/users");

      render(<App />);

      await screen.findByTestId("users-table");

      // Check role selects exist.
      const roleSelect1 = screen.getByTestId("role-select-user-1");
      expect(roleSelect1).toBeInTheDocument();
      expect(roleSelect1).toHaveValue("admin");

      const roleSelect2 = screen.getByTestId("role-select-user-2");
      expect(roleSelect2).toBeInTheDocument();
      expect(roleSelect2).toHaveValue("user");

      // Check toggle buttons exist.
      expect(screen.getByTestId("toggle-enabled-user-1")).toBeInTheDocument();
      expect(screen.getByTestId("toggle-enabled-user-2")).toBeInTheDocument();
    });

    it("calls API to toggle user enabled status", async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/admin/users");

      render(<App />);

      await screen.findByTestId("users-table");

      // Click Disable on the regular user.
      fireEvent.click(screen.getByTestId("toggle-enabled-user-2"));

      await waitFor(() => {
        // Verify a PUT call was made for the user.
        const putCalls = fetchMock.mock.calls.filter(
          (call: unknown[]) =>
            String(call[0]).includes("/api/v1/admin/users/user-2") &&
            (call[1] as RequestInit)?.method === "PUT",
        );
        expect(putCalls.length).toBeGreaterThanOrEqual(1);

        const body = JSON.parse((putCalls[0][1] as RequestInit).body as string);
        expect(body.enabled).toBe(false);
      });
    });
  });

  describe("Tracks page", () => {
    it("renders a table with all tracks", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/tracks");

      render(<App />);

      const table = await screen.findByTestId("tracks-table");
      expect(table).toBeInTheDocument();

      expect(screen.getByText("My Track")).toBeInTheDocument();
      expect(screen.getByText("Other Track")).toBeInTheDocument();
      expect(screen.getByText("admin@example.com")).toBeInTheDocument();
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });

    it("shows confirmation dialog before deleting a track", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/tracks");

      render(<App />);

      await screen.findByTestId("tracks-table");

      // Click delete on the first track.
      fireEvent.click(screen.getByTestId("delete-track-track-1"));

      // Confirmation dialog should appear.
      const dialog = await screen.findByTestId("delete-confirm-dialog");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Are you sure you want to delete this track? This action cannot be undone.",
        ),
      ).toBeInTheDocument();

      // Cancel button should close the dialog.
      fireEvent.click(screen.getByTestId("cancel-delete"));
      expect(
        screen.queryByTestId("delete-confirm-dialog"),
      ).not.toBeInTheDocument();
    });

    it("calls API to delete track after confirmation", async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/admin/tracks");

      render(<App />);

      await screen.findByTestId("tracks-table");

      // Click delete on the first track.
      fireEvent.click(screen.getByTestId("delete-track-track-1"));

      // Confirm the delete.
      await screen.findByTestId("delete-confirm-dialog");
      fireEvent.click(screen.getByTestId("confirm-delete"));

      await waitFor(() => {
        const deleteCalls = fetchMock.mock.calls.filter(
          (call: unknown[]) =>
            String(call[0]).includes("/api/v1/admin/tracks/track-1") &&
            (call[1] as RequestInit)?.method === "DELETE",
        );
        expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows view and delete buttons per track", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/tracks");

      render(<App />);

      await screen.findByTestId("tracks-table");

      expect(screen.getByTestId("view-track-track-1")).toBeInTheDocument();
      expect(screen.getByTestId("delete-track-track-1")).toBeInTheDocument();
      expect(screen.getByTestId("view-track-track-2")).toBeInTheDocument();
      expect(screen.getByTestId("delete-track-track-2")).toBeInTheDocument();
    });
  });

  describe("License page", () => {
    it("renders the License placeholder", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/license");

      render(<App />);

      await screen.findByTestId("license-placeholder");
      expect(
        screen.getByText(
          "Coming soon -- will be connected to Replicated SDK",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Support page", () => {
    it("renders the Support placeholder", async () => {
      vi.stubGlobal("fetch", createFetchMock());
      window.history.pushState({}, "", "/admin/support");

      render(<App />);

      await screen.findByTestId("support-placeholder");
      expect(
        screen.getByText(
          "Coming soon -- will be connected to Replicated SDK",
        ),
      ).toBeInTheDocument();
    });
  });
});
