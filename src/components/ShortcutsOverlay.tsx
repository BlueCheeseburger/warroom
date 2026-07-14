import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { isShortcutDisabled, toggleShortcutDisabled } from '../lib/shortcutPrefs';

// ─── Keyboard shortcuts overlay (⌘/ on Mac, Ctrl+/ on Windows) ────────────────
// The full, organized list of every keyboard shortcut in the app. Keep this in
// sync with reality — grep for `metaKey || e.ctrlKey` across src/ before adding
// or removing an entry, and update electron/skills/user_manual.md's "Keyboard
// Shortcuts" section + Documentation.tsx to match (same discipline as the docs
// sync rule for everything else).
//
// Disabling: a handful of standalone command-style shortcuts (not core typing/
// navigation conventions) can be turned off per-user via localStorage
// (shortcutPrefs.ts). The toggle is intentionally understated — no checkbox,
// no visible chrome — clicking directly on a disableable shortcut's key badge
// toggles it, shown only by a hover state and a struck-through/dimmed key once
// off. Every consuming keydown handler checks isShortcutDisabled(id) before
// acting. ⌘/ itself is disableable, but the Settings → Keyboard Shortcuts
// button always opens this overlay regardless, so it's never a dead end.

const isMac = window.warroom?.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

interface Shortcut { id?: string; keys: string[]; label: string; }
interface Group { title: string; shortcuts: Shortcut[]; }

const GROUPS: Group[] = [
  {
    title: 'Global',
    shortcuts: [
      { id: 'global-search', keys: [`${MOD}K`], label: 'Open global search' },
      { id: 'shortcuts-overlay', keys: [`${MOD}/`], label: 'Open this shortcuts list' },
      { keys: ['Esc'], label: 'Close the current modal, popover, or overlay' },
    ],
  },
  {
    title: 'Find on a page',
    shortcuts: [
      { id: 'find-page', keys: [`${MOD}F`], label: 'Find on this page — Documentation, User Manual, a speech doc, or a flow' },
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
      { id: 'flow-bold', keys: [`${MOD}B`], label: 'Bold' },
      { id: 'flow-italic', keys: [`${MOD}I`], label: 'Italic' },
      { id: 'flow-underline', keys: [`${MOD}U`], label: 'Underline' },
      { id: 'flow-strike', keys: [`${MOD}⇧X`], label: 'Strikethrough' },
      { id: 'flow-highlight', keys: [`${MOD}⇧H`], label: 'Highlight' },
      { id: 'flow-undo', keys: [`${MOD}Z`], label: 'Undo' },
      { id: 'flow-redo', keys: [`${MOD}⇧Z`], label: 'Redo (or ' + MOD + 'Y)' },
      { id: 'flow-link', keys: [`${MOD}L`], label: 'Draw an arrow — press once in the source cell, again in the target cell' },
      { keys: ['Tab', '⇧Tab'], label: 'Move to the next / previous column' },
      { keys: ['Enter'], label: 'Move down a row' },
      { keys: ['⇧Enter'], label: 'New line within a cell' },
      { keys: ['←↑→↓'], label: 'Move to the neighbouring cell in that direction' },
      { id: 'flow-move-row', keys: [`${MOD}↑`, `${MOD}↓`], label: "Move this cell's content up / down a row" },
      { id: 'flow-sheet-switch', keys: [`${MOD}1`, '…', `${MOD}8`], label: 'Jump to sheet 1–8 (' + MOD + '9 jumps to the last sheet)' },
      { id: 'flow-sheet-new', keys: [`${MOD}T`], label: 'New sheet' },
      { keys: ['Esc'], label: 'Cancel arrow-draw mode, or close find' },
    ],
  },
];

function Kbd({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <kbd
      onClick={onClick}
      title={onClick ? (disabled ? 'Disabled — click to re-enable' : 'Click to disable') : undefined}
      className="text-xs font-mono px-1.5 py-0.5 rounded transition"
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border-med)',
        boxShadow: disabled ? 'none' : 'inset 0 -1.5px 0 var(--border-med)',
        color: 'var(--ink)',
        cursor: onClick ? 'pointer' : 'default',
        opacity: disabled ? 0.4 : 1,
        textDecoration: disabled ? 'line-through' : 'none',
      }}
    >
      {children}
    </kbd>
  );
}

function matchShortcut(s: Shortcut, q: string): boolean {
  if (!q) return true;
  const hay = (s.label + ' ' + s.keys.join(' ')).toLowerCase();
  return hay.includes(q);
}

export default function ShortcutsOverlay() {
  const { shortcutsOpen, setShortcutsOpen } = useApp();
  const [query, setQuery] = useState('');
  // Bumped on every toggle to force disabled-state re-reads from localStorage.
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() { setShortcutsOpen(false); }

  useEffect(() => {
    if (!shortcutsOpen) return;
    setQuery('');
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [shortcutsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shortcutsOpen) return null;

  const q = query.trim().toLowerCase();
  const filteredGroups = GROUPS
    .map((group) => ({ ...group, shortcuts: group.shortcuts.filter((s) => matchShortcut(s, q)) }))
    .filter((group) => group.shortcuts.length > 0);

  return (
    <>
      <div
        onClick={close}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998, animation: 'lm-fade 120ms ease-out' }}
      />
      <div
        style={{
          position: 'fixed',
          top: 90,
          left: '50%',
          width: '100%',
          maxWidth: 560,
          maxHeight: 'calc(100vh - 160px)',
          zIndex: 9999,
          transform: 'translateX(-50%)',
          background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          border: '1px solid var(--border-med)',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'wr-palette-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5"
          style={{ height: 44, flexShrink: 0 }}
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

        <div
          className="flex items-center gap-2 px-5"
          style={{ height: 40, borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
            stroke="var(--nav-inactive-color)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}>
            <circle cx="8.5" cy="8.5" r="5" />
            <path d="M12.5 12.5L17 17" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter shortcuts…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'inherit' }}
          />
        </div>

        <div className="overflow-y-auto scroll-thin px-2.5 py-3" style={{ flex: 1 }}>
          {filteredGroups.length === 0 && (
            <div className="text-xs text-center py-8" style={{ color: 'var(--nav-inactive-color)' }}>
              No shortcuts match "{query.trim()}"
            </div>
          )}
          {filteredGroups.map((group) => (
            <div key={group.title} className="mb-4 last:mb-1">
              <div className="label px-2.5 mb-1" style={{ fontSize: 10 }}>{group.title}</div>
              <div>
                {group.shortcuts.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 px-2.5 py-1.5 rounded-lg transition"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span className="text-xs" style={{ color: 'var(--ink)', opacity: 0.8 }}>{s.label}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => (
                        <Kbd
                          key={j}
                          disabled={s.id ? isShortcutDisabled(s.id) : false}
                          onClick={s.id ? () => { toggleShortcutDisabled(s.id!); setTick((t) => t + 1); } : undefined}
                        >
                          {k}
                        </Kbd>
                      ))}
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
