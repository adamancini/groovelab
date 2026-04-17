import { Link } from "react-router";
import { useAuth } from "../context/AuthContext";

/** Home dashboard for authenticated users, landing page for guests. */
export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-secondary animate-pulse text-lg">Loading...</p>
      </div>
    );
  }

  if (user) {
    return <AuthenticatedHome email={user.email} />;
  }

  return <GuestHome />;
}

function AuthenticatedHome({ email }: { email: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-text-primary text-3xl font-bold">
        Welcome back, {email.split("@")[0]}
      </h1>

      {/* Progress summary card (placeholder) */}
      <section
        aria-label="Progress summary"
        className="bg-elevated mt-8 rounded-lg border border-white/10 p-6"
      >
        <h2 className="text-text-primary text-lg font-semibold">Your Progress</h2>
        <p className="text-text-secondary mt-2 text-sm">
          Progress data will appear here once you start learning.
        </p>
      </section>

      {/* Quick-start buttons */}
      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          to="/learn"
          className="bg-accent-primary hover:bg-accent-primary/80 inline-flex items-center rounded-lg px-6 py-3 font-medium text-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          Start Learning
        </Link>
        <Link
          to="/play"
          className="bg-elevated text-text-primary hover:bg-elevated/80 inline-flex items-center rounded-lg border border-white/10 px-6 py-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          Open Play Mode
        </Link>
      </div>
    </div>
  );
}

function GuestHome() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-text-primary text-3xl font-bold">
        Welcome to Groovelab
      </h1>
      <p className="text-text-secondary mt-4 max-w-2xl text-lg">
        Learn music theory through interactive flashcards, build custom practice
        tracks, and explore the fretboard -- all in one place.
      </p>

      {/* Feature overview */}
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {[
          {
            title: "Learn",
            desc: "Master intervals, chords, and scales with spaced-repetition flashcards.",
            to: "/learn",
          },
          {
            title: "Play",
            desc: "Build and play custom backing tracks to sharpen your ear.",
            to: "/play",
          },
          {
            title: "Fretboard",
            desc: "Interactive fretboard reference with scale and chord overlays.",
            to: "/fretboard",
          },
        ].map((f) => (
          <Link
            key={f.to}
            to={f.to}
            className="bg-elevated rounded-lg border border-white/10 p-6 transition-colors hover:border-accent-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
          >
            <h2 className="text-text-primary text-lg font-semibold">{f.title}</h2>
            <p className="text-text-secondary mt-2 text-sm">{f.desc}</p>
          </Link>
        ))}
      </div>

      {/* Sign in prompt (non-modal) */}
      <section className="bg-elevated mt-12 rounded-lg border border-white/10 p-6 text-center">
        <p className="text-text-primary text-lg font-medium">
          Sign in to track your progress
        </p>
        <p className="text-text-secondary mt-1 text-sm">
          Your learning data stays with your account across devices.
        </p>
        <Link
          to="/auth/signin"
          className="bg-accent-primary hover:bg-accent-primary/80 mt-4 inline-flex items-center rounded-lg px-6 py-3 font-medium text-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          Sign in
        </Link>
      </section>
    </div>
  );
}
