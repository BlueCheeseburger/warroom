import React, { useState, useEffect } from 'react';
import { useApp } from '../store/appStore';
import { Block, Round } from '../types';
import { Dots } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';

const CURRENT_YEAR = new Date().getFullYear();


export default function MissionBrief() {
  const { db, view, update, setView } = useApp();
  if (view.kind !== 'round') return null;
  const round = db.rounds[view.roundId];
  if (!round) return <div className="p-8 text-sm text-ink/50">Round not found.</div>;
  const tournament = db.tournaments[round.tournamentId];
  const opponent = round.opponentId ? db.opponents[round.opponentId] : undefined;

  return (
    <div className="flex flex-col h-full">
      <RoundHeader round={round} tournament={tournament} />
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="p-6 space-y-5 max-w-4xl">
          {round.isBye && (
            <div className="glass-card rounded-sm p-4 text-center">
              <div className="text-2xl mb-1">🎉</div>
              <div className="font-semibold text-base">BYE Round</div>
              <p className="text-sm text-ink/50 mt-1">Free win — no round needed.</p>
            </div>
          )}
          {!round.isBye && (
            <>
              <MissionBriefAI round={round} opponent={opponent} />
              <OpponentCard round={round} opponent={opponent} />
              <JudgePanel round={round} />
              <SuggestedBlocks round={round} opponent={opponent} />
              <Checklist round={round} opponent={opponent} />
            </>
          )}
          {(round.result === 'win' || round.result === 'loss') && (
            <Debrief round={round} />
          )}
          {round.autoFilled && (
            <p className="text-[11px] text-ink/30 text-center pb-2">
              ✦ Auto-filled by Tabroom Monitor
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Round header ─────────────────────────────────────────────────────────────

function RoundHeader({ round, tournament }: { round: Round; tournament: any }) {
  const { update, setView } = useApp();
  const [editing, setEditing] = useState(false);
  const [room, setRoom] = useState(round.room ?? '');
  const [time, setTime] = useState(round.time ?? '');

  async function save() {
    await update((db) => ({
      ...db,
      rounds: { ...db.rounds, [round.id]: { ...round, room, time } },
    }));
    setEditing(false);
  }

  return (
    <div className="px-6 py-4 glass-elevated flex items-start justify-between gap-4">
      <div>
        <button
          onClick={() => setView({ kind: 'tournament', tournamentId: round.tournamentId })}
          className="text-xs text-ink/40 hover:text-ink mb-1"
        >
          ← {tournament?.name ?? 'Tournament'}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold">Round {round.number}</h1>
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium ${round.side === 'aff' ? 'badge-aff' : 'badge-neg'}`}>
            {round.side}
          </span>
          <ResultBadge result={round.result} roundId={round.id} />
        </div>
        {editing ? (
          <div className="flex gap-2 mt-2">
            <input className="input text-xs" placeholder="Room" value={room} onChange={(e) => setRoom(e.target.value)} />
            <input className="input text-xs" placeholder="Time" value={time} onChange={(e) => setTime(e.target.value)} />
            <button className="btn-primary text-xs" onClick={save}>Save</button>
            <button className="btn text-xs" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <div className="flex gap-3 mt-1 text-xs text-ink/40">
            {round.room && <span>Room: {round.room}</span>}
            {round.time && <span>Time: {round.time}</span>}
            <button className="hover:text-ink" onClick={() => setEditing(true)}>Edit details</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBadge({ result, roundId }: { result: Round['result']; roundId: string }) {
  const { update, db } = useApp();
  const round = db.rounds[roundId];

  async function setResult(r: Round['result']) {
    await update((db) => ({ ...db, rounds: { ...db.rounds, [roundId]: { ...round, result: r } } }));
  }

  const options: Round['result'][] = ['win', 'loss', 'pending'];
  return (
    <select
      value={result}
      onChange={(e) => setResult(e.target.value as Round['result'])}
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border font-medium appearance-none cursor-pointer ${
        result === 'win' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
        result === 'loss' ? 'bg-danger/10 text-danger border-danger/20' :
        'bg-line text-ink/50 border-line'
      }`}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── Opponent card ────────────────────────────────────────────────────────────

function OpponentCard({ round, opponent }: { round: Round; opponent: any }) {
  const { setView } = useApp();
  const disc = opponent?.disclosures as any;
  const [affExpanded, setAffExpanded] = useState(false);

  // Resolve aff/neg — prefer structured fields, fall back to raw OC data
  const affEntry: { name: string; description?: string } | undefined = disc?.aff ?? (() => {
    if (!disc?.rawRounds?.length && !disc?.rawCites?.length) return undefined;
    const rawCites: any[] = disc?.rawCites ?? [];
    const rawRounds: any[] = disc?.rawRounds ?? [];
    const affCite = rawCites.find((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
    const affRound = rawRounds.find((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));
    const name = affCite?.title ?? affCite?.cites?.slice(0, 100) ?? (affRound ? 'Aff' : null);
    return name ? { name } : undefined;
  })();

  const negEntries: { name: string }[] = disc?.neg?.length ? disc.neg : (() => {
    if (!disc?.rawCites?.length) return [];
    const rawCites: any[] = disc?.rawCites ?? [];
    return Array.from(
      new Set(
        rawCites
          .filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'))
          .map((c: any) => c.title ?? c.cites?.slice(0, 100) ?? '')
          .filter(Boolean)
      )
    ).map((name) => ({ name: name as string }));
  })();

  return (
    <div className="glass-card rounded-sm p-4">
      <div className="label mb-2">Opponent</div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">
            {opponent ? (
              <button className="hover:underline" onClick={() => setView({ kind: 'opponent', opponentId: opponent.id })}>
                {opponent.teamName}
              </button>
            ) : (
              round.opponentName ?? 'Unknown opponent'
            )}
          </div>
          {opponent?.school && <div className="text-xs text-ink/50">{opponent.school}</div>}
          {disc?.roundsDisclosed != null && (
            <div className="text-xs text-ink/40 mt-0.5">{disc.roundsDisclosed} rounds disclosed</div>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm shrink-0 ${disc?.roundsDisclosed ? 'bg-emerald-100 text-emerald-700' : 'bg-line text-ink/40'}`}>
          {disc?.roundsDisclosed ? 'Disclosure found' : 'No disclosure'}
        </span>
      </div>

      <OpponentStatsBar opponent={opponent} />

      {affEntry && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-xs text-ink/50 mb-1">Aff</div>
          <div className="text-sm font-medium">{affEntry.name}</div>
          {affEntry.description && (
            <>
              <div className={`text-xs text-ink/60 mt-1 ${affExpanded ? '' : 'line-clamp-2'}`}>{affEntry.description}</div>
              {affEntry.description.length > 100 && (
                <button className="text-[11px] text-ink/40 hover:text-ink mt-1" onClick={() => setAffExpanded(!affExpanded)}>
                  {affExpanded ? 'Collapse' : 'Expand'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {negEntries.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-xs text-ink/50 mb-1">Neg positions</div>
          <ul className="space-y-1">
            {negEntries.map((p, i) => (
              <NegCiteEntry key={i} entry={p} rawCites={disc?.rawCites ?? []} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NegCiteEntry({ entry, rawCites }: { entry: { name: string }; rawCites: any[] }) {
  const [open, setOpen] = useState(false);
  // Find cites matching this position's title
  const matchingCites = rawCites.filter(
    (c: any) => (c.side ?? '').toLowerCase().startsWith('n') &&
      (c.title === entry.name || (c.title ?? c.cites?.slice(0, 100)) === entry.name)
  );
  const hasCites = matchingCites.some((c: any) => c.cites?.trim());

  return (
    <li>
      <div className="flex items-start gap-1">
        {hasCites ? (
          <button
            className="text-sm text-left flex-1 hover:text-ink/80 transition"
            onClick={() => setOpen(!open)}
          >
            <span className="mr-1 text-ink/30 text-xs">{open ? '▾' : '▸'}</span>
            {entry.name}
          </button>
        ) : (
          <span className="text-sm flex-1">{entry.name}</span>
        )}
      </div>
      {open && hasCites && (
        <div className="mt-1 ml-3 space-y-2">
          {matchingCites.filter((c: any) => c.cites?.trim()).map((c: any, ci: number) => (
            <div key={ci} className="text-xs text-ink/60 bg-panel rounded px-2 py-1.5 leading-relaxed whitespace-pre-wrap border border-line">
              {c.cite && <div className="font-medium text-ink/80 mb-0.5">{c.cite}</div>}
              {c.cites?.slice(0, 800)}
              {(c.cites?.length ?? 0) > 800 && <span className="text-ink/30"> …</span>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

// ─── Judge panel ──────────────────────────────────────────────────────────────

function JudgePanel({ round }: { round: Round }) {
  const { update } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const hasJudge = !!(round.judgeName || round.judgeParadigm);
  if (!hasJudge && !round.judgeId) return null;

  // Auto-fetch paradigm on mount if we have a name but no paradigm yet
  useEffect(() => {
    if (round.judgeParadigm) return;  // already have it
    if (round.judgeId) {
      // Have a Tabroom ID — fetch directly
      fetchParadigm();
    } else if (round.judgeName) {
      // Name-only (email import) — search Tabroom by name
      fetchParadigmByName();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  async function fetchParadigm() {
    if (!round.judgeId) return;
    setFetching(true); setFetchError('');
    try {
      const res = await window.warroom.tabroom.monitor.fetchParadigm(round.judgeId!);
      if (!res.ok || !res.text) throw new Error(res.error ?? 'No paradigm found');
      await update((db) => ({
        ...db,
        rounds: { ...db.rounds, [round.id]: { ...round, judgeParadigm: res.text! } },
      }));
    } catch (e: any) {
      setFetchError(e.message ?? 'Failed to fetch paradigm');
    } finally {
      setFetching(false);
    }
  }

  async function fetchParadigmByName() {
    if (!round.judgeName) return;
    setFetching(true); setFetchError('');
    try {
      const res = await window.warroom.tabroom.fetchParadigmByName(round.judgeName);
      if (!res.ok) throw new Error(res.error ?? 'Not found on Tabroom');
      await update((db) => ({
        ...db,
        rounds: {
          ...db.rounds,
          [round.id]: {
            ...round,
            ...(res.personId && { judgeId: res.personId }),
            ...(res.paradigm && { judgeParadigm: res.paradigm }),
          },
        },
      }));
      if (!res.paradigm) setFetchError(`Found ${round.judgeName} on Tabroom but no paradigm written yet.`);
    } catch (e: any) {
      setFetchError(e.message ?? 'Could not find judge on Tabroom');
    } finally {
      setFetching(false);
    }
  }

  const paradigmText = round.judgeParadigm ?? '';
  const PREVIEW_LEN = 400;

  return (
    <div className="glass-card rounded-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="label">Judge</div>
        {!round.judgeParadigm && (
          <button className="btn text-xs" onClick={round.judgeId ? fetchParadigm : fetchParadigmByName} disabled={fetching}>
            {fetching ? <Dots /> : 'Fetch paradigm'}
          </button>
        )}
      </div>

      {round.judgeName && (
        <div className="font-semibold text-sm mb-1">{round.judgeName}</div>
      )}

      {fetching && <p className="text-xs text-ink/40 italic mb-1">Searching Tabroom…</p>}
      {fetchError && <p className="text-xs text-danger mb-2">{fetchError}</p>}

      {paradigmText ? (
        <div>
          <p className="text-xs text-ink/70 leading-relaxed whitespace-pre-wrap">
            {expanded ? paradigmText : paradigmText.slice(0, PREVIEW_LEN)}
            {!expanded && paradigmText.length > PREVIEW_LEN && '…'}
          </p>
          {paradigmText.length > PREVIEW_LEN && (
            <button
              className="text-[11px] text-ink/40 hover:text-ink mt-1"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Collapse' : 'Read full paradigm'}
            </button>
          )}
        </div>
      ) : (!fetching && !fetchError) ? (
        <p className="text-xs text-ink/40 italic">No paradigm found.</p>
      ) : null}

      <div className="mt-3 pt-3 border-t border-line">
        <JudgeNotesInline round={round} />
      </div>
    </div>
  );
}

function JudgeNotesInline({ round }: { round: Round }) {
  const { update } = useApp();
  const [notes, setNotes] = useState(round.judgeNotes ?? '');
  const [dirty, setDirty] = useState(false);

  async function save() {
    await update((db) => ({ ...db, rounds: { ...db.rounds, [round.id]: { ...round, judgeNotes: notes } } }));
    setDirty(false);
  }

  return (
    <div>
      <div className="text-[11px] text-ink/40 mb-1">Personal notes</div>
      <textarea
        className="input w-full h-14 resize-none text-xs"
        placeholder="Judge tendencies, pet peeves…"
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
      />
      {dirty && <button className="btn-primary text-xs mt-1" onClick={save}>Save</button>}
    </div>
  );
}

// ─── Opponent stats bar (Debate Land) ────────────────────────────────────────

function OpponentStatsBar({ opponent }: { opponent: any }) {
  const stats = opponent?.stats;
  if (!stats?.lastFetched || stats?.source !== 'debate.land') return null;

  const parts: string[] = [];
  if (stats.careerOTR != null) parts.push(`OTR: ${stats.careerOTR.toFixed(3)}`);
  if (stats.peakRank != null) parts.push(`Rank: #${stats.peakRank}`);
  if (stats.totalRecord) parts.push(stats.totalRecord);
  if (stats.prelimWinPct) parts.push(`Win%: ${stats.prelimWinPct}`);
  if (stats.avgSpeaks != null) parts.push(`Speaks: ${stats.avgSpeaks.toFixed(1)}`);
  if (stats.totalBids != null && stats.totalBids > 0) parts.push(`Bids: ${stats.totalBids}`);

  if (parts.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-line">
      <p className="text-[11px] text-ink/40 tracking-wide">
        {parts.join('  ·  ')}
      </p>
    </div>
  );
}

// ─── AI Mission Brief ─────────────────────────────────────────────────────────

/** Renders the Gemini briefing text. Handles **bold**, bullet lists, and section headers. */
function BriefingText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        // Section headers: **HEADER**
        const headerMatch = line.match(/^\*\*([^*]+)\*\*\s*$/);
        if (headerMatch) {
          return (
            <div key={i} className="font-semibold text-ink mt-3 mb-0.5 text-[11px] uppercase tracking-wider text-ink/50 first:mt-0">
              {headerMatch[1]}
            </div>
          );
        }
        // Bullet points
        if (line.match(/^[-•*]\s/)) {
          const content = line.replace(/^[-•*]\s/, '');
          return (
            <div key={i} className="flex gap-2">
              <span className="text-ink/30 shrink-0 mt-0.5">·</span>
              <span>{renderInline(content)}</span>
            </div>
          );
        }
        // Empty line
        if (!line.trim()) return <div key={i} className="h-1" />;
        // Normal line
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function MissionBriefAI({ round, opponent }: { round: Round; opponent: any }) {
  const { update } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const storedBrief: string | undefined = (round as any).missionBrief;

  // Auto-generate on first open if no brief yet (and not a bye)
  useEffect(() => {
    if (!storedBrief && !loading && !round.isBye) {
      generate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  const disc = opponent?.disclosures as any;

  function buildParams() {
    let affName: string | undefined;
    let negPositions: string[] = [];
    let rawCitesSample = '';

    if (disc?.aff?.name) affName = disc.aff.name;
    if (disc?.neg?.length) negPositions = disc.neg.map((n: any) => n.name).filter(Boolean);

    // Fall back to raw OC data
    if (!affName && !negPositions.length && (disc?.rawCites?.length || disc?.rawRounds?.length)) {
      const rawCites: any[] = disc.rawCites ?? [];
      const rawRounds: any[] = disc.rawRounds ?? [];
      const affCite = rawCites.find((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      const affRound = rawRounds.find((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));
      affName = affCite?.title ?? affCite?.cites?.slice(0, 100) ?? (affRound ? 'Aff' : undefined);
      const negSet = new Set(
        rawCites
          .filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'))
          .map((c: any) => c.title ?? c.cites?.slice(0, 80) ?? '')
          .filter(Boolean)
      );
      negPositions = Array.from(negSet) as string[];
      // Sample raw cite text for more context
      rawCitesSample = rawCites
        .filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n') && c.cites?.trim())
        .slice(0, 3)
        .map((c: any) => `[${c.title ?? 'Neg'}]\n${c.cites?.slice(0, 400)}`)
        .join('\n\n');
    }

    return {
      roundNumber: round.number,
      side: round.side,
      room: round.room,
      time: round.time,
      opponentName: opponent?.teamName ?? round.opponentName ?? 'Unknown',
      judgeName: round.judgeName,
      judgeParadigm: round.judgeParadigm,
      affName,
      negPositions,
      rawCitesSample,
    };
  }

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const params = buildParams();
      const res = await window.warroom.ai.missionBrief(params);
      if (!res.ok || !res.text) {
        setError(humanizeGeminiError(res.error));
        return;
      }
      // Persist the brief on the round
      await update((db) => ({
        ...db,
        rounds: { ...db.rounds, [round.id]: { ...(db.rounds[round.id] ?? round), missionBrief: res.text } },
      }));
    } catch (e: any) {
      setError(humanizeGeminiError(e.message));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-sm p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(26,115,232,0.07) 0%, rgba(66,133,244,0.04) 100%)',
        border: '1px solid rgba(66,133,244,0.25)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Gemini spark icon */}
          <svg width="14" height="14" viewBox="0 0 28 28" fill="none" style={{ flexShrink: 0 }}>
            <path d="M14 2C14 8.627 8.627 14 2 14C8.627 14 14 19.373 14 26C14 19.373 19.373 14 26 14C19.373 14 14 8.627 14 2Z" fill="#4285F4"/>
          </svg>
          <div className="label" style={{ color: 'rgba(66,133,244,0.9)' }}>Briefing</div>
        </div>
        <button className="btn text-xs" onClick={generate} disabled={loading}>
          {loading ? <Dots /> : storedBrief ? 'Regenerate' : 'Generate briefing'}
        </button>
      </div>

      {error && <div className="text-xs text-danger mb-2">{error}</div>}

      {loading && (
        <div className="text-xs text-ink/40 italic">Analyzing opponent and judge…</div>
      )}

      {storedBrief && !loading && (
        <BriefingText text={storedBrief} />
      )}

      {!storedBrief && !loading && !error && (
        <div className="text-sm text-ink/40 italic">
          Click "Generate briefing" for an AI-powered strategy brief covering the opponent's disclosure, judge tendencies, and what to run.
        </div>
      )}
    </div>
  );
}

// ─── Suggested blocks ─────────────────────────────────────────────────────────

function SuggestedBlocks({ round, opponent }: { round: Round; opponent: any }) {
  const { db, update, setView } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const allBlocks = Object.values(db.blocks);

  const suggestedIds: string[] = round.suggestedBlocks ?? [];
  const suggested = suggestedIds.map((id) => db.blocks[id]).filter(Boolean);

  async function loadSuggestions() {
    if (allBlocks.length === 0) { setError('Add some blocks to your cases first.'); return; }
    const disc = opponent?.disclosures as any;

    // Build position strings from structured aff/neg if available, otherwise fall back
    // to deriving from rawRounds/rawCites (the format stored by the Tabroom Monitor).
    let affName: string | null = disc?.aff?.name ?? null;
    let negNames: string[] = (disc?.neg ?? []).map((n: any) => n.name).filter(Boolean);

    if (!affName && !negNames.length && disc?.rawRounds?.length) {
      const rawCites: any[] = disc.rawCites ?? [];
      const rawRounds: any[] = disc.rawRounds ?? [];
      const affCite = rawCites.find((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      const affRound = rawRounds.find((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));
      affName = affCite?.title ?? affCite?.cites?.slice(0, 100) ?? (affRound ? 'Aff' : null);
      negNames = Array.from(
        new Set(
          rawCites
            .filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'))
            .map((c: any) => c.title ?? c.cites?.slice(0, 100) ?? '')
            .filter(Boolean)
        )
      );
    }

    if (!affName && !negNames.length) { setError('No disclosure loaded for this opponent.'); return; }

    const positions = [
      affName ? `Aff: ${affName}` : '',
      ...negNames.map((n) => `Neg: ${n}`),
    ].filter(Boolean).join('\n');

    setLoading(true);
    setError('');
    try {
      const blockList = allBlocks.map((b) => ({ id: b.id, title: b.title }));
      const ids = await window.warroom.ai.suggestBlocks(positions, blockList);
      await update((db) => ({
        ...db,
        rounds: { ...db.rounds, [round.id]: { ...round, suggestedBlocks: ids } },
      }));
    } catch (e: any) {
      const msg = e?.message ?? '';
      setError(msg === 'NO_KEY' ? 'Add your Gemini API key in Settings to get block suggestions.' : `AI request failed — ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Suggested blocks</div>
        {allBlocks.length > 0 && (
          <button className="btn text-xs" onClick={loadSuggestions} disabled={loading}>
            {loading ? <Dots /> : suggestedIds.length ? 'Refresh' : 'Load suggestions'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-danger mb-2">{error}</div>}

      {suggestedIds.length === 0 && !loading && (
        <div className="text-sm text-ink/40 italic">
          {allBlocks.length === 0
            ? 'Add blocks to your cases first.'
            : 'Click "Load suggestions" to get AI-powered block recommendations.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {suggested.map((block) => {
          const cardCount = block.cards.length;
          const outdated = block.cards.filter((id) => {
            const c = db.cards[id];
            return c && CURRENT_YEAR - c.year > 4;
          }).length;
          return (
            <button
              key={block.id}
              onClick={() => setView({ kind: 'block', blockId: block.id })}
              className="text-left glass-card rounded-sm bg-panel px-3 py-2 hover:border-ink/30 transition"
            >
              <div className="text-sm font-medium truncate">{block.title}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-ink/40">{cardCount} card{cardCount !== 1 ? 's' : ''}</span>
                {outdated > 0 && (
                  <span className="text-[10px] text-warn">· {outdated} outdated</span>
                )}
              </div>
              <div className="text-[11px] text-ink/30 mt-0.5">
                {new Date(block.updatedAt).toLocaleDateString()}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Checklist ────────────────────────────────────────────────────────────────

function Checklist({ round, opponent }: { round: Round; opponent: any }) {
  const { db, update } = useApp();
  const [judgeNotes, setJudgeNotes] = useState(round.judgeNotes ?? '');
  const [dirty, setDirty] = useState(false);

  const disc = opponent?.disclosures as any;
  const disclosurePulled = !!disc?.pulledAt;
  const blocksSurfaced = (round.suggestedBlocks?.length ?? 0) > 0;

  // Count outdated cards in suggested blocks
  const outdatedWarnings: string[] = [];
  (round.suggestedBlocks ?? []).forEach((blockId) => {
    const block = db.blocks[blockId];
    if (!block) return;
    const count = block.cards.filter((id) => {
      const c = db.cards[id];
      return c && CURRENT_YEAR - c.year > 4;
    }).length;
    if (count > 0) outdatedWarnings.push(`${count} outdated in ${block.title}`);
  });

  async function saveNotes() {
    await update((db) => ({ ...db, rounds: { ...db.rounds, [round.id]: { ...round, judgeNotes } } }));
    setDirty(false);
  }

  return (
    <div className="glass-card rounded-sm p-4 space-y-3">
      <div className="label">Pre-round checklist</div>
      <CheckItem ok={disclosurePulled} label="Disclosure pulled" />
      <CheckItem ok={blocksSurfaced} label="Blocks surfaced" />
      {outdatedWarnings.map((w, i) => (
        <div key={i} className="flex items-center gap-2 text-warn">
          <span className="text-sm">⚠</span>
          <span className="text-xs">{w}</span>
        </div>
      ))}
      {/* Only show judge notes here if there's no JudgePanel (i.e. no auto-filled judge data) */}
      {!round.judgeName && !round.judgeId && (
        <div className="pt-2 border-t border-line">
          <div className="label mb-1">Judge paradigm notes</div>
          <textarea
            className="input w-full h-20 resize-y text-xs"
            placeholder="Note judge tendencies, preferences, pet peeves…"
            value={judgeNotes}
            onChange={(e) => { setJudgeNotes(e.target.value); setDirty(true); }}
          />
          {dirty && <button className="btn-primary text-xs mt-1" onClick={saveNotes}>Save</button>}
        </div>
      )}
    </div>
  );
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-bold ${ok ? 'text-emerald-600' : 'text-ink/30'}`}>{ok ? '✓' : '✗'}</span>
      <span className={`text-sm ${ok ? 'text-ink' : 'text-ink/50'}`}>{label}</span>
    </div>
  );
}

// ─── Post-round debrief ───────────────────────────────────────────────────────

function Debrief({ round }: { round: Round }) {
  const { db, update } = useApp();
  const allBlocks = Object.values(db.blocks);
  const [argsRead, setArgsRead] = useState<string[]>(round.argsRead ?? []);
  const [argsWorked, setArgsWorked] = useState(round.argsWorked?.join('\n') ?? '');
  const [argsFailed, setArgsFailed] = useState(round.argsFailed?.join('\n') ?? '');
  const [saved, setSaved] = useState(false);

  function toggleBlock(id: string) {
    setArgsRead((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function save() {
    await update((db) => ({
      ...db,
      rounds: {
        ...db.rounds,
        [round.id]: {
          ...round,
          argsRead,
          argsWorked: argsWorked.split('\n').map((s) => s.trim()).filter(Boolean),
          argsFailed: argsFailed.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      },
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="glass-card rounded-sm p-4 space-y-4">
      <div className="label">Post-round debrief</div>
      <div>
        <div className="text-xs text-ink/50 mb-1">Arguments read (select blocks)</div>
        <div className="grid grid-cols-2 gap-1">
          {allBlocks.map((b) => (
            <label key={b.id} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={argsRead.includes(b.id)} onChange={() => toggleBlock(b.id)} />
              <span className="text-xs truncate">{b.title}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-ink/50 mb-1">What worked (one per line)</div>
        <textarea className="input w-full h-16 resize-none text-xs" value={argsWorked} onChange={(e) => setArgsWorked(e.target.value)} />
      </div>
      <div>
        <div className="text-xs text-ink/50 mb-1">What failed (one per line)</div>
        <textarea className="input w-full h-16 resize-none text-xs" value={argsFailed} onChange={(e) => setArgsFailed(e.target.value)} />
      </div>
      <button className="btn-primary text-xs" onClick={save}>{saved ? 'Saved ✓' : 'Save debrief'}</button>
    </div>
  );
}
