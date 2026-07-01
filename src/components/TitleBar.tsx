import React, { useState, useEffect, useRef } from 'react';
import { useApp, Theme, DebateEvent } from '../store/appStore';
import { AIProviderIcon } from './GeminiPanel';
import { PixelCoinFace, PixelCoinIcon } from './PixelCoin';

// ─── Speech timer data ────────────────────────────────────────────────────────

const TIMER_LEVEL_KEY = 'warroom-timer-level';

interface SpeechSlot { label: string; secs: number; }
type PolicyLevel = 'hs' | 'clg';

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

function getSlots(event: DebateEvent, level: PolicyLevel): SpeechSlot[] {
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
  const { event } = useApp();
  const [level, setLevel] = useState<PolicyLevel>(
    () => (localStorage.getItem(TIMER_LEVEL_KEY) as PolicyLevel) ?? 'hs',
  );
  const [slotIdx, setSlotIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<'min' | 'sec' | null>(null);
  const [editVal, setEditVal] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const slots = getSlots(event, level);
  const safeIdx = Math.min(slotIdx, slots.length - 1);
  const slot = slots[safeIdx];
  const display = timeLeft ?? slot.secs;

  // Refs so the tick's setInterval closure can read the current slot position
  // without being re-created (and without going stale) on every slot change.
  const safeIdxRef = useRef(safeIdx);
  safeIdxRef.current = safeIdx;
  const slotsLenRef = useRef(slots.length);
  slotsLenRef.current = slots.length;

  // Reset on event or level change
  useEffect(() => {
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

  function selectSlot(i: number) {
    setSlotIdx(i);
    setRunning(false);
    setTimeLeft(null);
    setDropdownOpen(false);
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

  useEffect(() => {
    function handleControl(e: Event) {
      const { action, speech, level: lvl } = (e as CustomEvent).detail ?? {};
      if (action === 'start') {
        if (display === 0) setTimeLeft(null);
        setRunning(true);
      } else if (action === 'pause') {
        setRunning(false);
      } else if (action === 'toggle') {
        if (display === 0) { setTimeLeft(null); setRunning(true); }
        else setRunning((v) => !v);
      } else if (action === 'reset') {
        setRunning(false);
        setTimeLeft(null);
      } else if (action === 'select' && speech) {
        const needle = String(speech).toLowerCase();
        const idx = slots.findIndex((s) => s.label.toLowerCase().includes(needle) || needle.includes(s.label.toLowerCase()));
        if (idx >= 0) selectSlot(idx);
      } else if (action === 'level' && (lvl === 'hs' || lvl === 'clg')) {
        localStorage.setItem(TIMER_LEVEL_KEY, lvl);
        setLevel(lvl);
      }
    }
    window.addEventListener('warroom-timer-control', handleControl);
    return () => window.removeEventListener('warroom-timer-control', handleControl);
  }, [slots, display]);


  const overtime = display === 0;
  const urgent = display <= 30 && display > 0;
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

      {/* Speech type dropdown trigger */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 rounded transition"
          style={{
            background: dropdownOpen ? 'var(--nav-hover-bg)' : 'transparent',
            color: 'var(--titlebar-label)',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
            border: 'none', cursor: 'pointer', minWidth: 90, ...nd,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={(e) => { if (!dropdownOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {slot.label}
          <svg width="7" height="7" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
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
            <rect x="1"  y="1" width="2.8" height="8" rx="0.8" />
            <rect x="6.2" y="1" width="2.8" height="8" rx="0.8" />
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
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
        <PixelCoinIcon size={15} />
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
                <PixelCoinFace variant="heads" size={60} />
              </div>
              {/* Tails face */}
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <PixelCoinFace variant="tails" size={60} />
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
  const { mode, setMode, setView, chatOpen, setChatOpen, unreadCount, geminiOpen, setGeminiOpen, navHistory, navHistoryIndex, goBack, goForward, event } = useApp();
  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;
  const isMac = window.warroom?.platform === 'darwin';
  const isWin = window.warroom?.platform === 'win32';
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai' | 'anthropic' | 'grok'>('gemini');

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

      {/* Center: mode toggle */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--mode-toggle-bg)' }}>
          <ModeBtn label="Prep"  active={mode === 'prep'}  onClick={() => setMode('prep')} />
          <ModeBtn label="Round" active={mode === 'round'} onClick={() => setMode('round')} danger />
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

      {/* Coin flip — PF only (the coin toss that decides sides/speaking order) */}
      {event === 'pf' && (
        <>
          <CoinFlip />
          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />
        </>
      )}

      {/* Speech timer */}
      <SpeechTimer />

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

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

function ModeBtn({ label, active, onClick, danger }: {
  label: string; active: boolean; onClick: () => void; danger?: boolean;
}) {
  const activeStyle = danger
    ? { background: '#b3261e', color: '#ffffff' }
    : { background: 'var(--bg-card)', color: 'var(--nav-active-color)' };
  return (
    <button
      onClick={onClick}
      className="px-4 py-1 text-[11px] uppercase tracking-wider rounded-md transition font-bold"
      style={{
        ...(active ? activeStyle : { background: 'transparent', color: 'var(--nav-inactive-color)' }),
        boxShadow: active ? (danger ? '0 1px 4px rgba(179,38,30,0.3)' : 'var(--nav-active-shadow)') : 'none',
      }}
    >
      {label}
    </button>
  );
}
