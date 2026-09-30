export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-emerald-600" />
      <path
        d="M8 9.2A1.2 1.2 0 0 1 9.2 8h7.3a2 2 0 0 1 1.4.6l6.5 6.5a2 2 0 0 1 0 2.8l-7.1 7.1a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1-.6-1.4z"
        className="fill-white"
      />
      <circle cx="12.6" cy="12.6" r="1.9" className="fill-emerald-600" />
    </svg>
  );
}
