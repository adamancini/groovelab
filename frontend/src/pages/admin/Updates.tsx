import { useEffect, useState } from "react";

interface UpdateData {
  versionLabel?: string;
  isDeployable?: boolean;
}

const CURRENT_VERSION =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_APP_VERSION) ||
  "0.1.0";

export default function Updates() {
  const [update, setUpdate] = useState<UpdateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCommand, setShowCommand] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/replicated/updates", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<UpdateData>;
      })
      .then((data) => {
        if (!cancelled) setUpdate(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-primary mb-6 text-2xl font-bold">Updates</h1>
        <p className="text-secondary">Checking for updates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-primary mb-6 text-2xl font-bold">Updates</h1>
        <p className="text-secondary" data-testid="updates-error">
          Unable to check for updates. The SDK may not be available yet.
        </p>
      </div>
    );
  }

  const hasUpdate = update && update.versionLabel;

  return (
    <div>
      <h1 className="text-primary mb-6 text-2xl font-bold">Updates</h1>

      <div className="space-y-6">
        {/* Current version */}
        <div
          className="bg-surface rounded-lg border border-white/10 p-6"
          data-testid="current-version-card"
        >
          <p className="text-secondary text-sm">Current Version</p>
          <p
            className="text-primary text-lg font-mono font-semibold"
            data-testid="current-version"
          >
            v{CURRENT_VERSION}
          </p>
        </div>

        {/* Available update */}
        {hasUpdate ? (
          <div
            className="bg-surface rounded-lg border border-white/10 p-6"
            data-testid="available-update-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-secondary text-sm">Available Update</p>
                <p
                  className="text-accent-primary text-lg font-mono font-semibold"
                  data-testid="available-version"
                >
                  v{update.versionLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCommand((prev) => !prev)}
                className="bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                data-testid="apply-update-button"
              >
                Apply Update
              </button>
            </div>

            {showCommand && (
              <div
                className="mt-4 rounded-lg bg-black/20 p-4"
                data-testid="upgrade-command"
              >
                <p className="text-secondary mb-2 text-xs">
                  Run the following command to upgrade:
                </p>
                <code className="text-primary block break-all font-mono text-sm">
                  helm upgrade groovelab oci://registry.replicated.com/groovelab/groovelab
                  --version {update.versionLabel}
                </code>
              </div>
            )}
          </div>
        ) : (
          <div
            className="bg-surface rounded-lg border border-white/10 p-6"
            data-testid="no-updates-card"
          >
            <p className="text-secondary text-sm">
              You are running the latest version. No updates available.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
