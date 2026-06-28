import { contextBridge, ipcRenderer } from 'electron';

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
  },
  secure: {
    set: (key: string, value: string) => ipcRenderer.invoke('secure:set', key, value),
    get: (key: string) => ipcRenderer.invoke('secure:get', key),
  },
  dialog: {
    openFile: (accept: string[]) => ipcRenderer.invoke('dialog:openFile', accept),
    saveBuffer: (base64: string, defaultName: string, filters: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveBuffer', base64, defaultName, filters),
  },
  ai: {
    extractCards: (filePath: string) => ipcRenderer.invoke('ai:extractCards', filePath),
    cutterReadSource: (filePath: string) => ipcRenderer.invoke('ai:cutterReadSource', filePath),
    cutterEmphasize: (params: any) => ipcRenderer.invoke('ai:cutterEmphasize', params),
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
    outweighScenario: (difficulty: string) =>
      ipcRenderer.invoke('ai:outweighScenario', difficulty),
    outweighRebuttal: (params: { difficulty: string; scenario: any; userImpact: string; userCalc: string }) =>
      ipcRenderer.invoke('ai:outweighRebuttal', params),
    outweighJudge: (params: { difficulty: string; scenario: any; userImpact: string; userCalc: string; rebuttal: string; userFinal: string }) =>
      ipcRenderer.invoke('ai:outweighJudge', params),
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
    clearCache: (filePath?: string) => ipcRenderer.invoke('speechdoc:clearCache', filePath),
    headingStyles: (base64: string) => ipcRenderer.invoke('speechdoc:headingStyles', base64),
  },
  dictation: {
    transcribe: (audioBase64: string, mimeType: string) =>
      ipcRenderer.invoke('dictation:transcribe', audioBase64, mimeType),
  },
  fs: {
    readFileBytes: (filePath: string) => ipcRenderer.invoke('fs:readFileBytes', filePath),
    readDocxBytes: (filePath: string) => ipcRenderer.invoke('fs:readDocxBytes', filePath),
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
      ipcRenderer.on('chat:newMessage', (_e, msg) => cb(msg));
      return () => ipcRenderer.removeAllListeners('chat:newMessage');
    },
    // Room management
    getMembers: (teamId: string) => ipcRenderer.invoke('chat:getMembers', teamId),
    kickMember: (teamId: string, userId: string) => ipcRenderer.invoke('chat:kickMember', teamId, userId),
    renameTeam: (teamId: string, name: string) => ipcRenderer.invoke('chat:renameTeam', teamId, name),
    claimOwnership: (teamId: string) => ipcRenderer.invoke('chat:claimOwnership', teamId),
    geminiSend: (messages: any[], systemText?: string) =>
      ipcRenderer.invoke('chat:geminiSend', messages, systemText),
    onGeminiChunk: (cb: (text: string) => void) => {
      const handler = (_e: any, text: string) => cb(text);
      ipcRenderer.on('chat:geminiChunk', handler);
      return () => ipcRenderer.removeListener('chat:geminiChunk', handler);
    },
    onGeminiDone: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.once('chat:geminiDone', handler);
      return () => ipcRenderer.removeListener('chat:geminiDone', handler);
    },
    onGeminiError: (cb: (err: string) => void) => {
      const handler = (_e: any, err: string) => cb(err);
      ipcRenderer.once('chat:geminiError', handler);
      return () => ipcRenderer.removeListener('chat:geminiError', handler);
    },
    generateGeminiTitle: (messages: any[]) => ipcRenderer.invoke('chat:generateGeminiTitle', messages),
    editMessage: (messageId: string, content: string) => ipcRenderer.invoke('chat:editMessage', messageId, content),
    deleteMessage: (messageId: string) => ipcRenderer.invoke('chat:deleteMessage', messageId),
    editDMMessage: (messageId: string, content: string) => ipcRenderer.invoke('chat:editDMMessage', messageId, content),
    deleteDMMessage: (messageId: string) => ipcRenderer.invoke('chat:deleteDMMessage', messageId),
    geminiAgentTurn: (messages: any[], wantTitle?: boolean, userContext?: string) => ipcRenderer.invoke('chat:geminiAgentTurn', messages, wantTitle, userContext),
    lookupUserByEmail: (email: string) => ipcRenderer.invoke('chat:lookupUserByEmail', email),
    // DMs
    getDMChannels: (teamId: string) => ipcRenderer.invoke('chat:getDMChannels', teamId),
    createDM: (teamId: string, members: { userId: string; displayName: string }[], name?: string) =>
      ipcRenderer.invoke('chat:createDM', teamId, members, name),
    getDMMessages: (dmChannelId: string) => ipcRenderer.invoke('chat:getDMMessages', dmChannelId),
    sendDMMessage: (payload: any) => ipcRenderer.invoke('chat:sendDMMessage', payload),
    addDMMember: (dmChannelId: string, userId: string, displayName: string) =>
      ipcRenderer.invoke('chat:addDMMember', dmChannelId, userId, displayName),
    subscribeDM: (dmChannelId: string) => ipcRenderer.invoke('chat:subscribeDM', dmChannelId),
    unsubscribeDM: () => ipcRenderer.invoke('chat:unsubscribeDM'),
    onNewDMMessage: (cb: (msg: any) => void) => {
      ipcRenderer.on('chat:newDMMessage', (_e, msg) => cb(msg));
      return () => ipcRenderer.removeAllListeners('chat:newDMMessage');
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
  daemon: {
    status: () => ipcRenderer.invoke('daemon:status'),
  },
  notes: {
    get: (p: { teamId: string; entityType: string; entityId: string }) =>
      ipcRenderer.invoke('notes:get', p),
    upsert: (p: { teamId: string; entityType: string; entityId: string; entityName: string; userId: string; userName: string; content: string }) =>
      ipcRenderer.invoke('notes:upsert', p),
  },
  platform: process.platform,
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('window:setTitleBarOverlay', opts),
  onScoutingOpen: (cb: (data: { kind: 'judge' | 'opponent'; id: string }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('scouting:openJudge',    (_e: any, id: string) => cb({ kind: 'judge',    id }));
    ipcRenderer.on('scouting:openOpponent', (_e: any, id: string) => cb({ kind: 'opponent', id }));
    return () => {
      ipcRenderer.removeListener('scouting:openJudge',    handler);
      ipcRenderer.removeListener('scouting:openOpponent', handler);
    };
  },
  onFileOpen: (cb: (filePath: string) => void) => {
    const handler = (_e: any, filePath: string) => cb(filePath);
    ipcRenderer.on('file:open', handler);
    return () => ipcRenderer.removeListener('file:open', handler);
  },
};

contextBridge.exposeInMainWorld('warroom', api);
export type WarroomApi = typeof api;
