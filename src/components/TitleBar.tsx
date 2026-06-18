import React, { useState, useEffect, useRef } from 'react';
import { useApp, Theme, DebateEvent } from '../store/appStore';
import { GeminiIcon } from './GeminiPanel';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const slots = getSlots(event, level);
  const safeIdx = Math.min(slotIdx, slots.length - 1);
  const slot = slots[safeIdx];
  const display = timeLeft ?? slot.secs;

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
        if (cur <= 1) { setRunning(false); return 0; }
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
            className="absolute top-full mt-1 left-0 z-[9999] rounded-lg py-1 shadow-xl"
            style={{
              background: 'var(--bg-popover, var(--bg-sidebar))',
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

      {/* Countdown */}
      <span
        className="font-mono font-bold tabular-nums px-1"
        style={{ fontSize: 13, color: timeColor, minWidth: 38, textAlign: 'right', transition: 'color 0.25s' }}
      >
        {fmt(display)}
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
  const { mode, setMode, theme, cycleTheme, setView, chatOpen, setChatOpen, unreadCount, geminiOpen, setGeminiOpen, navHistory, navHistoryIndex, goBack, goForward } = useApp();
  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;
  const isMac = window.warroom?.platform === 'darwin';

  return (
    <div
      className="titlebar h-9 flex items-center select-none"
      style={{
        background: 'var(--bg-titlebar)',
        borderBottom: '1px solid var(--border-side)',
        paddingLeft: isMac ? 80 : 12,
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

      {/* Speech timer */}
      <SpeechTimer />

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 8px', flexShrink: 0 }} />

      {/* Right: theme / AI / chat */}
      <button
        onClick={cycleTheme}
        title={`Theme: ${THEME_LABELS[theme]} — click to cycle`}
        className="mr-1 w-6 h-6 flex items-center justify-center rounded-md transition"
        style={{ color: 'var(--titlebar-label)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <ThemeIcon theme={theme} />
      </button>

      <button
        onClick={() => setGeminiOpen(!geminiOpen)}
        title="Warroom AI"
        className="mr-1 w-6 h-6 flex items-center justify-center rounded-md transition"
        style={{ color: geminiOpen ? 'var(--nav-active-color)' : 'var(--titlebar-label)' } as any}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <GeminiIcon size={16} />
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
