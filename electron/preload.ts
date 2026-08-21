import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  storage: {
    read: (name: string) => ipcRenderer.invoke('storage:read', name),
    write: (name: string, data: unknown) => ipcRenderer.invoke('storage:write', name, data),
  },
  // Live collaborative flowing: Yjs document synced over Supabase Realtime
  // broadcast. Update/awareness payloads are base64 strings (Uint8Array <-> b64).
  flowSync: {
    join: (flowId: string) => ipcRenderer.invoke('flowSync:join', flowId),
    leave: (flowId: string) => ipcRenderer.invoke('flowSync:leave', flowId),
    broadcastUpdate: (flowId: string, updateB64: string) => ipcRenderer.invoke('flowSync:broadcastUpdate', flowId, updateB64),
    broadcastAwareness: (flowId: string, awarenessB64: string) => ipcRenderer.invoke('flowSync:broadcastAwareness', flowId, awarenessB64),
    track: (flowId: string, meta: any) => ipcRenderer.invoke('flowSync:track', flowId, meta),
    promote: (flowId: string, teamId: string, name: string, contentB64: string) =>
      ipcRenderer.invoke('flowSync:promote', flowId, teamId, name, contentB64),
    saveSnapshot: (flowId: string, name: string, contentB64: string) =>
      ipcRenderer.invoke('flowSync:saveSnapshot', flowId, name, contentB64),
    loadSnapshot: (flowId: string) => ipcRenderer.invoke('flowSync:loadSnapshot', flowId),
    onRemoteUpdate: (cb: (p: { flowId: string; update: string }) => void) => {
      const h = (_e: any, p: any) => cb(p);
      ipcRenderer.on('flowSync:remoteUpdate', h);
      return () => ipcRenderer.removeListener('flowSync:remoteUpdate', h);
    },
    onRemoteAwareness: (cb: (p: { flowId: string; awareness: string }) => void) => {
      const h = (_e: any, p: any) => cb(p);
      ipcRenderer.on('flowSync:remoteAwareness', h);
      return () => ipcRenderer.removeListener('flowSync:remoteAwareness', h);
    },
    onPresence: (cb: (p: { flowId: string; state: any }) => void) => {
      const h = (_e: any, p: any) => cb(p);
      ipcRenderer.on('flowSync:presence', h);
      return () => ipcRenderer.removeListener('flowSync:presence', h);
    },
    // Realtime channel status (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED)
    // — fires on join AND every later transition (drop + reconnect), so the
    // live-sync indicator reflects reality for the whole session, not just
    // the initial join.
    onStatus: (cb: (p: { flowId: string; status: string }) => void) => {
      const h = (_e: any, p: any) => cb(p);
      ipcRenderer.on('flowSync:status', h);
      return () => ipcRenderer.removeListener('flowSync:status', h);
    },
  },
  secure: {
    set: (key: string, value: string) => ipcRenderer.invoke('secure:set', key, value),
    get: (key: string) => ipcRenderer.invoke('secure:get', key),
  },
  dialog: {
    openFile: (accept: string[]) => ipcRenderer.invoke('dialog:openFile', accept),
    openFiles: (accept: string[]) => ipcRenderer.invoke('dialog:openFiles', accept),
    openFolderOfDocx: (extensions?: string[]) => ipcRenderer.invoke('dialog:openFolderOfDocx', extensions),
    /**
     * Resolve OS-dragged File objects to real paths and trust them for the
     * file-read IPC handlers.
     *
     * Electron removed `File.path` in v32, so `webUtils.getPathForFile` is the
     * only way to recover a dropped file's path. It resolves *genuine* File
     * objects only — a renderer cannot forge one carrying an arbitrary path — so
     * an OS drag-drop is as legitimate a trust anchor as a file dialog. That's
     * why this takes File objects rather than strings: the trust decision stays
     * anchored to something the renderer can't fabricate.
     */
    resolveDroppedFiles: async (files: File[], accept: string[]) => {
      const paths: string[] = [];
      for (const f of files) {
        let p = '';
        try { p = webUtils.getPathForFile(f); } catch { continue; }
        const ext = p.split('.').pop()?.toLowerCase() ?? '';
        if (p && accept.includes(ext)) paths.push(p);
      }
      if (paths.length > 0) await ipcRenderer.invoke('fs:trustDropped', paths);
      return paths;
    },
    saveBuffer: (base64: string, defaultName: string, filters: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveBuffer', base64, defaultName, filters),
  },
  ai: {
    extractCards: (filePath: string) => ipcRenderer.invoke('ai:extractCards', filePath),
    cutterReadSource: (filePath: string) => ipcRenderer.invoke('ai:cutterReadSource', filePath),
    cutterEmphasize: (params: any) => ipcRenderer.invoke('ai:cutterEmphasize', params),
    analyzeRound: (params: {
      flowSummary: string;
      notes: string;
      docs: { fileName: string; text: string }[];
      event: 'policy' | 'pf';
      clarifications: { question: string; answer: string }[];
    }) => ipcRenderer.invoke('ai:analyzeRound', params),
    autoFlowClassify: (params: any) => ipcRenderer.invoke('ai:autoFlowClassify', params),
    autoFlowSummarize: (params: {
      files: { fileName: string; path: string }[];
      cards: { fileName: string; tag: string; maxWords: number }[];
    }) => ipcRenderer.invoke('ai:autoFlowSummarize', params),
    summarizeFlowSheet: (params: { sheetName: string; event: 'policy' | 'pf'; entries: string[] }) =>
      ipcRenderer.invoke('ai:summarizeFlowSheet', params),
    readImageAsDataUrl: (filePath: string) => ipcRenderer.invoke('fs:readImageAsDataUrl', filePath),
    suggestBlocks: (positions: string, blocks: { id: string; title: string }[]) =>
      ipcRenderer.invoke('ai:suggestBlocks', positions, blocks),
    teamSummary: (params: { teamName: string; rawRounds: any[]; rawCites: any[] }) =>
      ipcRenderer.invoke('ai:teamSummary', params),
    parseRoundEmail: (params: { filePath?: string; imageBase64?: string; mimeType?: string }) =>
      ipcRenderer.invoke('ai:parseRoundEmail', params),
    missionBrief: (params: any) => ipcRenderer.invoke('ai:missionBrief', params),
    crossExQuestions: (params: { highlightedText: string; fullText: string; event: 'policy' | 'pf' | 'ld'; basedOn?: string; side?: string }) =>
      ipcRenderer.invoke('ai:crossExQuestions', params),
    crossExTraps: (params: { highlightedText: string; fullText: string; event: 'policy' | 'pf' | 'ld' }) =>
      ipcRenderer.invoke('ai:crossExTraps', params),
    crossExGradeTrap: (params: { setup: string; idealAnswer: string; trapAnswer: string; gotcha: string; lesson: string; userAnswer: string; event: 'policy' | 'pf' | 'ld' }) =>
      ipcRenderer.invoke('ai:crossExGradeTrap', params),
    scoreCards: (params: { cards: { tag: string; cite: string }[] }) =>
      ipcRenderer.invoke('ai:scoreCards', params),
    compareImpactsText: (textA: string, textB: string, labelA: string, labelB: string) =>
      ipcRenderer.invoke('ai:compareImpactsText', textA, textB, labelA, labelB),
    outweighScenario: (params: {
      difficulty: string;
      event?: 'policy' | 'pf';
      custom?: {
        yourDoc?: { label: string; text: string } | null;
        oppDoc?: { label: string; text: string } | null;
        sidePreference?: string;
        userNotes?: string;
        resolutionText?: string;
      };
    }) => ipcRenderer.invoke('ai:outweighScenario', params),
    outweighRebuttal: (params: { difficulty: string; event?: 'policy' | 'pf'; scenario: any; userImpact: string; userCalc: string }) =>
      ipcRenderer.invoke('ai:outweighRebuttal', params),
    outweighJudge: (params: { difficulty: string; event?: 'policy' | 'pf'; scenario: any; userImpact: string; userCalc: string; rebuttal: string; userFinal: string }) =>
      ipcRenderer.invoke('ai:outweighJudge', params),
    impactLibraryDraft: (params: { source: string; event?: string }) =>
      ipcRenderer.invoke('ai:impactLibraryDraft', params),
    impactLibraryReview: (params: { entry: any; source?: string; existing?: { id: string; title: string; claim: string }[] }) =>
      ipcRenderer.invoke('ai:impactLibraryReview', params),
  },
  // Auto Flow batch progress. Its own namespace, NOT part of `api.ai`: the loop
  // at the bottom of this file wraps every `api.ai` method in an async
  // error-toast shim, which would turn this subscribe call's synchronous
  // unsubscribe return value into a Promise and break `const off = …; off()`.
  autoFlow: {
    onProgress: (cb: (p: {
      phase: 'classifying' | 'summarizing';
      batchesDone: number; totalBatches: number;
      cardsDone: number; cardsTotal: number;
    }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('ai:autoFlowProgress', handler);
      return () => ipcRenderer.removeListener('ai:autoFlowProgress', handler);
    },
  },
  // Local LM Studio server probes, used by the Settings screen. Deliberately its
  // own namespace and NOT part of `api.ai` — the loop at the bottom of this file
  // turns every `api.ai` method into a retry-and-toast call, which is wrong for a
  // button the user just clicked and is waiting on.
  lmstudio: {
    listModels: (baseUrl?: string) => ipcRenderer.invoke('lmstudio:listModels', baseUrl),
    test: () => ipcRenderer.invoke('lmstudio:test'),
  },
  impactlib: {
    list: () => ipcRenderer.invoke('impactlib:list'),
    submit: (entry: any) => ipcRenderer.invoke('impactlib:submit', entry),
    update: (entryId: string, patch: any) => ipcRenderer.invoke('impactlib:update', entryId, patch),
    delete: (entryId: string) => ipcRenderer.invoke('impactlib:delete', entryId),
    vote: (entryId: string, vote: number, reason?: string | null) => ipcRenderer.invoke('impactlib:vote', entryId, vote, reason),
    save: (entryId: string, saved: boolean) => ipcRenderer.invoke('impactlib:save', entryId, saved),
  },
  clipboard: {
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
  },
  opencaselist: {
    login: (username: string, password: string) => ipcRenderer.invoke('opencaselist:login', username, password),
    caselists: () => ipcRenderer.invoke('opencaselist:caselists'),
    search: (query: string, shard: string) => ipcRenderer.invoke('opencaselist:search', query, shard),
    rounds: (caselist: string, school: string, team: string) => ipcRenderer.invoke('opencaselist:rounds', caselist, school, team),
    cites: (caselist: string, school: string, team: string) => ipcRenderer.invoke('opencaselist:cites', caselist, school, team),
    openFile: (urlOrPath: string) => ipcRenderer.invoke('opencaselist:openFile', urlOrPath),
    fetchFileToTemp: (urlOrPath: string) => ipcRenderer.invoke('opencaselist:fetchFileToTemp', urlOrPath),
    saveFile: (tempPath: string, defaultName: string) => ipcRenderer.invoke('opencaselist:saveFile', tempPath, defaultName),
  },
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openBuffer: (base64: string, filename: string) => ipcRenderer.invoke('shell:openBuffer', base64, filename),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  speechdoc: {
    extract: (filePath: string) => ipcRenderer.invoke('speechdoc:extract', filePath),
    extractBlocks: (filePath: string) => ipcRenderer.invoke('speechdoc:extractBlocks', filePath),
    clearCache: (filePath?: string) => ipcRenderer.invoke('speechdoc:clearCache', filePath),
    summarizeForAttachment: (docText: string, fileName: string) => ipcRenderer.invoke('speechdoc:summarizeForAttachment', docText, fileName),
    headingStyles: (base64: string) => ipcRenderer.invoke('speechdoc:headingStyles', base64),
  },
  dictation: {
    transcribe: (audioBase64: string, mimeType: string, offline?: boolean) =>
      ipcRenderer.invoke('dictation:transcribe', audioBase64, mimeType, offline),
    offlineModelStatus: () => ipcRenderer.invoke('dictation:offlineModelStatus'),
    downloadOfflineModel: () => ipcRenderer.invoke('dictation:downloadOfflineModel'),
    removeOfflineModel: () => ipcRenderer.invoke('dictation:removeOfflineModel'),
    onOfflineModelProgress: (cb: (p: { status: string; label?: string; overallPct?: number }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('dictation:offlineModelProgress', handler);
      return () => ipcRenderer.removeListener('dictation:offlineModelProgress', handler);
    },
  },
  fs: {
    readFileBytes: (filePath: string) => ipcRenderer.invoke('fs:readFileBytes', filePath),
    readDocxBytes: (filePath: string) => ipcRenderer.invoke('fs:readDocxBytes', filePath),
    trustIfExists: (paths: string[]) => ipcRenderer.invoke('fs:trustIfExists', paths),
    extractDocxText: (filePath: string) => ipcRenderer.invoke('fs:extractDocxText', filePath),
    countDocxCards: (filePath: string) => ipcRenderer.invoke('fs:countDocxCards', filePath),
    fileSize: (filePath: string) => ipcRenderer.invoke('fs:fileSize', filePath),
    writeTempFile: (base64: string, filename: string) => ipcRenderer.invoke('fs:writeTempFile', base64, filename),
  },
  dl: {
    searchTeam: (params: { query: string; eventType: string }) =>
      ipcRenderer.invoke('dl-search-team', params),
    getTeamStats: (params: { teamId: string; eventType: string }) =>
      ipcRenderer.invoke('dl-get-team-stats', params),
  },
  tabroom: {
    getTournament: (tournId: string) =>
      ipcRenderer.invoke('tabroom-get-tournament', { tournId }),
    getEntries: (tournId: string, eventId: string) =>
      ipcRenderer.invoke('tabroom-get-entries', { tournId, eventId }),
    getPairings: (tournId: string, eventId: string, roundId: string) =>
      ipcRenderer.invoke('tabroom-get-pairings', { tournId, eventId, roundId }),
    fetchTournament: (tournId: string) =>
      ipcRenderer.invoke('tabroom-fetch-tournament', { tournId }),
    monitor: {
      start: (config: {
        dbTournamentId: string;
        tabroomTournId: string;
        tournamentName: string;
        eventName: string;
        entryCode: string;
        caselist: string;
        eventType: string;
      }) => ipcRenderer.invoke('tabroom:monitor:start', config),
      stop: () => ipcRenderer.invoke('tabroom:monitor:stop'),
      status: () => ipcRenderer.invoke('tabroom:monitor:status'),
      fetchParadigm: (judgeId: string) => ipcRenderer.invoke('tabroom:monitor:fetchParadigm', judgeId),
      onNewRound: (cb: (data: any) => void) => {
        const h = (_e: any, d: any) => cb(d);
        ipcRenderer.on('tabroom:monitor:newRound', h);
        return () => ipcRenderer.removeListener('tabroom:monitor:newRound', h);
      },
      onError: (cb: (err: string) => void) => {
        const h = (_e: any, err: string) => cb(err);
        ipcRenderer.on('tabroom:monitor:error', h);
        return () => ipcRenderer.removeListener('tabroom:monitor:error', h);
      },
      onStopped: (cb: () => void) => {
        ipcRenderer.on('tabroom:monitor:stopped', cb);
        return () => ipcRenderer.removeListener('tabroom:monitor:stopped', cb);
      },
      onNotifClick: (cb: (data: { dbTournamentId: string; roundNumber: number }) => void) => {
        const h = (_e: any, d: any) => cb(d);
        ipcRenderer.on('tabroom:monitor:notifClick', h);
        return () => ipcRenderer.removeListener('tabroom:monitor:notifClick', h);
      },
      onExistingRounds: (cb: (roundNumbers: number[]) => void) => {
        const h = (_e: any, nums: number[]) => cb(nums);
        ipcRenderer.on('tabroom:monitor:existingRounds', h);
        return () => ipcRenderer.removeListener('tabroom:monitor:existingRounds', h);
      },
      testFire: (opts?: {
        roundNumber?: number; isBye?: boolean; room?: string; side?: 'aff' | 'neg';
        opponentCode?: string; judgeName?: string; judgeId?: string; dbTournamentId?: string;
      }) => ipcRenderer.invoke('tabroom:monitor:testFire', opts),
      pollNow: () => ipcRenderer.invoke('tabroom:monitor:pollNow'),
    },
    fetchParadigmByName: (name: string) => ipcRenderer.invoke('tabroom:fetchParadigmByName', name),
    searchJudges: (query: string) => ipcRenderer.invoke('tabroom:searchJudges', query),
    fetchParadigm: (judgeId: string) => ipcRenderer.invoke('tabroom:fetchParadigm', judgeId),
    searchTournaments: (query: string) => ipcRenderer.invoke('tabroom:searchTournaments', query),
    testLogin: (username: string, password: string) => ipcRenderer.invoke('tabroom:testLogin', username, password),
    retestLogin: () => ipcRenderer.invoke('tabroom:retestLogin'),
    inbox: {
      start: (cfg: { entryCode: string; dbTournamentId: string; tournamentName: string }) =>
        ipcRenderer.invoke('tabroom:inbox:start', cfg),
      stop: () => ipcRenderer.invoke('tabroom:inbox:stop'),
      status: () => ipcRenderer.invoke('tabroom:inbox:status'),
      onResult: (cb: (data: { key: string; roundNum: number; result: 'win' | 'loss'; dbTournamentId: string }) => void) => {
        const h = (_e: any, d: any) => cb(d);
        ipcRenderer.on('tabroom:inbox:result', h);
        return () => ipcRenderer.removeListener('tabroom:inbox:result', h);
      },
      onResultClick: (cb: (data: { dbTournamentId: string; roundNumber: number }) => void) => {
        const h = (_e: any, d: any) => cb(d);
        ipcRenderer.on('tabroom:inbox:resultClick', h);
        return () => ipcRenderer.removeListener('tabroom:inbox:resultClick', h);
      },
    },
  },
  chat: {
    getSession: () => ipcRenderer.invoke('chat:getSession'),
    signIn: (email: string, password: string) => ipcRenderer.invoke('chat:signIn', email, password),
    signUp: (email: string, password: string, displayName: string) => ipcRenderer.invoke('chat:signUp', email, password, displayName),
    signOut: () => ipcRenderer.invoke('chat:signOut'),
    resetPassword: (email: string) => ipcRenderer.invoke('chat:resetPassword', email),
    updatePassword: (password: string) => ipcRenderer.invoke('chat:updatePassword', password),
    onAuthRecovery: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('auth:recovery', handler);
      return () => ipcRenderer.removeListener('auth:recovery', handler);
    },
    /** Fires when a warroom://auth recovery link arrived that this app never asked for. */
    onAuthRecoveryRejected: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('auth:recovery-rejected', handler);
      return () => ipcRenderer.removeListener('auth:recovery-rejected', handler);
    },
    getTeam: (userId: string) => ipcRenderer.invoke('chat:getTeam', userId),
    getTeams: (userId: string) => ipcRenderer.invoke('chat:getTeams', userId),
    createTeam: (name: string) => ipcRenderer.invoke('chat:createTeam', name),
    joinTeam: (inviteCode: string) => ipcRenderer.invoke('chat:joinTeam', inviteCode),
    joinTeamByCode: (inviteCode: string, displayName: string, role: string) =>
      ipcRenderer.invoke('chat:joinTeamByCode', inviteCode, displayName, role),
    getMessages: (teamId: string) => ipcRenderer.invoke('chat:getMessages', teamId),
    sendMessage: (payload: any) => ipcRenderer.invoke('chat:sendMessage', payload),
    subscribe: (teamId: string) => ipcRenderer.invoke('chat:subscribe', teamId),
    unsubscribe: () => ipcRenderer.invoke('chat:unsubscribe'),
    onNewMessage: (cb: (msg: any) => void) => {
      const handler = (_e: any, msg: any) => cb(msg);
      ipcRenderer.on('chat:newMessage', handler);
      // Remove only THIS listener, not every listener on the channel.
      return () => ipcRenderer.removeListener('chat:newMessage', handler);
    },
    // Room management
    getMembers: (teamId: string) => ipcRenderer.invoke('chat:getMembers', teamId),
    kickMember: (teamId: string, userId: string) => ipcRenderer.invoke('chat:kickMember', teamId, userId),
    renameTeam: (teamId: string, name: string) => ipcRenderer.invoke('chat:renameTeam', teamId, name),
    claimOwnership: (teamId: string) => ipcRenderer.invoke('chat:claimOwnership', teamId),
    rotateInvite: (teamId: string) => ipcRenderer.invoke('chat:rotateInvite', teamId),
    generateGeminiTitle: (messages: any[]) => ipcRenderer.invoke('chat:generateGeminiTitle', messages),
    editMessage: (messageId: string, content: string) => ipcRenderer.invoke('chat:editMessage', messageId, content),
    deleteMessage: (messageId: string) => ipcRenderer.invoke('chat:deleteMessage', messageId),
    editDMMessage: (messageId: string, content: string) => ipcRenderer.invoke('chat:editDMMessage', messageId, content),
    deleteDMMessage: (messageId: string) => ipcRenderer.invoke('chat:deleteDMMessage', messageId),
    geminiAgentTurn: (messages: any[], wantTitle?: boolean, userContext?: string, requestId?: string) =>
      ipcRenderer.invoke('chat:geminiAgentTurn', messages, wantTitle, userContext, requestId),
    // Streamed text deltas for an in-flight geminiAgentTurn call, scoped by requestId
    // so unrelated turns (or a stale listener from a previous turn) never cross-talk.
    onAgentStreamChunk: (requestId: string, cb: (delta: string) => void) => {
      const handler = (_e: any, payload: { requestId: string; delta: string }) => {
        if (payload?.requestId === requestId) cb(payload.delta);
      };
      ipcRenderer.on('chat:agentStreamChunk', handler);
      return () => ipcRenderer.removeListener('chat:agentStreamChunk', handler);
    },
    lookupUserByEmail: (email: string) => ipcRenderer.invoke('chat:lookupUserByEmail', email),
    // DMs
    getDMChannels: (teamId: string) => ipcRenderer.invoke('chat:getDMChannels', teamId),
    createDM: (teamId: string, members: { userId: string; displayName: string }[], name?: string) =>
      ipcRenderer.invoke('chat:createDM', teamId, members, name),
    getDMMessages: (dmChannelId: string) => ipcRenderer.invoke('chat:getDMMessages', dmChannelId),
    sendDMMessage: (payload: any) => ipcRenderer.invoke('chat:sendDMMessage', payload),
    addDMMember: (dmChannelId: string, userId: string, displayName: string) =>
      ipcRenderer.invoke('chat:addDMMember', dmChannelId, userId, displayName),
    leaveDM: (dmChannelId: string, userId: string) => ipcRenderer.invoke('chat:leaveDM', dmChannelId, userId),
    subscribeDM: (dmChannelId: string) => ipcRenderer.invoke('chat:subscribeDM', dmChannelId),
    unsubscribeDM: () => ipcRenderer.invoke('chat:unsubscribeDM'),
    onNewDMMessage: (cb: (msg: any) => void) => {
      const handler = (_e: any, msg: any) => cb(msg);
      ipcRenderer.on('chat:newDMMessage', handler);
      // Remove only THIS listener, not every listener on the channel.
      return () => ipcRenderer.removeListener('chat:newDMMessage', handler);
    },
    subscribeAllDMs: (teamId: string) => ipcRenderer.invoke('chat:subscribeAllDMs', teamId),
    unsubscribeAllDMs: () => ipcRenderer.invoke('chat:unsubscribeAllDMs'),
    onAnyDMMessage: (cb: (msg: any) => void) => {
      const handler = (_e: any, msg: any) => cb(msg);
      ipcRenderer.on('chat:anyDMMessage', handler);
      return () => ipcRenderer.removeListener('chat:anyDMMessage', handler);
    },
    showNotification: (opts: { title: string; body: string; targetKind: 'team' | 'dm'; channelId?: string }) =>
      ipcRenderer.invoke('chat:showNotification', opts),
    onNotificationClicked: (cb: (t: { kind: 'team' | 'dm'; channelId?: string }) => void) => {
      const handler = (_e: any, t: any) => cb(t);
      ipcRenderer.on('chat:notificationClicked', handler);
      return () => ipcRenderer.removeListener('chat:notificationClicked', handler);
    },
  },
  pins: {
    getAll: (scope: { teamId?: string; dmChannelId?: string }) => ipcRenderer.invoke('chat:getPins', scope),
    pin: (payload: { teamId?: string; dmChannelId?: string; messageId: string; senderName: string; content: string; pinnedById: string; pinnedByName: string }) =>
      ipcRenderer.invoke('chat:pinMessage', payload),
    unpin: (pinId: string) => ipcRenderer.invoke('chat:unpinMessage', pinId),
    subscribe: (scope: { teamId?: string; dmChannelId?: string }) => ipcRenderer.invoke('chat:subscribePins', scope),
    unsubscribe: (scope: { teamId?: string; dmChannelId?: string }) => ipcRenderer.invoke('chat:unsubscribePins', scope),
    onChange: (cb: (p: { eventType: string; row: any }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('chat:pinsChange', handler);
      return () => ipcRenderer.removeListener('chat:pinsChange', handler);
    },
  },
  presence: {
    join: (teamId: string) => ipcRenderer.invoke('chat:joinPresence', teamId),
    leave: () => ipcRenderer.invoke('chat:leavePresence'),
    track: (meta: { userId: string; displayName: string; typing: string | null }) => ipcRenderer.invoke('chat:trackPresence', meta),
    onSync: (cb: (state: Record<string, any[]>) => void) => {
      const handler = (_e: any, state: any) => cb(state);
      ipcRenderer.on('chat:presenceSync', handler);
      return () => ipcRenderer.removeListener('chat:presenceSync', handler);
    },
  },
  // Per-team file library, separate from the message stream. name/dataB64 are
  // encrypted client-side (chatCrypto.ts) before crossing this bridge — see
  // team_files table + handlers in main.ts for the full design.
  teamFiles: {
    getAll: (teamId: string) => ipcRenderer.invoke('chat:getTeamFiles', teamId),
    upload: (payload: { teamId: string; uploaderId: string; uploaderName: string; name: string; dataB64: string; summaryText?: string }) =>
      ipcRenderer.invoke('chat:uploadTeamFile', payload),
    updateContent: (fileId: string, dataB64: string) => ipcRenderer.invoke('chat:updateTeamFileContent', fileId, dataB64),
    removeContent: (fileId: string) => ipcRenderer.invoke('chat:removeTeamFileContent', fileId),
    delete: (fileId: string) => ipcRenderer.invoke('chat:deleteTeamFile', fileId),
    subscribe: (teamId: string) => ipcRenderer.invoke('chat:subscribeTeamFiles', teamId),
    unsubscribe: () => ipcRenderer.invoke('chat:unsubscribeTeamFiles'),
    onChange: (cb: (p: { eventType: string; row: any }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('chat:teamFileChange', handler);
      return () => ipcRenderer.removeListener('chat:teamFileChange', handler);
    },
    // Local file-watch (powers auto-update) — see main.ts for the fs.watch side.
    watchLocal: (fileId: string, filePath: string) => ipcRenderer.invoke('chat:watchLocalTeamFile', fileId, filePath),
    unwatchLocal: (fileId: string) => ipcRenderer.invoke('chat:unwatchLocalTeamFile', fileId),
    isWatching: (fileId: string) => ipcRenderer.invoke('chat:isWatchingTeamFile', fileId),
    readWatchedBytes: (fileId: string) => ipcRenderer.invoke('chat:readWatchedTeamFileBytes', fileId),
    onLocalFileChanged: (cb: (p: { fileId: string }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('chat:localTeamFileChanged', handler);
      return () => ipcRenderer.removeListener('chat:localTeamFileChanged', handler);
    },
    // Flow watch (powers auto-update for flows shared to Team Files) — unlike
    // watchLocal above, there's no file on disk to fs.watch, so FlowView.tsx
    // itself checks getWatchedFileIdForFlow after every save and pushes.
    watchFlow: (fileId: string, flowId: string) => ipcRenderer.invoke('chat:watchFlowTeamFile', fileId, flowId),
    unwatchFlow: (fileId: string) => ipcRenderer.invoke('chat:unwatchFlowTeamFile', fileId),
    getWatchedFileIdForFlow: (flowId: string) => ipcRenderer.invoke('chat:getWatchedFileIdForFlow', flowId),
  },
  // Team-scoped comments anchored to a span of text in an open speech doc —
  // see doc_comments in supabase/schema.sql and the handlers in main.ts.
  docComments: {
    get: (teamId: string, docKey: string) => ipcRenderer.invoke('docComments:get', teamId, docKey),
    add: (payload: {
      teamId: string; docKey: string; docName: string; userId: string; userName: string;
      visibility: 'team' | 'private'; anchorKind?: 'text' | 'card'; anchorText: string;
      anchorParaIndex: number; anchorOccurrence: number; body: string; parentId?: string | null;
    }) => ipcRenderer.invoke('docComments:add', payload),
    delete: (commentId: string) => ipcRenderer.invoke('docComments:delete', commentId),
    resolve: (commentId: string, resolved: boolean, resolvedByName: string) =>
      ipcRenderer.invoke('docComments:resolve', commentId, resolved, resolvedByName),
    subscribe: (teamId: string) => ipcRenderer.invoke('docComments:subscribe', teamId),
    unsubscribe: () => ipcRenderer.invoke('docComments:unsubscribe'),
    onChange: (cb: (p: { eventType: string; row: any }) => void) => {
      const handler = (_e: any, p: any) => cb(p);
      ipcRenderer.on('docComments:change', handler);
      return () => ipcRenderer.removeListener('docComments:change', handler);
    },
  },
  gdrive: {
    status: () => ipcRenderer.invoke('gdrive:status'),
    connect: () => ipcRenderer.invoke('gdrive:connect'),
    disconnect: () => ipcRenderer.invoke('gdrive:disconnect'),
    listFiles: (pageToken?: string) => ipcRenderer.invoke('gdrive:listFiles', pageToken),
    searchFiles: (query: string) => ipcRenderer.invoke('gdrive:searchFiles', query),
    fetchFile: (fileId: string) => ipcRenderer.invoke('gdrive:fetchFile', fileId),
    uploadAsSheets: (base64: string, filename: string) => ipcRenderer.invoke('gdrive:uploadAsSheets', base64, filename),
  },
  topics: {
    scrape: () => ipcRenderer.invoke('scrape-nsda-topics'),
    getStored: () => ipcRenderer.invoke('get-stored-topics'),
    save: (topics: any) => ipcRenderer.invoke('save-topics', topics),
    generateBrief: (params: { eventType: 'pf' | 'ld'; resolution: string }) =>
      ipcRenderer.invoke('generate-topic-brief', params),
    getNextReleaseDates: () => ipcRenderer.invoke('get-next-release-dates'),
    getPolicyContext: () => ipcRenderer.invoke('get-policy-topic-context'),
    onUpdated: (cb: () => void) => {
      ipcRenderer.on('topics-updated', cb);
      return () => ipcRenderer.removeListener('topics-updated', cb);
    },
    onNavigateTo: (cb: (eventType: 'pf' | 'ld') => void) => {
      const handler = (_e: any, eventType: 'pf' | 'ld') => cb(eventType);
      ipcRenderer.on('navigate-to-topics', handler);
      return () => ipcRenderer.removeListener('navigate-to-topics', handler);
    },
  },
  gemini: {
    compareImpacts: (pathA: string, pathB: string, labelA: string, labelB: string) =>
      ipcRenderer.invoke('gemini:compareImpacts', pathA, pathB, labelA, labelB),
    importFlow: (input: { event: 'policy' | 'pf' | null; sheets: { name: string; grid: string[][] }[] }) =>
      ipcRenderer.invoke('gemini:importFlow', input),
  },
  agent: {
    fetchArticle: (url: string) => ipcRenderer.invoke('agent:fetchArticle', url),
  },
  skills: {
    list:  () => ipcRenderer.invoke('skills:list'),
    read:  (name: string) => ipcRenderer.invoke('skills:read', name),
    write: (name: string, content: string) => ipcRenderer.invoke('skills:write', name, content),
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    openInEditor: (name: string) => ipcRenderer.invoke('prompts:openInEditor', name),
  },
  daemon: {
    status: () => ipcRenderer.invoke('daemon:status'),
  },
  touchBar: {
    // Renderer -> main: push live timer state so Touch Bar labels stay in
    // sync (the main process has no way to read renderer state itself).
    updateTimer: (state: { speechLabel: string; display: string; running: boolean }) =>
      ipcRenderer.send('touchbar:timerState', state),
    // Main -> renderer: a Touch Bar button was pressed.
    onControl: (cb: (data: { target: 'timer' | 'search' | 'coin'; action: string; [key: string]: any }) => void) => {
      const h = (_e: any, d: any) => cb(d);
      ipcRenderer.on('touchbar:control', h);
      return () => ipcRenderer.removeListener('touchbar:control', h);
    },
  },
  notes: {
    get: (p: { teamId: string; entityType: string; entityId: string }) =>
      ipcRenderer.invoke('notes:get', p),
    upsert: (p: { teamId: string; entityType: string; entityId: string; entityName: string; userId: string; userName: string; content: string }) =>
      ipcRenderer.invoke('notes:upsert', p),
    attachTag: (p: { teamId: string; entityType: string; entityId: string; entityName?: string; userId: string; userName: string; type: string; name: string; data: any }) =>
      ipcRenderer.invoke('notes:attachTag', p),
    getTags: (p: { teamId: string; entityType: string; entityId: string }) =>
      ipcRenderer.invoke('notes:getTags', p),
    removeTag: (attachmentId: string) =>
      ipcRenderer.invoke('notes:removeTag', attachmentId),
    findTagsByRef: (p: { teamId: string; type: string; matchKey: 'localRefId' | 'url' | 'teamFileId'; matchValue: string }) =>
      ipcRenderer.invoke('notes:findTagsByRef', p),
  },
  platform: process.platform,
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('window:setTitleBarOverlay', opts),
  // Custom traffic-light buttons (TitleBar.tsx) — see the `frame: false`
  // note in main.ts's createWindow.
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowGetState: () => ipcRenderer.invoke('window:getState'),
  onWindowStateChanged: (cb: (s: { maximized: boolean; focused: boolean }) => void) => {
    const h = (_e: any, s: any) => cb(s);
    ipcRenderer.on('window:stateChanged', h);
    return () => ipcRenderer.removeListener('window:stateChanged', h);
  },
  onScoutingOpen: (cb: (data: { kind: 'judge' | 'opponent'; id: string }) => void) => {
    // Keep references to the exact listeners we register so cleanup can remove
    // them. (Previously cleanup removed an unrelated `handler` that was never
    // registered, so these two listeners leaked on every re-subscribe.)
    const onJudge    = (_e: any, id: string) => cb({ kind: 'judge',    id });
    const onOpponent = (_e: any, id: string) => cb({ kind: 'opponent', id });
    ipcRenderer.on('scouting:openJudge',    onJudge);
    ipcRenderer.on('scouting:openOpponent', onOpponent);
    return () => {
      ipcRenderer.removeListener('scouting:openJudge',    onJudge);
      ipcRenderer.removeListener('scouting:openOpponent', onOpponent);
    };
  },
  onFileOpen: (cb: (filePath: string) => void) => {
    const handler = (_e: any, filePath: string) => cb(filePath);
    ipcRenderer.on('file:open', handler);
    return () => ipcRenderer.removeListener('file:open', handler);
  },
  exportCardsToDocx: (cards: any[]) => ipcRenderer.invoke('export:cardsToDocx', cards),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    onStatus: (cb: (status: any) => void) => {
      const h = (_e: any, status: any) => cb(status);
      ipcRenderer.on('updater:status', h);
      return () => ipcRenderer.removeListener('updater:status', h);
    },
  },
};

// Most `ai:*`/`gemini:*` handlers in electron/main.ts retry their own model call
// (see `withDelayedRetry` there: 8s, then 30s, then 60s — 4 attempts total)
// before giving up. The ones the user can retry themselves from the UI —
// Auto Flow's classify/summarize, which drop the user back on step 2 with the
// "Sort with Warroom AI" button — deliberately do NOT, so a failure surfaces in
// seconds rather than after ~100s of invisible backoff (CLAUDE.md's "AI call
// retries + error surfacing" rule). Either way, a call that fails here is a real
// failure worth surfacing. Wrap every method on
// `api.ai` and `api.gemini` once, centrally, instead of adding error-toast
// boilerplate to every one of the ~20+ call sites across the renderer: on a
// thrown error OR a resolved `{ ok: false, error }`, dispatch a plain DOM
// event most components never see or handle. `AiErrorToast.tsx` (mounted once
// in App.tsx) listens for it and shows the message in a toast. The original
// return value / thrown error is passed through unchanged, so existing
// try/catch and `if (!res.ok)` handling in each component keeps working
// exactly as before — this is purely additive.
//
// Deliberately NOT wrapped: `api.chat` (mixes `geminiAgentTurn` with plain
// message/DM CRUD that has nothing to do with AI — wrapping the whole
// namespace would toast on a failed "delete message"). The agent chat turn
// already has its own error channel (`onGeminiError`) and its tool-call loop
// can have side effects, so blind retry-and-toast isn't a safe fit there; see
// CLAUDE.md's "AI call retries" rule for the reasoning.
for (const ns of [api.ai, api.gemini] as const) {
  for (const key of Object.keys(ns) as (keyof typeof ns)[]) {
    const original = (ns as any)[key] as (...args: any[]) => Promise<any>;
    (ns as any)[key] = async (...args: any[]) => {
      try {
        const res = await original(...args);
        if (res && typeof res === 'object' && (res as any).ok === false) {
          window.dispatchEvent(new CustomEvent('warroom:ai-error', {
            detail: { source: String(key), message: (res as any).error || 'Warroom AI ran into a problem.' },
          }));
        }
        return res;
      } catch (e: any) {
        window.dispatchEvent(new CustomEvent('warroom:ai-error', {
          detail: { source: String(key), message: e?.message || 'Warroom AI ran into a problem.' },
        }));
        throw e;
      }
    };
  }
}

// An input the main process had to cut down before sending it to the model.
// Forwarded as a DOM event so `AiErrorToast.tsx` can show it the same way it
// shows AI errors, with no per-feature wiring — see `capForPrompt` in main.ts.
// This is a warning, not a failure: the call still ran, just on less than the
// user gave it, and they need to know that before trusting the answer.
ipcRenderer.on('ai:inputTruncated', (_e, p: { label: string; kept: number; total: number }) => {
  window.dispatchEvent(new CustomEvent('warroom:ai-warning', { detail: p }));
});

contextBridge.exposeInMainWorld('warroom', api);
export type WarroomApi = typeof api;
