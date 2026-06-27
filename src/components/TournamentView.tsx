import React, { useState, useEffect, useCallback } from 'react';
import { useApp, useDangerBtnClass, DebateEvent } from '../store/appStore';
import { DB, Opponent, Round, Side, Tournament } from '../types';
import { TrashIcon, Dots } from './Spinner';

function seasonYearSuffix(): string {
  const now = new Date();
  const yr = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return yr.toString().slice(-2);
}

type UpdateFn = (fn: (db: DB) => DB) => Promise<void>;

// Background: pull an opponent's disclosure (OpenCaselist), competitive stats
// (Debate Land), and an AI scouting summary into the opponent record `id`.
// Fire-and-forget — safe to call from any round-save path. Shared by the manual
// Add Round form and the email-import flow.
function researchOpponentInto(id: string, name: string, event: DebateEvent, update: UpdateFn) {
  const yr = seasonYearSuffix();
  const shard = event === 'pf' ? `hspf${yr}` : event === 'ld' ? `hsld${yr}` : `hspolicy${yr}`;
  const dlEvent = event === 'pf' ? 'pf' : event === 'ld' ? 'ld' : 'policy';

  // OpenCaselist: search → pull → Gemini
  (async () => {
    try {
      const searchRes = await window.warroom.opencaselist.search(name, shard);
      if (!searchRes.ok) return;
      const list: any[] = Array.isArray(searchRes.data)
        ? searchRes.data
        : searchRes.data?.teams ?? searchRes.data?.results ?? searchRes.data?.data ?? [];
      if (list.length === 0) return;

      const hit = list[0];
      const school = hit.school ?? hit.schoolSlug ?? '';
      const team = hit.team ?? hit.teamSlug ?? name;
      const caselist = hit.caselist ?? hit.caselistSlug ?? shard;
      const teamName = hit.displayName ?? name;

      const [roundsRes, citesRes] = await Promise.all([
        window.warroom.opencaselist.rounds(caselist, school, team),
        window.warroom.opencaselist.cites(caselist, school, team),
      ]);

      const rounds: any[] = roundsRes.ok
        ? (Array.isArray(roundsRes.data) ? roundsRes.data : roundsRes.data?.rounds ?? []) : [];
      const cites: any[] = citesRes.ok
        ? (Array.isArray(citesRes.data) ? citesRes.data : citesRes.data?.cites ?? []) : [];

      const affCites = cites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      const negCites = cites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n'));
      const affRounds = rounds.filter((r: any) => (r.side ?? '').toLowerCase().startsWith('a'));

      const aff = affCites.length
        ? { name: affCites[0].title ?? affCites[0].cites?.slice(0, 100) ?? 'Aff' }
        : affRounds.length ? { name: 'Aff' } : undefined;
      const neg = Array.from(new Set(
        negCites.map((c: any) => c.title ?? c.cites?.slice(0, 100) ?? '').filter(Boolean)
      )).map((n) => ({ name: String(n).slice(0, 200) }));

      await update((db) => ({
        ...db,
        opponents: {
          ...db.opponents,
          [id]: {
            ...db.opponents[id],
            teamId: team, teamName, school, caselist,
            disclosures: {
              ...(db.opponents[id]?.disclosures ?? {}),
              pulledAt: new Date().toISOString(),
              roundsDisclosed: rounds.length,
              aff, neg,
              rawRounds: rounds.slice(0, 200),
              rawCites: cites.slice(0, 200),
            },
          },
        },
      }));

      // Gemini AI Scout
      if (rounds.length > 0 || cites.length > 0) {
        window.warroom.ai.teamSummary({ teamName, rawRounds: rounds, rawCites: cites })
          .then((res) => {
            if (!res.ok || !res.aff) return;
            const scout = { aff: res.aff, neg: res.neg!, citations: res.citations ?? [], generatedAt: new Date().toISOString() };
            update((db) => ({
              ...db,
              opponents: {
                ...db.opponents,
                [id]: {
                  ...db.opponents[id],
                  disclosures: { ...(db.opponents[id]?.disclosures ?? {}), aiScout: scout },
                },
              },
            }));
          })
          .catch(() => {});
      }
    } catch {}
  })();

  // Debate Land
  window.warroom.dl.searchTeam({ query: name, eventType: dlEvent })
    .then(async (res) => {
      if (!res.success || !res.results?.length) return;
      const candidate = res.results[0];
      const statsRes = await window.warroom.dl.getTeamStats({ teamId: candidate.teamId, eventType: candidate.event ?? dlEvent });
      if (statsRes.success && statsRes.stats) {
        update((db) => ({
          ...db,
          opponents: {
            ...db.opponents,
            [id]: { ...db.opponents[id], stats: statsRes.stats },
          },
        }));
      }
    })
    .catch(() => {});
}

export default function TournamentView() {
  const { db, update, setView, view } = useApp();
  const dangerCls = useDangerBtnClass();
  if (view.kind !== 'tournament') return null;
  const t = db.tournaments[view.tournamentId];
  if (!t) return <div className="p-8 text-sm text-ink/50">Tournament not found.</div>;
  const rounds = t.rounds.map((id) => db.rounds[id]).filter(Boolean).sort((a, b) => a.number - b.number);

  // Analytics
  const wins = rounds.filter((r) => r.result === 'win').length;
  const losses = rounds.filter((r) => r.result === 'loss').length;
  const blockReadCounts: Record<string, number> = {};
  const blockFailedCounts: Record<string, number> = {};
  rounds.forEach((r) => {
    r.argsRead.forEach((id) => { blockReadCounts[id] = (blockReadCounts[id] ?? 0) + 1; });
    r.argsFailed.forEach((id) => { blockFailedCounts[id] = (blockFailedCounts[id] ?? 0) + 1; });
  });
  const topRead = Object.entries(blockReadCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ block: db.blocks[id], count }))
    .filter((x) => x.block);
  const failedBlocks = Object.entries(blockFailedCounts)
    .filter(([, count]) => count >= 2)
    .map(([id]) => db.blocks[id])
    .filter(Boolean);

  async function deleteRound(roundId: string) {
    if (!confirm('Delete this round?')) return;
    await update((db) => {
      const next = { ...db };
      delete next.rounds[roundId];
      next.tournaments[t.id] = { ...t, rounds: t.rounds.filter((id) => id !== roundId) };
      return next;
    });
  }

  async function deleteTournament() {
    if (!confirm(`Delete "${t.name}" and all its rounds?`)) return;
    await update((db) => {
      const next = { ...db };
      t.rounds.forEach((id) => delete next.rounds[id]);
      delete next.tournaments[t.id];
      return next;
    });
    setView({ kind: 'tournaments' });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 glass-elevated flex items-start justify-between gap-4">
        <div>
          <button onClick={() => setView({ kind: 'tournaments' })} className="text-xs text-ink/40 hover:text-ink mb-1">
            ← Tournaments
          </button>
          <h1 className="text-lg font-semibold">{t.name}</h1>
          <div className="text-xs text-ink/40 mt-0.5">{t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString() : ''}</div>
        </div>
        <button className={`btn btn-icon w-7 h-7 mt-1 ${dangerCls}`} title="Delete" onClick={deleteTournament}><TrashIcon /></button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-6 space-y-6 max-w-4xl">
        {/* Round table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="label">Rounds</div>
            <div className="flex gap-2">
              <ImportFromEmailButton tournamentId={t.id} />
              <AddRoundButton tournamentId={t.id} />
            </div>
          </div>
          {rounds.length === 0 ? (
            <div className="text-sm text-ink/40 italic">No rounds yet.</div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <Th>Rd</Th><Th>Side</Th><Th>Opponent</Th><Th>Result</Th><Th>Notes</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => {
                  const opp = r.opponentId ? db.opponents[r.opponentId] : undefined;
                  return (
                    <tr key={r.id} className="border-b border-line hover:bg-panel/60 cursor-pointer" onClick={() => setView({ kind: 'round', roundId: r.id })}>
                      <Td>{r.number}</Td>
                      <Td>
                        <span className={`text-[10px] px-1 py-0.5 rounded-sm ${r.side === 'aff' ? 'badge-aff' : 'badge-neg'}`}>{r.side}</span>
                      </Td>
                      <Td>{opp?.teamName ?? r.opponentName ?? '—'}</Td>
                      <Td>
                        <QuickResultBadge roundId={r.id} result={r.result} />
                      </Td>
                      <Td><span className="text-ink/50 truncate block max-w-[180px]">{r.notes || '—'}</span></Td>
                      <Td>
                        <button
                          className="text-xs text-ink/30 hover:text-danger"
                          onClick={(e) => { e.stopPropagation(); deleteRound(r.id); }}
                        >×</button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Tabroom Monitor */}
        {t.tabroom_id && <TabroomMonitorPanel tournament={t} />}

        {/* Analytics */}
        {rounds.length > 0 && (
          <div className="glass-card rounded-sm p-4 space-y-4">
            <div className="label">Analytics</div>
            <div className="flex gap-6">
              <Stat label="Record" value={`${wins}–${losses}`} />
              <Stat label="Rounds" value={rounds.length} />
            </div>
            {topRead.length > 0 && (
              <div>
                <div className="text-xs text-ink/50 mb-1">Most read blocks</div>
                {topRead.map(({ block, count }) => (
                  <div key={block.id} className="text-xs flex gap-2">
                    <span className="text-ink/40">{count}×</span>
                    <span>{block.title}</span>
                  </div>
                ))}
              </div>
            )}
            {failedBlocks.length > 0 && (
              <div>
                <div className="text-xs text-warn mb-1">⚠ Consistently failing blocks</div>
                {failedBlocks.map((b) => (
                  <div key={b.id} className="text-xs text-warn">{b.title} (failed {blockFailedCounts[b.id]}×)</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: any) {
  return <th className="text-left text-[10px] uppercase tracking-wider text-ink/40 py-1.5 pr-4 font-medium">{children}</th>;
}
function Td({ children }: any) {
  return <td className="py-1.5 pr-4 text-xs">{children}</td>;
}

function QuickResultBadge({ roundId, result }: { roundId: string; result: Round['result'] }) {
  const { db, update } = useApp();
  const [hovered, setHovered] = useState(false);

  async function setResult(r: Round['result'], e: React.MouseEvent) {
    e.stopPropagation();
    const round = db.rounds[roundId];
    if (!round) return;
    await update((db) => ({ ...db, rounds: { ...db.rounds, [roundId]: { ...round, result: r } } }));
    setHovered(false);
  }

  const badgeClass = result === 'win'
    ? 'bg-emerald-100 text-emerald-700'
    : result === 'loss'
    ? 'bg-danger/10 text-danger'
    : 'bg-line text-ink/40';

  if (result !== 'pending') {
    return (
      <span className={`text-[10px] px-1 py-0.5 rounded-sm ${badgeClass}`}>{result}</span>
    );
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`text-[10px] px-1 py-0.5 rounded-sm cursor-default ${badgeClass}`}>
        pending
      </span>
      {hovered && (
        <div
          className="absolute left-0 top-full mt-0.5 z-20 flex gap-1 rounded-sm shadow-lg p-1"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="text-[10px] px-2 py-0.5 rounded-sm bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-medium"
            onClick={(e) => setResult('win', e)}
          >
            Win
          </button>
          <button
            className="text-[10px] px-2 py-0.5 rounded-sm bg-danger/10 text-danger hover:bg-danger/20 font-medium"
            onClick={(e) => setResult('loss', e)}
          >
            Loss
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// ─── Tabroom Monitor Panel ────────────────────────────────────────────────────

function isTournamentDay(tournament: Tournament): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startStr = tournament.start ?? tournament.date;
  const endStr = tournament.end ?? tournament.date;
  // Append noon time to avoid timezone edge-cases when only a date string is stored
  const start = new Date(startStr.includes('T') ? startStr : startStr + 'T12:00:00');
  const end = new Date(endStr.includes('T') ? endStr : endStr + 'T12:00:00');
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return today >= start && today <= end;
}

function TabroomMonitorPanel({ tournament }: { tournament: Tournament }) {
  const { db, update, event } = useApp();
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entryCode, setEntryCode] = useState(tournament.tabroomEntryCode ?? '');
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // Derive caselist and DL event type from app event setting
  const caselist = event === 'pf' ? 'hspf' : event === 'ld' ? 'hsld' : 'hspolicy';
  const eventType = event === 'pf' ? 'pf' : event === 'ld' ? 'ld' : 'policy';
  const eventLabel = event === 'pf' ? 'HS PF' : event === 'ld' ? 'HS LD' : 'HS Policy';

  const isToday = isTournamentDay(tournament);

  // Check current monitor status on mount; auto-start on tournament day if entry code is saved
  useEffect(() => {
    window.warroom?.tabroom?.monitor?.status().then((s) => {
      if (s.active && s.state?.dbTournamentId === tournament.id) {
        setActive(true);
      } else if (!s.active && isToday && (tournament.tabroomEntryCode ?? '').trim()) {
        // Tournament day detected — kick off monitoring automatically
        startMonitor();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.id]);

  // Listen for stopped event
  useEffect(() => {
    const cleanup = window.warroom?.tabroom?.monitor?.onStopped(() => setActive(false));
    return () => cleanup?.();
  }, []);

  async function saveEntryCode(code: string) {
    await update((db) => ({
      ...db,
      tournaments: {
        ...db.tournaments,
        [tournament.id]: { ...db.tournaments[tournament.id], tabroomEntryCode: code },
      },
    }));
  }

  async function startMonitor() {
    if (!entryCode.trim()) { setError('Enter your entry code first.'); return; }
    setLoading(true); setError('');
    try {
      await saveEntryCode(entryCode.trim());
      const res = await window.warroom.tabroom.monitor.start({
        dbTournamentId: tournament.id,
        tabroomTournId: tournament.tabroom_id!,
        tournamentName: tournament.name,
        eventName: eventLabel,
        entryCode: entryCode.trim(),
        caselist,
        eventType,
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to start');
      // Also start the inbox result monitor (uses same Tabroom credentials)
      window.warroom.tabroom.inbox?.start({
        entryCode: entryCode.trim(),
        dbTournamentId: tournament.id,
        tournamentName: tournament.name,
      }).catch(() => {});
      setActive(true);
      setLastPoll(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
    } catch (e: any) {
      setError(e.message ?? 'Error starting monitor');
    } finally {
      setLoading(false);
    }
  }

  async function stopMonitor() {
    await window.warroom.tabroom.monitor.stop();
    window.warroom.tabroom.inbox?.stop().catch(() => {});
    setActive(false);
  }

  async function pollNow() {
    setPolling(true);
    try {
      await window.warroom.tabroom.monitor.pollNow();
      setLastPoll(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
    } catch { /* ignore */ } finally {
      setPolling(false);
    }
  }

  // Refresh "last polled" time when active
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setLastPoll(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
    }, 60_000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div className="glass-card rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="label">Live Monitor</div>
          {active && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}
            >
              ● Active
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {active && (
            <button className="btn text-xs" onClick={pollNow} disabled={polling} title="Check Tabroom for new pairings right now">
              {polling ? <Dots /> : 'Poll now'}
            </button>
          )}
          {active ? (
            <button className="btn text-xs" onClick={stopMonitor}>Stop</button>
          ) : (
            <button
              className="btn-primary text-xs"
              onClick={startMonitor}
              disabled={loading || !entryCode.trim()}
            >
              {loading ? <Dots /> : 'Start Monitor'}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-ink/50 mb-1 leading-relaxed">
        Polls Tabroom every 60 s for new pairings. When a new round is posted, Warroom fires an OS notification, scrapes the judge paradigm, looks up the opponent on OpenCaselist and Debate Land, and creates the round automatically.
      </p>
      {isToday && !active && (tournament.tabroomEntryCode ?? '').trim() && (
        <p className="text-xs text-emerald-600 mb-3">
          ✦ Today is tournament day — monitor will start automatically when you open this page.
        </p>
      )}
      {!isToday && (
        <p className="text-[11px] text-ink/40 mb-3">
          The monitor starts automatically when you open Warroom on the day of the tournament (as long as your entry code is saved).
        </p>
      )}
      {isToday && active && (
        <p className="text-[11px] text-ink/40 mb-3">
          Auto-started for today's tournament. Use "Poll now" to check for new pairings immediately.
        </p>
      )}

      <div className="space-y-2">
        <div>
          <label className="text-[11px] text-ink/50 block mb-1">Your entry code</label>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm font-mono"
              placeholder="e.g. Emery BL"
              value={entryCode}
              onChange={(e) => setEntryCode(e.target.value)}
              disabled={active}
            />
            {!active && entryCode !== (tournament.tabroomEntryCode ?? '') && (
              <button className="btn text-xs" onClick={() => saveEntryCode(entryCode.trim())}>Save</button>
            )}
          </div>
          <p className="text-[10px] text-ink/40 mt-1">
            Must match exactly what appears in Tabroom pairings (e.g. "Emery BL", "LACC AD").
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {active && lastPoll && (
          <p className="text-[10px] text-ink/40">Last checked: {lastPoll}</p>
        )}

        {active && (
          <div className="flex items-center gap-2 text-xs text-ink/60 pt-1">
            <span className="animate-pulse">📡</span>
            <span>Monitoring {tournament.name} · polling every 60 s</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Import from email ───────────────────────────────────────────────────────

function ImportFromEmailButton({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  return open
    ? <ImportFromEmailModal tournamentId={tournamentId} onDone={() => setOpen(false)} />
    : <button className="btn text-xs" onClick={() => setOpen(true)}>↑ Import from email</button>;
}

function ImportFromEmailModal({ tournamentId, onDone }: { tournamentId: string; onDone: () => void }) {
  const { db, update, setView, event } = useApp();
  const opponents = Object.values(db.opponents);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [usedFallback, setUsedFallback] = useState(false);

  const [num, setNum] = useState<number>(1);
  const [side, setSide] = useState<Side>('aff');
  const [opponentName, setOpponentName] = useState('');
  const [opponentId, setOpponentId] = useState('');
  const [room, setRoom] = useState('');
  const [time, setTime] = useState('');
  const [judgeName, setJudgeName] = useState('');
  const [parsed, setParsed] = useState(false);

  // Pre-pipeline: cached data fetched in background before user clicks Add Round
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [cachedJudgeId, setCachedJudgeId] = useState<string | null>(null);
  const [cachedParadigm, setCachedParadigm] = useState<string | null>(null);
  const [cachedBrief, setCachedBrief] = useState<string | null>(null);
  // Abort flag — if user cancels/re-pastes before pipeline finishes, discard results
  const pipelineActive = React.useRef(false);

  function applyParsed(d: { round: number; side: 'aff' | 'neg'; room: string | null; time: string | null; aff_team: string; neg_team: string; isBye?: boolean; judge?: string | null }) {
    setNum(d.round ?? 1);
    setSide(d.side ?? 'aff');
    setRoom(d.room ?? '');
    setTime(d.time ?? '');
    // Reset any previously cached pipeline results
    pipelineActive.current = false;
    setCachedJudgeId(null);
    setCachedParadigm(null);
    setCachedBrief(null);
    setPipelineStatus(null);

    if (d.isBye) {
      setOpponentName('BYE');
      setOpponentId('');
      setParsed(true);
      return;
    }

    const oppTeam = (d.side === 'aff' ? d.neg_team : d.aff_team) ?? '';
    setOpponentName(oppTeam);
    const match = oppTeam.trim()
      ? opponents.find((o) =>
          o.teamName.toLowerCase().includes(oppTeam.toLowerCase()) ||
          oppTeam.toLowerCase().includes(o.teamName.toLowerCase())
        )
      : undefined;
    setOpponentId(match?.id ?? '');
    const judge = d.judge ?? null;
    if (judge) setJudgeName(judge);
    setParsed(true);

    // Fire the pre-round pipeline immediately — don't wait for the user to click Add Round
    runPreRoundPipeline({
      round: d.round ?? 1,
      side: d.side ?? 'aff',
      room: d.room ?? '',
      time: d.time ?? '',
      opponentName: oppTeam,
      judgeName: judge ?? '',
    });
  }

  async function runPreRoundPipeline(info: {
    round: number; side: string; room: string; time: string;
    opponentName: string; judgeName: string;
  }) {
    // Mark this pipeline run as active; if another parse comes in it will flip the flag
    pipelineActive.current = true;
    const token = {}; // object identity used as a cancellation token
    const activeToken = token;

    // ── Step 1: fetch judge paradigm in background ───────────────────────────
    let paradigm: string | null = null;
    let personId: string | null = null;
    if (info.judgeName) {
      setPipelineStatus('Looking up judge…');
      try {
        const res = await window.warroom.tabroom.fetchParadigmByName(info.judgeName);
        if (!pipelineActive.current || activeToken !== token) return; // cancelled
        if (res.ok) {
          personId = res.personId ?? null;
          paradigm = res.paradigm ?? null;
          if (personId) setCachedJudgeId(personId);
          if (paradigm) setCachedParadigm(paradigm);
        }
      } catch { /* ignore */ }
    }

    if (!pipelineActive.current || activeToken !== token) return;

    // ── Step 2: look up existing opponent disclosure from DB ─────────────────
    const matchedOpp = info.opponentName
      ? Object.values(db.opponents).find((o) =>
          o.teamName.toLowerCase().includes(info.opponentName.toLowerCase()) ||
          info.opponentName.toLowerCase().includes(o.teamName.toLowerCase())
        )
      : undefined;
    const disc = (matchedOpp?.disclosures as any) ?? {};
    let affName: string | undefined;
    let negPositions: string[] = [];
    let rawCitesSample = '';
    if (disc.aff?.name) affName = disc.aff.name;
    if (disc.neg?.length) negPositions = disc.neg.map((n: any) => n.name).filter(Boolean);
    if (!affName && !negPositions.length && disc.rawCites?.length) {
      const rawCites: any[] = disc.rawCites;
      const affCite = rawCites.find((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
      affName = affCite?.title ?? affCite?.cites?.slice(0, 80) ?? undefined;
      const negSet = new Set(rawCites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n')).map((c: any) => c.title ?? '').filter(Boolean));
      negPositions = Array.from(negSet) as string[];
      rawCitesSample = rawCites.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n') && c.cites?.trim()).slice(0, 3).map((c: any) => `[${c.title ?? 'Neg'}]\n${c.cites?.slice(0, 400)}`).join('\n\n');
    }

    if (!pipelineActive.current || activeToken !== token) return;

    // ── Step 3: generate Gemini mission brief ────────────────────────────────
    setPipelineStatus('Generating briefing…');
    try {
      const res = await window.warroom.ai.missionBrief({
        roundNumber: info.round,
        side: info.side,
        room: info.room || undefined,
        time: info.time || undefined,
        opponentName: info.opponentName || 'Unknown',
        judgeName: info.judgeName || undefined,
        judgeParadigm: paradigm ?? undefined,
        affName,
        negPositions,
        rawCitesSample: rawCitesSample || undefined,
      });
      if (!pipelineActive.current || activeToken !== token) return;
      if (res.ok && res.text) setCachedBrief(res.text);
    } catch { /* ignore */ }

    if (!pipelineActive.current || activeToken !== token) return;
    setPipelineStatus(null);
  }

  async function processImage(base64: string, mime: string) {
    pipelineActive.current = false; // cancel any running pipeline
    setImagePreview(`data:${mime};base64,${base64}`);
    setParsing(true);
    setParseError('');
    setParsed(false);
    setUsedFallback(false);
    setCachedBrief(null); setCachedParadigm(null); setCachedJudgeId(null); setPipelineStatus(null);
    const res = await window.warroom.ai.parseRoundEmail({ imageBase64: base64, mimeType: mime });
    setParsing(false);
    if (!res.ok || !res.data) {
      setParseError(res.error ?? 'Could not read the image — make sure it shows a Tabroom pairing email clearly');
      return;
    }
    if (res.usedFallback) setUsedFallback(true);
    applyParsed(res.data);
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items);
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(',');
      const mime = header.replace('data:', '').replace(';base64', '');
      processImage(base64, mime);
    };
    reader.readAsDataURL(blob);
  }

  async function handleClipboard() {
    const res = await window.warroom.clipboard.readImage();
    if (!res.ok || !res.base64) { setParseError('No image found in clipboard'); return; }
    processImage(res.base64, res.mimeType ?? 'image/png');
  }

  async function handleUpload() {
    const path = await window.warroom.dialog.openFile(['png', 'jpg', 'jpeg']);
    if (!path) return;
    pipelineActive.current = false;
    setParsing(true);
    setParseError('');
    setParsed(false);
    setUsedFallback(false);
    setCachedBrief(null); setCachedParadigm(null); setCachedJudgeId(null); setPipelineStatus(null);
    const res = await window.warroom.ai.parseRoundEmail({ filePath: path });
    setParsing(false);
    if (!res.ok || !res.data) { setParseError(res.error ?? 'Could not parse the image'); return; }
    setImagePreview(null);
    if (res.usedFallback) setUsedFallback(true);
    applyParsed(res.data);
  }

  // Background: pull OpenCaselist + DL + Gemini for the opponent
  function researchOpponent(id: string, name: string) {
    researchOpponentInto(id, name, event, update);
  }

  async function save() {
    const roundId = crypto.randomUUID();
    let resolvedOppId = opponentId;
    const finalName = opponentName.trim();
    const isByeRound = finalName.toUpperCase() === 'BYE';

    if (!isByeRound && !resolvedOppId && finalName) {
      const existing = Object.values(db.opponents).find(
        (o) => o.teamName.toLowerCase() === finalName.toLowerCase()
      );
      if (existing) {
        resolvedOppId = existing.id;
      } else {
        resolvedOppId = crypto.randomUUID();
        const newOpp: Opponent = {
          id: resolvedOppId, teamName: finalName, school: '',
          notes: '', disclosures: {}, roundsAgainst: [],
        };
        await update((db) => ({ ...db, opponents: { ...db.opponents, [resolvedOppId!]: newOpp } }));
      }
    }

    // Stop accepting pipeline results once we commit
    pipelineActive.current = false;

    const round: Round = {
      id: roundId, tournamentId, number: num, side, opponentId: resolvedOppId ?? '',
      opponentName: isByeRound ? 'BYE' : (resolvedOppId ? undefined : finalName || undefined),
      room: room || undefined, time: time || undefined,
      result: 'pending', notes: '',
      argsRead: [], argsWorked: [], argsFailed: [],
      ...(isByeRound && { isBye: true }),
      ...(judgeName.trim() && { judgeName: judgeName.trim() }),
      // Attach everything pre-fetched by the pipeline (may still be null if slow)
      ...(cachedJudgeId && { judgeId: cachedJudgeId }),
      ...(cachedParadigm && { judgeParadigm: cachedParadigm }),
      ...(cachedBrief && { missionBrief: cachedBrief }),
    };
    await update((db) => {
      const next = { ...db };
      next.rounds[roundId] = round;
      next.tournaments[tournamentId] = {
        ...next.tournaments[tournamentId],
        rounds: [...next.tournaments[tournamentId].rounds, roundId],
      };
      if (resolvedOppId && next.opponents[resolvedOppId]) {
        next.opponents[resolvedOppId] = {
          ...next.opponents[resolvedOppId],
          roundsAgainst: [...next.opponents[resolvedOppId].roundsAgainst, roundId],
        };
      }
      return next;
    });

    // Fire background research for the opponent (skip for bye rounds)
    if (!isByeRound && resolvedOppId && finalName) researchOpponent(resolvedOppId, finalName);

    onDone();
    setView({ kind: 'round', roundId });
  }

  return (
    <div
      className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) { pipelineActive.current = false; onDone(); } }}
      onPaste={handlePaste}
    >
      <div className="glass-elevated rounded-sm border border-line p-5 w-[460px] space-y-3 shadow-lg">
        <div className="label">Import round from pairing email</div>

        {/* Drop zone */}
        <div
          className="border border-dashed border-line rounded-sm p-4 text-center space-y-2"
          style={{ minHeight: 100 }}
        >
          {imagePreview ? (
            <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded-sm object-contain" />
          ) : (
            <div className="text-xs text-ink/40 leading-relaxed">
              Paste a screenshot (Cmd+V) or upload a file
            </div>
          )}
          {parsing && <div className="text-xs text-ink/50">Reading image…</div>}
          {parseError && <div className="text-xs text-danger">{parseError}</div>}
        </div>

        <div className="flex gap-2">
          <button className="btn text-xs flex-1" onClick={handleClipboard}>Paste from clipboard</button>
          <button className="btn text-xs flex-1" onClick={handleUpload}>Upload image</button>
        </div>

        {usedFallback && (
          <div
            className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
            style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.5)', color: 'var(--ink)' }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>⚠️</span>
            <span><strong>OCR failed</strong> — Warroom AI was used as a fallback to read this image. Double-check all fields below before adding the round.</span>
          </div>
        )}
        {parsed && (
          <>
            <div className="text-xs text-ink/50 pt-1">Review and edit parsed fields:</div>
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-xs text-ink/50 mb-1">Round #</div>
                <input className="input w-full" type="number" value={num} min={1} onChange={(e) => setNum(Number(e.target.value))} />
              </div>
              <div className="flex-1">
                <div className="text-xs text-ink/50 mb-1">Side</div>
                <select className="input w-full" value={side} onChange={(e) => setSide(e.target.value as Side)}>
                  <option value="aff">Aff</option>
                  <option value="neg">Neg</option>
                </select>
              </div>
            </div>
            <div>
              <div className="text-xs text-ink/50 mb-1">Opponent name</div>
              <input className="input w-full" value={opponentName} onChange={(e) => setOpponentName(e.target.value)} placeholder="Team name" />
            </div>
            <div>
              <div className="text-xs text-ink/50 mb-1">Judge</div>
              <input className="input w-full" value={judgeName} onChange={(e) => setJudgeName(e.target.value)} placeholder="Judge name" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-xs text-ink/50 mb-1">Room</div>
                <input className="input w-full" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" />
              </div>
              <div className="flex-1">
                <div className="text-xs text-ink/50 mb-1">Time</div>
                <input className="input w-full" value={time} onChange={(e) => setTime(e.target.value)} placeholder="Time" />
              </div>
            </div>
            <div className="flex gap-2 pt-1 items-center">
              <button className="btn-primary" onClick={save}>Add round</button>
              <button className="btn" onClick={() => { pipelineActive.current = false; onDone(); }}>Cancel</button>
              {pipelineStatus && (
                <span className="text-[11px] text-ink/40 flex items-center gap-1 ml-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {pipelineStatus}
                </span>
              )}
              {!pipelineStatus && cachedBrief && (
                <span className="text-[11px] text-emerald-600 ml-1">✓ Briefing ready</span>
              )}
            </div>
          </>
        )}

        {!parsed && (
          <div className="flex justify-end">
            <button className="btn text-xs" onClick={() => { pipelineActive.current = false; onDone(); }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add round button + form ──────────────────────────────────────────────────

function AddRoundButton({ tournamentId }: { tournamentId: string }) {
  const [open, setOpen] = useState(false);
  return open
    ? <AddRoundForm tournamentId={tournamentId} onDone={() => setOpen(false)} />
    : <button className="btn text-xs" onClick={() => setOpen(true)}>+ Add round</button>;
}

function AddRoundForm({ tournamentId, onDone }: { tournamentId: string; onDone: () => void }) {
  const { db, update, setView, event } = useApp();
  const opponents = Object.values(db.opponents);
  const tournament = db.tournaments[tournamentId];

  const [num, setNum] = useState(1);
  const [side, setSide] = useState<Side>('aff');
  const [opponentId, setOpponentId] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [room, setRoom] = useState('');
  const [time, setTime] = useState('');
  const [result, setResult] = useState<Round['result']>('pending');
  const [notes, setNotes] = useState('');

  const [tabroomSearching, setTabroomSearching] = useState(false);
  const [tabroomError, setTabroomError] = useState('');
  const [tabroomCandidates, setTabroomCandidates] = useState<any[] | null>(null);

  async function searchTabroom() {
    const tournId = tournament?.tabroom_id;
    const eventId = tournament?.tabroom_event_id ?? '';
    if (!tournId) {
      setTabroomError('Add a Tabroom tournament ID in tournament settings to enable this');
      return;
    }
    if (!opponentName.trim()) {
      setTabroomError('Enter a team name to search');
      return;
    }
    if (!eventId) {
      setTabroomError('No event ID set — add tabroom_event_id to the tournament first');
      return;
    }
    setTabroomSearching(true);
    setTabroomError('');
    setTabroomCandidates(null);
    const res = await window.warroom.tabroom.getEntries(tournId, eventId);
    setTabroomSearching(false);
    if (!res.success) {
      if (res.error === 'PRIVATE') {
        setTabroomError("This tournament's data is private on Tabroom");
      } else {
        setTabroomError('Could not reach Tabroom — try again later');
      }
      return;
    }
    const q = opponentName.toLowerCase().trim();
    const matches = (res.data ?? []).filter((e: any) => {
      const code = (e.code ?? e.entry_code ?? '').toLowerCase();
      const school = (e.school ?? e.school_name ?? '').toLowerCase();
      const names = ((e.competitors ?? []) as any[]).map((c: any) => (c.name ?? '').toLowerCase()).join(' ');
      return code.includes(q) || school.includes(q) || names.includes(q);
    });
    if (matches.length === 0) {
      setTabroomError('No matching entries found on Tabroom');
    } else if (matches.length === 1) {
      applyTabroomEntry(matches[0]);
    } else {
      setTabroomCandidates(matches.slice(0, 6));
    }
  }

  function applyTabroomEntry(entry: any) {
    const school = entry.school ?? entry.school_name ?? '';
    const code = entry.code ?? entry.entry_code ?? '';
    const competitorNames = ((entry.competitors ?? []) as any[]).map((c: any) => c.name ?? '').filter(Boolean).join(' / ');
    setOpponentName([code, competitorNames || school].filter(Boolean).join(' — '));
    setTabroomCandidates(null);
    setTabroomError('');
  }

  async function save() {
    const id = crypto.randomUUID();
    let resolvedOppId = opponentId || '';
    // Name to research on OpenCaselist, and whether this opponent still needs a pull.
    let researchName = '';
    let shouldResearch = false;
    const isByeRound = opponentName.trim().toUpperCase() === 'BYE';

    // Auto-create opponent record when a name is typed but no profile selected
    if (!resolvedOppId && opponentName.trim() && !isByeRound) {
      const name = opponentName.trim();
      const existing = Object.values(db.opponents).find(
        (o) => o.teamName.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        resolvedOppId = existing.id;
        researchName = existing.teamName;
        shouldResearch = !(existing.disclosures as any)?.pulledAt;
      } else {
        resolvedOppId = crypto.randomUUID();
        const newOpp: Opponent = {
          id: resolvedOppId, teamName: name, school: '',
          notes: '', disclosures: {}, roundsAgainst: [],
        };
        await update((db) => ({ ...db, opponents: { ...db.opponents, [resolvedOppId]: newOpp } }));
        researchName = name;
        shouldResearch = true;
      }
    } else if (resolvedOppId) {
      // Opponent picked from existing profiles — pull only if never disclosed before.
      const picked = db.opponents[resolvedOppId];
      if (picked) {
        researchName = picked.teamName;
        shouldResearch = !(picked.disclosures as any)?.pulledAt;
      }
    }

    const round: Round = {
      id, tournamentId, number: num, side, opponentId: resolvedOppId,
      opponentName: resolvedOppId ? undefined : opponentName || undefined,
      room: room || undefined, time: time || undefined,
      result, notes,
      argsRead: [], argsWorked: [], argsFailed: [],
    };
    await update((db) => {
      const next = { ...db };
      next.rounds[id] = round;
      next.tournaments[tournamentId] = {
        ...next.tournaments[tournamentId],
        rounds: [...next.tournaments[tournamentId].rounds, id],
      };
      if (resolvedOppId && next.opponents[resolvedOppId]) {
        next.opponents[resolvedOppId] = {
          ...next.opponents[resolvedOppId],
          roundsAgainst: [...next.opponents[resolvedOppId].roundsAgainst, id],
        };
      }
      return next;
    });
    // Auto-populate the opponent's disclosure/scout from OpenCaselist in the
    // background (skips BYEs and opponents already pulled).
    if (shouldResearch && resolvedOppId && researchName) {
      researchOpponentInto(resolvedOppId, researchName, event, update);
    }
    onDone();
    setView({ kind: 'round', roundId: id });
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <div className="glass-elevated rounded-sm border border-line p-5 w-[420px] space-y-3 shadow-lg">
        <div className="label">Add round</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="text-xs text-ink/50 mb-1">Round #</div>
            <input className="input w-full" type="number" value={num} min={1} onChange={(e) => setNum(Number(e.target.value))} />
          </div>
          <div className="flex-1">
            <div className="text-xs text-ink/50 mb-1">Side</div>
            <select className="input w-full" value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="aff">Aff</option>
              <option value="neg">Neg</option>
            </select>
          </div>
          <div className="flex-1">
            <div className="text-xs text-ink/50 mb-1">Result</div>
            <select className="input w-full" value={result} onChange={(e) => setResult(e.target.value as Round['result'])}>
              <option value="pending">TBD</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs text-ink/50 mb-1">Opponent (from profiles)</div>
          <select className="input w-full" value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
            <option value="">— type name below instead —</option>
            {opponents.map((o) => <option key={o.id} value={o.id}>{o.teamName}</option>)}
          </select>
        </div>
        {!opponentId && (
          <div className="space-y-1">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Team name (if not in profiles)"
                value={opponentName}
                onChange={(e) => { setOpponentName(e.target.value); setTabroomError(''); setTabroomCandidates(null); }}
              />
              <button
                className="btn text-xs shrink-0"
                onClick={searchTabroom}
                disabled={tabroomSearching || !opponentName.trim()}
                title={!tournament?.tabroom_id ? 'Add a Tabroom ID to this tournament first' : 'Search entries on Tabroom'}
              >
                {tabroomSearching ? '…' : 'Search Tabroom'}
              </button>
            </div>
            {tabroomError && (
              <div className="text-xs text-danger">{tabroomError}</div>
            )}
            {tabroomCandidates && (
              <div className="glass-card rounded-sm p-2 space-y-1">
                <div className="text-xs text-ink/40 mb-1">Select matching entry:</div>
                {tabroomCandidates.map((e, i) => {
                  const label = [e.code ?? e.entry_code, e.school ?? e.school_name].filter(Boolean).join(' — ');
                  return (
                    <button
                      key={e.id ?? i}
                      className="w-full text-left text-xs px-2 py-1 hover:bg-panel rounded-sm"
                      onClick={() => applyTabroomEntry(e)}
                    >
                      {label || `Entry ${i + 1}`}
                    </button>
                  );
                })}
                <button className="text-xs text-ink/30 hover:text-ink pt-1" onClick={() => setTabroomCandidates(null)}>Cancel</button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Room" value={room} onChange={(e) => setRoom(e.target.value)} />
          <input className="input flex-1" placeholder="Time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <textarea className="input w-full h-16 resize-none text-xs" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2 pt-1">
          <button className="btn-primary" onClick={save}>Save round</button>
          <button className="btn" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
