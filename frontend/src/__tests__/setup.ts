import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Node 22+ exposes a built-in localStorage global that requires
// --localstorage-file to function.  In the jsdom test environment the
// built-in takes precedence over jsdom's implementation, breaking
// localStorage.clear() and friends.  Stub it with an in-memory shim so
// tests can use localStorage normally.
const store: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = String(value);
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
};

vi.stubGlobal("localStorage", localStorageMock);

// Reset the browser URL to "/" before each test so that BrowserRouter
// always starts on the Home route regardless of navigation in prior tests.
import { beforeEach } from "vitest";

beforeEach(() => {
  window.history.pushState({}, "", "/");
});
