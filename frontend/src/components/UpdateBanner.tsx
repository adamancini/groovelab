import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface UpdateInfo {
  versionLabel?: string;
  isDeployable?: boolean;
}

const DISMISS_KEY = "update-banner-dismissed";

export default function UpdateBanner() {
  const { user } = useAuth();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session.
    if (sessionStorage.getItem(DISMISS_KEY) === "true") {
      setDismissed(true);
      return;
    }

    let cancelled = false;

    fetch("/api/replicated/updates", { credentials: "include" })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<UpdateInfo>;
      })
      .then((data) => {
        if (!cancelled && data && data.versionLabel) {
          setUpdate(data);
        }
      })
      .catch(() => {
        // Silently ignore -- banner is non-critical.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  if (!update || dismissed) {
    return null;
  }

  const isAdmin = user?.role === "admin";

  return (
    <div
      data-testid="update-banner"
      role="status"
      className="update-banner relative flex items-center justify-center px-4 py-2 text-sm"
      style={{
        backgroundColor: "var(--color-update-banner, #2a2a4a)",
        color: "var(--color-update-banner-text, #e8e8ff)",
      }}
    >
      {isAdmin ? (
        <span data-testid="update-banner-admin-text">
          A new version of Groovelab is available.{" "}
          <a
            href="/admin"
            className="underline font-medium hover:opacity-80"
            style={{ color: "inherit" }}
          >
            View in Admin
          </a>
        </span>
      ) : (
        <span data-testid="update-banner-user-text">
          A new version is available. Contact your administrator.
        </span>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss update banner"
        data-testid="update-banner-dismiss"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: "inherit" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
