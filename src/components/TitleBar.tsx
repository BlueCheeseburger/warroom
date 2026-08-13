import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp, Theme, DebateEvent } from '../store/appStore';
import { AIProviderIcon } from './GeminiPanel';
import { CoinFace, CoinIcon } from './Coin';
import { useMenuA11y } from '../hooks/useMenuA11y';
import { ChatAvatar } from './Avatar';
import {
  QuickChatPin, getQuickChatPins, isQuickChatEnabled, onChatPrefsChange,
  readQuickChatBinding, specForQuickChatPin, eventMatchesQuickChatBinding,
} from '../lib/chatPrefs';

function QuickChatBar() {
  const { setChatOpen, setPendingChatTarget } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [pins, setPins] = useState<QuickChatPin[]>([]);

  useEffect(() => {
    function load() { setEnabled(isQuickChatEnabled()); setPins(getQuickChatPins()); }
    load();
    return onChatPrefsChange(load);
  }, []);

  function open(pin: QuickChatPin) {
    setChatOpen(true);
    setPendingChatTarget(pin.kind === 'team' ? { kind: 'team' } : { kind: 'dm', channelId: pin.id });
  }

  useEffect(() => {
    if (!enabled || pins.length === 0) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea)$/i.test(target.tagName)) return;
      for (const pin of pins) {
        if (!pin.shortcutId) continue;
        const binding = readQuickChatBinding(pin.shortcutId);
        if (binding && eventMatchesQuickChatBinding(e, binding)) { e.preventDefault(); open(pin); return; }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, pins]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || pins.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mr-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
      {pins.map((pin) => (
        <button
          key={pin.id}
          title={pin.name}
          onClick={() => open(pin)}
          className="w-6 h-6 flex items-center justify-center rounded-md transition"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <ChatAvatar spec={specForQuickChatPin(pin)} size={20} />
        </button>
      ))}
    </div>
  );
}

// ─── Speech timer data ────────────────────────────────────────────────────────

export const TIMER_LEVEL_KEY = 'warroom-timer-level';
const TIMER_SESSION_KEY = 'warroom-timer-session';

interface TimerSession { event: string; level: PolicyLevel; slotIdx: number; timeLeft: number | null; }

function loadTimerSession(event: string, level: PolicyLevel): { slotIdx: number; timeLeft: number | null } | null {
  try {
    const raw = localStorage.getItem(TIMER_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as TimerSession;
    // Only resume a timer that actually belongs to the current event/level —
    // a stale slot index from PF wouldn't mean anything against Policy's slots.
    if (s.event !== event || s.level !== level) return null;
    return { slotIdx: s.slotIdx, timeLeft: s.timeLeft };
  } catch { return null; }
}

function saveTimerSession(s: TimerSession) {
  try { localStorage.setItem(TIMER_SESSION_KEY, JSON.stringify(s)); } catch {}
}

export interface SpeechSlot { label: string; secs: number; }
export type PolicyLevel = 'hs' | 'clg';

const SLOTS: Record<'policy-hs' | 'policy-clg' | 'pf' | 'ld', SpeechSlot[]> = {
  'policy-hs': [
    { label: 'Constructive', secs: 480 },
    { label: 'Cross-Ex',     secs: 180 },
    { label: 'Rebuttal',     secs: 300 },
  ],
  'policy-clg': [
    { label: 'Constructive', secs: 540 },
    { label: 'Cross-Ex',     secs: 180 },
    { label: 'Rebuttal',     secs: 360 },
  ],
  'pf': [
    { label: 'Constructive', secs: 240 },
    { label: 'Crossfire',    secs: 180 },
    { label: 'Rebuttal',     secs: 240 },
    { label: 'Summary',      secs: 180 },
    { label: 'Grand CX',     secs: 180 },
    { label: 'Final Focus',  secs: 120 },
  ],
  'ld': [
    { label: 'AC',  secs: 360 },
    { label: 'CX',  secs: 180 },
    { label: 'NC',  secs: 420 },
    { label: '1AR', secs: 240 },
    { label: 'NR',  secs: 360 },
    { label: '2AR', secs: 180 },
  ],
};

export function getSlots(event: DebateEvent, level: PolicyLevel): SpeechSlot[] {
  if (event === 'policy') return level === 'clg' ? SLOTS['policy-clg'] : SLOTS['policy-hs'];
  if (event === 'pf') return SLOTS['pf'];
  return SLOTS['ld'];
}

function fmt(secs: number): string {
  const m = Math.floor(Math.abs(secs) / 60);
  const s = Math.abs(secs) % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── SpeechTimer ──────────────────────────────────────────────────────────────

function SpeechTimer() {
  const { event, timerWarningSecs, view, db } = useApp();
  const [level, setLevel] = useState<PolicyLevel>(
    () => (localStorage.getItem(TIMER_LEVEL_KEY) as PolicyLevel) ?? 'hs',
  );

  // Non-standard/off-the-clock tournaments can override individual speech
  // lengths (Settings for this live on the Tournament itself, edited from
  // TournamentView) — apply them only while actually viewing that tournament
  // or one of its rounds, so switching to unrelated prep silently goes back
  // to the normal defaults instead of a stale override following you around.
  const activeTournament = view.kind === 'tournament'
    ? db.tournaments[view.tournamentId]
    : view.kind === 'round'
    ? db.tournaments[db.rounds[view.roundId]?.tournamentId ?? '']
    : undefined;
  const customTimes = activeTournament?.customSpeechTimes;
  // Session restore: resume the exact slot + remaining time from before the
  // app closed (cleanly or not — a laptop battery dying mid-speech shouldn't
  // reset the clock). Deliberately does NOT restore `running` — it always
  // reopens paused, so the timer never silently starts counting down again
  // before the user has actually looked at the screen.
  const restoredSession = useMemo(() => loadTimerSession(event, level), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [slotIdx, setSlotIdx] = useState(restoredSession?.slotIdx ?? 0);
  const [timeLeft, setTimeLeft] = useState<number | null>(restoredSession?.timeLeft ?? null);
  const [running, setRunning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<'min' | 'sec' | null>(null);
  const [editVal, setEditVal] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const baseSlots = getSlots(event, level);
  // Memoized so `slots` keeps a stable reference across renders when there's
  // no override (or the override didn't change) — the handleControl effect
  // below depends on [slots] and assumes that stability (see its comment).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slots = useMemo(() => (
    customTimes
      ? baseSlots.map((s) => (
          Number.isFinite(customTimes[s.label]) && customTimes[s.label] > 0
            ? { ...s, secs: Math.round(customTimes[s.label]) }
            : s
        ))
      : baseSlots
  ), [baseSlots, JSON.stringify(customTimes)]);
  const safeIdx = Math.min(slotIdx, slots.length - 1);
  const slot = slots[safeIdx];
  const display = timeLeft ?? slot.secs;

  // Refs so the tick's setInterval closure can read the current slot position
  // without being re-created (and without going stale) on every slot change.
  const safeIdxRef = useRef(safeIdx);
  safeIdxRef.current = safeIdx;
  const slotsLenRef = useRef(slots.length);
  slotsLenRef.current = slots.length;
  // Current displayed seconds, read by the agent-control effect without putting
  // `display` in its deps (which would re-register the window listener every tick).
  const displayRef = useRef(display);
  displayRef.current = display;
  const runningRef = useRef(running);
  runningRef.current = running;

  // Reset on event or level change — but not on mount, which would otherwise
  // immediately wipe out the slot/time just restored above from a prior
  // session (this effect's deps fire on mount too, same as any other).
  const skipFirstReset = useRef(true);
  useEffect(() => {
    if (skipFirstReset.current) { skipFirstReset.current = false; return; }
    setRunning(false);
    setTimeLeft(null);
    setSlotIdx(0);
  }, [event, level]);

  // Tick
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const cur = prev ?? slot.secs;
        if (cur <= 1) {
          setRunning(false);
          // Auto-advance to the next speech slot (if any), leaving it paused at
          // its full time. Brief 1.2s hold on 0:00 so the end is visible first.
          const idx = safeIdxRef.current;
          if (idx < slotsLenRef.current - 1) {
            setTimeout(() => { setSlotIdx(idx + 1); setTimeLeft(null); setRunning(false); }, 1200);
          }
          return 0;
        }
        return cur - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, slot.secs]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function down(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    }
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [dropdownOpen]);
  useMenuA11y(dropdownOpen, dropdownRef, () => setDropdownOpen(false));

  function selectSlot(i: number) {
    setSlotIdx(i);
    setRunning(false);
    setTimeLeft(null);
    setDropdownOpen(false);
  }

  // Advances to the next speech in this event's list, wrapping around. Not
  // exposed as in-app UI (the title bar keeps its dropdown) — used by the
  // macOS Touch Bar's speech-type button, which cycles rather than opening a
  // menu (no equivalent widget on that hardware).
  //
  // Reads safeIdxRef/slotsLenRef, not safeIdx/slots.length directly: this is
  // called from handleControl, whose effect has deps [slots] — and `slots`
  // keeps the same array reference across re-renders (getSlots() returns a
  // stable module-level SLOTS[...] array, not a new one), so that effect only
  // re-runs when the event/level actually changes, not on every slot advance.
  // Reading safeIdx directly here would close over whatever it was when the
  // effect last ran (often mount, i.e. always 0) — so every press after the
  // first would "cycle" from that same stale index and appear to do nothing
  // whenever it recomputed the same target slot.
  function cycleSlot() {
    selectSlot((safeIdxRef.current + 1) % slotsLenRef.current);
  }

  function toggleRun() {
    if (display === 0) { setTimeLeft(null); setRunning(true); }
    else setRunning((v) => !v);
  }

  function reset() { setRunning(false); setTimeLeft(null); }

  function startEdit(part: 'min' | 'sec') {
    if (running) return;
    const cur = timeLeft ?? slot.secs;
    const val = part === 'min'
      ? String(Math.floor(cur / 60))
      : String(cur % 60).padStart(2, '0');
    setEditingPart(part);
    setEditVal(val);
    setTimeout(() => { editInputRef.current?.select(); }, 0);
  }

  function commitEdit() {
    if (!editingPart) return;
    const cur = timeLeft ?? slot.secs;
    const parsed = parseInt(editVal, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      const mins = editingPart === 'min' ? parsed : Math.floor(cur / 60);
      const secs = editingPart === 'sec' ? Math.min(parsed, 59) : cur % 60;
      setTimeLeft(mins * 60 + secs);
    }
    setEditingPart(null);
    setEditVal('');
  }

  useEffect(() => {
    if (!editingPart) return;
    function onMouseDown(e: MouseEvent) {
      if (editInputRef.current && !editInputRef.current.contains(e.target as Node)) {
        commitEdit();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [editingPart, editVal]);

  function toggleLevel() {
    const next: PolicyLevel = level === 'hs' ? 'clg' : 'hs';
    localStorage.setItem(TIMER_LEVEL_KEY, next);
    setLevel(next);
  }

  // Persist for session restore — fires every tick while running (not just on
  // pause), since a battery dying mid-speech needs the remaining time saved
  // continuously, not only at moments the user explicitly stopped the clock.
  useEffect(() => {
    saveTimerSession({ event, level, slotIdx, timeLeft });
  }, [event, level, slotIdx, timeLeft]);

  // Expose state for agent reads and listen for agent control events
  useEffect(() => {
    (window as any).__warroomTimerState = {
      speech: slot.label,
      timeLeft: timeLeft ?? slot.secs,
      running,
      event,
      level,
      slots: slots.map((s) => s.label),
    };
  });

  // Push live state to the main process so the macOS Touch Bar's speech/time
  // labels stay in sync — it has no way to read renderer state itself.
  useEffect(() => {
    window.warroom?.touchBar?.updateTimer({
      speechLabel: slot.label,
      display: `${Math.floor(display / 60)}:${String(display % 60).padStart(2, '0')}`,
      running,
    });
  }, [slot.label, display, running]);

  useEffect(() => {
    function handleControl(e: Event) {
      const { action, speech, level: lvl, deltaSeconds } = (e as CustomEvent).detail ?? {};
      if (action === 'start') {
        if (displayRef.current === 0) setTimeLeft(null);
        setRunning(true);
      } else if (action === 'pause') {
        setRunning(false);
      } else if (action === 'toggle') {
        if (displayRef.current === 0) { setTimeLeft(null); setRunning(true); }
        else setRunning((v) => !v);
      } else if (action === 'reset') {
        setRunning(false);
        setTimeLeft(null);
      } else if (action === 'select' && speech) {
        const needle = String(speech).toLowerCase();
        const idx = slots.findIndex((s) => s.label.toLowerCase().includes(needle) || needle.includes(s.label.toLowerCase()));
        if (idx >= 0) selectSlot(idx);
      } else if (action === 'cycle') {
        // Touch Bar: no dropdown widget there, so its speech button cycles instead.
        cycleSlot();
      } else if (action === 'nudge' && typeof deltaSeconds === 'number') {
        // Touch Bar: no text entry there, so custom time is set via +/- steps
        // instead of typing — same "editing pauses a running timer" rule.
        if (runningRef.current) setRunning(false);
        setTimeLeft(Math.max(0, displayRef.current + deltaSeconds));
      } else if (action === 'level' && (lvl === 'hs' || lvl === 'clg')) {
        localStorage.setItem(TIMER_LEVEL_KEY, lvl);
        setLevel(lvl);
      }
    }
    window.addEventListener('warroom-timer-control', handleControl);
    return () => window.removeEventListener('warroom-timer-control', handleControl);
  }, [slots]); // `display` is read via displayRef so it needn't re-register each tick


  const overtime = display === 0;
  const urgent = display <= timerWarningSecs && display > 0;
  const timeColor = overtime
    ? '#ef4444'
    : urgent ? '#f59e0b'
    : running ? 'var(--nav-active-color)'
    : 'var(--titlebar-label)';

  const nd: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as any;

  return (
    <div className="flex items-center gap-0.5" style={{ ...nd, position: 'relative' }}>

      {/* HS / CLG pill — policy only */}
      {event === 'policy' && (
        <button
          onClick={toggleLevel}
          title={level === 'hs' ? 'HS Policy — click for College (NDT/CEDA)' : 'College — click for HS'}
          className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 transition"
          style={{
            background: 'var(--mode-toggle-bg)',
            color: 'var(--titlebar-label)',
            border: 'none', cursor: 'pointer',
            minWidth: 34, textAlign: 'center', ...nd,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--titlebar-label)'; }}
        >
          {level === 'hs' ? 'HS' : 'CLG'}
        </button>
      )}

      {/* Speech type dropdown trigger — fixed width sized to the longest
          possible label ("Constructive") so switching labels never shifts
          the coin/nav-arrows to its left (see CLAUDE.md "Top bar / fixed-
          position UI"). Label itself truncates rather than growing. */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center justify-between gap-1 px-2 py-0.5 rounded transition"
          style={{
            background: dropdownOpen ? 'var(--nav-hover-bg)' : 'transparent',
            color: 'var(--titlebar-label)',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
            border: 'none', cursor: 'pointer', width: 124, ...nd,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={(e) => { if (!dropdownOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.label}</span>
          {/* viewBox matches the rendered box 1:1 (was an 8×6 viewBox squeezed
              into a 7×7 square, which letterboxed to 7×5.25 and rendered soft). */}
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="1 1 4 5 7 1" />
          </svg>
        </button>

        {dropdownOpen && (
          <div
            className="glass-popover absolute top-full mt-1 left-0 z-[9999] rounded-lg py-1 shadow-xl"
            style={{
              border: '1px solid var(--border-subtle)',
              minWidth: 148,
            }}
          >
            {slots.map((s, i) => (
              <button
                key={`${s.label}-${i}`}
                onClick={() => selectSlot(i)}
                className="w-full text-left flex items-center justify-between px-3 py-1.5 text-xs transition"
                style={{
                  background: i === safeIdx ? 'var(--nav-active-bg)' : 'transparent',
                  color: i === safeIdx ? 'var(--nav-active-color)' : 'var(--ink)',
                  border: 'none', cursor: 'pointer', ...nd,
                }}
                onMouseEnter={(e) => { if (i !== safeIdx) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                onMouseLeave={(e) => { if (i !== safeIdx) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span>{s.label}</span>
                <span className="font-mono ml-3" style={{ opacity: 0.45, fontSize: 11 }}>{fmt(s.secs)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Countdown — click minutes or seconds to edit when paused */}
      <span
        className="font-mono font-bold tabular-nums px-1 flex items-center justify-end"
        style={{ fontSize: 13, color: timeColor, width: 44, flexShrink: 0, transition: 'color 0.25s', gap: 0 }}
      >
        {editingPart === 'min' ? (
          <input
            ref={editInputRef}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitEdit(); } else if (e.key === 'Escape') { setEditingPart(null); } }}
            className="font-mono font-bold tabular-nums bg-transparent outline-none border-b text-center"
            style={{ fontSize: 13, color: timeColor, width: 22, borderColor: 'var(--accent)', ...nd }}
            type="text"
            inputMode="numeric"
          />
        ) : (
          <span
            onClick={() => startEdit('min')}
            title={running ? undefined : 'Click to edit minutes'}
            style={{ cursor: running ? 'default' : 'text' }}
          >
            {String(Math.floor(display / 60))}
          </span>
        )}
        <span>:</span>
        {editingPart === 'sec' ? (
          <input
            ref={editInputRef}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitEdit(); } else if (e.key === 'Escape') { setEditingPart(null); } }}
            className="font-mono font-bold tabular-nums bg-transparent outline-none border-b text-center"
            style={{ fontSize: 13, color: timeColor, width: 22, borderColor: 'var(--accent)', ...nd }}
            type="text"
            inputMode="numeric"
          />
        ) : (
          <span
            onClick={() => startEdit('sec')}
            title={running ? undefined : 'Click to edit seconds'}
            style={{ cursor: running ? 'default' : 'text' }}
          >
            {String(display % 60).padStart(2, '0')}
          </span>
        )}
      </span>

      {/* Play / Pause */}
      <button
        onClick={toggleRun}
        title={running ? 'Pause' : 'Start'}
        className="w-6 h-6 flex items-center justify-center rounded transition"
        style={{ color: running ? 'var(--nav-active-color)' : 'var(--titlebar-label)', background: 'transparent', border: 'none', cursor: 'pointer', ...nd }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {running ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            {/* Whole-pixel widths/positions — a 2.8-wide bar starting at x=1
                ends at 3.8 and renders one soft edge; 3-wide from x=1 does not. */}
            <rect x="1" y="1" width="3" height="8" rx="0.8" />
            <rect x="6" y="1" width="3" height="8" rx="0.8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1L9 5L2 9V1Z" />
          </svg>
        )}
      </button>

      {/* Reset */}
      <button
        onClick={reset}
        title="Reset"
        className="w-6 h-6 flex items-center justify-center rounded transition"
        style={{ color: 'var(--titlebar-label)', background: 'transparent', border: 'none', cursor: 'pointer', ...nd }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Viewbox padded 1 unit on every side (13x13 mapped into a 12px box)
            — the arrowhead's stroke reaches y=1-0.8=0.2 in the unpadded
            0-12 box, and SVG's default overflow:hidden root clips that top
            sliver. The pad gives the stroke headroom without changing the
            path's own coordinates or the rendered icon's apparent size. */}
        <svg width="12" height="12" viewBox="-0.5 -0.5 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 2.5A5 5 0 1 0 11 6" />
          <polyline points="10.5 1 10.5 4 7.5 4" />
        </svg>
      </button>
    </div>
  );
}

// ─── Coin flip ────────────────────────────────────────────────────────────────
// A quick, genuinely random coin flip (Math.random) with a real 3D flip
// animation — CSS rotateY on a two-sided coin, backface-visibility hidden so
// only one face shows at a time. Spins a random number of extra full turns
// each flip so it never looks mechanical, then settles on the pre-committed
// random face.

type CoinFace = 'heads' | 'tails';

function CoinFlip() {
  const [open, setOpen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState<CoinFace | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useMenuA11y(open, dropdownRef, () => setOpen(false));

  // Touch Bar "flip" button: open the popover and run a real flip, visible
  // on-screen (the animation itself can't live on the Touch Bar — see the
  // "why can't we do the 3D animation" discussion).
  useEffect(() => {
    function onExternalFlip(e: Event) {
      if ((e as CustomEvent).detail?.action !== 'flip') return;
      setOpen(true);
      // If the popover wasn't already open, the coin div is mounting for the
      // first time this tick — calling flip() synchronously would set its
      // rotateY transform on that very first paint, and CSS transitions only
      // animate a *change* to an already-painted element, so it'd just snap
      // to the final angle with no spin. Deferring past the mount's paint
      // (double rAF: one for the commit, one for the browser to register the
      // resting transform) gives the next transform a prior value to animate
      // from. Already-open popovers still flip instantly for real interactivity.
      requestAnimationFrame(() => requestAnimationFrame(flip));
    }
    window.addEventListener('warroom-coinflip-control', onExternalFlip);
    return () => window.removeEventListener('warroom-coinflip-control', onExternalFlip);
  }); // no deps: `flip` reads `flipping` fresh each render, same as its own button's onClick

  function flip() {
    if (flipping) return;
    setFlipping(true);
    setResult(null);
    const landsOnTails = Math.random() < 0.5;
    // A handful of extra full spins (4-7) on top of whatever rotation we're
    // already at, landing on 0deg (heads face-out) or 180deg (tails face-out)
    // mod 360 — always spinning forward so it never snaps backward.
    const extraSpins = 4 + Math.floor(Math.random() * 4);
    setRotation((prev) => {
      const currentMod = ((prev % 360) + 360) % 360;
      const targetMod = landsOnTails ? 180 : 0;
      const delta = ((targetMod - currentMod) + 360) % 360;
      return prev + extraSpins * 360 + delta;
    });
    window.setTimeout(() => {
      setResult(landsOnTails ? 'tails' : 'heads');
      setFlipping(false);
    }, 900);
  }

  const nd: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as any;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', ...nd }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Flip a coin"
        className="w-6 h-6 flex items-center justify-center rounded-md transition"
        style={{
          background: open ? 'var(--nav-hover-bg)' : 'transparent',
          color: 'var(--titlebar-label)',
          border: 'none', cursor: 'pointer', ...nd,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <CoinIcon size={15} />
      </button>

      {open && (
        <div
          className="glass-popover absolute top-full mt-1 right-0 z-[9999] rounded-lg shadow-xl flex flex-col items-center"
          style={{ border: '1px solid var(--border-subtle)', width: 148, padding: '14px 12px 12px' }}
        >
          <div style={{ perspective: 500 }}>
            <div
              onClick={flip}
              role="button"
              title="Click to flip"
              style={{
                width: 60, height: 60, position: 'relative',
                transformStyle: 'preserve-3d',
                transform: `rotateY(${rotation}deg)`,
                transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                cursor: flipping ? 'default' : 'pointer',
              }}
            >
              {/* Heads face */}
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
                <CoinFace variant="heads" size={60} />
              </div>
              {/* Tails face */}
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <CoinFace variant="tails" size={60} />
              </div>
            </div>
          </div>

          <div style={{ height: 16, marginTop: 8, fontSize: 11, fontWeight: 600, color: 'var(--ink)', textTransform: 'capitalize' }}>
            {flipping ? '' : result ?? ' '}
          </div>

          <button
            onClick={flip}
            disabled={flipping}
            className="text-xs font-medium rounded-md px-3 py-1 mt-1 transition"
            style={{
              background: flipping ? 'var(--bg-btn)' : 'var(--accent)',
              color: flipping ? 'var(--nav-inactive-color)' : '#fff',
              border: 'none', cursor: flipping ? 'default' : 'pointer', ...nd,
            }}
          >
            {flipping ? 'Flipping…' : result ? 'Flip again' : 'Flip'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Theme icon ───────────────────────────────────────────────────────────────

const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light:  'Light',
  dark:   'Dark',
};

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2"  x2="12" y2="5"  />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2"  y1="12" x2="5"  y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"  />
        <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" />
        <line x1="4.22"  y1="19.78" x2="6.34"  y2="17.66" />
        <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"  />
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Nav arrows ───────────────────────────────────────────────────────────────

function NavArrow({ direction, enabled, onClick, title }: {
  direction: 'back' | 'forward'; enabled: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={title}
      className="w-6 h-6 flex items-center justify-center rounded-md transition mr-0.5"
      style={{
        color: enabled ? 'var(--titlebar-label)' : 'var(--nav-inactive-color)',
        opacity: enabled ? 1 : 0.35,
        cursor: enabled ? 'pointer' : 'default',
        WebkitAppRegion: 'no-drag',
      } as any}
      onMouseEnter={(e) => { if (enabled) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'back'
          ? <polyline points="15 18 9 12 15 6" />
          : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

// ─── TitleBar ─────────────────────────────────────────────────────────────────

export default function TitleBar() {
  const { setView, chatOpen, setChatOpen, unreadCount, geminiOpen, setGeminiOpen, navHistory, navHistoryIndex, goBack, goForward } = useApp();
  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;
  const isMac = window.warroom?.platform === 'darwin';
  const isWin = window.warroom?.platform === 'win32';
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai' | 'anthropic' | 'grok' | 'lmstudio'>('gemini');

  useEffect(() => {
    window.warroom?.storage.read('app_settings').then((s: any) => {
      if (s?.apiProvider) setAiProvider(s.apiProvider);
    }).catch(() => {});
    function onSettingsChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.apiProvider !== undefined) setAiProvider(detail.apiProvider);
    }
    window.addEventListener('warroom-settings-change', onSettingsChange);
    return () => window.removeEventListener('warroom-settings-change', onSettingsChange);
  }, []);

  return (
    <div
      className="titlebar glass-titlebar h-9 flex items-center select-none"
      style={{
        borderBottom: '1px solid var(--border-side)',
        paddingLeft: isMac ? 80 : 12,
        // Windows draws the min/max/close caption buttons over the top-right
        // (~140px). Reserve that width so the timer, AI, and chat controls
        // aren't hidden underneath them. Prefer the exact Window Controls
        // Overlay width when available, but never reserve less than 140px.
        paddingRight: isWin
          ? 'max(140px, calc(100vw - env(titlebar-area-width, 100vw)))'
          : undefined,
      }}
    >
      {/* Left: wordmark + nav arrows */}
      <button
        className="text-[11px] tracking-[0.2em] font-bold mr-2 transition"
        style={{ color: 'var(--titlebar-label)', background: 'transparent', border: 'none', cursor: 'pointer', WebkitAppRegion: 'no-drag' } as any}
        onClick={() => setView({ kind: 'home' })}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-active-color)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--titlebar-label)'; }}
        title="Home"
      >
        WARROOM
      </button>
      <NavArrow direction="back"    enabled={canGoBack}    onClick={goBack}    title="Go back" />
      <NavArrow direction="forward" enabled={canGoForward} onClick={goForward} title="Go forward" />

      {/* Spacer — pushes the coin/timer/AI/chat cluster to the right, same as
          when the Prep/Round toggle used to sit here. */}
      <div className="flex-1" />

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

      {/* Coin flip */}
      <CoinFlip />

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

      {/* Speech timer */}
      <SpeechTimer />

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

      {/* Quick chat pins */}
      <QuickChatBar />

      {/* Right: AI / chat */}
      <button
        onClick={() => setGeminiOpen(!geminiOpen)}
        title="Warroom AI"
        className="mr-1 w-6 h-6 flex items-center justify-center rounded-md transition"
        style={{ color: geminiOpen ? 'var(--nav-active-color)' : 'var(--titlebar-label)' } as any}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <AIProviderIcon provider={aiProvider} size={16} />
      </button>

      <button
        onClick={() => setChatOpen(!chatOpen)}
        title="Team chat"
        className="relative mr-3 w-6 h-6 flex items-center justify-center rounded-md transition"
        style={{ color: chatOpen ? 'var(--nav-active-color)' : 'var(--titlebar-label)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <ChatIcon />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: '#b3261e', padding: '0 2px' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

