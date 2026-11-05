import React from 'react';

/** Same geometry as the toolbar icon rendered by scripts/generate-icons.mjs. */
export default function Logo({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#3b5bf6" />
      <g fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round">
        <rect x="15.44" y="8.05" width="10.42" height="6.6" rx="3.3" transform="rotate(-45 20.65 11.35)" />
        <rect x="6.14" y="17.35" width="10.42" height="6.6" rx="3.3" transform="rotate(-45 11.35 20.65)" />
        <path d="M14 18L18 14" />
      </g>
    </svg>
  );
}
