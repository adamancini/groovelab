import { useState, type ReactNode } from "react";

interface EntitlementGateProps {
  enabled: boolean;
  tooltip: string;
  children: ReactNode;
}

/**
 * EntitlementGate wraps children with a visual gate when the entitlement is
 * disabled. The children are rendered with reduced opacity, a lock icon
 * overlay, and a tooltip on hover explaining the restriction.
 *
 * When enabled, children are rendered normally with no visual modifications.
 */
export default function EntitlementGate({
  enabled,
  tooltip,
  children,
}: EntitlementGateProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (enabled) {
    return <>{children}</>;
  }

  return (
    <div
      className="relative inline-block"
      data-testid="entitlement-gate"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
    >
      {/* Dimmed children */}
      <div className="pointer-events-none select-none opacity-50" aria-hidden="true">
        {children}
      </div>

      {/* Lock icon overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        data-testid="entitlement-lock-icon"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="text-text-secondary h-6 w-6 drop-shadow"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          role="tooltip"
          data-testid="entitlement-tooltip"
          className="bg-elevated text-text-primary absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg border border-white/10 px-3 py-2 text-xs shadow-lg whitespace-nowrap"
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}
