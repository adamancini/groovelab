import { useEffect, useState } from "react";

interface Entitlement {
  field: string;
  value: string;
}

interface LicenseData {
  license_id: string;
  license_type: string;
  expires_at: string;
  entitlements?: Entitlement[];
}

type HealthStatus = "green" | "yellow" | "red";

function getHealthStatus(expiresAt: string): HealthStatus {
  if (!expiresAt) return "green";

  const now = new Date();
  const expires = new Date(expiresAt);

  if (isNaN(expires.getTime())) return "red";

  const daysUntilExpiry = Math.floor(
    (expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilExpiry < 0) return "red";
  if (daysUntilExpiry < 30) return "yellow";
  return "green";
}

function healthColor(status: HealthStatus): string {
  switch (status) {
    case "green":
      return "#22c55e";
    case "yellow":
      return "#eab308";
    case "red":
      return "#ef4444";
  }
}

function healthLabel(status: HealthStatus): string {
  switch (status) {
    case "green":
      return "Active";
    case "yellow":
      return "Expiring Soon";
    case "red":
      return "Expired";
  }
}

export default function License() {
  const [license, setLicense] = useState<LicenseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/replicated/license", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LicenseData>;
      })
      .then((data) => {
        if (!cancelled) setLicense(data);
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
        <h1 className="text-text-primary mb-6 text-2xl font-bold">License</h1>
        <p className="text-text-secondary">Loading license information...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-text-primary mb-6 text-2xl font-bold">License</h1>
        <p className="text-text-secondary" data-testid="license-error">
          Unable to load license information. The SDK may not be available yet.
        </p>
      </div>
    );
  }

  if (!license) {
    return (
      <div>
        <h1 className="text-text-primary mb-6 text-2xl font-bold">License</h1>
        <p className="text-text-secondary">No license data available.</p>
      </div>
    );
  }

  const health = getHealthStatus(license.expires_at);

  return (
    <div>
      <h1 className="text-text-primary mb-6 text-2xl font-bold">License</h1>

      <div className="space-y-6">
        {/* License details */}
        <div
          className="bg-surface rounded-lg border border-white/10 p-6"
          data-testid="license-details"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-text-secondary text-sm">License ID</p>
              <p
                className="text-text-primary font-mono text-sm"
                data-testid="license-id"
              >
                {license.license_id}
              </p>
            </div>
            <div>
              <p className="text-text-secondary text-sm">Type</p>
              <p className="text-text-primary text-sm capitalize" data-testid="license-type">
                {license.license_type}
              </p>
            </div>
            <div>
              <p className="text-text-secondary text-sm">Expires</p>
              <p className="text-text-primary text-sm" data-testid="license-expiry">
                {license.expires_at
                  ? new Date(license.expires_at).toLocaleDateString()
                  : "Never"}
              </p>
            </div>
            <div>
              <p className="text-text-secondary text-sm">Status</p>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: healthColor(health) }}
                  data-testid="license-health-indicator"
                  aria-label={`License health: ${healthLabel(health)}`}
                />
                <p className="text-text-primary text-sm">{healthLabel(health)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Entitlements */}
        <div
          className="bg-surface rounded-lg border border-white/10 p-6"
          data-testid="license-entitlements"
        >
          <h2 className="text-text-primary mb-4 text-lg font-semibold">
            Entitlements
          </h2>
          {license.entitlements && license.entitlements.length > 0 ? (
            <div className="space-y-2">
              {license.entitlements.map((ent) => (
                <div
                  key={ent.field}
                  className="flex items-center justify-between rounded border border-white/5 px-4 py-2"
                  data-testid={`entitlement-${ent.field}`}
                >
                  <span className="text-text-primary text-sm font-mono">
                    {ent.field}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      ent.value === "true" ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {ent.value === "true" ? "Enabled" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-secondary text-sm">
              No entitlements configured.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
