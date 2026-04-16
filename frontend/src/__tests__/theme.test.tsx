import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

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
  document.documentElement.classList.remove("dark");
});

describe("Theme toggle", () => {
  it("defaults to dark mode", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggles to light mode and persists to localStorage", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const toggle = screen.getByLabelText("Switch to light mode");
    fireEvent.click(toggle);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("groovelab-theme")).toBe("light");
  });

  it("toggles back to dark mode", async () => {
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    const toggle = screen.getByLabelText("Switch to light mode");
    fireEvent.click(toggle);

    // Now should show the dark mode toggle
    const darkToggle = screen.getByLabelText("Switch to dark mode");
    fireEvent.click(darkToggle);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("groovelab-theme")).toBe("dark");
  });

  it("restores theme from localStorage", async () => {
    localStorage.setItem("groovelab-theme", "light");
    render(<App />);
    await screen.findByText("Welcome to Groovelab");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
