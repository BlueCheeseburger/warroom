import React, { useEffect } from 'react';
import { useApp } from '../store/appStore';

// ─── Keyboard shortcuts overlay (⌘/ on Mac, Ctrl+/ on Windows) ────────────────
// The full, organized list of every keyboard shortcut in the app. Keep this in
// sync with reality — grep for `metaKey || e.ctrlKey` across src/ before adding
// or removing an entry, and update electron/skills/user_manual.md's "Keyboard
// Shortcuts" section + Documentation.tsx to match (same discipline as the docs
// sync rule for everything else).

const isMac = window.warroom?.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

interface Shortcut { keys: string[]; label: string; }
interface Group { title: string; shortcuts: Shortcut[]; }

const GROUPS: Group[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: [`${MOD}K`], label: 'Open global search' },
      { keys: [`${MOD}/`], label: 'Open this shortcuts list' },
      { keys: ['Esc'], label: 'Close the current modal, popover, or overlay' },
    ],
  },
  {
    title: 'Find on a page',
    shortcuts: [
      { keys: [`${MOD}F`], label: 'Find on this page — Documentation, User Manual, a speech doc, or a flow' },
      { keys: ['Enter', '⇧Enter'], label: 'Next / previous match' },
    ],
  },
  {
    title: 'AI panel & team chat',
    shortcuts: [
      { keys: ['Enter'], label: 'Send message' },
      { keys: ['⇧Enter'], label: 'New line' },
      { keys: ['@'], label: 'Open the mention picker to attach context' },
      { keys: ['Esc'], label: 'Close the mention picker or attach menu' },
    ],
  },
  {
    title: 'Flow editor',
    shortcuts: [
      { keys: [`${MOD}B`], label: 'Bold' },
      { keys: [`${MOD}I`], label: 'Italic' },
      { keys: [`${MOD}U`], label: 'Underline' },
      { keys: [`${MOD}⇧X`], label: 'Strikethrough' },
      { keys: [`${MOD}Z`], label: 'Undo' },
      { keys: [`${MOD}⇧Z`], label: 'Redo (or ' + MOD + 'Y)' },
      { keys: [`${MOD}L`], label: 'Draw an arrow — press once in the source cell, again in the target cell' },
      { keys: ['Tab', '⇧Tab'], label: 'Move to the next / previous column' },
      { keys: ['Enter'], label: 'Move down a row' },
      { keys: ['⇧Enter'], label: 'New line within a cell' },
      { keys: ['←↑→↓'], label: "Move between cells from a cell's edge" },
      { keys: ['⌥↑', '⌥↓'], label: "Move this cell's content up / down a row" },
      { keys: ['Esc'], label: 'Cancel arrow-draw mode, or close find' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="text-xs font-mono px-1.5 py-0.5 rounded"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border-med)', color: 'var(--ink)' }}
    >
      {children}
    </kbd>
  );
}

export default function ShortcutsOverlay() {
  const { shortcutsOpen, setShortcutsOpen } = useApp();

  function close() { setShortcutsOpen(false); }

  useEffect(() => {
    if (!shortcutsOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shortcutsOpen) return null;

  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998 }} />
      <div
        style={{
          position: 'fixed',
          top: 90,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 560,
          maxHeight: 'calc(100vh - 160px)',
          zIndex: 9999,
          background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          border: '1px solid var(--border-med)',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5"
          style={{ height: 48, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Keyboard shortcuts</span>
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center rounded-full text-ink/35 hover:text-ink/70 hover:bg-black/8 transition text-base"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto scroll-thin px-5 py-4" style={{ flex: 1 }}>
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <div className="label mb-2" style={{ fontSize: 10 }}>{group.title}</div>
              <div className="space-y-1.5">
                {group.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <span className="text-xs" style={{ color: 'var(--ink)', opacity: 0.8 }}>{s.label}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => <Kbd key={j}>{k}</Kbd>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
