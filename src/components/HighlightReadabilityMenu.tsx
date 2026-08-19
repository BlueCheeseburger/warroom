import React, { useState, useRef, useEffect } from 'react';
import { loadHighlightReadability, saveHighlightReadability } from '../utils/docxViewerUtils';

// The slider itself — label, track, endpoints — with no trigger/popover chrome
// of its own, so it can be dropped into either this file's standalone "⋯"
// popover or embedded inside a pane's existing ToolbarOverflowMenu (compact
// multi-pane mode) instead of adding a second "⋯" button next to it. Fully
// self-contained: reads/writes `warroom-highlight-readability` and dispatches
// HIGHLIGHT_READABILITY_CHANGED itself, so every open viewer pane picks up a
// change live without any prop wiring between them.
export function HighlightReadabilitySlider() {
  const [value, setValue] = useState(() => loadHighlightReadability());

  function onChange(v: number) {
    setValue(v);
    saveHighlightReadability(v);
  }

  return (
    <div className="px-1 py-0.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color: 'rgb(var(--ink-rgb))' }}>Highlight readability</span>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{value}%</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ accentColor: 'var(--nav-active-color, #4285F4)' }}
      />
      <div className="flex items-center justify-between text-[9.5px] mt-1" style={{ color: 'var(--nav-inactive-color)' }}>
        <span>Word's colors</span>
        <span>Muted</span>
      </div>
    </div>
  );
}

// A small "⋯" trigger, hidden alongside a doc viewer's other tools, that
// opens a popover wrapping HighlightReadabilitySlider. Only rendered when the
// pane has room for its own dedicated "⋯" (single-pane / non-compact
// toolbars) — in compact multi-pane mode, the slider is folded into the
// pane's existing ToolbarOverflowMenu instead so there's never two "⋯"
// buttons sitting side by side. Deliberately tucked away rather than a
// visible toolbar control: it's a one-time taste preference, not something
// read every time a doc opens.
export default function HighlightReadabilityMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Highlight readability"
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
        style={{
          background: open ? 'var(--nav-active-bg)' : 'transparent',
          border: 'none', cursor: 'pointer',
          color: open ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
        }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-50 rounded-xl px-3 py-2.5"
          style={{
            top: 'calc(100% + 4px)', right: 0, width: 210,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          <HighlightReadabilitySlider />
        </div>
      )}
    </div>
  );
}
