import { create } from 'zustand';
import { DB, emptyDB, ChatUser, ChatTeam, ChatMember } from '../types';
import { loadDB, saveDB } from '../utils/storage';

export type Mode = 'prep' | 'round';
export type Theme = 'system' | 'light' | 'dark';
export type DebateEvent = 'policy' | 'pf' | 'ld';
/** 'hover' = red only on hover (subtle); 'always' = red border always, deeper on hover */
export type DangerHighlight = 'hover' | 'always';

// Maps the full app_settings value (from onboarding) to a DebateEvent.
export function mapSettingsEvent(e: string): DebateEvent {
  if (e === 'hspf') return 'pf';
  if (e === 'hsld' || e === 'nfald') return 'ld';
  return 'policy'; // hspolicy, ndtceda, or unknown
}

export interface FlowMeta {
  id: string;
  name: string;
  event: DebateEvent;
  shared?: boolean;
}

export type View =
  | { kind: 'home' }
  | { kind: 'case'; caseId: string }
  | { kind: 'block'; blockId: string }
  | { kind: 'library' }
  | { kind: 'speech-doc'; docPath?: string }
  | { kind: 'tournaments' }
  | { kind: 'tournament'; tournamentId: string }
  | { kind: 'round'; roundId: string }
  | { kind: 'opponents' }
  | { kind: 'opponent'; opponentId: string }
  | { kind: 'judge'; judgeId: string }
  | { kind: 'judge-preview'; personId: string; name: string; institution: string }
  | { kind: 'settings'; scrollTo?: string }
  | { kind: 'flow'; flowId?: string }
  | { kind: 'logos' }
  | { kind: 'open-ev' }
  | { kind: 'google-scholar' }
  | { kind: 'gdrive' }
  | { kind: 'docs' }
  | { kind: 'topics'; tab?: 'policy' | 'pf' | 'ld' };

export type AgentSearchFn = (query: string) => Promise<string>;

interface AppState {
  db: DB;
  mode: Mode;
  view: View;
  theme: Theme;
  dangerHighlight: DangerHighlight;
  setDangerHighlight: (d: DangerHighlight) => void;
  event: DebateEvent;
  flowsIndex: FlowMeta[];
  ready: boolean;
  busyViews: Record<string, string>;
  // Chat
  chatOpen: boolean;
  geminiOpen: boolean;
  unreadCount: number;
  currentUser: ChatUser | null;
  currentTeam: ChatTeam | null;
  teamMembers: ChatMember[];
  defaultSharePermission: 'edit' | 'view';
  navHistory: View[];
  navHistoryIndex: number;
  setMode: (m: Mode) => void;
  setView: (v: View) => void;
  goBack: () => void;
  goForward: () => void;
  setTheme: (t: Theme) => void;
  cycleTheme: () => void;
  setEvent: (e: DebateEvent) => void;
  setFlowsIndex: (idx: FlowMeta[]) => void;
  init: () => Promise<void>;
  update: (fn: (db: DB) => DB) => Promise<void>;
  setBusy: (viewKey: string, label: string | null) => void;
  // Chat actions
  setChatOpen: (open: boolean) => void;
  setGeminiOpen: (open: boolean) => void;
  geminiActiveId: string | null;
  setGeminiActiveId: (id: string | null) => void;
  setCurrentUser: (user: ChatUser | null) => void;
  setCurrentTeam: (team: ChatTeam | null) => void;
  setTeamMembers: (members: ChatMember[]) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
  setDefaultSharePermission: (p: 'edit' | 'view') => void;
  // Onboarding
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  // Agent search registry — webview components register their search fns here
  agentSearchFns: { logos: AgentSearchFn | null; openev: AgentSearchFn | null };
  registerAgentSearch: (source: 'logos' | 'openev', fn: AgentSearchFn | null) => void;
}

export const useApp = create<AppState>((set, get) => ({
  db: emptyDB(),
  mode: 'prep',
  view: { kind: 'home' },
  navHistory: [{ kind: 'home' }],
  navHistoryIndex: 0,
  theme: (localStorage.getItem('warroom-theme') as Theme | null) ?? 'system',
  dangerHighlight: (localStorage.getItem('warroom-danger-highlight') as DangerHighlight | null) ?? 'always',
  setDangerHighlight: (d) => { localStorage.setItem('warroom-danger-highlight', d); set({ dangerHighlight: d }); },
  event: (localStorage.getItem('warroom-event') as DebateEvent | null) ?? 'policy',
  flowsIndex: [],
  ready: false,
  busyViews: {},
  chatOpen: false,
  geminiOpen: false,
  geminiActiveId: null,
  unreadCount: 0,
  currentUser: null,
  currentTeam: null,
  teamMembers: [],
  defaultSharePermission: (localStorage.getItem('warroom-share-permission') as 'edit' | 'view' | null) ?? 'edit',
  showOnboarding: false,
  agentSearchFns: { logos: null, openev: null },
  registerAgentSearch: (source, fn) => set((s) => ({
    agentSearchFns: { ...s.agentSearchFns, [source]: fn },
  })),
  setMode: (m) => set({ mode: m }),
  setView: (v) => set((s) => {
    const trimmed = s.navHistory.slice(0, s.navHistoryIndex + 1);
    const newHistory = [...trimmed, v].slice(-60);
    return { view: v, navHistory: newHistory, navHistoryIndex: newHistory.length - 1 };
  }),
  goBack: () => set((s) => {
    if (s.navHistoryIndex <= 0) return s;
    const newIndex = s.navHistoryIndex - 1;
    return { view: s.navHistory[newIndex], navHistoryIndex: newIndex };
  }),
  goForward: () => set((s) => {
    if (s.navHistoryIndex >= s.navHistory.length - 1) return s;
    const newIndex = s.navHistoryIndex + 1;
    return { view: s.navHistory[newIndex], navHistoryIndex: newIndex };
  }),
  setEvent: (e) => { localStorage.setItem('warroom-event', e); set({ event: e }); },
  setFlowsIndex: (idx) => set({ flowsIndex: idx }),
  setBusy: (viewKey, label) => set((s) => {
    const next = { ...s.busyViews };
    if (label === null) delete next[viewKey]; else next[viewKey] = label;
    return { busyViews: next };
  }),
  setTheme: (t) => {
    localStorage.setItem('warroom-theme', t);
    set({ theme: t });
  },
  cycleTheme: () => {
    const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
    const t = next[get().theme];
    localStorage.setItem('warroom-theme', t);
    set({ theme: t });
  },
  init: async () => {
    try {
      const db = await loadDB();
      let flowsIndex: FlowMeta[] = [];
      try {
        const idx = await window.warroom?.storage.read('flows_index');
        if (Array.isArray(idx)) flowsIndex = idx;
      } catch {}
      // app_settings.event (chosen in Settings / onboarding) is the source of truth for
      // the active event. Reconcile it on every launch so the timer, flows, and forms
      // follow the user's saved event instead of a stale cached localStorage value.
      let event = get().event;
      try {
        const s = await window.warroom?.storage.read('app_settings');
        if (s?.event) {
          event = mapSettingsEvent(s.event);
          localStorage.setItem('warroom-event', event);
        }
      } catch {}
      set({ db, flowsIndex, ready: true, event });
    } catch (err) {
      console.error('Failed to load DB:', err);
      set({ db: emptyDB(), flowsIndex: [], ready: true });
    }
  },
  update: async (fn) => {
    const next = fn(get().db);
    set({ db: next });
    await saveDB(next);
  },
  setShowOnboarding: (show) => set({ showOnboarding: show }),
  setChatOpen: (open) => set({ chatOpen: open }),
  setGeminiOpen: (open) => set({ geminiOpen: open }),
  setGeminiActiveId: (id) => set({ geminiActiveId: id }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setCurrentTeam: (team) => set({ currentTeam: team }),
  setTeamMembers: (members) => set({ teamMembers: members }),
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  clearUnread: () => set({ unreadCount: 0 }),
  setDefaultSharePermission: (p) => {
    localStorage.setItem('warroom-share-permission', p);
    set({ defaultSharePermission: p });
  },
}));

/**
 * Returns the Tailwind className string for danger (delete) icon buttons,
 * respecting the user's dangerHighlight preference.
 */
export function useDangerBtnClass() {
  const dangerHighlight = useApp((s) => s.dangerHighlight);
  if (dangerHighlight === 'always') {
    // Always visible red border + tint; deeper on hover
    return 'text-danger border-danger/60 hover:border-danger hover:bg-danger/15';
  }
  // Subtle: only shows red on hover
  return 'text-danger border-danger/30 hover:border-danger/70 hover:bg-danger/10';
}
