import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../store/appStore';
import { Case, OpponentStats } from '../types';
import { humanizeGeminiError } from '../utils/geminiError';
import { Spinner } from './Spinner';
import SharedNotesEditor from './SharedNotesEditor';

// OpenCaselist cite titles often arrive with markdown heading syntax (e.g. "# 1AC").
// Strip leading ATX markers so names read cleanly in the UI.
function cleanCiteTitle(s: string): string {
  return s.replace(/^#+\s*/, '').trim();
}

// Wraps the first case-insensitive occurrence of `query` in the text with a <mark>.
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#facc15', color: '#1a1a1a', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function OpponentProfile() {
  const { db, update, setView, view } = useApp();
  const pendingDisclosureQuery = useApp((s) => s.pendingDisclosureQuery);
  const setPendingDisclosureQuery = useApp((s) => s.setPendingDisclosureQuery);
  const [highlight, setHighlight] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const oppId = view.kind === 'opponent' ? view.opponentId : '';

  // Capture the matched term handed over by global search, then clear it.
  useEffect(() => {
    if (pendingDisclosureQuery) {
      setHighlight(pendingDisclosureQuery);
      setPendingDisclosureQuery('');
    }
  }, [pendingDisclosureQuery, setPendingDisclosureQuery]);

  // Clear the highlight when switching opponents.
  useEffect(() => { setHighlight(''); }, [oppId]);

  // After render, scroll the first matching disclosure title into view.
  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => {
      const nodes = scrollRef.current?.querySelectorAll<HTMLElement>('[data-disc-title]');
      if (!nodes) return;
      for (const el of Array.from(nodes)) {
        if ((el.textContent ?? '').toLowerCase().includes(highlight.toLowerCase())) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        }
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [highlight, oppId]);

  if (view.kind !== 'opponent') return null;
  const opp = db.opponents[view.opponentId];
  if (!opp) return <div className="p-8 text-sm text-ink/50">Opponent not found.</div>;

  const disc = opp.disclosures as any;
  const rounds = opp.roundsAgainst.map((id) => db.rounds[id]).filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 glass-elevated flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => setView({ kind: 'opponents' })}
            className="text-xs text-ink/40 hover:text-ink mb-1"
          >
            ← Opponents
          </button>
          <h1 className="text-lg font-semibold">{opp.teamName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-ink/50">{opp.school}</span>
            {disc?.roundsDisclosed != null && (
              <span className="text-xs text-ink/40">{disc.roundsDisclosed} rounds disclosed</span>
            )}
            {disc?.pulledAt && (
              <span className="text-xs text-ink/30">
                Pulled {new Date(disc.pulledAt).toLocaleDateString()}
              </span>
            )}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-sm ${
                disc?.roundsDisclosed
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-line text-ink/40'
              }`}
            >
              {disc?.roundsDisclosed ? 'Disclosure found' : 'No disclosure'}
            </span>
          </div>
        </div>
        <RePullButton opp={opp} />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-6 space-y-5">
        {/* Gemini scouting report — keyed by opponent ID so it remounts on navigation */}
        <GeminiTeamSummary key={opp.id} disc={disc} teamName={opp.teamName} oppId={opp.id} />

        {/* Aff */}
        <Section title="Disclosed aff">
          {disc?.aff ? (
            <div>
              <div className="text-sm font-medium" data-disc-title>
                <HighlightText text={cleanCiteTitle(disc.aff.name)} query={highlight} />
              </div>
              {disc.aff.description && (
                <div className="text-xs text-ink/60 mt-1">{disc.aff.description}</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-ink/40 italic">No aff disclosure found.</div>
          )}
        </Section>

        {/* Neg */}
        <Section title="Disclosed neg positions">
          {disc?.neg?.length ? (
            <ul className="space-y-1">
              {disc.neg.map((p: any, i: number) => (
                <li key={i} className="text-sm">
                  <span className="font-medium" data-disc-title>
                    <HighlightText text={cleanCiteTitle(p.name)} query={highlight} />
                  </span>
                  {p.description && <span className="text-ink/50 ml-2">{p.description}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-ink/40 italic">No neg positions found.</div>
          )}
        </Section>

        {/* Disclosed files */}
        <DisclosedFiles disc={disc} teamName={opp.teamName ?? opp.school ?? 'Opponent'} highlight={highlight} />

        {/* Debate Land stats */}
        <DebateLandSection key={opp.id} opp={opp} />

        {/* Notes */}
        <Section title="Notes">
          <NotesEditor opp={opp} />
        </Section>

        {/* Rounds against */}
        {rounds.length > 0 && (
          <Section title={`Rounds against (${rounds.length})`}>
            <div className="space-y-1">
              {rounds.map((r) => {
                const t = db.tournaments[r.tournamentId];
                return (
                  <button
                    key={r.id}
                    onClick={() => setView({ kind: 'round', roundId: r.id })}
                    className="w-full text-left glass-card rounded-sm px-3 py-2 hover:border-ink/30 text-sm"
                  >
                    <span className="font-medium">Rd {r.number}</span>
                    <span className="text-ink/50 ml-2">{t?.name ?? 'Unknown tournament'}</span>
                    <span
                      className={`ml-2 text-[10px] px-1 rounded-sm ${
                        r.result === 'win'
                          ? 'bg-emerald-100 text-emerald-700'
                          : r.result === 'loss'
                          ? 'bg-danger/10 text-danger'
                          : 'bg-line text-ink/40'
                      }`}
                    >
                      {r.result}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

interface DisclosureEntry {
  label: string;
  side: string;
  url: string;      // file path/URL, or '' for text entries
  text?: string;    // inline text content for text-only disclosures
}

function collectEntries(disc: any): DisclosureEntry[] {
  const entries: DisclosureEntry[] = [];
  const seenKeys = new Set<string>();

  // Cites: show file link if available, otherwise show inline text
  const rawCites: any[] = disc?.rawCites ?? [];
  for (const c of rawCites) {
    const url = c.opensource ?? c.url ?? '';
    const text = c.cites ?? '';
    const key = url || `cite-${c.cite_id ?? c.round_id ?? entries.length}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const side = (c.side ?? '').toUpperCase().startsWith('A') ? 'Aff' : 'Neg';
    const label = cleanCiteTitle(c.title ?? c.cites?.slice(0, 80) ?? url);
    entries.push({ label, side, url, text: url ? undefined : text || undefined });
  }

  // Rounds: show file link if available, otherwise show report text
  const rawRounds: any[] = disc?.rawRounds ?? [];
  for (const r of rawRounds) {
    const url = r.opensource ?? r.url ?? '';
    const report = r.report ?? '';
    // Skip contact-info rounds (tournament = "0---Contact Info") and rounds with no content
    if (!url && (!report || report.length < 10)) continue;
    const tourn = (r.tournament ?? '').replace(/^\d+---/, '');
    if (!tourn && !url) continue; // skip rounds with no tournament name and no file
    const rd = r.round ?? r.roundNum ?? '';
    const key = url || `round-${r.round_id ?? entries.length}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const side = (r.side ?? '').toUpperCase().startsWith('A') ? 'Aff' : 'Neg';
    const label = [tourn, rd ? `Rd ${rd}` : ''].filter(Boolean).join(' – ') || url;
    entries.push({ label, side, url, text: url ? undefined : report || undefined });
  }

  return entries;
}

function DisclosedFiles({ disc, teamName, highlight = '' }: { disc: any; teamName: string; highlight?: string }) {
  const [viewingFile, setViewingFile] = useState<{ url: string; label: string; side: string } | null>(null);
  const [expandedText, setExpandedText] = useState<string | null>(null);

  const entries = collectEntries(disc);
  if (entries.length === 0) return null;

  return (
    <>
      <Section title={`Disclosures (${entries.length})`}>
        <div className="space-y-1">
          {entries.map((e, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${
                    e.side === 'Aff' ? 'badge-aff' : 'badge-neg'
                  }`}
                >
                  {e.side}
                </span>
                <span className="flex-1 text-xs text-ink truncate" title={e.label} data-disc-title>
                  <HighlightText text={e.label} query={highlight} />
                </span>
                {e.url ? (
                  <button
                    className="btn text-xs shrink-0"
                    onClick={() => setViewingFile({ url: e.url, label: e.label, side: e.side })}
                  >
                    Open
                  </button>
                ) : e.text ? (
                  <button
                    className="btn text-xs shrink-0"
                    onClick={() => setExpandedText(expandedText === e.text ? null : e.text!)}
                  >
                    {expandedText === e.text ? 'Hide' : 'View'}
                  </button>
                ) : null}
              </div>
              {e.text && expandedText === e.text && (
                <div className="mt-1 ml-10 text-xs text-ink/70 whitespace-pre-wrap bg-line/30 rounded px-2 py-1.5 leading-relaxed">
                  {e.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {viewingFile && (
        <DisclosedFileModal
          url={viewingFile.url}
          label={viewingFile.label}
          side={viewingFile.side}
          teamName={teamName}
          onClose={() => setViewingFile(null)}
        />
      )}
    </>
  );
}

// ─── In-app disclosed file viewer ────────────────────────────────────────────
// Downloads the docx to a temp path and opens it in the full SpeechDocViewer
// (outline, credibility, cross-ex, focus mode, find, etc.). A lightweight
// loading overlay is shown while the download is in progress.

function DisclosedFileModal({
  url, label, side, teamName, onClose,
}: {
  url: string; label: string; side: string; teamName: string; onClose: () => void;
}) {
  const { setView } = useApp();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetchRes = await window.warroom.opencaselist.fetchFileToTemp(url);
        if (cancelled) return;
        if (!fetchRes.ok) throw new Error(fetchRes.error ?? 'Could not download file.');

        // Pre-warm the OC cache so SpeechDocViewer opens instantly if the user
        // later saves this case.
        try {
          const readRes = await window.warroom.fs.readFileBytes(fetchRes.tempPath);
          if (readRes.ok && readRes.base64 && readRes.base64.length <= 2_500_000) {
            localStorage.setItem('warroom-oc-docx-' + url, readRes.base64);
          }
        } catch { /* quota — viewer will fetch on open */ }

        if (cancelled) return;
        onClose();
        setView({
          kind: 'speech-doc',
          docPath: fetchRes.tempPath,
          ocPreview: { url, teamName, label, side },
        } as any);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Unknown error');
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const modal = (
    <div
      className="flex flex-col items-center justify-center gap-4"
      style={{
        position: 'fixed', top: 36, left: 0, right: 0, bottom: 0, zIndex: 200,
        background: 'var(--bg-main)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {!error ? (
        <>
          <Spinner />
          <div className="text-sm text-ink/50">Loading {label}…</div>
          <button className="btn text-xs mt-2" onClick={onClose}>Cancel</button>
        </>
      ) : (
        <>
          <div className="border border-danger/30 rounded-sm bg-danger/5 p-3 text-sm text-danger max-w-md text-center">{error}</div>
          <div className="flex gap-2">
            <button className="btn text-xs" onClick={onClose}>Close</button>
            <button className="btn text-xs" onClick={() => window.warroom.opencaselist.openFile(url)}>
              Open in browser
            </button>
          </div>
        </>
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

// ─── Gemini team scouting summary ────────────────────────────────────────────

interface SummaryCitation { id: number; sourceTitle: string; excerpt: string }
interface TeamSummaryResult {
  aff: string;
  neg: string;
  citations: SummaryCitation[];
}

// ── Rich text renderer ────────────────────────────────────────────────────────
type RichNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'underline'; text: string }
  | { type: 'cite'; id: number };

function parseRich(text: string): RichNode[] {
  // Match **bold**, *italic*, __underline__, [cite:N]
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|\[cite:(\d+)\]/g;
  const nodes: RichNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: 'bold', text: m[1] });
    else if (m[2] !== undefined) nodes.push({ type: 'italic', text: m[2] });
    else if (m[3] !== undefined) nodes.push({ type: 'underline', text: m[3] });
    else if (m[4] !== undefined) nodes.push({ type: 'cite', id: parseInt(m[4], 10) });
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

function CitationChip({ id, citations }: { id: number; citations: SummaryCitation[] }) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const cite = citations.find((c) => c.id === id);

  // Close when clicking outside BOTH the button AND the popover
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const inBtn = btnRef.current?.contains(e.target as Node) ?? false;
      const inPop = popoverRef.current?.contains(e.target as Node) ?? false;
      if (!inBtn && !inPop) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function handleClick() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const POPOVER_W = 300;
    const left = Math.min(rect.left, window.innerWidth - POPOVER_W - 12);
    setPopoverPos({ top: rect.bottom + 6, left: Math.max(8, left) });
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        className="inline-flex items-center justify-center text-[10px] font-semibold rounded-full mx-0.5 transition select-none"
        style={{
          width: 16, height: 16,
          background: open ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.18)',
          color: '#818cf8',
          border: '1px solid rgba(99,102,241,0.35)',
          verticalAlign: 'middle',
          lineHeight: 1,
          display: 'inline-flex',
        }}
        title={cite?.sourceTitle ?? `Source ${id}`}
      >
        {id}
      </button>

      {/* Portal — renders at fixed viewport coords, never clipped by scroll containers */}
      {open && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            width: 300,
            zIndex: 9999,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            padding: 12,
          }}
        >
          {cite ? (
            <>
              <div className="text-[10px] font-semibold text-ink/50 uppercase tracking-wider mb-2">
                {cite.sourceTitle}
              </div>
              <div
                className="text-xs leading-relaxed"
                style={{
                  background: 'rgba(250,204,21,0.12)',
                  borderLeft: '2px solid rgba(250,204,21,0.6)',
                  padding: '5px 8px',
                  borderRadius: 2,
                }}
              >
                {cite.excerpt}
              </div>
            </>
          ) : (
            <div className="text-xs text-ink/40">Source {id}</div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

function RichText({ text, citations }: { text: string; citations: SummaryCitation[] }) {
  const nodes = parseRich(text);
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') return <React.Fragment key={i}>{n.text}</React.Fragment>;
        if (n.type === 'bold') return <strong key={i} className="font-bold text-ink">{n.text}</strong>;
        if (n.type === 'italic') return <em key={i} className="italic" style={{ color: '#818cf8' }}>{n.text}</em>;
        if (n.type === 'underline') return <u key={i} style={{ textDecoration: 'underline', textDecorationColor: 'currentColor', textDecorationSkipInk: 'none', textUnderlineOffset: '2px' }}>{n.text}</u>;
        if (n.type === 'cite') return <CitationChip key={i} id={n.id} citations={citations} />;
        return null;
      })}
    </>
  );
}

// Split prose into paragraphs and render each with rich text.
// The final paragraph is always bold — it's the prediction sentence.
function RichBody({ text, citations }: { text: string; citations: SummaryCitation[] }) {
  const paragraphs = text.split(/\n+/).filter((p) => p.trim());
  return (
    <div className="space-y-2.5 text-sm text-ink/80 leading-relaxed">
      {paragraphs.map((p, i) => {
        const isLast = i === paragraphs.length - 1;
        return (
          <p key={i} className={isLast ? 'font-bold text-ink' : ''}>
            <RichText text={p} citations={citations} />
          </p>
        );
      })}
    </div>
  );
}

// ── Main summary component ────────────────────────────────────────────────────
function GeminiTeamSummary({ disc, teamName, oppId }: { disc: any; teamName: string; oppId: string }) {
  const { update } = useApp();
  const rawRounds: any[] = disc?.rawRounds ?? [];
  const rawCites: any[] = disc?.rawCites ?? [];
  const hasData = rawRounds.length > 0 || rawCites.length > 0;

  // Load from cache if available
  const cached: TeamSummaryResult | undefined = disc?.aiScout;

  const [status, setStatus] = useState<'loading' | 'done' | 'error' | 'no-key' | 'no-data'>(
    cached ? 'done' : hasData ? 'loading' : 'no-data'
  );
  const [result, setResult] = useState<TeamSummaryResult | null>(cached ?? null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'aff' | 'neg'>('aff');

  // Guard: prevents double-invocation; also acts as cancellation flag on unmount
  const generatingRef = React.useRef(false);
  const cancelledRef = React.useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    // If we have a cached result, show it immediately — don't call Gemini
    if (cached) return;
    if (!hasData) return;
    if (generatingRef.current) return;
    generatingRef.current = true;
    generate();
    return () => { cancelledRef.current = true; }; // cancel on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const friendlyError = humanizeGeminiError;

  async function generate() {
    setStatus('loading');
    setError('');
    generatingRef.current = true;
    try {
      const res = await window.warroom.ai.teamSummary({ teamName, rawRounds, rawCites });
      if (cancelledRef.current) return; // navigated away — discard result
      if (!res.ok) {
        if (res.error === 'NO_KEY') { setStatus('no-key'); return; }
        setError(friendlyError(res.error ?? 'Analysis failed'));
        setStatus('error');
        return;
      }
      const scout: TeamSummaryResult = {
        aff: res.aff!,
        neg: res.neg!,
        citations: res.citations ?? [],
      };
      setResult(scout);
      setStatus('done');
      // Persist to DB so we don't call Gemini again on next visit
      await update((db) => ({
        ...db,
        opponents: {
          ...db.opponents,
          [oppId]: {
            ...db.opponents[oppId],
            disclosures: {
              ...(db.opponents[oppId]?.disclosures ?? {}),
              aiScout: { ...scout, generatedAt: new Date().toISOString() },
            },
          },
        },
      }));
    } catch (e: any) {
      setError(friendlyError(e.message ?? 'Unknown error'));
      setStatus('error');
    } finally {
      generatingRef.current = false;
    }
  }

  if (status === 'no-data') return null;

  return (
    <div
      className="rounded-sm p-4 space-y-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-sm"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
          >
            AI Scout
          </span>
          <span className="text-xs font-medium text-ink/70">Gemini analysis</span>
        </div>
        {(status === 'done' || status === 'error') && (
          <button className="btn text-[11px]" onClick={generate}>Regenerate</button>
        )}
      </div>

      {/* Loading */}
      {status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-ink/50 py-2">
          <Spinner />
          Analyzing {rawRounds.length} rounds and {rawCites.length} cites…
        </div>
      )}

      {/* No Gemini key */}
      {status === 'no-key' && (
        <div className="text-xs text-ink/50 italic py-1">
          Add a Gemini API key in Settings to get AI scouting reports.
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="text-xs text-danger py-1">{error}</div>
      )}

      {/* Done */}
      {status === 'done' && result && (
        <div className="space-y-3">
          {/* Aff / Neg tabs */}
          <div className="flex gap-1">
            {(['aff', 'neg'] as const).map((side) => (
              <button
                key={side}
                onClick={() => setActiveTab(side)}
                className={`text-xs px-3 py-1 rounded-sm border transition font-medium ${
                  activeTab === side
                    ? side === 'aff' ? 'badge-aff border-transparent' : 'badge-neg border-transparent'
                    : 'border-line text-ink/40 hover:text-ink/60'
                }`}
              >
                {side === 'aff' ? 'Aff' : 'Neg'}
              </button>
            ))}
          </div>

          {/* Rich analysis body */}
          <div style={{ maxHeight: 380, overflowY: 'auto' }} className="scroll-thin pr-1">
            <RichBody
              text={activeTab === 'aff' ? result.aff : result.neg}
              citations={result.citations}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-sm p-4">
      <div className="label mb-2">{title}</div>
      {children}
    </div>
  );
}

function NotesEditor({ opp }: { opp: any }) {
  const { update } = useApp();
  const [notes, setNotes] = useState(opp.notes ?? '');

  // Stable cross-user entity ID: prefer OpenCaselist teamId, else school/teamName slug
  const entityId = opp.teamId
    ? String(opp.teamId)
    : `${opp.school ?? ''}/${opp.teamName ?? ''}`.toLowerCase().replace(/\s+/g, '-');

  function saveLocal(val: string) {
    update((db) => ({ ...db, opponents: { ...db.opponents, [opp.id]: { ...opp, notes: val } } }));
  }

  return (
    <SharedNotesEditor
      entityType="opponent"
      entityId={entityId}
      entityName={opp.teamName ?? opp.school ?? 'Opponent'}
      localNotes={notes}
      onLocalChange={setNotes}
      onLocalSave={saveLocal}
    />
  );
}

// ─── Debate Land stats ────────────────────────────────────────────────────────

type DLEvent = 'policy' | 'pf' | 'ld';

interface DLCandidate {
  name: string;
  teamId: string;
  otr: number | null;
  rank: number | null;
  totalRecord: string | null;
  speaks: number | null;
  event: DLEvent;
}

const DL_EVENT_LABELS: Record<DLEvent, string> = {
  policy: 'Policy',
  pf: 'Public Forum',
  ld: 'Lincoln-Douglas',
};

function DebateLandSection({ opp }: { opp: any }) {
  const { update, event } = useApp();
  const [dlEvent, setDlEvent] = useState<DLEvent>(() => {
    if (event === 'pf') return 'pf';
    if (event === 'ld') return 'ld';
    return 'policy';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<DLCandidate[] | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(opp.teamName ?? '');

  const stats: OpponentStats | undefined = opp.stats;
  const hasDLStats = stats?.source === 'debate.land';

  useEffect(() => {
    if (!hasDLStats) search();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchFullStats(candidate: DLCandidate) {
    setLoading(true);
    setError('');
    setCandidates(null);
    try {
      const res = await window.warroom.dl.getTeamStats({ teamId: candidate.teamId, eventType: candidate.event });
      if (!res.success) {
        setError(res.error ?? 'Could not load stats from Debate Land — check your connection');
        return;
      }
      await update((db) => ({
        ...db,
        opponents: {
          ...db.opponents,
          [opp.id]: { ...db.opponents[opp.id], stats: res.stats },
        },
      }));
    } catch (_) {
      setError('Could not load stats from Debate Land — check your connection');
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    setLoading(true);
    setError('');
    setCandidates(null);
    try {
      const res = await window.warroom.dl.searchTeam({ query: searchQuery.trim() || opp.teamName, eventType: dlEvent });
      if (!res.success) {
        setError('Could not load stats from Debate Land — check your connection');
        return;
      }
      const results: DLCandidate[] = res.results ?? [];
      if (results.length === 0) {
        setError(`No ${DL_EVENT_LABELS[dlEvent]} teams found matching "${searchQuery.trim() || opp.teamName}" — try just the school name or use fewer words`);
        return;
      }
      if (results.length === 1) {
        await fetchFullStats(results[0]);
        return;
      }
      setCandidates(results);
    } catch (_) {
      setError('Could not load stats from Debate Land — check your connection');
    } finally {
      setLoading(false);
    }
  }

  const eventBadge = hasDLStats
    ? (stats!.event === 'policy' ? 'Policy' : stats!.event === 'pf' ? 'PF' : 'LD')
    : null;

  return (
    <Section title="Debate Land stats">
      {/* Event selector + search input — shown when no stats loaded yet, or during disambiguation/error */}
      {(!hasDLStats || candidates != null || error) && (
        <div className="space-y-2 mb-3">
          <div className="flex gap-1">
            {(['policy', 'pf', 'ld'] as DLEvent[]).map((ev) => (
              <button
                key={ev}
                className={`text-xs px-2.5 py-1 rounded-sm border transition ${
                  dlEvent === ev
                    ? 'bg-ink/10 border-ink/30 text-ink'
                    : 'border-line text-ink/40 hover:border-ink/20 hover:text-ink/60'
                }`}
                onClick={() => setDlEvent(ev)}
              >
                {DL_EVENT_LABELS[ev]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 text-xs bg-transparent border border-line rounded-sm px-2 py-1 text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
              placeholder="Team name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            />
            <button className="btn text-xs" onClick={search} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {/* Stats display */}
      {hasDLStats && stats!.lastFetched && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-ink/10 text-ink/60 font-medium">
              {eventBadge}
            </span>
            {stats!.debateLandUrl && (
              <button
                className="text-xs text-ink/40 hover:text-ink"
                onClick={() => window.warroom.opencaselist.openFile(stats!.debateLandUrl!)}
              >
                ↗ Debate Land
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {stats!.careerOTR != null && (
              <StatRow label="Career OTR" value={stats!.careerOTR.toFixed(3)} />
            )}
            {stats!.peakRank != null && (
              <StatRow label="Peak rank" value={`#${stats!.peakRank}`} />
            )}
            {stats!.totalRecord && (
              <StatRow label="Total record" value={stats!.totalRecord} />
            )}
            {stats!.prelimRecord && (
              <StatRow label="Prelim record" value={stats!.prelimRecord} />
            )}
            {stats!.prelimWinPct && (
              <StatRow label="Prelim win %" value={stats!.prelimWinPct} />
            )}
            {stats!.avgSpeaks != null && (
              <StatRow label="Avg speaks" value={stats!.avgSpeaks.toFixed(1)} />
            )}
            {stats!.totalBids != null && (
              <StatRow label="Total bids" value={String(stats!.totalBids)} />
            )}
            {stats!.avgBreakPct && (
              <StatRow label="Avg break %" value={stats!.avgBreakPct} />
            )}
            {stats!.avgTrueWinPct && (
              <StatRow label="Avg true win %" value={stats!.avgTrueWinPct} />
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[11px] text-ink/30">
              Updated {new Date(stats!.lastFetched).toLocaleString()}
            </span>
            <button className="btn text-xs" onClick={search} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-xs text-ink/40">Searching Debate Land…</div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="text-xs text-danger">{error}</div>
      )}

      {/* Disambiguation */}
      {candidates && (
        <div className="space-y-1">
          <div className="text-xs text-ink/50 mb-1">Multiple matches — pick the right team:</div>
          {candidates.map((c, i) => (
            <button
              key={c.teamId ?? i}
              className="w-full text-left glass-card rounded-sm px-3 py-2 hover:border-ink/30 text-xs"
              onClick={() => fetchFullStats(c)}
            >
              <span className="font-medium">{c.name}</span>
              {c.otr != null && (
                <span className="text-ink/50 ml-2">OTR: {c.otr.toFixed(3)}</span>
              )}
              {c.totalRecord && (
                <span className="text-ink/50 ml-2">{c.totalRecord}</span>
              )}
            </button>
          ))}
          <button
            className="text-xs text-ink/40 hover:text-ink mt-1"
            onClick={() => setCandidates(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </Section>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink/50">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function RePullButton({ opp }: { opp: any }) {
  const { update, setView } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!opp.teamId) return null;

  async function rePull() {
    setLoading(true);
    setError('');
    try {
      const caselist = opp.caselist ?? 'hspolicy';
      const [roundsRes, citesRes] = await Promise.all([
        window.warroom.opencaselist.rounds(caselist, opp.school, opp.teamId),
        window.warroom.opencaselist.cites(caselist, opp.school, opp.teamId),
      ]);

      if (!roundsRes.ok) throw new Error(roundsRes.error ?? 'Could not fetch rounds');

      const roundList: any[] = Array.isArray(roundsRes.data) ? roundsRes.data : roundsRes.data?.rounds ?? [];
      const citeList: any[] = citesRes.ok
        ? (Array.isArray(citesRes.data) ? citesRes.data : citesRes.data?.cites ?? [])
        : [];

      const affCites = citeList.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      const negCites = citeList.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'));
      const affRounds = roundList.filter((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));

      const aff = affCites.length
        ? { name: affCites[0].title ?? affCites[0].cites?.slice(0, 100) ?? 'Aff', description: '' }
        : affRounds.length ? { name: 'Aff', description: '' } : undefined;

      const negPositions = Array.from(
        new Set(negCites.map((c: any) => c.title ?? c.cites?.slice(0, 100) ?? '').filter(Boolean))
      ).map((name) => ({ name: name as string }));

      await update((db) => {
        const current = db.opponents[opp.id];
        return {
          ...db,
          opponents: {
            ...db.opponents,
            [opp.id]: {
              ...current,
              disclosures: {
                ...(current?.disclosures as any),
                pulledAt: new Date().toISOString(),
                roundsDisclosed: roundList.length,
                aff,
                neg: negPositions,
                rawRounds: roundList,
                rawCites: citeList,
              },
            },
          },
        };
      });
    } catch (e: any) {
      setError(e.message ?? 'Could not reach OpenCaselist.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn text-xs" onClick={rePull} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh disclosure'}
      </button>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
