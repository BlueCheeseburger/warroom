import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';
import { Case, Round, Side, Tournament } from '../types';
import { GeminiIcon } from './GeminiPanel';
import ImpactCalcPanel from './ImpactCalcPanel';

type TournStatus = 'live' | 'upcoming' | 'past';

function daysUntil(startStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(startStr + 'T00:00:00');
  return Math.max(1, Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

function tournamentStatus(t: Tournament): TournStatus {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startStr = t.start ?? t.date;
  const endStr   = t.end   ?? t.start ?? t.date;
  // Parse as local midnight to avoid timezone shifts
  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T23:59:59');
  if (today >= start && today <= end) return 'live';
  if (start > today) return 'upcoming';
  return 'past';
}

// ─── Speech-doc side detection ──────────────────────────────────────────────────
// Imported speech docs live in localStorage recents (not db.cases), so the home
// Cases tile has to fold them in itself. We classify each as aff or neg by tallying
// the speech labels that show up in its pockets/hats: aff speeches are 1AC/2AC/1AR/
// 2AR, neg are 1NC/2NC/1NR/2NR. The side with more labels wins; a tie or no labels
// falls back to the filename. Results are cached so we only extract each doc once.
const SPEECH_RECENTS_KEY = 'warroom-speech-doc-recents';
const SPEECH_SIDES_KEY = 'warroom-speech-doc-sides';

type DocSide = 'aff' | 'neg' | 'unknown';

function classifyDocSide(text: string, name: string): DocSide {
  const hay = text.toLowerCase();
  const tally = (terms: string[]) =>
    terms.reduce((n, t) => n + (hay.match(new RegExp(`\\b${t}\\b`, 'g'))?.length ?? 0), 0);
  const aff = tally(['1ac', '2ac', '1ar', '2ar']);
  const neg = tally(['1nc', '2nc', '1nr', '2nr']);
  if (aff > neg) return 'aff';
  if (neg > aff) return 'neg';
  // Tie or no speech labels — fall back to the filename's own side marker.
  const tokens = name.toLowerCase().split(/[^a-z]+/);
  if (tokens.some((t) => t === 'aff' || t === 'affirmative')) return 'aff';
  if (tokens.some((t) => t === 'neg' || t === 'negative')) return 'neg';
  return 'unknown';
}

function useSpeechDocCounts(): { count: number; aff: number; neg: number } {
  const [sides, setSides] = useState<Record<string, DocSide>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let recents: { path: string; name: string }[] = [];
      try { recents = JSON.parse(localStorage.getItem(SPEECH_RECENTS_KEY) ?? '[]'); } catch { /* ignore */ }
      let cache: Record<string, DocSide> = {};
      try { cache = JSON.parse(localStorage.getItem(SPEECH_SIDES_KEY) ?? '{}'); } catch { /* ignore */ }

      const next: Record<string, DocSide> = {};
      for (const r of recents) {
        if (cache[r.path]) { next[r.path] = cache[r.path]; continue; }
        try {
          const res = await (window.warroom as any).speechdoc.extract(r.path);
          next[r.path] = classifyDocSide(res?.ok ? (res.data?.full ?? '') : '', r.name);
        } catch { next[r.path] = classifyDocSide('', r.name); }
      }
      if (cancelled) return;
      localStorage.setItem(SPEECH_SIDES_KEY, JSON.stringify(next)); // also prunes stale paths
      setSides(next);
    })();
    return () => { cancelled = true; };
  }, []);

  const vals = Object.values(sides);
  return {
    count: vals.length,
    aff: vals.filter((s) => s === 'aff').length,
    neg: vals.filter((s) => s === 'neg').length,
  };
}

export default function Home() {
  const { db, mode } = useApp();

  const cases = Object.values(db.cases);
  const cards = Object.values(db.cards);

  // Imported speech docs count toward the Cases tile alongside real cases.
  const speechDocs = useSpeechDocCounts();
  const casesTotal = cases.length + speechDocs.count;
  const affTotal = cases.filter((c) => c.side === 'aff').length + speechDocs.aff;
  const negTotal = cases.filter((c) => c.side === 'neg').length + speechDocs.neg;
  const opponents = Object.values(db.opponents);
  const tournaments = Object.values(db.tournaments);
  const rounds = Object.values(db.rounds);

  const roundWins   = rounds.filter((r) => r.result === 'win').length;
  const roundLosses = rounds.filter((r) => r.result === 'loss').length;
  const pending     = rounds.filter((r) => r.result === 'pending').length;
  const wins   = roundWins   + (db.manualWins   ?? 0);
  const losses = roundLosses + (db.manualLosses ?? 0);

  // Live = today within start→end. Upcoming = soonest future tournament by start date.
  const liveTournament = tournaments.find((t) => tournamentStatus(t) === 'live');
  const upcomingTournament = [...tournaments]
    .filter((t) => tournamentStatus(t) === 'upcoming')
    .sort((a, b) => new Date(a.start ?? a.date).getTime() - new Date(b.start ?? b.date).getTime())[0];
  const featuredTournament = liveTournament ?? upcomingTournament;
  const featuredIsLive = !!liveTournament;

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-thin" style={{ background: 'var(--bg-main)' }}>
      <StatusBar wins={wins} losses={losses} pending={pending} tournament={featuredTournament} isLive={featuredIsLive} />

      <div className="flex-1 p-6 space-y-5 max-w-6xl w-full mx-auto">
        {/* Stat row */}
        <div className="grid grid-cols-4 gap-3">
          <BigStat label="Cases" value={casesTotal} sub={`${affTotal} aff · ${negTotal} neg`} accent="blue" />
          <BigStat label="Cards" value={cards.length} sub={`${Object.values(db.blocks).length} blocks`} accent="purple" />
          <BigStat label="Opponents" value={opponents.length} accent="amber" sub="tracked" />
          <BigStat label="Tournaments" value={tournaments.length} sub={`${rounds.length} rounds total`} accent="emerald" />
        </div>

        {/* Main two-column grid */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <CasesPanel />
            <TournamentsPanel />
            {opponents.length > 0 && <OpponentsPanel />}
          </div>
          <div className="space-y-4">
            <QuickActions />
            <ImpactCalcCard />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar({ wins, losses, pending, tournament, isLive }: {
  wins: number; losses: number; pending: number; tournament?: Tournament; isLive: boolean;
}) {
  const { update } = useApp();
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : null;
  const [hovering, setHovering] = useState(false);

  function adjustWins(delta: number) {
    update((db) => {
      const next = { ...db, manualWins: Math.max(0, (db.manualWins ?? 0) + delta) };
      try { localStorage.setItem('warroom-manual-wins', String(next.manualWins)); } catch {}
      return next;
    });
  }
  function adjustLosses(delta: number) {
    update((db) => {
      const next = { ...db, manualLosses: Math.max(0, (db.manualLosses ?? 0) + delta) };
      try { localStorage.setItem('warroom-manual-losses', String(next.manualLosses)); } catch {}
      return next;
    });
  }

  return (
    <div
      className="shrink-0 px-6 py-3 flex items-center justify-between gap-6 select-none"
      style={{ background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-5">
        {tournament && (
          <div className="flex items-center gap-2">
            {isLive ? (
              <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded"
                style={{ background: '#16a34a', color: '#fff', letterSpacing: '0.1em' }}>
                Active Tournament
              </span>
            ) : (
              <span className="label">Upcoming</span>
            )}
            <span className="text-xs font-medium text-ink truncate max-w-[260px]">{tournament.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-5">
        {winPct !== null && (
          <div className="flex items-center gap-1.5">
            <span className="label">Win rate</span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{winPct}%</span>
          </div>
        )}
        {pending > 0 && (
          <Tooltip text="Add results in Tournaments ↗">
            <div className="flex items-center gap-1.5" style={{ cursor: 'default' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs text-ink/50">{pending} pending</span>
            </div>
          </Tooltip>
        )}

        {/* W–L with hover ± controls */}
        <div
          className="flex items-center gap-1"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          style={{ cursor: 'default' }}
        >
          {/* Win side */}
          <button
            onClick={() => adjustWins(-1)}
            className="text-[11px] font-bold transition rounded px-1"
            style={{
              opacity: hovering ? 1 : 0,
              pointerEvents: hovering ? 'auto' : 'none',
              color: 'var(--nav-inactive-color)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              transition: 'opacity 0.15s ease',
            }}
          >−</button>
          <span className="text-xs font-mono" style={{ color: wins > 0 ? 'var(--emerald, #16a34a)' : 'var(--ink-faint, rgba(var(--ink-rgb),0.3))' }}>
            {wins}W
          </span>
          <button
            onClick={() => adjustWins(1)}
            className="text-[11px] font-bold transition rounded px-1"
            style={{
              opacity: hovering ? 1 : 0,
              pointerEvents: hovering ? 'auto' : 'none',
              color: 'var(--nav-inactive-color)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              transition: 'opacity 0.15s ease',
            }}
          >+</button>

          <span className="text-xs text-ink/20 mx-0.5">–</span>

          {/* Loss side */}
          <button
            onClick={() => adjustLosses(-1)}
            className="text-[11px] font-bold transition rounded px-1"
            style={{
              opacity: hovering ? 1 : 0,
              pointerEvents: hovering ? 'auto' : 'none',
              color: 'var(--nav-inactive-color)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              transition: 'opacity 0.15s ease',
            }}
          >−</button>
          <span className="text-xs font-mono" style={{ color: losses > 0 ? 'var(--rose, #e11d48)' : 'var(--ink-faint, rgba(var(--ink-rgb),0.3))' }}>
            {losses}L
          </span>
          <button
            onClick={() => adjustLosses(1)}
            className="text-[11px] font-bold transition rounded px-1"
            style={{
              opacity: hovering ? 1 : 0,
              pointerEvents: hovering ? 'auto' : 'none',
              color: 'var(--nav-inactive-color)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              transition: 'opacity 0.15s ease',
            }}
          >+</button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared hover animation helpers ──────────────────────────────────────────

/** Base style for cards that lift on hover */
const CARD_BASE: React.CSSProperties = {
  transition: 'transform .15s cubic-bezier(.4,0,.2,1), box-shadow .15s ease, border-color .14s ease, background .14s ease',
  willChange: 'transform',
};

/**
 * Accent-ring lift on hover — matches the Claude Design spec:
 * a 2px accent ring + deep drop shadow + a subtle rise & scale.
 * Pass a `ring` colour to override the accent (e.g. the live-tournament green).
 */
function onCardEnter(e: React.MouseEvent<HTMLElement>, ring = 'var(--accent)') {
  const el = e.currentTarget as HTMLElement;
  el.style.transform = 'translateY(-1px)';
  el.style.boxShadow = `0 0 0 1px ${ring}, 0 6px 16px -8px rgba(0,0,0,0.18)`;
  el.style.borderColor = ring;
  el.style.zIndex = '1';
}
function onCardLeave(e: React.MouseEvent<HTMLElement>, restBorder?: string) {
  const el = e.currentTarget as HTMLElement;
  el.style.transform = '';
  el.style.boxShadow = '';
  el.style.borderColor = restBorder ?? 'var(--border-subtle)';
  el.style.zIndex = '';
}

/** Blue glow — used on Gemini chat rows (no lift) */
function onGeminiEnter(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget as HTMLElement;
  el.style.background = 'rgba(66,133,244,0.07)';
  el.style.borderColor = 'rgba(66,133,244,0.38)';
  el.style.boxShadow = '0 0 0 3px rgba(66,133,244,0.08)';
}
function onGeminiLeave(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget as HTMLElement;
  el.style.background = '';
  el.style.borderColor = 'var(--border-subtle)';
  el.style.boxShadow = '';
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ text, children, up = false }: {
  text: string; children: React.ReactNode; up?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            ...(up ? { bottom: 'calc(100% + 7px)' } : { top: 'calc(100% + 7px)' }),
            zIndex: 9999,
            whiteSpace: 'nowrap',
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: 11,
            pointerEvents: 'none',
            background: 'var(--bg-popover, var(--bg-sidebar))',
            border: '1px solid var(--border-subtle)',
            color: 'var(--ink)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Floating context menu ────────────────────────────────────────────────────

interface FloatingMenuItem { label: string; danger?: boolean; onClick: () => void; }

function FloatingMenu({ x, y, items, onClose }: {
  x: number; y: number; items: FloatingMenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function down(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);

  // Clamp to viewport
  const left = Math.min(x, window.innerWidth - 145);
  const top  = Math.min(y, window.innerHeight - items.length * 34 - 12);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] rounded-lg py-1 text-xs shadow-xl"
      style={{
        left, top, minWidth: 136,
        background: 'var(--bg-popover, var(--bg-sidebar))',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
          className="w-full text-left px-3 py-1.5 transition"
          style={{ color: item.danger ? 'var(--danger, #ef4444)' : 'var(--nav-active-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Big stat tiles ───────────────────────────────────────────────────────────

type Accent = 'blue' | 'purple' | 'amber' | 'emerald';

const ACCENT_CLASSES: Record<Accent, string> = {
  blue:    'text-blue-600 dark:text-blue-400',
  purple:  'text-purple-600 dark:text-purple-400',
  amber:   'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

const ACCENT_BG: Record<Accent, string> = {
  blue:    'bg-blue-50 dark:bg-blue-950/30',
  purple:  'bg-purple-50 dark:bg-purple-950/30',
  amber:   'bg-amber-50 dark:bg-amber-950/30',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/30',
};

function BigStat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent: Accent }) {
  return (
    <div
      className={`glass-card rounded-xl px-4 py-3.5 ${ACCENT_BG[accent]}`}
      style={{ border: '1px solid var(--border-subtle)', ...CARD_BASE }}
      onMouseEnter={(e) => onCardEnter(e)}
      onMouseLeave={(e) => onCardLeave(e)}
    >
      <div className="label mb-1">{label}</div>
      <div className={`text-3xl font-bold tabular-nums ${ACCENT_CLASSES[accent]}`}>{value}</div>
      {sub && <div className="text-[11px] mt-1 text-ink/40">{sub}</div>}
    </div>
  );
}

// ─── Cases panel ─────────────────────────────────────────────────────────────

const RECENTS_KEY = 'warroom-speech-doc-recents';
interface RecentDoc { path: string; name: string; cardCount?: number }
function getSpeechDocs(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
}

function CasesPanel() {
  const { db, update, setView, mode } = useApp();
  const cases = Object.values(db.cases);
  const [speechDocs, setSpeechDocs] = useState<RecentDoc[]>(getSpeechDocs);
  const [name, setName] = useState('');
  const [side, setSide] = useState<Side>('aff');
  const [creating, setCreating] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === RECENTS_KEY) setSpeechDocs(getSpeechDocs());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Eagerly count cards for speech docs that don't have a cached count yet.
  // Runs in the background so the home screen isn't blocked.
  useEffect(() => {
    const uncounted = speechDocs.filter(d => d.cardCount == null);
    if (uncounted.length === 0) return;
    (async () => {
      for (const d of uncounted) {
        try {
          const res = await window.warroom?.fs.countDocxCards(d.path);
          if (res?.ok) {
            const count = (res as any).count as number;
            const next = getSpeechDocs().map(r =>
              r.path === d.path ? { ...r, cardCount: count } : r
            );
            localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
            window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
          }
        } catch { /* best-effort */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechDocs.map(d => d.path).join(',')]);

  async function create() {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    const c: Case = { id, name: name.trim(), side, blocks: [] };
    await update((db) => ({ ...db, cases: { ...db.cases, [id]: c } }));
    setName('');
    setCreating(false);
    setView({ kind: 'case', caseId: id });
  }

  async function renameCase(id: string, newName: string) {
    if (!newName.trim()) { setRenamingId(null); return; }
    await update((db) => ({
      ...db,
      cases: { ...db.cases, [id]: { ...db.cases[id], name: newName.trim() } },
    }));
    setRenamingId(null);
  }

  async function deleteCase(id: string) {
    await update((db) => {
      const { [id]: _, ...rest } = db.cases;
      return { ...db, cases: rest };
    });
  }

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Cases</div>
        {mode === 'prep' && (
          <button className="btn text-[11px]" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New case'}
          </button>
        )}
      </div>

      {creating && (
        <div className="flex gap-2 mb-3">
          <input
            autoFocus
            className="input flex-1 text-xs"
            placeholder="Case name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
          />
          <select className="input text-xs" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="aff">Aff</option>
            <option value="neg">Neg</option>
          </select>
          <button className="btn-primary text-xs" onClick={create}>Create</button>
        </div>
      )}

      {cases.length === 0 && speechDocs.length === 0 ? (
        <div className="text-sm italic text-ink/35 py-2">No cases yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {cases.map((c) => {
            const cardCount = c.blocks.reduce((acc, bid) => {
              return acc + (db.blocks[bid]?.cards.length ?? 0);
            }, 0);
            // Match "flow", "flay", or "lay" only when not surrounded by letters
            const styleMatch = c.name.match(/(?<![a-zA-Z])(flow|flay|lay)(?![a-zA-Z])/i);
            const styleTag = styleMatch ? styleMatch[1].toLowerCase() : null;

            if (renamingId === c.id) {
              return (
                <input
                  key={c.id}
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => renameCase(c.id, renameDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameCase(c.id, renameDraft);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium outline-none"
                  style={{ background: 'var(--nav-active-bg)', border: '1px solid var(--border-med)', color: 'var(--ink)' }}
                />
              );
            }

            return (
              <button
                key={c.id}
                onClick={() => setView({ kind: 'case', caseId: c.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ id: c.id, x: e.clientX, y: e.clientY });
                }}
                className="text-left rounded-lg px-3 py-2.5 group"
                style={{ background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
                onMouseEnter={(e) => onCardEnter(e)}
                onMouseLeave={(e) => onCardLeave(e)}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.side === 'aff' ? 'bg-blue-500' : 'bg-rose-500'}`} />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-ink/40">{c.side}</span>
                </div>
                <div className="text-sm font-medium truncate text-ink">{c.name}</div>
                <div className="text-[11px] mt-1 text-ink/40 flex items-center gap-1.5">
                  {styleTag && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold"
                      style={{ background: 'var(--border-subtle)', color: 'var(--placeholder)' }}
                    >
                      {styleTag}
                    </span>
                  )}
                  {cardCount} card{cardCount !== 1 ? 's' : ''}
                </div>
              </button>
            );
          })}
          {speechDocs.map((d) => {
            const displayName = d.name.replace(/\.docx$/i, '');
            const styleMatch = displayName.match(/(?<![a-zA-Z])(flow|flay|lay)(?![a-zA-Z])/i);
            const styleTag = styleMatch ? styleMatch[1].toLowerCase() : null;
            const isAff = /\baff\b/i.test(displayName);
            const isNeg = /\bneg\b/i.test(displayName);
            return (
              <button
                key={d.path}
                onClick={() => setView({ kind: 'speech-doc', docPath: d.path })}
                className="text-left rounded-lg px-3 py-2.5 group"
                style={{ background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
                onMouseEnter={(e) => onCardEnter(e)}
                onMouseLeave={(e) => onCardLeave(e)}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {(isAff || isNeg) && (
                    <>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAff ? 'bg-blue-500' : 'bg-rose-500'}`} />
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-ink/40">{isAff ? 'aff' : 'neg'}</span>
                    </>
                  )}
                  {!isAff && !isNeg && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-ink/40">doc</span>
                  )}
                </div>
                <div className="text-sm font-medium truncate text-ink">{displayName}</div>
                <div className="text-[11px] mt-1 text-ink/40 flex items-center gap-1.5">
                  {styleTag && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold"
                      style={{ background: 'var(--border-subtle)', color: 'var(--placeholder)' }}
                    >
                      {styleTag}
                    </span>
                  )}
                  {d.cardCount != null
                    ? `${d.cardCount} card${d.cardCount !== 1 ? 's' : ''}`
                    : 'speech doc'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {ctxMenu && (
        <FloatingMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            {
              label: 'Rename',
              onClick: () => {
                const c = db.cases[ctxMenu.id];
                setRenameDraft(c?.name ?? '');
                setRenamingId(ctxMenu.id);
              },
            },
            { label: 'Delete', danger: true, onClick: () => deleteCase(ctxMenu.id) },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

// ─── Tournaments panel ────────────────────────────────────────────────────────

function TournamentsPanel() {
  const { db, setView } = useApp();
  // Sort upcoming first, then by soonest start date
  const tournaments = Object.values(db.tournaments).sort((a, b) => {
    const sa = new Date(a.start ?? a.date).getTime();
    const sb = new Date(b.start ?? b.date).getTime();
    const today = Date.now();
    const aUp = sa >= today; const bUp = sb >= today;
    if (aUp && !bUp) return -1;
    if (!aUp && bUp) return 1;
    return aUp ? sa - sb : sb - sa; // upcoming: soonest first; past: most recent first
  });

  if (tournaments.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Tournaments</div>
        <button className="btn text-[11px]" onClick={() => setView({ kind: 'tournaments' })}>View all</button>
      </div>
      <div className="space-y-2">
        {tournaments.slice(0, 4).map((t) => {
          const rounds = t.rounds.map((rid) => db.rounds[rid]).filter(Boolean);
          const wins = rounds.filter((r) => r?.result === 'win').length;
          const losses = rounds.filter((r) => r?.result === 'loss').length;
          const pending = rounds.filter((r) => r?.result === 'pending').length;
          const status = tournamentStatus(t);
          const startStr = t.start ?? t.date;
          const endStr = t.end ?? startStr;
          const dateStr = startStr
            ? (startStr === endStr
                ? new Date(startStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                : `${new Date(startStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(endStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)
            : '';
          return (
            <button
              key={t.id}
              onClick={() => setView({ kind: 'tournament', tournamentId: t.id })}
              className="w-full text-left flex items-center justify-between rounded-lg px-3 py-2.5 transition"
              style={{ background: 'var(--bg-main)', border: `1px solid ${status === 'live' ? '#16a34a55' : 'var(--border-subtle)'}`, ...CARD_BASE }}
              onMouseEnter={(e) => onCardEnter(e, status === 'live' ? 'var(--pos)' : 'var(--accent)')}
              onMouseLeave={(e) => onCardLeave(e, status === 'live' ? '#16a34a55' : undefined)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {status === 'live' && (
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1 py-0.5 rounded shrink-0" style={{ background: '#16a34a', color: '#fff' }}>Live</span>
                  )}
                  {status === 'upcoming' && (() => {
                    const days = daysUntil(t.start ?? t.date);
                    return (
                      <span className="text-[9px] font-bold tracking-wide uppercase px-1 py-0.5 rounded shrink-0" style={{ background: 'var(--border-med)', color: 'var(--label-color)' }}>
                        {days === 1 ? '1 day' : `${days} days`}
                      </span>
                    );
                  })()}
                  <div className="text-sm font-medium text-ink truncate">{t.name}</div>
                </div>
                <div className="text-[11px] text-ink/40 mt-0.5">{dateStr}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                {rounds.length === 0 ? (
                  <span className="text-[11px] text-ink/30">No rounds</span>
                ) : (
                  <>
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{wins}W</span>
                    <span className="text-[11px] text-ink/30">–</span>
                    <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{losses}L</span>
                    {pending > 0 && (
                      <Tooltip text="Add results in Tournaments ↗" up>
                        <span className="text-[11px] text-amber-600" style={{ cursor: 'default' }}>· {pending} pending</span>
                      </Tooltip>
                    )}
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Win/loss record panel ────────────────────────────────────────────────────

function RecordPanel({ wins, losses, pending, rounds }: { wins: number; losses: number; pending: number; rounds: Round[] }) {
  const total = wins + losses;
  const winPct = total > 0 ? (wins / total) * 100 : 0;

  const recent = [...rounds]
    .filter((r) => r.result !== 'pending')
    .sort((a, b) => (b as any).createdAt > (a as any).createdAt ? 1 : -1)
    .slice(0, 8);

  if (rounds.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="label mb-3">Record</div>

      <div className="flex items-end gap-3 mb-3">
        <div>
          <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{wins}</span>
          <span className="text-xl text-ink/30 mx-1">–</span>
          <span className="text-3xl font-bold text-rose-600 dark:text-rose-400">{losses}</span>
        </div>
        {total > 0 && (
          <div className="text-xs text-ink/40 pb-0.5">{Math.round(winPct)}%</div>
        )}
      </div>

      {total > 0 && (
        <div className="w-full rounded-full overflow-hidden mb-3" style={{ height: 6, background: 'var(--border-subtle)' }}>
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${winPct}%` }}
          />
        </div>
      )}

      {recent.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {recent.map((r, i) => (
            <span
              key={r.id + i}
              className={`w-5 h-5 rounded-sm text-[10px] font-bold flex items-center justify-center ${
                r.result === 'win'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
              }`}
              title={`Round ${r.number} — ${r.result}`}
            >
              {r.result === 'win' ? 'W' : 'L'}
            </span>
          ))}
        </div>
      )}

      {pending > 0 && (
        <div className="mt-2">
          <Tooltip text="Add results in Tournaments ↗" up>
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" style={{ cursor: 'default' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {pending} pending
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Gemini home card ─────────────────────────────────────────────────────────

interface GeminiConvMeta { id: string; title: string; }

const CONV_META_KEY = 'warroom-gemini-conversations';
const convHistoryKey = (id: string) => `warroom-gemini-conv-${id}`;

function persistConvs(next: GeminiConvMeta[]) {
  try {
    localStorage.setItem(CONV_META_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent('storage', { key: CONV_META_KEY }));
  } catch {}
}

function GeminiHomeCard() {
  const { setGeminiOpen, setGeminiActiveId } = useApp();
  const [convs, setConvs] = useState<GeminiConvMeta[]>([]);

  useEffect(() => {
    function load() {
      try {
        const raw = localStorage.getItem(CONV_META_KEY);
        if (raw) setConvs(JSON.parse(raw));
      } catch {}
    }
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);

  function openNew() { setGeminiActiveId(null); setGeminiOpen(true); }
  function openConv(id: string) { setGeminiActiveId(id); setGeminiOpen(true); }

  function renameConv(id: string, title: string) {
    const next = convs.map((c) => c.id === id ? { ...c, title } : c);
    setConvs(next);
    persistConvs(next);
    // Also patch the full history entry in localStorage so GeminiPanel sees the new title
    try {
      const hist = localStorage.getItem(convHistoryKey(id));
      // title is stored only in the meta key, so nothing more needed
      void hist;
    } catch {}
  }

  function deleteConv(id: string) {
    const next = convs.filter((c) => c.id !== id);
    setConvs(next);
    persistConvs(next);
    try { localStorage.removeItem(convHistoryKey(id)); } catch {}
  }

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GeminiIcon size={14} />
          <span className="label">Warroom AI</span>
        </div>
        <button className="btn text-[11px]" onClick={openNew}>+ New chat</button>
      </div>

      {convs.length === 0 ? (
        <button
          onClick={openNew}
          className="w-full rounded-lg px-3 py-3 text-left flex items-center gap-2"
          style={{ background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
          onMouseEnter={(e) => onCardEnter(e)}
          onMouseLeave={(e) => onCardLeave(e)}
        >
          <GeminiIcon size={13} />
          <span className="text-xs text-ink/50">Start a new conversation…</span>
        </button>
      ) : (
        <div className="space-y-1">
          {convs.slice(0, 6).map((c) => (
            <GeminiConvRow
              key={c.id}
              conv={c}
              onOpen={() => openConv(c.id)}
              onRename={(title) => renameConv(c.id, title)}
              onDelete={() => deleteConv(c.id)}
            />
          ))}
          {convs.length > 6 && (
            <button
              onClick={() => setGeminiOpen(true)}
              className="w-full text-center text-[10px] py-1"
              style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              +{convs.length - 6} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GeminiConvRow({ conv, onOpen, onRename, onDelete }: {
  conv: GeminiConvMeta;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function outside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  function startRename() {
    setMenuOpen(false);
    setCtxPos(null);
    setDraft(conv.title);
    setRenaming(true);
  }

  function commitRename() {
    const t = draft.trim();
    if (t && t !== conv.title) onRename(t);
    setRenaming(false);
  }

  const active = hovered || menuOpen;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
          className="w-full rounded-lg px-3 py-2 text-xs outline-none font-medium"
          style={{
            background: 'var(--nav-active-bg)',
            color: 'var(--nav-active-color)',
            border: '1px solid var(--border-subtle)',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          onClick={onOpen}
          onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
          onContextMenu={(e) => { e.preventDefault(); setCtxPos({ x: e.clientX, y: e.clientY }); }}
          className="w-full text-left rounded-lg px-3 py-2 text-xs flex items-center gap-2"
          style={{
            background: active ? 'rgba(66,133,244,0.07)' : 'var(--bg-main)',
            border: `1px solid ${active ? 'rgba(66,133,244,0.38)' : 'var(--border-subtle)'}`,
            boxShadow: active ? '0 0 0 3px rgba(66,133,244,0.08)' : '',
            color: 'var(--ink)',
            ...CARD_BASE,
          }}
        >
          <GeminiIcon size={11} />
          <span className="truncate flex-1" style={{ color: 'var(--ink)', opacity: 0.7 }}>{conv.title}</span>

          {/* Three-dots button — visible on hover */}
          {active && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="shrink-0 flex items-center justify-center w-5 h-5 rounded transition"
              style={{ color: 'var(--nav-inactive-color)', opacity: 0.7 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="2" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="10" cy="6" r="1.1"/>
              </svg>
            </span>
          )}
        </button>
      )}

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 z-50 rounded-lg py-1 text-xs shadow-xl"
          style={{
            top: '100%', minWidth: 120, marginTop: 2,
            background: 'var(--bg-popover, var(--bg-sidebar))',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); startRename(); }}
            className="w-full text-left px-3 py-1.5 transition"
            style={{ color: 'var(--nav-active-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-1.5 transition"
            style={{ color: 'var(--danger, #ef4444)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--nav-hover-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Delete
          </button>
        </div>
      )}

      {ctxPos && (
        <FloatingMenu
          x={ctxPos.x}
          y={ctxPos.y}
          items={[
            { label: 'Rename', onClick: startRename },
            { label: 'Delete', danger: true, onClick: () => { setCtxPos(null); onDelete(); } },
          ]}
          onClose={() => setCtxPos(null)}
        />
      )}
    </div>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

function QuickActions() {
  const { setView, mode, chatOpen, setChatOpen } = useApp();

  const actions = [
    { label: 'Flow sheet', icon: '⌨', onClick: () => setView({ kind: 'flow' }) },
    { label: 'Card library', icon: '🗂', onClick: () => setView({ kind: 'library' }) },
    ...(mode === 'prep' ? [
      { label: 'Opponents', icon: '🔍', onClick: () => setView({ kind: 'opponents' }) },
      { label: 'Import doc', icon: '↓', onClick: () => setView({ kind: 'speech-doc' }) },
    ] : [
      { label: 'Speech doc', icon: '📄', onClick: () => setView({ kind: 'block', blockId: '__speech__' } as any) },
    ]),
    { label: 'Tournaments', icon: '🏆', onClick: () => setView({ kind: 'tournaments' }) },
    { label: 'Chat', icon: '💬', onClick: () => setChatOpen(true) },
  ];

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="label mb-3">Quick actions</div>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex flex-col items-start rounded-lg px-3 py-2.5 text-left"
            style={{ background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
            onMouseEnter={(e) => onCardEnter(e)}
            onMouseLeave={(e) => onCardLeave(e)}
          >
            <span className="text-base mb-1">{a.icon}</span>
            <span className="text-xs font-medium text-ink">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Impact Calc card ────────────────────────────────────────────────────────

export function ImpactCalcCard() {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="3" x2="12" y2="21"/>
          <path d="M5 21h14"/>
          <path d="M5 7l7-4 7 4"/>
          <path d="M5 7l-3 6h6l-3-6z"/>
          <path d="M19 7l-3 6h6l-3-6z"/>
        </svg>
        <span className="label">Impact Calc</span>
      </div>
      <ImpactCalcPanel />
    </div>
  );
}

// ─── Opponents panel ──────────────────────────────────────────────────────────

function OpponentsPanel() {
  const { db, update, setView } = useApp();
  const opponents = Object.values(db.opponents).slice(0, 5);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  async function renameOpponent(id: string, newName: string) {
    if (!newName.trim()) { setRenamingId(null); return; }
    await update((db) => ({
      ...db,
      opponents: { ...db.opponents, [id]: { ...db.opponents[id], teamName: newName.trim() } },
    }));
    setRenamingId(null);
  }

  async function deleteOpponent(id: string) {
    await update((db) => {
      const { [id]: _, ...rest } = db.opponents;
      return { ...db, opponents: rest };
    });
  }

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Opponents</div>
        <button className="btn text-[11px]" onClick={() => setView({ kind: 'opponents' })}>All</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {opponents.map((o) => {
          const roundsAgainst = o.roundsAgainst.length;
          const disc = (o.disclosures as any);
          const hasDisc = !!disc?.roundsDisclosed;

          if (renamingId === o.id) {
            return (
              <input
                key={o.id}
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => renameOpponent(o.id, renameDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameOpponent(o.id, renameDraft);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="rounded-lg px-3 py-2 text-xs font-medium outline-none"
                style={{ background: 'var(--nav-active-bg)', border: '1px solid var(--border-med)', color: 'var(--ink)' }}
              />
            );
          }

          return (
            <button
              key={o.id}
              onClick={() => setView({ kind: 'opponent', opponentId: o.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ id: o.id, x: e.clientX, y: e.clientY });
              }}
              className="text-left flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', ...CARD_BASE }}
              onMouseEnter={(e) => onCardEnter(e)}
              onMouseLeave={(e) => onCardLeave(e)}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium truncate text-ink">{o.teamName}</div>
                {o.school && <div className="text-[10px] text-ink/40 truncate">{o.school}</div>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {hasDisc && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">disc</span>
                )}
                {roundsAgainst > 0 && (
                  <span className="text-[10px] text-ink/30">{roundsAgainst}×</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {ctxMenu && (
        <FloatingMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            {
              label: 'Rename',
              onClick: () => {
                const o = db.opponents[ctxMenu.id];
                setRenameDraft(o?.teamName ?? '');
                setRenamingId(ctxMenu.id);
              },
            },
            { label: 'Delete', danger: true, onClick: () => deleteOpponent(ctxMenu.id) },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
