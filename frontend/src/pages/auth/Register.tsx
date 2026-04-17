import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";

export default function Register() {
  const { signUp, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (password !== confirm) {
      setLocalError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      navigate("/", { replace: true });
    } catch {
      // error surfaced via AuthContext
    } finally {
      setSubmitting(false);
    }
  }

  const displayError = localError ?? error;

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-text-primary text-center text-2xl font-bold">
        Create an account
      </h1>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex flex-col gap-4"
        noValidate
      >
        {displayError && (
          <p role="alert" className="text-accent-wrong text-sm">
            {displayError}
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary text-sm">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-elevated text-text-primary rounded-lg border border-white/10 px-4 py-2 placeholder:text-white/30 focus:border-accent-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            placeholder="you@example.com"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary text-sm">Password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-elevated text-text-primary rounded-lg border border-white/10 px-4 py-2 placeholder:text-white/30 focus:border-accent-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            placeholder="Min 8 characters"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary text-sm">Confirm password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-elevated text-text-primary rounded-lg border border-white/10 px-4 py-2 placeholder:text-white/30 focus:border-accent-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            placeholder="Repeat password"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="bg-accent-primary hover:bg-accent-primary/80 mt-2 rounded-lg px-4 py-3 font-medium text-black transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="text-text-secondary mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link
          to="/auth/signin"
          className="text-accent-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary rounded"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
