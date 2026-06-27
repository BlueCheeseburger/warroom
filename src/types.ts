export type Side = 'aff' | 'neg';

export interface Card {
  id: string;
  blockId: string;
  tag: string;
  cite: string;
  body: string;
  year: number;
  flagged: boolean;
  createdAt: string;
}

export interface Block {
  id: string;
  caseId: string;
  title: string;
  type: string;
  cards: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Case {
  id: string;
  name: string;
  side: Side;
  blocks: string[];
  shared?: boolean;
  ocSource?: {
    teamName: string;
    label: string;
    url: string;
    importedAt: string;
    byteLen?: number;
  };
  searchKeywords?: string[];   // cached keyword extraction result
  searchSig?: string;          // signature: ocSource.url + ':' + ocSource.byteLen — re-extract only when changed
}

export interface DisclosedPosition {
  name: string;
  description?: string;
}

export interface OpponentStats {
  source: 'debate.land';
  event: 'policy' | 'pf' | 'ld';
  careerOTR: number | null;
  peakRank: number | null;
  avgSpeaks: number | null;
  avgStdSpeaks: number | null;
  totalRounds: number | null;
  totalBids: number | null;
  avgOpWpM: string | null;
  prelimWinPct: string | null;
  avgBreakPct: string | null;
  avgTrueWinPct: string | null;
  totalRecord: string | null;
  prelimRecord: string | null;
  debateLandUrl: string | null;
  lastFetched: string | null;
}

export interface Opponent {
  id: string;
  teamName: string;
  school: string;
  teamId?: string; // OpenCaselist team ID
  caselist?: string; // OpenCaselist caselist slug (e.g. 'hspolicy25')
  notes: string;
  disclosures: {
    pulledAt?: string;
    roundsDisclosed?: number;
    aff?: DisclosedPosition;
    neg?: DisclosedPosition[];
    rawRounds?: any[];
    rawCites?: any[];
    aiScout?: {
      aff: string;
      neg: string;
      citations: { id: number; sourceTitle: string; excerpt: string }[];
      generatedAt: string;
    };
  };
  roundsAgainst: string[]; // round IDs
  stats?: OpponentStats;
  tabroom_entry_id?: string;
}

export interface Round {
  id: string;
  tournamentId: string;
  number: number;
  side: Side;
  opponentId: string;
  opponentName?: string; // fallback if not in profiles
  room?: string;
  time?: string;
  result: 'win' | 'loss' | 'pending';
  notes: string;
  judgeNotes?: string;
  argsRead: string[];
  argsWorked: string[];
  argsFailed: string[];
  suggestedBlocks?: string[];
  // Auto-populated by Tabroom monitor
  judgeName?: string;
  judgeParadigm?: string;
  judgeId?: string;
  autoFilled?: boolean;
  isBye?: boolean;
  missionBrief?: string;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  start?: string;
  end?: string;
  location?: string;
  event_type?: string;
  rounds: string[];
  tabroom_id?: string;
  tabroom_event_id?: string;
  tabroomEntryCode?: string; // e.g. "Emery BL" — used by the Tabroom monitor
}

export interface SharedNote {
  user_id: string;
  user_name: string;
  content: string;
  updated_at: string;
}

export interface JudgeRound {
  tournament: string; date: string; level: string;
  event: string; round: string; aff: string; neg: string;
  vote: string; result: string;
}

export interface Judge {
  id: string;
  personId: string;
  name: string;
  institution: string;
  paradigm: string | null;
  record?: JudgeRound[];
  notes: string;
  tabroomUrl: string;
  savedAt: string;
  paradigmFetchedAt: string | null;
  /** "Last reviewed on…" string from Tabroom, used to detect paradigm updates. */
  paradigmLastReviewedAt?: string | null;
}

export interface DB {
  cases: Record<string, Case>;
  blocks: Record<string, Block>;
  cards: Record<string, Card>;
  opponents: Record<string, Opponent>;
  tournaments: Record<string, Tournament>;
  rounds: Record<string, Round>;
  judges: Record<string, Judge>;
  /** Manual win/loss adjustments on top of round-derived totals */
  manualWins?: number;
  manualLosses?: number;
}

export const emptyDB = (): DB => ({
  cases: {},
  blocks: {},
  cards: {},
  opponents: {},
  tournaments: {},
  rounds: {},
  judges: {},
  manualWins: 0,
  manualLosses: 0,
});

// ─── Tabroom Monitor types ─────────────────────────────────────────────────────

export interface TabroomMonitorConfig {
  dbTournamentId: string;
  tabroomTournId: string;
  tournamentName: string;
  eventName: string;
  entryCode: string;
  caselist: string;
  eventType: string;
}

export interface TabroomPairing {
  roundNumber: number;
  roundId: string;
  room: string | null;
  time: string | null;
  side: 'aff' | 'neg' | null;
  opponentCode: string;
  judgeName: string | null;
  judgeId: string | null;
  isBye: boolean;
}

export interface TabroomRoundBrief {
  dbTournamentId: string;
  pairing: TabroomPairing;
  research: {
    judgeParadigm: string | null;
    ocRounds: any[] | null;
    ocCites: any[] | null;
    dlStats: any | null;
  };
}

declare global {
  interface Window {
    warroom: {
      storage: {
        read: (name: string) => Promise<any>;
        write: (name: string, data: unknown) => Promise<boolean>;
      };
      flowSync: {
        join: (flowId: string) => Promise<{ ok: boolean; error?: string }>;
        leave: (flowId: string) => Promise<{ ok: boolean }>;
        broadcastUpdate: (flowId: string, updateB64: string) => Promise<{ ok: boolean; error?: string }>;
        broadcastAwareness: (flowId: string, awarenessB64: string) => Promise<{ ok: boolean }>;
        track: (flowId: string, meta: any) => Promise<{ ok: boolean }>;
        promote: (flowId: string, teamId: string, name: string, contentB64: string) => Promise<{ ok: boolean; error?: string }>;
        saveSnapshot: (flowId: string, name: string, contentB64: string) => Promise<{ ok: boolean; error?: string }>;
        loadSnapshot: (flowId: string) => Promise<{ ok: boolean; data?: { content: string | null; name: string; team_id: string; owner_id: string; updated_at: string } | null; error?: string }>;
        onRemoteUpdate: (cb: (p: { flowId: string; update: string }) => void) => () => void;
        onRemoteAwareness: (cb: (p: { flowId: string; awareness: string }) => void) => () => void;
        onPresence: (cb: (p: { flowId: string; state: any }) => void) => () => void;
      };
      secure: {
        set: (key: string, value: string) => Promise<boolean>;
        get: (key: string) => Promise<string | null>;
      };
      dialog: {
        openFile: (accept: string[]) => Promise<string | null>;
        saveBuffer: (base64: string, defaultName: string, filters: { name: string; extensions: string[] }[]) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
      };
      ai: {
        extractCards: (filePath: string) => Promise<ExtractedCard[]>;
        suggestBlocks: (
          opponentPositions: string,
          blockList: { id: string; title: string }[]
        ) => Promise<string[]>;
        teamSummary: (params: {
          teamName: string;
          rawRounds: any[];
          rawCites: any[];
        }) => Promise<{
          ok: boolean;
          aff?: string;
          neg?: string;
          citations?: { id: number; sourceTitle: string; excerpt: string }[];
          error?: string;
        }>;
        missionBrief: (params: {
          roundNumber: number; side: string; room?: string; time?: string;
          opponentName: string; judgeName?: string; judgeParadigm?: string;
          affName?: string; negPositions: string[]; rawCitesSample?: string;
        }) => Promise<{ ok: boolean; text?: string; error?: string }>;
        parseRoundEmail: (params: {
          filePath?: string;
          imageBase64?: string;
          mimeType?: string;
        }) => Promise<{
          ok: boolean;
          data?: {
            round: number;
            side: 'aff' | 'neg';
            room: string | null;
            time: string | null;
            aff_team: string;
            neg_team: string;
            judge: string | null;
            isBye: boolean;
          };
          error?: string;
          usedFallback?: boolean;
        }>;
        crossExQuestions: (params: {
          highlightedText: string;
          fullText: string;
          event: 'policy' | 'pf' | 'ld';
          basedOn?: string;
          side?: string;
        }) => Promise<{
          ok: boolean;
          // Initial generation returns grouped questions; "3 more like this" returns a flat array.
          groups?: { side: 'Aff' | 'Neg' | 'General'; questions: { question: string; answer: string; cardCite?: string }[] }[];
          questions?: { question: string; answer: string; cardCite?: string }[];
          error?: string;
        }>;
        crossExTraps: (params: {
          highlightedText: string;
          fullText: string;
          event: 'policy' | 'pf' | 'ld';
        }) => Promise<{
          ok: boolean;
          traps?: { setup: string; trapAnswer: string; gotcha: string; idealAnswer: string; lesson: string }[];
          error?: string;
        }>;
        crossExGradeTrap: (params: {
          setup: string; idealAnswer: string; trapAnswer: string; gotcha: string; lesson: string;
          userAnswer: string; event: 'policy' | 'pf' | 'ld';
        }) => Promise<{
          ok: boolean;
          verdict?: 'avoided' | 'fell' | 'partial';
          feedback?: string;
          error?: string;
        }>;
        scoreCards: (params: { cards: { tag: string; cite: string }[] }) => Promise<{
          ok: boolean;
          scores?: { score: number; verdict: string; author: number; recency: number; source: number; claim: number; reason: string; press: string }[];
          error?: string;
        }>;
      };
      clipboard: {
        readImage: () => Promise<{ ok: boolean; base64?: string; mimeType?: string; error?: string }>;
      };
      opencaselist: {
        login: (username: string, password: string) => Promise<boolean>;
        caselists: () => Promise<any>;
        search: (query: string, shard: string) => Promise<any>;
        rounds: (caselist: string, school: string, team: string) => Promise<any>;
        cites: (caselist: string, school: string, team: string) => Promise<any>;
        openFile: (urlOrPath: string) => Promise<{ ok: boolean; error?: string }>;
        fetchFileToTemp: (urlOrPath: string) => Promise<{ ok: boolean; tempPath: string; filename: string; downloadUrl: string; error?: string }>;
        saveFile: (tempPath: string, defaultName: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
      };
      shell: {
        openPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
        openBuffer: (base64: string, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
        openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      };
      fs: {
        readFileBytes: (filePath: string) => Promise<{ ok: boolean; base64?: string; error?: string }>;
        readDocxBytes: (filePath: string) => Promise<{ ok: boolean; base64?: string; error?: string }>;
        writeTempFile: (base64: string, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      };
      dl: {
        searchTeam: (params: { query: string; eventType: string }) =>
          Promise<{ success: boolean; results?: any[]; error?: string }>;
        getTeamStats: (params: { teamId: string; eventType: string }) =>
          Promise<{ success: boolean; stats?: any; name?: string; error?: string }>;
      };
      tabroom: {
        getTournament: (tournId: string) =>
          Promise<{ success: boolean; data?: any; error?: string }>;
        getEntries: (tournId: string, eventId: string) =>
          Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPairings: (tournId: string, eventId: string, roundId: string) =>
          Promise<{ success: boolean; data?: any[]; error?: string }>;
        fetchTournament: (tournId: string) =>
          Promise<{ success: boolean; tournament?: { name: string | null; start: string | null; end: string | null; city: string | null; state: string | null; events: any[]; tabroom_id: string }; error?: string }>;
        monitor: {
          start: (config: TabroomMonitorConfig) => Promise<{ ok: boolean; error?: string }>;
          stop: () => Promise<{ ok: boolean }>;
          status: () => Promise<{ active: boolean; state: TabroomMonitorConfig | null }>;
          fetchParadigm: (judgeId: string) => Promise<{ ok: boolean; text?: string | null; error?: string }>;
          onNewRound: (cb: (data: TabroomRoundBrief) => void) => () => void;
          onError: (cb: (err: string) => void) => () => void;
          onStopped: (cb: () => void) => () => void;
          onNotifClick: (cb: (data: { dbTournamentId: string; roundNumber: number }) => void) => () => void;
          onExistingRounds: (cb: (roundNumbers: number[]) => void) => () => void;
          testFire: (opts?: any) => Promise<any>;
          pollNow: () => Promise<{ ok: boolean; error?: string }>;
        };
        fetchParadigmByName: (name: string) => Promise<{ ok: boolean; personId?: string | null; paradigm?: string | null; record?: any[]; error?: string }>;
        searchJudges: (query: string) => Promise<{ ok: boolean; results?: { personId: string; name: string; institution: string }[]; error?: string }>;
        fetchParadigm: (judgeId: string) => Promise<{ ok: boolean; paradigm?: string | null; record?: JudgeRound[]; error?: string }>;
        searchTournaments: (query: string) => Promise<{ ok: boolean; results?: { id: string; name: string; start: string; end: string; location: string; circuit: string }[]; error?: string }>;
        testLogin: (username: string, password: string) => Promise<{ ok: boolean; error?: string; reason?: 'no_creds' | 'form_parse_failed' | 'rejected' | 'no_cookie' | 'network' }>;
        retestLogin?: () => Promise<{ ok: boolean; error?: string }>;
        inbox?: {
          start: (cfg: { entryCode: string; dbTournamentId: string; tournamentName: string }) => Promise<{ ok: boolean; error?: string }>;
          stop: () => Promise<{ ok: boolean }>;
          status: () => Promise<{ active: boolean; config: any }>;
          onResult: (cb: (data: { key: string; roundNum: number; result: 'win' | 'loss'; dbTournamentId: string }) => void) => () => void;
          onResultClick: (cb: (data: { dbTournamentId: string; roundNumber: number }) => void) => () => void;
        };
      };
      chat: {
        getSession: () => Promise<{ ok: boolean; data?: any; error?: string }>;
        signIn: (email: string, password: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        signUp: (email: string, password: string, displayName: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        signOut: () => Promise<{ ok: boolean; error?: string }>;
        resetPassword: (email: string) => Promise<{ ok: boolean; error?: string }>;
        updatePassword: (password: string) => Promise<{ ok: boolean; error?: string }>;
        onAuthRecovery: (cb: () => void) => () => void;
        getTeam: (userId: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        getTeams: (userId: string) => Promise<{ ok: boolean; data?: ChatTeam[]; error?: string }>;
        createTeam: (name: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        joinTeam: (inviteCode: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        joinTeamByCode: (inviteCode: string, displayName: string, role: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        getMessages: (teamId: string) => Promise<{ ok: boolean; data?: any[]; error?: string }>;
        sendMessage: (payload: any) => Promise<{ ok: boolean; data?: any; error?: string }>;
        subscribe: (teamId: string) => Promise<void>;
        unsubscribe: () => Promise<void>;
        onNewMessage: (cb: (msg: any) => void) => () => void;
        getMembers: (teamId: string) => Promise<{ ok: boolean; data?: any[]; error?: string }>;
        kickMember: (teamId: string, userId: string) => Promise<{ ok: boolean; error?: string }>;
        renameTeam: (teamId: string, name: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        claimOwnership: (teamId: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        geminiSend: (messages: any[], systemText?: string) => Promise<{ ok: boolean; data?: string; error?: string }>;
        onGeminiChunk: (cb: (text: string) => void) => () => void;
        onGeminiDone: (cb: () => void) => () => void;
        onGeminiError: (cb: (err: string) => void) => () => void;
        generateGeminiTitle: (messages: any[]) => Promise<{ ok: boolean; data?: string; error?: string }>;
        geminiAgentTurn: (messages: any[], wantTitle?: boolean, userContext?: string) => Promise<{ ok: boolean; data?: { type: 'text' | 'tool_call'; text?: string; title?: string; name?: string; args?: Record<string, any>; modelContent?: any }; error?: string }>;
        lookupUserByEmail: (email: string) => Promise<{ ok: boolean; data?: { userId: string; displayName: string } | null; error?: string }>;
        getDMChannels: (teamId: string) => Promise<{ ok: boolean; data?: any[]; error?: string }>;
        createDM: (teamId: string, members: { userId: string; displayName: string }[], name?: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
        getDMMessages: (dmChannelId: string) => Promise<{ ok: boolean; data?: any[]; error?: string }>;
        sendDMMessage: (payload: any) => Promise<{ ok: boolean; data?: any; error?: string }>;
        addDMMember: (dmChannelId: string, userId: string, displayName: string) => Promise<{ ok: boolean; error?: string }>;
        subscribeDM: (dmChannelId: string) => Promise<void>;
        unsubscribeDM: () => Promise<void>;
        onNewDMMessage: (cb: (msg: any) => void) => () => void;
        editMessage: (messageId: string, content: string) => Promise<{ ok: boolean; error?: string }>;
        deleteMessage: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
        editDMMessage: (messageId: string, content: string) => Promise<{ ok: boolean; error?: string }>;
        deleteDMMessage: (messageId: string) => Promise<{ ok: boolean; error?: string }>;
      };
      gdrive: {
        status: () => Promise<{ connected: boolean }>;
        connect: () => Promise<{ ok: boolean; error?: string }>;
        disconnect: () => Promise<{ ok: boolean }>;
        listFiles: (pageToken?: string) => Promise<{ ok: boolean; files?: DriveFile[]; nextPageToken?: string; error?: string }>;
        searchFiles: (query: string) => Promise<{ ok: boolean; files?: DriveFile[]; error?: string }>;
        fetchFile: (fileId: string) => Promise<{ ok: boolean; base64?: string; error?: string }>;
        uploadAsSheets: (base64: string, filename: string) => Promise<{ ok: boolean; fileId?: string; url?: string; error?: string }>;
      };
      topics: {
        scrape: () => Promise<any>;
        getStored: () => Promise<any>;
        save: (topics: any) => Promise<{ ok: boolean }>;
        generateBrief: (params: { eventType: 'pf' | 'ld'; resolution: string }) => Promise<{ success: boolean }>;
        getNextReleaseDates: () => Promise<{ pf: string | null; ld: string | null }>;
        getPolicyContext: () => Promise<string | null>;
        onUpdated: (cb: () => void) => () => void;
        onNavigateTo: (cb: (eventType: 'pf' | 'ld') => void) => () => void;
      };
      gemini: {
        compareImpacts: (pathA: string, pathB: string, labelA: string, labelB: string) =>
          Promise<{ ok: true; result: ImpactCalcResult } | { ok: false; error: string }>;
        importFlow: (input: ImportFlowInput) => Promise<ImportFlowResult>;
      };
      agent: {
        fetchArticle: (url: string) => Promise<{ ok: boolean; text: string; error?: string }>;
      };
      skills: {
        list: () => Promise<{ ok: boolean; skills: { name: string; source: 'user' | 'bundled' }[]; error?: string }>;
        read: (name: string) => Promise<{ ok: boolean; content: string; error?: string }>;
      };
      notes: {
        get: (p: { teamId: string; entityType: string; entityId: string }) => Promise<{ ok: boolean; data?: SharedNote[]; error?: string }>;
        upsert: (p: { teamId: string; entityType: string; entityId: string; entityName: string; userId: string; userName: string; content: string }) => Promise<{ ok: boolean; error?: string }>;
      };
      platform: string;
      setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => Promise<boolean>;
      onFileOpen: (cb: (filePath: string) => void) => () => void;
    };
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatUser {
  id: string;
  email: string;
  displayName: string;
}

export interface ChatTeam {
  id: string;
  name: string;
  invite_code: string;
  owner_id?: string | null;
}

export interface ChatMember {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
}

export interface DMChannel {
  id: string;
  team_id: string;
  name: string | null;
  created_at: string;
  members: { user_id: string; display_name: string }[];
}

export interface DMMessage {
  id: string;
  dm_channel_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
  attachments?: (MessageAttachment & { permission?: 'edit' | 'view' })[];
}

export interface MessageAttachment {
  id: string;
  message_id: string;
  type: 'case' | 'block' | 'flow' | 'opponent' | 'member' | 'image' | 'speech-doc';
  name: string;
  data: any;
}

export interface ChatMessage {
  id: string;
  team_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  round_ref_id?: string;
  round_ref_label?: string;
  created_at: string;
  attachments?: MessageAttachment[];
}

// Item queued for attachment when user picks a mention
export interface PendingMention {
  type: 'case' | 'block' | 'flow' | 'opponent' | 'member' | 'image' | 'speech-doc' | 'speechdoc' | 'judge';
  id: string;
  name: string;
  data: any;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export interface ExtractedCard {
  tag: string;
  cite: string;
  body: string;
  year: number;
}

// ─── Impact calculus ──────────────────────────────────────────────────────────

export interface ImpactItem {
  claim: string;
  magnitude: 'extinction' | 'existential' | 'major' | 'moderate' | 'minor';
  probability: 'high' | 'medium' | 'low';
  timeframe: 'immediate' | 'short' | 'medium' | 'long';
  reversibility: 'irreversible' | 'difficult' | 'reversible';
}

export interface ImpactClash {
  claimA: string | null;
  claimB: string | null;
  winner: 'A' | 'B' | 'even';
  reasoning: string;
  dimension: string;
}

export interface ImpactCalcResult {
  summary: string;
  docA: { label: string; impacts: ImpactItem[] };
  docB: { label: string; impacts: ImpactItem[] };
  clashes: ImpactClash[];
  verdict: 'A' | 'B' | 'even';
  verdictReason: string;
}

// ─── Flow-sheet import (AI fallback) ──────────────────────────────────────────

export interface ImportFlowInput {
  event: 'policy' | 'pf' | null;
  sheets: { name: string; grid: string[][] }[];
}

export type ImportFlowResult =
  | { ok: true; event: 'policy' | 'pf'; sheets: { name: string; rows: string[][] }[] }
  | { ok: false; error: string };

