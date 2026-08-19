import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import {
  isShortcutDisabled, toggleShortcutDisabled,
  DEFAULT_BINDINGS, getEffectiveBinding, hasCustomBinding, resetBinding,
  setCustomBinding, isBindingValid, bindingFromEvent, formatBinding, findConflict,
} from '../lib/shortcutPrefs';

// ─── Keyboard shortcuts overlay (⌘/ on Mac, Ctrl+/ on Windows) ────────────────
// The full, organized list of every keyboard shortcut in the app. Keep this in
// sync with reality — grep for `metaKey || e.ctrlKey` across src/ before adding
// or removing an entry, and update electron/skills/user_manual.md's "Keyboard
// Shortcuts" section + Documentation.tsx to match (same discipline as the docs
// sync rule for everything else).
//
// Disabling and rebinding are deliberately different gestures so they never
// fight for the same control:
// - Disabling: click a shortcut's key badge itself — hovering previews a
//   faint strikethrough, and a disabled badge settles into a red tint + red
//   strikethrough. Works for any shortcut with a stable `id`.
// - Rebinding: click the pencil icon to a shortcut's left (only shown for
//   shortcuts with a DEFAULT_BINDINGS entry in shortcutPrefs.ts) to start
//   "recording" — press any key with ⌘/Ctrl or ⌥ held; Esc cancels. A few
//   multi-key groups (sheet-switching ⌘1-9, the ⌘↑/⌘↓ row-move pair) are
//   disableable but not individually rebindable, since they don't reduce to
//   one combo.
// Every consuming keydown handler calls matchesShortcut(e, id) so a rebind or
// disable takes effect everywhere that id is wired up. ⌘/ itself is
// disableable/rebindable, but the Settings → Keyboard Shortcuts button always
// opens this overlay regardless, so it's never a dead end.

const isMac = window.warroom?.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

interface Shortcut { id?: string; keys: string[]; label: string; }
interface Group { title: string; shortcuts: Shortcut[]; }

export const GROUPS: Group[] = [
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
    // Comments UI is currently hidden (COMMENTS_UI_ENABLED in
    // SpeechDocViewer.tsx) — the shortcut stays registered in
    // shortcutPrefs.ts, just not listed here while it's inert.
    title: 'Speech doc viewer',
    shortcuts: [],
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
      { id: 'flow-redo', keys: [`${MOD}⇧Z`], label: 'Redo' },
      { id: 'flow-link', keys: [`${MOD}L`], label: 'Draw an arrow — press once in the source cell, again in the target cell' },
      { keys: ['Tab', '⇧Tab'], label: 'Move to the next / previous column' },
      { keys: ['Enter'], label: 'Move down a row' },
      { keys: ['⇧Enter'], label: 'New line within a cell' },
      { keys: ['←', '→'], label: 'Move the cursor through the text' },
      { keys: ['↑', '↓'], label: 'Move a line within the cell — or to the cell above / below when there is no line left' },
      { id: 'flow-move-row', keys: [`${MOD}↑`, `${MOD}↓`], label: "Move this cell's content up / down a row" },
      { id: 'flow-sheet-switch', keys: [`${MOD}1`, '…', `${MOD}8`], label: 'Jump to sheet 1–8 (' + MOD + '9 jumps to the last sheet)' },
      { id: 'flow-sheet-new', keys: [`${MOD}T`], label: 'New sheet' },
      { keys: ['Esc'], label: 'Cancel arrow-draw mode, or close find' },
    ],
  },
];

// A shortcut's key badge. Clicking it toggles disable — a faint strikethrough
// previews on hover, and settles into a full red tint + red strikethrough once
// disabled, so "this click disables it" reads before you commit to the click.
// Rebinding is a *different* gesture entirely (the pencil button to the row's
// left) so the two actions never fight for the same control.
function Kbd({ children, disabled, clickable, onClick, title }: {
  children: React.ReactNode; disabled?: boolean; clickable?: boolean; onClick?: () => void; title?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const Tag: any = clickable ? 'button' : 'kbd';
  return (
    <Tag
      onClick={clickable ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      className="relative text-xs font-mono px-1.5 py-0.5 rounded transition"
      style={{
        background: disabled ? 'color-mix(in srgb, var(--neg, #ef4444) 16%, var(--bg-input))' : 'var(--bg-input)',
        border: `1px solid ${disabled ? 'var(--neg, #ef4444)' : 'var(--border-med)'}`,
        boxShadow: disabled ? 'none' : 'inset 0 -1.5px 0 var(--border-med)',
        color: disabled ? 'var(--neg, #ef4444)' : 'var(--ink)',
        cursor: clickable ? 'pointer' : 'default',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {children}
      {clickable && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 2, right: 2, top: '50%', height: 1,
            background: 'currentColor',
            opacity: disabled ? 1 : (hovered ? 0.35 : 0),
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            transition: 'opacity 120ms ease',
          }}
        />
      )}
    </Tag>
  );
}

// Pencil button to a shortcut's left — the sole entry point into rebinding,
// kept visually and functionally separate from the disable click on the badge.
function EditBinding({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Change this shortcut"
      className="w-5 h-5 flex items-center justify-center rounded transition shrink-0"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', opacity: 0.55 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.55'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.2 3.3a1.5 1.5 0 0 1 2.1 2.1L6.5 15.2l-3 .8.8-3z" />
      </svg>
    </button>
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState('');
  // Bumped on every disable/rebind to force effective-binding re-reads from localStorage.
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() { setShortcutsOpen(false); }
  function bump() { setTick((t) => t + 1); }

  useEffect(() => {
    // The component never unmounts (it self-guards on shortcutsOpen), so this
    // must fire on CLOSE too — otherwise closing mid-recording (backdrop click,
    // the × button — anything other than Escape) would leave the capture-phase
    // recording listener below attached forever, eating every keystroke app-wide.
    if (!shortcutsOpen) { setRecordingId(null); return; }
    setQuery('');
    setRecordingId(null);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [shortcutsOpen]);

  // Esc closes the overlay — unless a rebind is being recorded, in which case
  // Esc cancels the recording instead (handled by the recorder listener below).
  useEffect(() => {
    if (!shortcutsOpen || recordingId) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, recordingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // While recording, capture the next keydown as the new binding.
  useEffect(() => {
    if (!recordingId) return;
    const id = recordingId;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecordingId(null); return; }
      // Ignore bare modifier presses — wait for the actual combo.
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
      const binding = bindingFromEvent(e);
      if (!isBindingValid(binding)) {
        setRecordError('Must include ⌘/Ctrl or ⌥');
        return;
      }
      const conflict = findConflict(id, binding);
      if (conflict) {
        const label = GROUPS.flatMap((g) => g.shortcuts).find((s) => s.id === conflict)?.label ?? conflict;
        setRecordError(`Already used by "${label}"`);
        return;
      }
      setCustomBinding(id, binding);
      setRecordingId(null);
      setRecordError('');
      bump();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recordingId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                {group.shortcuts.map((s, i) => {
                  const rebindable = !!(s.id && DEFAULT_BINDINGS[s.id]);
                  const disabled = s.id ? isShortcutDisabled(s.id) : false;
                  const recording = recordingId === s.id;
                  const customized = rebindable && s.id ? hasCustomBinding(s.id) : false;
                  const displayKeys = rebindable && s.id
                    ? [formatBinding(getEffectiveBinding(s.id)!, MOD)]
                    : s.keys;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg transition"
                      style={{ background: 'transparent' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; if (s.id) setHoveredId(s.id); }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; setHoveredId(null); }}
                    >
                      <span className="text-xs" style={{ color: 'var(--ink)', opacity: 0.8 }}>{s.label}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {recording ? (
                          <span
                            className="text-xs font-mono px-1.5 py-0.5 rounded"
                            style={{ border: '1px dashed var(--accent)', color: 'var(--accent)' }}
                          >
                            {recordError || 'Press new keys…'}
                          </span>
                        ) : (
                          <>
                            {customized && (
                              <button
                                onClick={() => { if (s.id) { resetBinding(s.id); bump(); } }}
                                title="Reset to default"
                                className="text-[10px] transition"
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', opacity: hoveredId === s.id ? 0.7 : 0 }}
                              >
                                reset
                              </button>
                            )}
                            {rebindable && (
                              <EditBinding onClick={() => { setRecordError(''); setRecordingId(s.id!); }} />
                            )}
                            {displayKeys.map((k, j) => (
                              <Kbd
                                key={j}
                                disabled={disabled}
                                clickable={!!s.id}
                                title={s.id ? (disabled ? 'Disabled — click to re-enable' : 'Click to disable') : undefined}
                                onClick={() => { if (s.id) { toggleShortcutDisabled(s.id); bump(); } }}
                              >
                                {k}
                              </Kbd>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
