import { useState, useCallback } from "react";

interface BundleEntry {
  id: string;
  timestamp: string;
  status: "generating" | "ready" | "uploading" | "uploaded" | "error";
}

export default function Support() {
  const [bundles, setBundles] = useState<BundleEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateBundle = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/replicated/support-bundle", {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { id?: string; bundleId?: string };
      const bundleId = data.id || data.bundleId || `bundle-${Date.now()}`;

      setBundles((prev) => [
        {
          id: bundleId,
          timestamp: new Date().toISOString(),
          status: "ready",
        },
        ...prev,
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const uploadBundle = useCallback(async (bundleId: string) => {
    setBundles((prev) =>
      prev.map((b) =>
        b.id === bundleId ? { ...b, status: "uploading" as const } : b,
      ),
    );

    try {
      const res = await fetch(`/api/replicated/support-bundle/${bundleId}/upload`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setBundles((prev) =>
        prev.map((b) =>
          b.id === bundleId ? { ...b, status: "uploaded" as const } : b,
        ),
      );
    } catch {
      setBundles((prev) =>
        prev.map((b) =>
          b.id === bundleId ? { ...b, status: "error" as const } : b,
        ),
      );
    }
  }, []);

  const downloadBundle = useCallback((bundleId: string) => {
    const link = document.createElement("a");
    link.href = `/api/replicated/support-bundle/${bundleId}/download`;
    link.download = `support-bundle-${bundleId}.tar.gz`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  return (
    <div>
      <h1 className="text-primary mb-6 text-2xl font-bold">Support</h1>

      <div className="space-y-6">
        {/* Generate bundle section */}
        <div
          className="bg-surface rounded-lg border border-white/10 p-6"
          data-testid="support-generate-section"
        >
          <h2 className="text-primary mb-2 text-lg font-semibold">
            Support Bundle
          </h2>
          <p className="text-secondary mb-4 text-sm">
            Generate a support bundle to collect diagnostic information about
            your installation. You can download it locally or upload it to the
            Vendor Portal for analysis.
          </p>

          <button
            type="button"
            onClick={generateBundle}
            disabled={isGenerating}
            className="bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            data-testid="generate-bundle-button"
          >
            {isGenerating ? "Generating..." : "Generate Support Bundle"}
          </button>

          {/* Progress indicator */}
          {isGenerating && (
            <div
              className="mt-4 flex items-center gap-2"
              data-testid="bundle-progress"
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              <span className="text-secondary text-sm">
                Collecting diagnostic information...
              </span>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div
              className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3"
              data-testid="bundle-error"
            >
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Bundle history */}
        <div
          className="bg-surface rounded-lg border border-white/10 p-6"
          data-testid="bundle-history"
        >
          <h2 className="text-primary mb-4 text-lg font-semibold">
            Bundle History
          </h2>

          {bundles.length === 0 ? (
            <p className="text-secondary text-sm" data-testid="no-bundles">
              No support bundles have been generated yet.
            </p>
          ) : (
            <div className="space-y-3">
              {bundles.map((bundle) => (
                <div
                  key={bundle.id}
                  className="flex items-center justify-between rounded-lg border border-white/5 px-4 py-3"
                  data-testid={`bundle-entry-${bundle.id}`}
                >
                  <div>
                    <p
                      className="text-primary font-mono text-sm"
                      data-testid={`bundle-id-${bundle.id}`}
                    >
                      {bundle.id}
                    </p>
                    <p
                      className="text-secondary text-xs"
                      data-testid={`bundle-timestamp-${bundle.id}`}
                    >
                      {new Date(bundle.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Download locally -- always available */}
                    <button
                      type="button"
                      onClick={() => downloadBundle(bundle.id)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/5"
                      data-testid={`download-bundle-${bundle.id}`}
                    >
                      Download
                    </button>

                    {/* Upload to Vendor Portal */}
                    <button
                      type="button"
                      onClick={() => uploadBundle(bundle.id)}
                      disabled={
                        bundle.status === "uploading" ||
                        bundle.status === "uploaded"
                      }
                      className="bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      data-testid={`upload-bundle-${bundle.id}`}
                    >
                      {bundle.status === "uploading"
                        ? "Uploading..."
                        : bundle.status === "uploaded"
                          ? "Uploaded"
                          : "Upload"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
