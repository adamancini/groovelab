import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

// Mock fetch to simulate unauthenticated (guest) state by default.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "not authenticated" }),
    }),
  );
  localStorage.clear();
});

describe("Navigation", () => {
  it("renders all primary nav links", async () => {
    render(<App />);

    // Wait for loading to finish (AuthContext fetches /me on mount).
    await screen.findByText("Welcome to Groovelab");

    // Scope to the <nav> element to avoid matching feature cards on the guest home page.
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Home")).toBeInTheDocument();
    expect(within(nav).getByText("Learn")).toBeInTheDocument();
    expect(within(nav).getByText("Play")).toBeInTheDocument();
    expect(within(nav).getByText("Fretboard")).toBeInTheDocument();
  });

  it("renders the GL logo link", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const logo = screen.getByText("GL");
    expect(logo).toBeInTheDocument();
    expect(logo.closest("a")).toHaveAttribute("href", "/");
  });

  it("shows Sign in link for guests (no avatar dropdown)", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    // The nav should show a "Sign in" link (in the nav bar area).
    const signInLinks = screen.getAllByText("Sign in");
    // At least one in the nav
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    expect(signInLinks[0].closest("a")).toHaveAttribute(
      "href",
      "/auth/signin",
    );
  });

  it("navigates to sign-in page when Sign in is clicked", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    // Click the nav bar sign-in link (first one).
    const signInLinks = screen.getAllByText("Sign in");
    fireEvent.click(signInLinks[0]);

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("navigates between pages via nav links", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    // Use the nav-scoped links to avoid matching feature cards on the home page.
    const nav = screen.getByRole("navigation");

    fireEvent.click(within(nav).getByText("Learn"));
    expect(
      screen.getByRole("heading", { name: "Learn" }),
    ).toBeInTheDocument();

    fireEvent.click(within(nav).getByText("Play"));
    expect(
      screen.getByRole("heading", { name: "Play" }),
    ).toBeInTheDocument();

    fireEvent.click(within(nav).getByText("Fretboard"));
    expect(
      screen.getByRole("heading", { name: "Fretboard" }),
    ).toBeInTheDocument();

    fireEvent.click(within(nav).getByText("Home"));
    expect(screen.getByText("Welcome to Groovelab")).toBeInTheDocument();
  });

  it("has a skip-to-content link", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const skip = screen.getByText("Skip to content");
    expect(skip).toBeInTheDocument();
    expect(skip).toHaveAttribute("href", "#main-content");
  });

  it("has a main element with the correct id", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    expect(document.getElementById("main-content")).toBeInTheDocument();
    expect(document.getElementById("main-content")?.tagName).toBe("MAIN");
  });
});
