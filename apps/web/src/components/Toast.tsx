export function Toast({ message, kind }: { message: string | null; kind: 'success' | 'error' }) {
  if (!message) return null;
  return (
    <div
      className={`toast toast--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {message}
    </div>
  );
}
