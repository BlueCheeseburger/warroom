import React from 'react';

const DELAYS = [0, 150, 300];

/** Three bouncing dots — use inline inside buttons or small spaces. */
export function Dots({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`}>
      {DELAYS.map((delay, i) => (
        <span
          key={i}
          className="block w-[3px] h-[3px] rounded-full bg-current"
          style={{ animation: `dot-wave 1.2s ease-in-out ${delay}ms infinite` }}
        />
      ))}
    </span>
  );
}

/** Arc SVG spinner — cleaner replacement for the old circle/path combo. */
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.12" />
      <path
        d="M12 2a10 10 0 0 1 7.07 2.93"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Pencil edit icon */
export function EditIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** Trash delete icon */
export function TrashIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/** Full-panel loading state — centered dots + shimmering label. */
export function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[200px]">
      <div className="flex items-end gap-1.5">
        {DELAYS.map((delay, i) => (
          <span
            key={i}
            className="block w-2 h-2 rounded-full bg-ink/25"
            style={{ animation: `dot-wave 1.2s ease-in-out ${delay}ms infinite` }}
          />
        ))}
      </div>
      <p
        className="text-sm text-ink/40 tracking-wide select-none"
        style={{ animation: 'shimmer-text 2.4s ease-in-out infinite' }}
      >
        {message}
      </p>
    </div>
  );
}
