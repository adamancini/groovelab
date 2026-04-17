/** Skip-to-content link for screen readers and keyboard users. */
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="bg-accent-primary text-text-primary sr-only rounded px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]"
    >
      Skip to content
    </a>
  );
}
