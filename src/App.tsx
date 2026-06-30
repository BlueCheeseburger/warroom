import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './store/appStore';
import { TabroomRoundBrief } from './types';

// Derive structured aff/neg positions from raw OC data — mirrors OpponentProfile logic
function deriveDisclosurePositions(rawRounds: any[], rawCites: any[]) {
  const affCites = rawCites.filter((c) => (c.side ?? '').toLowerCase().startsWith('a'));
  const negCites = rawCites.filter((c) => (c.side ?? '').toLowerCase().startsWith('n'));
  const affRounds = rawRounds.filter((r) => (r.side ?? '').toLowerCase().startsWith('a'));

  const aff = affCites.length
    ? { name: affCites[0].title ?? affCites[0].cites?.slice(0, 100) ?? 'Aff', description: '' }
    : affRounds.length ? { name: 'Aff', description: '' } : undefined;

  const neg = Array.from(
    new Set(negCites.map((c) => c.title ?? c.cites?.slice(0, 100) ?? '').filter(Boolean))
  ).map((name) => ({ name }));

  return { aff, neg: neg.length ? neg : undefined };
}
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Home from './components/Home';
import CaseView from './components/CaseView';
import BlockView from './components/BlockView';
import Library from './components/Library';
import Settings from './components/Settings';
import OpponentSearch from './components/OpponentSearch';
import OpponentProfile from './components/OpponentProfile';
import JudgeProfile from './components/JudgeProfile';
import MissionBrief from './components/MissionBrief';
import TournamentList from './components/TournamentList';
import TournamentView from './components/TournamentView';
import SpeechDocViewer from './components/SpeechDocViewer';
import Onboarding from './components/Onboarding';
import FlowView from './components/FlowView';
import FindCards from './components/FindCards';
import OpenEvView from './components/OpenEvView';
import GoogleScholarView from './components/GoogleScholarView';
import AgentSearchViews from './components/AgentSearchViews';
import Chat from './components/Chat';
import GeminiPanel from './components/GeminiPanel';
import GoogleDrivePanel from './components/GoogleDrivePanel';
import Documentation from './components/Documentation';
import UserManual from './components/UserManual';
import TopicsScreen from './components/TopicsScreen';
import ImpactCalcView from './components/ImpactCalcView';
import ImpactHub from './components/ImpactHub';
import OutweighGame from './components/OutweighGame';
import SearchPalette from './components/SearchPalette';
import { extractKeywords, refreshSpeechDocKeywords, DOC_KEYWORD_CAP, DOC_KEYWORD_VERSION } from './lib/searchIndex';

const CHAT_MIN_W = 260;
const CHAT_MAX_W = 600;
const CHAT_DEFAULT_W = 320;

export default function App() {
  const { init, ready, mode, theme, direction, chatOpen, geminiOpen, setView, flowsIndex, setFlowsIndex, event, showOnboarding, setShowOnboarding, searchOpen, setSearchOpen } = useApp();
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('warroom-chat-width') ?? '', 10);
    return isNaN(saved) ? CHAT_DEFAULT_W : Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, saved));
  });
  // Toast notification for monitor events
  const [monitorToast, setMonitorToast] = useState<string | null>(null);

  // New-topic banners — shown at top of app when a topic drops
  interface NewTopicBanner { eventType: 'pf' | 'ld'; resolution: string; period: string }
  const [banners, setBanners] = useState<NewTopicBanner[]>([]);
  const dismissedBanners = React.useRef(new Set<string>());
  // Round numbers that existed in DB when monitoring started (skip them)
  const existingRoundNums = useRef(new Set<number>());
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => { init(); }, [init]);

  // ── Cmd+K global search shortcut ───────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSearchOpen]);

  // ── Background keyword extraction on app ready ─────────────────────────────
  // Distills the top keywords from every case docx + recent speech doc so the
  // global search can match on document contents. Runs once per file (cached by
  // a content signature) and never blocks the UI. Docx is a zip, so text must be
  // extracted via mammoth in the main process — not base64-decoded.
  useEffect(() => {
    if (!ready) return;
    (async () => {
      // 1. Cases imported from OpenCaselist (docx via ocSource)
      const { db: currentDb } = useApp.getState();
      const caseSig = (c: any) => c.ocSource.url + ':' + (c.ocSource.byteLen ?? 0) + ':v' + DOC_KEYWORD_VERSION;
      const cases = Object.values(currentDb.cases).filter(c => c.ocSource && (
        !c.searchKeywords || c.searchSig !== caseSig(c)
      ));
      for (const c of cases) {
        try {
          if (!c.ocSource?.url) continue;
          const fetched = await window.warroom?.opencaselist?.fetchFileToTemp(c.ocSource.url);
          if (!fetched?.ok || !fetched.tempPath) continue;
          const res = await window.warroom?.fs.extractDocxText(fetched.tempPath);
          if (!res?.ok || !res.text) continue;
          const keywords = extractKeywords(res.text, DOC_KEYWORD_CAP);
          const { update } = useApp.getState();
          await update(db2 => ({
            ...db2,
            cases: {
              ...db2.cases,
              [c.id]: { ...db2.cases[c.id], searchKeywords: keywords, searchSig: caseSig(c) },
            },
          }));
        } catch { /* best-effort */ }
      }

      // 2. Recent speech docs → distill + cache keywords in localStorage
      await refreshSpeechDocKeywords();
    })();
  }, [ready]);

  // ── NSDA Topic Monitor event handlers ──────────────────────────────────────
  useEffect(() => {
    async function checkForNewTopics() {
      const stored = await window.warroom?.topics?.getStored?.();
      if (!stored) return;
      const newBanners: { eventType: 'pf' | 'ld'; resolution: string; period: string }[] = [];
      for (const et of ['pf', 'ld'] as const) {
        const data = stored[et];
        if (!data?.brief && data?.current && !data.current.includes('not found')) {
          const key = `${et}:${data.current}`;
          if (!dismissedBanners.current.has(key)) {
            // Only show banner if brief is null (was just cleared = new topic), AND it's a release day
            const today = new Date().toISOString().split('T')[0];
            const releaseDays = et === 'pf'
              ? ['2025-08-01','2025-10-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01','2026-05-01','2026-08-01','2026-10-01','2026-12-01','2027-01-01','2027-02-01','2027-03-01','2027-05-01']
              : ['2025-08-01','2025-10-01','2025-12-01','2026-02-01','2026-05-01','2026-08-01','2026-10-01','2026-12-01','2027-02-01','2027-05-01'];
            if (releaseDays.includes(today)) {
              newBanners.push({ eventType: et, resolution: data.current, period: data.period });
            }
          }
        }
      }
      if (newBanners.length > 0) {
        setBanners((prev) => {
          const existing = new Set(prev.map((b) => `${b.eventType}:${b.resolution}`));
          const unique = newBanners.filter((b) => !existing.has(`${b.eventType}:${b.resolution}`));
          return [...prev, ...unique];
        });
      }
    }

    const unsubUpdated = window.warroom?.topics?.onUpdated?.(() => checkForNewTopics());
    const unsubNavigate = window.warroom?.topics?.onNavigateTo?.((eventType) => {
      setView({ kind: 'topics', tab: eventType });
    });
    // Check on mount too
    checkForNewTopics();
    return () => {
      unsubUpdated?.();
      unsubNavigate?.();
    };
  }, [setView]);

  // ── Tabroom Monitor event handlers ─────────────────────────────────────────
  // NOTE: Handlers use useApp.getState() so they always read fresh Zustand state
  // regardless of when the effect was registered (avoids stale-closure bugs).
  useEffect(() => {
    if (!window.warroom?.tabroom?.monitor) return;

    const cleanupExisting = window.warroom.tabroom.monitor.onExistingRounds((nums) => {
      existingRoundNums.current = new Set(nums);
    });

    const cleanupNotif = window.warroom.tabroom.monitor.onNotifClick(({ dbTournamentId, roundNumber }) => {
      const { db: freshDb, setView: sv } = useApp.getState();
      const rounds = Object.values(freshDb.rounds).filter(
        (r) => r.tournamentId === dbTournamentId && r.number === roundNumber,
      );
      if (rounds.length > 0) sv({ kind: 'round', roundId: rounds[0].id });
      else sv({ kind: 'tournament', tournamentId: dbTournamentId });
    });

    const cleanupNewRound = window.warroom.tabroom.monitor.onNewRound(async (brief: TabroomRoundBrief) => {
      const { dbTournamentId, pairing, research } = brief;

      // Skip if this round number was already in the DB when monitoring started
      if (existingRoundNums.current.has(pairing.roundNumber)) return;

      // Get fresh state (avoids stale closure)
      const { db: freshDb, update: freshUpdate, setView: sv } = useApp.getState();

      // Also skip if we already created this round (re-delivered event)
      const alreadyExists = Object.values(freshDb.rounds).some(
        (r) => r.tournamentId === dbTournamentId && r.number === pairing.roundNumber,
      );
      if (alreadyExists) return;

      const roundId = crypto.randomUUID();
      let opponentId: string | null = null;

      await freshUpdate((dbState) => {
        let next = { ...dbState };

        if (!pairing.isBye) {
          // Find or create opponent
          const existingOpp = Object.values(next.opponents).find(
            (o) => o.teamName.toLowerCase().trim() === pairing.opponentCode.toLowerCase().trim(),
          );
          if (existingOpp) {
            opponentId = existingOpp.id;
            // Attach round + research data to existing opponent
            next.opponents = {
              ...next.opponents,
              [existingOpp.id]: {
                ...existingOpp,
                roundsAgainst: [...(existingOpp.roundsAgainst ?? []), roundId],
                ...(research.dlStats && { stats: research.dlStats }),
                disclosures: {
                  ...(existingOpp.disclosures ?? {}),
                  ...(research.ocRounds != null && (() => {
                    const { aff, neg } = deriveDisclosurePositions(research.ocRounds, research.ocCites ?? []);
                    return {
                      pulledAt: new Date().toISOString(),
                      rawRounds: research.ocRounds,
                      rawCites: research.ocCites ?? [],
                      roundsDisclosed: research.ocRounds.length,
                      ...(aff && { aff }),
                      ...(neg && { neg }),
                    };
                  })()),
                },
              },
            };
          } else {
            opponentId = crypto.randomUUID();
            next.opponents = {
              ...next.opponents,
              [opponentId]: {
                id: opponentId,
                teamName: pairing.opponentCode,
                school: '',
                notes: '',
                roundsAgainst: [roundId],
                ...(research.dlStats && { stats: research.dlStats }),
                disclosures: research.ocRounds != null ? (() => {
                  const { aff, neg } = deriveDisclosurePositions(research.ocRounds, research.ocCites ?? []);
                  return {
                    pulledAt: new Date().toISOString(),
                    rawRounds: research.ocRounds,
                    rawCites: research.ocCites ?? [],
                    roundsDisclosed: research.ocRounds.length,
                    ...(aff && { aff }),
                    ...(neg && { neg }),
                  };
                })() : {},
              },
            };
          }
        }

        // Format display time
        let displayTime: string | undefined;
        if (pairing.time) {
          try { displayTime = new Date(pairing.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
          catch { displayTime = pairing.time; }
        }

        // Create round
        next.rounds = {
          ...next.rounds,
          [roundId]: {
            id: roundId,
            tournamentId: dbTournamentId,
            number: pairing.roundNumber,
            side: pairing.side ?? 'aff',
            opponentId: opponentId ?? '',
            opponentName: pairing.isBye ? 'BYE' : pairing.opponentCode,
            room: pairing.room ?? undefined,
            time: displayTime,
            result: 'pending',
            notes: '',
            argsRead: [],
            argsWorked: [],
            argsFailed: [],
            ...(pairing.judgeName && { judgeName: pairing.judgeName }),
            ...(pairing.judgeId && { judgeId: pairing.judgeId }),
            ...(research.judgeParadigm && { judgeParadigm: research.judgeParadigm }),
            autoFilled: true,
            isBye: pairing.isBye,
          },
        };

        // Add round to tournament
        const tourn = next.tournaments[dbTournamentId];
        if (tourn) {
          next.tournaments = {
            ...next.tournaments,
            [dbTournamentId]: { ...tourn, rounds: [...tourn.rounds, roundId] },
          };
        }

        return next;
      });

      // Navigate to the newly created round
      sv({ kind: 'round', roundId });

      // Show toast
      const msg = pairing.isBye
        ? `Round ${pairing.roundNumber} — BYE (free win!)`
        : `Round ${pairing.roundNumber} posted${pairing.room ? ` · ${pairing.room}` : ''}`;
      setMonitorToast(msg);
      setTimeout(() => setMonitorToast(null), 5000);

      // Fire Gemini mission brief in background — attach to round when ready
      if (!pairing.isBye) {
        (async () => {
          try {
            const { db: db2, update: upd2 } = useApp.getState();
            const savedRound = db2.rounds[roundId];
            const opp = opponentId ? db2.opponents[opponentId] : undefined;
            const disc = (opp?.disclosures as any) ?? {};

            let affName: string | undefined;
            let negPositions: string[] = [];
            let rawCitesSample = '';
            if (disc.aff?.name) affName = disc.aff.name;
            if (disc.neg?.length) negPositions = disc.neg.map((n: any) => n.name).filter(Boolean);
            if (!affName && !negPositions.length && disc.rawCites?.length) {
              const rc: any[] = disc.rawCites;
              const affCite = rc.find((c: any) => (c.side ?? '').toLowerCase().startsWith('a'));
              affName = affCite?.title ?? affCite?.cites?.slice(0, 80) ?? undefined;
              const ns = new Set(rc.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n')).map((c: any) => c.title ?? '').filter(Boolean));
              negPositions = Array.from(ns) as string[];
              rawCitesSample = rc.filter((c: any) => (c.side ?? '').toLowerCase().startsWith('n') && c.cites?.trim()).slice(0, 3).map((c: any) => `[${c.title ?? 'Neg'}]\n${c.cites?.slice(0, 400)}`).join('\n\n');
            }

            const briefRes = await window.warroom.ai.missionBrief({
              roundNumber: pairing.roundNumber,
              side: pairing.side ?? 'aff',
              room: pairing.room ?? undefined,
              time: savedRound?.time,
              opponentName: pairing.opponentCode,
              judgeName: pairing.judgeName ?? undefined,
              judgeParadigm: research.judgeParadigm ?? undefined,
              affName,
              negPositions,
              rawCitesSample: rawCitesSample || undefined,
            });

            if (briefRes.ok && briefRes.text) {
              const { update: upd3 } = useApp.getState();
              await upd3((s) => ({
                ...s,
                rounds: {
                  ...s.rounds,
                  [roundId]: { ...s.rounds[roundId], missionBrief: briefRes.text },
                },
              }));
            }
          } catch { /* best-effort */ }
        })();
      }
    });

    const cleanupError = window.warroom.tabroom.monitor.onError((err) => {
      setMonitorToast(`Monitor error: ${err}`);
      setTimeout(() => setMonitorToast(null), 6000);
    });

    return () => {
      cleanupExisting();
      cleanupNotif();
      cleanupNewRound();
      cleanupError();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — handlers use useApp.getState() for fresh state

  // ── Tabroom Inbox result handlers ──────────────────────────────────────────
  useEffect(() => {
    if (!window.warroom?.tabroom?.inbox) return;

    const cleanupResult = window.warroom.tabroom.inbox.onResult((data) => {
      const { db: freshDb, update: freshUpdate } = useApp.getState();
      const { dbTournamentId, roundNum, result } = data;
      // Find the matching round and update its result
      const matchingRound = Object.values(freshDb.rounds).find(
        (r) => r.tournamentId === dbTournamentId && r.number === roundNum && r.result === 'pending',
      );
      if (matchingRound) {
        freshUpdate((db) => ({
          ...db,
          rounds: {
            ...db.rounds,
            [matchingRound.id]: { ...matchingRound, result, autoFilled: true } as any,
          },
        }));
      }
    });

    const cleanupResultClick = window.warroom.tabroom.inbox.onResultClick(({ dbTournamentId, roundNumber }) => {
      const { db: freshDb, setView: sv } = useApp.getState();
      const round = Object.values(freshDb.rounds).find(
        (r) => r.tournamentId === dbTournamentId && r.number === roundNumber,
      );
      if (round) sv({ kind: 'round', roundId: round.id });
      else sv({ kind: 'tournament', tournamentId: dbTournamentId });
    });

    return () => {
      cleanupResult();
      cleanupResultClick();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate when a scouting update notification is clicked
  useEffect(() => {
    return (window.warroom as any)?.onScoutingOpen?.((data: { kind: 'judge' | 'opponent'; id: string }) => {
      if (data.kind === 'judge') setView({ kind: 'judge', judgeId: data.id });
      else setView({ kind: 'opponent', opponentId: data.id });
    });
  }, [setView]);

  useEffect(() => {
    return window.warroom?.onFileOpen?.((filePath: string) => {
      if (filePath.endsWith('.docx')) {
        setView({ kind: 'speech-doc', docPath: filePath });
      } else if (filePath.endsWith('.xlsx')) {
        const id = crypto.randomUUID();
        const name = filePath.split('/').pop()?.replace(/\.xlsx$/i, '') ?? 'Flow';
        const meta = { id, name, event };
        const newIndex = [...flowsIndex, meta];
        setFlowsIndex(newIndex);
        window.warroom?.storage.write('flows_index', newIndex);
        setView({ kind: 'flow', flowId: id });
      }
    });
  }, [setView, flowsIndex, setFlowsIndex, event]);

  // Check if this is a new user who hasn't completed onboarding.
  useEffect(() => {
    if (!ready) return;
    window.warroom?.storage.read('onboarding_done').then((val) => {
      if (!val) setShowOnboarding(true);
    });
  }, [ready]);

  // Apply/remove the `dark` class on <html> and sync with the OS preference.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = (dark: boolean) => root.classList.toggle('dark', dark);
      apply(mq.matches);
      mq.addEventListener('change', (e) => apply(e.matches));
      return () => mq.removeEventListener('change', (e) => apply(e.matches));
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  // Apply the visual direction (Calm / Paper / Editorial) on <html>.
  useEffect(() => {
    document.documentElement.dataset.direction = direction;
  }, [direction]);

  // Windows: keep the native caption-button overlay in sync with the current
  // theme by reading the live titlebar background and pushing it to main.
  useEffect(() => {
    if (window.warroom?.platform !== 'win32') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cs = getComputedStyle(document.documentElement);
        let color = cs.getPropertyValue('--bg-titlebar').trim();
        if (!color) return;
        if (color.startsWith('rgb')) {
          const m = color.match(/\d+/g);
          if (m) color = '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('');
        }
        let h = color.replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const n = parseInt(h, 16);
        const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
        window.warroom?.setTitleBarOverlay?.({
          color: '#' + h,
          symbolColor: lum < 128 ? '#e8e8ea' : '#33363e',
        });
      });
    };
    sync();
    mq.addEventListener('change', sync);
    return () => { cancelAnimationFrame(raf); mq.removeEventListener('change', sync); };
  }, [theme, direction]);

  function onResizeStart(e: React.MouseEvent) {
    resizing.current = true;
    startX.current = e.clientX;
    startW.current = chatWidth;
    let latestW = chatWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX.current - ev.clientX;
      latestW = Math.max(CHAT_MIN_W, Math.min(CHAT_MAX_W, startW.current + delta));
      setChatWidth(latestW);
    };
    const onUp = () => {
      resizing.current = false;
      localStorage.setItem('warroom-chat-width', String(latestW));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-sm select-none text-ink/30">
        Loading…
      </div>
    );
  }

  function dismissBanner(key: string) {
    dismissedBanners.current.add(key);
    setBanners((prev) => prev.filter((b) => `${b.eventType}:${b.resolution}` !== key));
  }

  const BANNER_H = 52;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-main)' }}>
      {/* New-topic banners — fixed at very top, push layout down */}
      {banners.map((banner) => {
        const key = `${banner.eventType}:${banner.resolution}`;
        const bgColor = banner.eventType === 'pf' ? '#F59E0B' : '#EF4444';
        return (
          <div
            key={key}
            className="flex items-center px-4 cursor-pointer select-none"
            style={{
              backgroundColor: bgColor,
              height: BANNER_H,
              flexShrink: 0,
              animation: 'slideDown 0.2s ease',
            }}
            onClick={() => {
              dismissBanner(key);
              setView({ kind: 'topics', tab: banner.eventType });
            }}
          >
            <span className="relative flex h-3 w-3 mr-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
            </span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="font-bold text-white text-sm shrink-0">
                🔔 NEW {banner.eventType === 'pf' ? 'PF' : 'LD'} TOPIC DROPPED
              </span>
              <span className="text-white/90 text-xs truncate">
                {banner.resolution}
              </span>
            </div>
            <span className="text-white font-medium text-xs mr-4 whitespace-nowrap shrink-0">
              View Details →
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); dismissBanner(key); }}
              className="text-white/80 hover:text-white text-base font-bold ml-1 shrink-0 leading-none"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto scroll-thin flex flex-col" style={{ background: 'var(--bg-main)' }}>
          <Router />
        </main>
        {/* Gemini panel */}
        {geminiOpen && (
          <div style={{ width: chatWidth, minWidth: chatWidth, maxWidth: chatWidth, flexShrink: 0, borderLeft: '1px solid var(--border-side)' }}>
            <GeminiPanel />
          </div>
        )}
        {/* Resize handle — only in DOM when chat panel is open */}
        {chatOpen && (
          <div
            className="w-1 shrink-0 cursor-col-resize z-10 hover:opacity-100 transition-opacity"
            style={{ background: 'var(--border-side)', opacity: 0.4 }}
            onMouseDown={onResizeStart}
          />
        )}
        {/* Visible chat panel — only in the flex row when open */}
        {chatOpen && (
          <div style={{ width: chatWidth, minWidth: chatWidth, maxWidth: chatWidth, flexShrink: 0 }}>
            <Chat />
          </div>
        )}
      </div>
      {/* Always-mounted Chat for session restore + unread counter subscriptions.
          Position absolute + zero size so it never affects layout. */}
      {!chatOpen && (
        <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
          <Chat />
        </div>
      )}
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
      {searchOpen && <SearchPalette />}
      {/* Tabroom monitor toast */}
      {monitorToast && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-med)',
            borderRadius: 10, padding: '10px 18px', zIndex: 9999,
            boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, color: 'rgb(var(--ink-rgb))',
          }}
        >
          <span style={{ fontSize: 15 }}>📡</span>
          <span>{monitorToast}</span>
        </div>
      )}
    </div>
  );
}

function Router() {
  const { view, mode, db } = useApp();

  // OpenCaseList-imported cases carry a docx (ocSource) and are rendered by the
  // full SpeechDocViewer (outline, find, credibility, cross-ex, etc.), not the
  // block-based CaseView. Route them to the always-mounted speech slot.
  const ocCaseActive = view.kind === 'case' && !!db.cases[(view as any).caseId]?.ocSource;

  const isSpeech = (mode === 'round' && view.kind === 'block' && (view as any).blockId === '__speech__')
    || view.kind === 'speech-doc' || ocCaseActive;
  const isLogos = view.kind === 'logos';
  const isOpenEv = view.kind === 'open-ev';
  const isGoogleScholar = view.kind === 'google-scholar';

  // Determine what to show in the regular (unmounted-on-navigate) slot
  let regular: React.ReactNode = null;
  if (!isSpeech && !isLogos && !isOpenEv && !isGoogleScholar) {
    switch (view.kind) {
      case 'home':        regular = <Home />; break;
      case 'case':        regular = <CaseView />; break;
      case 'block':       regular = <BlockView />; break;
      case 'library':     regular = <Library />; break;
      case 'settings':    regular = <Settings />; break;
      case 'opponents':   regular = <OpponentSearch />; break;
      case 'opponent':    regular = <OpponentProfile key={(view as any).opponentId} />; break;
      case 'judge':         regular = <JudgeProfile key={(view as any).judgeId} />; break;
      case 'judge-preview': regular = <JudgeProfile key={(view as any).personId} />; break;
      case 'round':       regular = <MissionBrief />; break;
      case 'tournaments': regular = <TournamentList />; break;
      case 'tournament':  regular = <TournamentView />; break;
      case 'flow':        regular = <FlowView />; break;
      case 'gdrive':        regular = <GoogleDrivePanel />; break;
      case 'docs':          regular = <Documentation />; break;
      case 'user-manual':   regular = <UserManual />; break;
      case 'topics':        regular = <TopicsScreen />; break;
      case 'impact-calc':   regular = <ImpactCalcView />; break;
      case 'impact-hub':    regular = <ImpactHub />; break;
      case 'outweigh-game': regular = <OutweighGame key={(view as any).difficulty} />; break;
      default:              regular = <Home />;
    }
  }

  return (
    <>
      <div className="contents" style={{ display: isSpeech ? undefined : 'none' }}>
        <SpeechDocViewer />
      </div>
      {/* Webviews always mounted so they don't refresh on navigation */}
      <div className="contents" style={{ display: isLogos ? undefined : 'none' }}>
        <FindCards />
      </div>
      <div className="contents" style={{ display: isOpenEv ? undefined : 'none' }}>
        <OpenEvView />
      </div>
      <div className="contents" style={{ display: isGoogleScholar ? undefined : 'none' }}>
        <GoogleScholarView />
      </div>
      {/* Dedicated hidden webviews for agent searches — never touches the user's views */}
      <AgentSearchViews />
      {regular}
    </>
  );
}
