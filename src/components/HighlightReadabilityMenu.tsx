import React, { useState, useRef, useEffect } from 'react';
import { loadHighlightReadability, saveHighlightReadability } from '../utils/docxViewerUtils';

// A small "⋯" trigger, hidden alongside a doc viewer's other tools, that
// opens a one-slider popover for how much to soften Word's raw highlighter
// colors (0 = exact original colors, 100 = fully muted/pastel). Fully
// self-contained — reads/writes `warroom-highlight-readability` and
// dispatches HIGHLIGHT_READABILITY_CHANGED itself, so every open viewer pane
// picks up a change live without any prop wiring between them. Deliberately
// tucked away rather than a visible toolbar control: it's a one-time taste
// preference, not something read every time a doc opens.
export default function HighlightReadabilityMenu() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => loadHighlightReadability());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function onChange(v: number) {
    setValue(v);
    saveHighlightReadability(v);
  }

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
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold" style={{ color: 'rgb(var(--ink-rgb))' }}>Highlight readability</span>
            <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{value}%</span>
          </div>
          <input
            type="range" min={0} max={100} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: 'var(--nav-active-color, #4285F4)' }}
          />
          <div className="flex items-center justify-between text-[9.5px] mt-1" style={{ color: 'var(--nav-inactive-color)' }}>
            <span>Word's colors</span>
            <span>Muted</span>
          </div>
        </div>
      )}
    </div>
  );
}
