import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  // Default: guest (unauthenticated).
  fetchMock.mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: "not authenticated" }),
  });
});

describe("Sign-in page", () => {
  it("renders OAuth buttons (disabled) and email/password form", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    // Navigate to sign in
    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();

    // OAuth buttons are disabled
    const googleBtn = screen.getByText("Continue with Google").closest("button");
    expect(googleBtn).toBeDisabled();
    expect(googleBtn).toHaveAttribute("title", "Google sign-in is not yet available");

    const githubBtn = screen.getByText("Continue with GitHub").closest("button");
    expect(githubBtn).toBeDisabled();
    expect(githubBtn).toHaveAttribute("title", "GitHub sign-in is not yet available");

    // Email/password form fields
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("********")).toBeInTheDocument();
  });

  it("has a link to the register page", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    const createLink = screen.getByText("Create one");
    expect(createLink.closest("a")).toHaveAttribute("href", "/auth/register");
  });

  it("shows error on failed sign-in", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    // Fill the form
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "bad@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("********"), {
      target: { value: "wrongpass" },
    });

    // Mock login failure
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "invalid credentials" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("invalid credentials");
  });

  it("redirects to home after successful sign-in", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("********"), {
      target: { value: "password123" },
    });

    // Mock successful login then /me.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: "1", email: "test@example.com", role: "user" }),
      });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Should redirect to home and show authenticated view.
    await screen.findByText("Welcome back, test");
  });

  // Regression for GRO-xrs2: Authboss returns 307 + JSON body on successful
  // login (no HTTP Location header). The frontend must treat this as success
  // and navigate away from /auth/login, not silently fail.
  it("redirects to home after 307-with-JSON login (Authboss success shape)", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("********"), {
      target: { value: "password123" },
    });

    // Authboss success: 307 with res.ok === false but a JSON success body.
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 307,
        json: () =>
          Promise.resolve({ status: "success", location: "/" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: "1", email: "test@example.com", role: "user" }),
      });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Should navigate to home and render authenticated view -- this is
    // exactly what was broken before GRO-xrs2's fix.
    await screen.findByText("Welcome back, test");
  });
});

describe("Register page", () => {
  it("renders email, password, and confirm fields", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);
    fireEvent.click(screen.getByText("Create one"));

    expect(
      screen.getByRole("heading", { name: "Create an account" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Min 8 characters")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Repeat password")).toBeInTheDocument();
  });

  it("shows error when passwords do not match", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);
    fireEvent.click(screen.getByText("Create one"));

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  });

  // Regression for GRO-xrs2: Authboss returns 307 + JSON body on successful
  // register. The Register page must navigate to "/" afterwards.
  it("redirects to home after 307-with-JSON register (Authboss success shape)", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);
    fireEvent.click(screen.getByText("Create one"));

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "password123" },
    });

    // Authboss success: 307 with res.ok === false + JSON success body.
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 307,
        json: () =>
          Promise.resolve({ status: "success", location: "/" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: "2", email: "new@example.com", role: "user" }),
      });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByText("Welcome back, new");
  });

  it("shows error when password is too short", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);
    fireEvent.click(screen.getByText("Create one"));

    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
  });
});

describe("Authenticated user avatar dropdown", () => {
  beforeEach(() => {
    // Simulate authenticated user.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: "1", email: "admin@example.com", role: "admin" }),
    });
  });

  it("shows avatar button with user initial", async () => {
    render(<App />);
    await screen.findByText("Welcome back, admin");

    const avatar = screen.getByTestId("avatar-button");
    expect(avatar).toHaveTextContent("A");
  });

  it("opens dropdown with email, Settings, Admin Panel, and Sign out", async () => {
    render(<App />);
    await screen.findByText("Welcome back, admin");

    fireEvent.click(screen.getByTestId("avatar-button"));

    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("does not show Admin Panel for non-admin users", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: "2", email: "user@example.com", role: "user" }),
    });

    render(<App />);
    await screen.findByText("Welcome back, user");

    fireEvent.click(screen.getByTestId("avatar-button"));

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
  });

  it("signs out and returns to guest view", async () => {
    render(<App />);
    await screen.findByText("Welcome back, admin");

    fireEvent.click(screen.getByTestId("avatar-button"));

    // Mock logout response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    fireEvent.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText("Welcome to Groovelab")).toBeInTheDocument();
    });
  });
});

describe("Guest home page", () => {
  it("shows feature overview cards and sign-in prompt", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    // Feature overview cards
    expect(
      screen.getByText(
        "Master intervals, chords, and scales with spaced-repetition flashcards.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Build and play custom backing tracks to sharpen your ear.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Interactive fretboard reference with scale and chord overlays.",
      ),
    ).toBeInTheDocument();

    // Non-modal sign-in prompt
    expect(
      screen.getByText("Sign in to track your progress"),
    ).toBeInTheDocument();
  });
});

describe("Authenticated home page", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: "1", email: "casey@example.com", role: "user" }),
    });
  });

  it("shows welcome message and quick-start buttons", async () => {
    render(<App />);
    await screen.findByText("Welcome back, casey");

    expect(screen.getByText("Your Progress")).toBeInTheDocument();
    expect(screen.getByText("Start Learning")).toBeInTheDocument();
    expect(screen.getByText("Open Play Mode")).toBeInTheDocument();
  });
});
