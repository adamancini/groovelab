import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../lib/api";

export interface AuthState {
  /** null = guest, undefined = still loading */
  user: api.User | null | undefined;
  /** Sign in with email/password; throws on failure */
  signIn: (email: string, password: string) => Promise<void>;
  /** Register a new account; throws on failure */
  signUp: (email: string, password: string) => Promise<void>;
  /** Sign out the current session */
  signOut: () => Promise<void>;
  /** True while the initial /me check is in flight */
  loading: boolean;
  /** Last auth error message, if any */
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.User | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount, check if there is an existing session.
  useEffect(() => {
    let cancelled = false;
    api
      .fetchCurrentUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await api.login(email, password);
      const u = await api.fetchCurrentUser();
      setUser(u);
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : "Sign in failed";
      setError(msg);
      throw err;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await api.register(email, password);
      const u = await api.fetchCurrentUser();
      setUser(u);
    } catch (err) {
      const msg =
        err instanceof api.ApiError ? err.message : "Registration failed";
      setError(msg);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{ user, signIn, signUp, signOut, loading, error, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
