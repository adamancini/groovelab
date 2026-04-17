/** Placeholder page for routes that are out of scope for this story. */
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 text-center">
      <h1 className="text-text-primary text-2xl font-bold">{title}</h1>
      <p className="text-text-secondary mt-4">This section is coming soon.</p>
    </div>
  );
}
