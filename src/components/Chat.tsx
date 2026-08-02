import React, { useState, useEffect, useRef } from 'react';
import { linkifyText } from '../lib/linkify';
import { useApp, FlowMeta } from '../store/appStore';
import { signOut } from '../lib/supabase';
import { getTeamKey, encryptText, encryptOutgoing, decryptMessage } from '../lib/chatCrypto';
import { transcribeRecording } from '../utils/dictation';
import { ChatMessage as ChatMessageType, DMChannel, DMMessage, PendingMention, PinnedMessage } from '../types';
import ChatMessageBubble, { AttachmentChip as ChatAttachmentChip, PinIcon } from './ChatMessage';
import MentionPicker from './MentionPicker';
import TeamSetup from './TeamSetup';
import RoomSettings from './RoomSettings';
import DMSettings from './DMSettings';
import TeamFiles from './TeamFiles';
import PinsPanel from './PinsPanel';
import { ChatAvatar, AvatarSpec } from './Avatar';
import SendDictateButton from './SendDictateButton';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea';
import {
  getFilesBarStyle, onChatPrefsChange, FilesBarStyle,
  getChatNotifLevel, ChatNotifLevel, typingDisplayNamesFor, presenceList, isUserOnline,
} from '../lib/chatPrefs';
import { MAX_ATTACHMENT_BYTES, base64SizeBytes } from '../lib/fileSizeGate';
import OversizedFilePopup from './OversizedFilePopup';

type ChatView = 'team' | 'dm-list' | 'files' | 'pins' | { kind: 'dm'; channel: DMChannel };

// A message is decrypted content mentioning `@DisplayName_With_Underscores` or
// directly replying to a message you sent — used by the "mentions & replies
// only" notification level (see chatPrefs.ts's ChatNotifLevel).
function messageMentionsOrReplies(content: string, replyToSenderName: string | undefined, displayName: string): boolean {
  const mentionTag = `@${displayName.replace(/\s/g, '_')}`;
  return content.includes(mentionTag) || replyToSenderName === displayName;
}

// Tracks "typing" presence for a room/DM (scopeKey = 'team' or a dm_channel_id).
// Call the returned function on every composer keystroke; it re-tracks 'typing'
// at most once per keystroke burst and clears itself after 2.5s of no input.
function useTypingTracker(scopeKey: string) {
  const { currentUser } = useApp();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRef = useRef(false);
  return () => {
    if (!currentUser) return;
    if (!typingRef.current) {
      typingRef.current = true;
      window.warroom.presence.track({ userId: currentUser.id, displayName: currentUser.displayName, typing: scopeKey });
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      typingRef.current = false;
      window.warroom.presence.track({ userId: currentUser.id, displayName: currentUser.displayName, typing: null });
    }, 2500);
  };
}

function TypingIndicator({ scopeKey }: { scopeKey: string }) {
  const { presenceState, currentUser } = useApp();
  const names = typingDisplayNamesFor(presenceState, scopeKey, currentUser?.id);
  if (names.length === 0) return null;
  const text = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names.length} people are typing…`;
  return <div className="px-3 pb-1 text-[10px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{text}</div>;
}

export default function Chat() {
  const { currentUser, currentTeam, chatOpen, setCurrentUser, setCurrentTeam, setTeamMembers, pendingChatTarget, setPendingChatTarget, setPresenceState } = useApp();
  const [ready, setReady] = useState(false);
  const [chatView, setChatView] = useState<ChatView>('team');
  const [showSettings, setShowSettings] = useState(false);
  const [dmSettingsFor, setDmSettingsFor] = useState<DMChannel | null>(null);
  const [filesBarStyle, setFilesBarStyleState] = useState<FilesBarStyle>(getFilesBarStyle());

  useEffect(() => onChatPrefsChange(() => setFilesBarStyleState(getFilesBarStyle())), []);

  useEffect(() => {
    async function restoreUser(userId: string) {
      setCurrentUser({ id: userId } as any); // placeholder until full data loads
    }

    async function loadTeam(user: any) {
      setCurrentUser(user);
      // Cache user info for fast restore on next start
      try { localStorage.setItem('warroom-chat-user', JSON.stringify(user)); } catch {}
      // Retry once — session JWT may not be available for DB queries immediately
      // after signIn (common in Node.js Supabase client on first query post-login).
      let teamRes = await window.warroom.chat.getTeam(user.id);
      if (teamRes.ok && !teamRes.data) {
        await new Promise((r) => setTimeout(r, 400));
        teamRes = await window.warroom.chat.getTeam(user.id);
      }
      if (teamRes.ok && teamRes.data) {
        setCurrentTeam(teamRes.data as any);
        try { localStorage.setItem('warroom-chat-team', JSON.stringify(teamRes.data)); } catch {}
        // Members are loaded by the reactive effect below (keyed on currentTeam.id),
        // so every path that sets a team — restore, TeamSetup login, create/join —
        // gets members loaded consistently.
      } else if (teamRes.ok && !teamRes.data) {
        // Confirmed not in any team (e.g. kicked externally) — clear the stale
        // optimistic cache so TeamSetup's create/join screen shows instead of an
        // empty, unusable room. Only fires on a definitive ok:true + null result,
        // not on transient errors (ok:false), so we don't wrongly evict on a blip.
        setCurrentTeam(null);
        setTeamMembers([]);
        try { localStorage.removeItem('warroom-chat-team'); } catch {}
      }
    }

    async function restore() {
      // 0. Optimistic render: show cached user/team immediately while verifying
      try {
        const cachedUser = JSON.parse(localStorage.getItem('warroom-chat-user') ?? 'null');
        const cachedTeam = JSON.parse(localStorage.getItem('warroom-chat-team') ?? 'null');
        if (cachedUser) setCurrentUser(cachedUser);
        if (cachedTeam) setCurrentTeam(cachedTeam);
      } catch {}

      // 1. Try existing Supabase session (persisted as file on disk)
      const res = await window.warroom.chat.getSession();
      if (res.ok && res.data) {
        await loadTeam(res.data as any);
        setReady(true);
        return;
      }

      // 2. Session expired or missing — try auto-login with saved credentials
      try {
        const savedEmail = await window.warroom?.secure.get('chat_email');
        const savedPassword = await window.warroom?.secure.get('chat_password');
        if (savedEmail && savedPassword) {
          const signInRes = await window.warroom.chat.signIn(savedEmail, savedPassword);
          if (signInRes.ok && signInRes.data) {
            await loadTeam(signInRes.data as any);
            setReady(true);
            return;
          }
        }
      } catch {}

      // 3. Nothing worked — clear the optimistic state so TeamSetup shows
      setCurrentUser(null);
      setCurrentTeam(null);
      setTeamMembers([]);
      try { localStorage.removeItem('warroom-chat-user'); localStorage.removeItem('warroom-chat-team'); } catch {}
      setReady(true);
    }
    restore();
  }, []);

  // Load team members whenever the active team changes. This is the single source
  // of truth for member loading, so login via restore, TeamSetup, or create/join
  // all populate members reliably (fixes stale member lists after re-login).
  // Retries once because on app restart the optimistic cached team can trigger
  // this before the Supabase session is ready (getMembers returns empty/error),
  // and the later confirmed load uses the same team id so the effect won't refire.
  useEffect(() => {
    const teamId = currentTeam?.id;
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      let res = await window.warroom.chat.getMembers(teamId);
      // A team always has at least the current user, so ok-but-empty means the
      // session wasn't ready yet — retry once after a short delay.
      if (!cancelled && (!res.ok || (res.data?.length ?? 0) === 0)) {
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        res = await window.warroom.chat.getMembers(teamId);
      }
      if (!cancelled && res.ok && res.data) setTeamMembers(res.data as any);
    })();
    return () => { cancelled = true; };
  }, [currentTeam?.id]);

  // Reset to the team room whenever the user signs out — from any path, including
  // the "Log out of chat" button in Settings (which can't touch this local state).
  // Prevents a stale DM/DM-list view from showing to the next signed-in user.
  useEffect(() => {
    if (!currentUser) setChatView('team');
  }, [currentUser]);

  // Quick Chat pins (TitleBar) request a specific room/DM be shown — consume and clear.
  useEffect(() => {
    if (!pendingChatTarget || !currentTeam) return;
    if (pendingChatTarget.kind === 'team') {
      setChatView('team');
      setPendingChatTarget(null);
      return;
    }
    let cancelled = false;
    window.warroom.chat.getDMChannels(currentTeam.id).then((res) => {
      if (cancelled || !res.ok) return;
      const ch = (res.data as DMChannel[]).find((c) => c.id === (pendingChatTarget as any).channelId);
      if (ch) setChatView({ kind: 'dm', channel: ch });
      setPendingChatTarget(null);
    });
    return () => { cancelled = true; };
  }, [pendingChatTarget, currentTeam?.id]);

  // Team Files auto-update: this device's fs.watch (electron/main.ts) fires
  // 'chat:localTeamFileChanged' whenever a file THIS device uploaded (or a
  // speechdoc sent in team chat with a real local path — see the same watch
  // wired up in sendMessage below) changes on disk. Encryption only happens in
  // the renderer (chatCrypto.ts uses Web Crypto), so main.ts can't push the
  // update itself — it hands off the plaintext bytes (over IPC, not network)
  // and this effect encrypts + writes them to Supabase. Lives in the top-level
  // Chat() component (always mounted, see App.tsx) so it keeps working even
  // when the Files panel isn't open or the chat is closed.
  useEffect(() => {
    if (!currentTeam) return;
    const off = window.warroom.teamFiles.onLocalFileChanged(async ({ fileId }) => {
      try {
        const bytesRes = await window.warroom.teamFiles.readWatchedBytes(fileId);
        if (!bytesRes.ok || !bytesRes.data?.base64) return;
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const encData = await encryptText(key, bytesRes.data.base64);
        await window.warroom.teamFiles.updateContent(fileId, encData);
      } catch {}
    });
    return off;
  }, [currentTeam?.id, currentTeam?.invite_code]);

  // Presence: join once per team, always (not gated on chatOpen) so the online
  // dot stays accurate even with the panel closed — same reasoning as the
  // always-mounted unread-counting instance. Leaves on team change/sign-out.
  useEffect(() => {
    if (!currentTeam || !currentUser) return;
    window.warroom.presence.join(currentTeam.id);
    window.warroom.presence.track({ userId: currentUser.id, displayName: currentUser.displayName, typing: null });
    const off = window.warroom.presence.onSync((state) => setPresenceState(state));
    return () => { off(); window.warroom.presence.leave(); setPresenceState({}); };
  }, [currentTeam?.id, currentUser?.id]);

  // Desktop notifications for DMs the user isn't currently looking at — the
  // per-open-DM subscription (DMBody) can't cover this, so this listens to
  // every DM insert across the team (RLS still scopes it to channels the user
  // is actually in) and decides per chatPrefs' per-chat notification level.
  // Team-room notifications are simpler and live in ChatBody's own always-
  // mounted subscription instead, since that one already runs regardless of view.
  const chatViewRef = useRef(chatView);
  chatViewRef.current = chatView;
  useEffect(() => {
    if (!currentTeam || !currentUser) return;
    window.warroom.chat.subscribeAllDMs(currentTeam.id);
    const off = window.warroom.chat.onAnyDMMessage(async (msg: any) => {
      if (msg.sender_id === currentUser.id) return; // never notify yourself
      const level = getChatNotifLevel(msg.dm_channel_id);
      if (level === 'none') return;
      const cv = chatViewRef.current;
      const viewingThisDM = useApp.getState().chatOpen && typeof cv === 'object' && cv.kind === 'dm' && cv.channel.id === msg.dm_channel_id;
      if (viewingThisDM) return;
      try {
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const decoded = await decryptMessage(key, msg);
        if (level === 'mentions' && !messageMentionsOrReplies(decoded.content, decoded.reply_to_sender_name, currentUser.displayName)) return;
        window.warroom.chat.showNotification({
          title: decoded.sender_name, body: decoded.content.slice(0, 200), targetKind: 'dm', channelId: msg.dm_channel_id,
        });
      } catch {}
    });
    return () => { off(); window.warroom.chat.unsubscribeAllDMs(); };
  }, [currentTeam?.id, currentUser?.id]);

  // A notification click (from either subscription above) should focus and
  // jump straight to that chat, same mechanism as a Quick Chat pin.
  useEffect(() => {
    return window.warroom.chat.onNotificationClicked((t) => {
      setPendingChatTarget(t.kind === 'team' ? { kind: 'team' } : { kind: 'dm', channelId: t.channelId! });
    });
  }, []);

  // Centralized sign-out: clears Supabase session, saved auto-login credentials,
  // all in-memory chat state, the cached optimistic data, and resets the view.
  async function handleSignOut() {
    try { await signOut(); } catch {}
    // Disable auto-login on next launch (restore() checks these are truthy).
    try {
      await window.warroom?.secure.set('chat_email', '');
      await window.warroom?.secure.set('chat_password', '');
    } catch {}
    setCurrentUser(null);
    setCurrentTeam(null);
    setTeamMembers([]);
    setChatView('team');
    try { localStorage.removeItem('warroom-chat-user'); localStorage.removeItem('warroom-chat-team'); } catch {}
  }

  if (!chatOpen) return null;

  const inDM = typeof chatView === 'object' && chatView.kind === 'dm';

  return (
    <div className="flex flex-col h-full relative w-full" style={{ background: 'var(--bg-main)' }}>
      <ChatHeader
        chatView={chatView}
        onBack={() => setChatView('team')}
        onSettings={() => setShowSettings(true)}
        onDMSettings={() => { if (inDM) setDmSettingsFor((chatView as any).channel); }}
        onDMList={() => setChatView('dm-list')}
        onFiles={() => setChatView('files')}
        onPins={() => setChatView('pins')}
        onSignOut={handleSignOut}
        filesBarStyle={filesBarStyle}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!ready ? (
          <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : !currentUser || !currentTeam ? (
          <TeamSetup onDone={() => {}} />
        ) : chatView === 'dm-list' ? (
          <AllChatsList
            onOpenTeam={() => setChatView('team')}
            onOpenDM={(ch) => setChatView({ kind: 'dm', channel: ch })}
          />
        ) : typeof chatView === 'object' && chatView.kind === 'dm' ? (
          <DMPane channel={chatView.channel} />
        ) : (
          <TeamRoomPane chatView={chatView} setChatView={setChatView} filesBarStyle={filesBarStyle} />
        )}
      </div>
      {showSettings && <RoomSettings onClose={() => setShowSettings(false)} />}
      {dmSettingsFor && (
        <DMSettings
          channel={dmSettingsFor}
          onClose={() => setDmSettingsFor(null)}
          onLeft={() => { setDmSettingsFor(null); setChatView('dm-list'); }}
        />
      )}
    </div>
  );
}

// A message's DOM node (id="msg-<id>") is always present under the Chat tab —
// used both by in-thread "jump to quoted message" and by the Pins tab's
// "Jump to message" (which first switches tabs, then scrolls once mounted).
function scrollToMessageEl(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.style.transition = 'background-color 0.3s';
  el.style.backgroundColor = 'var(--nav-hover-bg)';
  setTimeout(() => { el.style.backgroundColor = ''; }, 900);
}

function TabBar({ tabs, active, onSelect }: { tabs: { key: string; label: string }[]; active: string; onSelect: (k: string) => void }) {
  return (
    <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border-side)' }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          className="flex-1 text-[11px] font-semibold py-1.5 transition"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: active === t.key ? 'var(--ink)' : 'var(--nav-inactive-color)',
            borderBottom: active === t.key ? '2px solid var(--accent)' : '2px solid transparent',
          }}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Team room pane (Chat / Files / Pins split, or Chat with icon buttons) ────

function TeamRoomPane({ chatView, setChatView, filesBarStyle }: {
  chatView: ChatView; setChatView: (v: ChatView) => void; filesBarStyle: FilesBarStyle;
}) {
  const { currentTeam } = useApp();
  const active = chatView === 'files' ? 'files' : chatView === 'pins' ? 'pins' : 'chat';
  return (
    <div className="flex flex-col h-full">
      {filesBarStyle === 'split' && (
        <TabBar
          tabs={[{ key: 'chat', label: 'Chat' }, { key: 'files', label: 'Files' }, { key: 'pins', label: 'Pins' }]}
          active={active}
          onSelect={(k) => setChatView(k === 'chat' ? 'team' : (k as ChatView))}
        />
      )}
      <div className="flex-1 min-h-0">
        {active === 'files' ? <TeamFiles />
          : active === 'pins' && currentTeam ? <PinsPanel teamId={currentTeam.id} onJumpTo={(id) => { setChatView('team'); setTimeout(() => scrollToMessageEl(id), 50); }} />
          : <ChatBody />}
      </div>
    </div>
  );
}

// ─── DM pane (Chat / Pins split — DMs have no Files list, so this always shows
// the tab bar regardless of the team's files-bar-style setting, which only
// governs the 3-way Chat/Files/Pins tradeoff in team rooms) ────────────────────

function DMPane({ channel }: { channel: DMChannel }) {
  const [sub, setSub] = useState<'chat' | 'pins'>('chat');
  return (
    <div className="flex flex-col h-full">
      <TabBar tabs={[{ key: 'chat', label: 'Chat' }, { key: 'pins', label: 'Pins' }]} active={sub} onSelect={(k) => setSub(k as 'chat' | 'pins')} />
      <div className="flex-1 min-h-0">
        {sub === 'pins'
          ? <PinsPanel dmChannelId={channel.id} onJumpTo={(id) => { setSub('chat'); setTimeout(() => scrollToMessageEl(id), 50); }} />
          : <DMBody channel={channel} />}
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function ChatHeader({ chatView, onBack, onSettings, onDMSettings, onDMList, onFiles, onPins, onSignOut, filesBarStyle }: {
  chatView: ChatView;
  onBack: () => void;
  onSettings: () => void;
  onDMSettings: () => void;
  onDMList: () => void;
  onFiles: () => void;
  onPins: () => void;
  onSignOut: () => void;
  filesBarStyle: FilesBarStyle;
}) {
  const { currentTeam } = useApp();
  const [nameHovered, setNameHovered] = useState(false);
  const inDM = typeof chatView === 'object' && chatView.kind === 'dm';
  const inDMList = chatView === 'dm-list';
  const inFiles = chatView === 'files';
  const inPins = chatView === 'pins';
  const inSubview = inDM || inDMList;

  let title = currentTeam ? currentTeam.name : 'Team Chat';
  if (inDMList) title = 'All Chats';
  if (inFiles) title = 'Team Files';
  if (inPins) title = 'Pinned Messages';
  if (inDM) title = (chatView as any).channel.name ?? dmChannelTitle((chatView as any).channel);

  return (
    <div className="glass-titlebar h-10 flex items-center gap-2 px-3 shrink-0"
      style={{ borderBottom: '1px solid var(--border-side)' }}>
      {inSubview && (
        <button onClick={onBack} className="text-sm mr-0.5 shrink-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}>
          ←
        </button>
      )}
      <div className="relative flex-1 min-w-0" onMouseEnter={() => setNameHovered(true)} onMouseLeave={() => setNameHovered(false)}>
        <span
          className="text-xs font-semibold block truncate"
          style={nameHovered
            ? { color: 'var(--ink)', position: 'absolute', top: 0, left: 0, whiteSpace: 'nowrap', background: 'var(--bg-titlebar)', paddingRight: 6, zIndex: 30 }
            : { color: 'var(--ink)' }}
        >
          {title}
        </span>
      </div>

      {currentTeam && !inSubview && filesBarStyle === 'icon' && (
        <>
          <IconBtn title="Team files" onClick={onFiles}><FilesIcon /></IconBtn>
          <IconBtn title="Pinned messages" onClick={onPins}><PinIcon /></IconBtn>
        </>
      )}
      {currentTeam && !inSubview && (
        <IconBtn title="All chats" onClick={onDMList}><DMIcon /></IconBtn>
      )}
      {currentTeam && !inDMList && (
        <IconBtn title={inDM ? 'DM settings' : 'Room settings'} onClick={inDM ? onDMSettings : onSettings}><SettingsIcon /></IconBtn>
      )}
      <IconBtn title="Sign out" onClick={onSignOut}><SignOutIcon /></IconBtn>
    </div>
  );
}

// ─── Team chat body ───────────────────────────────────────────────────────────

function ChatBody() {
  const { currentUser, currentTeam, chatOpen, clearUnread, incrementUnread } = useApp();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<'idle' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const notifyTyping = useTypingTracker('team');

  // messageId -> pinId, seeded once on mount. Only reflects pin/unpin actions
  // taken from this session live (see handleTogglePin) — the Pins tab itself
  // (PinsPanel.tsx) is the fully realtime source of truth.
  const [pinnedMap, setPinnedMap] = useState<Map<string, string>>(new Map());

  useAutoGrowTextarea(textareaRef, panelRef, composerText);

  useEffect(() => {
    if (!currentTeam) return;
    window.warroom.pins.getAll({ teamId: currentTeam.id }).then((res) => {
      if (res.ok) setPinnedMap(new Map((res.data as PinnedMessage[]).filter((p) => p.message_id).map((p) => [p.message_id as string, p.id])));
    });
  }, [currentTeam?.id]);

  async function handleTogglePin(m: ChatMessageType) {
    if (!currentTeam || !currentUser) return;
    const existingPinId = pinnedMap.get(m.id);
    if (existingPinId) {
      const res = await window.warroom.pins.unpin(existingPinId);
      if (res.ok) setPinnedMap((prev) => { const next = new Map(prev); next.delete(m.id); return next; });
      return;
    }
    const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
    const [senderName, content] = await Promise.all([encryptText(key, m.sender_name), encryptText(key, m.content)]);
    const res = await window.warroom.pins.pin({
      teamId: currentTeam.id, messageId: m.id, senderName, content,
      pinnedById: currentUser.id, pinnedByName: currentUser.displayName,
    });
    if (res.ok && res.data) setPinnedMap((prev) => new Map(prev).set(m.id, res.data.id));
  }

  useEffect(() => {
    if (!currentTeam) return;
    loadMessages();
    window.warroom.chat.subscribe(currentTeam.id);
    const off = window.warroom.chat.onNewMessage(async (msg: any) => {
      let decoded = msg;
      try {
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        decoded = await decryptMessage(key, msg);
      } catch {}
      setMessages((prev) => prev.find((m) => m.id === decoded.id) ? prev : [...prev, decoded]);
      // Read the live value, not the one captured when this subscription was set up
      // (the effect only re-runs on team change), so the unread badge doesn't tick up
      // — and no desktop notification fires — while the chat panel is actually open
      // and showing this room (ChatBody only mounts under exactly that condition,
      // or as the always-mounted background instance when the panel is closed).
      if (!useApp.getState().chatOpen) {
        incrementUnread();
        if (decoded.sender_id !== currentUser?.id) {
          const level = getChatNotifLevel('team');
          const isMention = currentUser ? messageMentionsOrReplies(decoded.content, decoded.reply_to_sender_name, currentUser.displayName) : false;
          if (level === 'all' || (level === 'mentions' && isMention)) {
            window.warroom.chat.showNotification({ title: decoded.sender_name, body: (decoded.content ?? '').slice(0, 200), targetKind: 'team' });
          }
        }
      }
    });
    return () => { off(); window.warroom.chat.unsubscribe(); };
  }, [currentTeam?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (chatOpen) clearUnread(); }, [chatOpen]);

  // Close picker on outside click
  useEffect(() => {
    if (!showMentionPicker) return;
    function onMouseDown(e: MouseEvent) {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setShowMentionPicker(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showMentionPicker]);

  async function loadMessages() {
    if (!currentTeam) return;
    setLoading(true);
    const res = await window.warroom.chat.getMessages(currentTeam.id);
    if (res.ok) {
      try {
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const decrypted = await Promise.all((res.data as any[]).map((m) => decryptMessage(key, m)));
        setMessages(decrypted as ChatMessageType[]);
      } catch {
        setMessages(res.data as ChatMessageType[]);
      }
    }
    setLoading(false);
  }

  function handleComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setComposerText(val);
    notifyTyping();
    const cursor = e.target.selectionStart ?? val.length;
    const match = val.slice(0, cursor).match(/@(\w*)$/);
    if (match) { setShowMentionPicker(true); setMentionQuery(match[1]); }
    else { setShowMentionPicker(false); setMentionQuery(''); }
  }

  const [oversized, setOversized] = useState<{ item: PendingMention; data: any; sizeBytes: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  function insertMentionText(item: PendingMention) {
    const cursor = textareaRef.current?.selectionStart ?? composerText.length;
    const replaced = composerText.slice(0, cursor).replace(/@\w*$/, `@${item.name.replace(/\s/g, '_')} `);
    setComposerText(replaced + composerText.slice(cursor));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function addMention(item: PendingMention, data: any) {
    setPendingMentions((prev) => prev.find((p) => p.id === item.id) ? prev : [...prev, { ...item, data }]);
    insertMentionText(item);
  }

  async function handleMentionSelect(item: PendingMention) {
    setShowMentionPicker(false);
    let data = item.data;
    if (item.type === 'flow') {
      try { data = await window.warroom?.storage.read(`flow_${item.id}`); } catch {}
      const sizeBytes = new Blob([JSON.stringify(data ?? {})]).size;
      if (sizeBytes > MAX_ATTACHMENT_BYTES) { setOversized({ item, data, sizeBytes }); return; }
    } else if (item.type === 'speechdoc' && item.data?.filePath) {
      // Extract actual doc text so the recipient can read it, not just a local file path
      try {
        const [extractRes, bytesRes] = await Promise.all([
          (window.warroom as any)?.speechdoc?.extract(item.data.filePath),
          window.warroom.fs.readFileBytes(item.data.filePath),
        ]);
        if (extractRes?.ok) data = { filePath: item.data.filePath, full: extractRes.data.full, tokenSaving: extractRes.data.tokenSaving };
        const sizeBytes = bytesRes?.ok && bytesRes.base64 ? base64SizeBytes(bytesRes.base64) : 0;
        if (sizeBytes > MAX_ATTACHMENT_BYTES) { setOversized({ item, data, sizeBytes }); return; }
      } catch {}
    }
    addMention(item, data);
  }

  function cancelOversized() { setOversized(null); setSummarizeError(''); }

  function sendOversizedNameOnly() {
    if (!oversized) return;
    const { item, sizeBytes } = oversized;
    addMention(item, { oversized: true, sizeBytes, filePath: item.data?.filePath });
    setOversized(null);
  }

  async function summarizeOversized() {
    if (!oversized || oversized.item.type !== 'speechdoc') return;
    setSummarizing(true); setSummarizeError('');
    try {
      const text = oversized.data?.full || oversized.data?.tokenSaving || '';
      const res = await (window.warroom as any)?.speechdoc?.summarizeForAttachment(text, oversized.item.name);
      if (!res?.ok) throw new Error(res?.error ?? 'Summarization failed');
      addMention(oversized.item, { summarized: true, summary: res.data, sizeBytes: oversized.sizeBytes, filePath: oversized.item.data?.filePath });
      setOversized(null);
    } catch (e: any) {
      setSummarizeError(e?.message ?? 'Failed to summarize');
    } finally {
      setSummarizing(false);
    }
  }

  async function compressImage(src: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = src;
    });
  }

  async function addImageAttachment(src: string, name: string) {
    const compressed = await compressImage(src);
    const item: PendingMention = { type: 'image', id: crypto.randomUUID(), name, data: { src: compressed } };
    setPendingMentions((prev) => [...prev, item]);
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await addImageAttachment(reader.result, `screenshot_${Date.now()}.png`);
      }
    };
    reader.readAsDataURL(file);
  }

  async function startDictation() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) { setIsRecording(false); return; }
        setIsRecording(false);
        setDictationStatus('transcribing');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const text = await transcribeRecording(blob, recorder.mimeType);
        if (text) setComposerText((prev) => (prev ? prev + ' ' : '') + text);
        setDictationStatus('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch { setIsRecording(false); }
  }

  function stopDictation() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
  }

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const [replyingTo, setReplyingTo] = React.useState<{ id: string; senderName: string; content: string } | null>(null);

  async function handleEditMessage(id: string, current: string) {
    setEditingId(id);
    setEditingText(current);
  }

  function handleReply(id: string, senderName: string, content: string) {
    setReplyingTo({ id, senderName, content });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background-color 0.3s';
    el.style.backgroundColor = 'var(--nav-hover-bg)';
    setTimeout(() => { el.style.backgroundColor = ''; }, 900);
  }

  async function submitEdit() {
    if (!editingId || !editingText.trim() || !currentTeam) { setEditingId(null); return; }
    const plain = editingText.trim();
    const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
    const res = await window.warroom.chat.editMessage(editingId, await encryptText(key, plain));
    if (res.ok) {
      setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, content: plain, edited: true } as any : m));
    }
    setEditingId(null);
    setEditingText('');
  }

  async function handleDeleteMessage(id: string) {
    const res = await window.warroom.chat.deleteMessage(id);
    if (res.ok) setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function sendMessage() {
    const content = composerText.trim() || pendingMentions.map((m) => `@${m.name.replace(/\s/g, '_')}`).join(' ');
    if (!content || !currentUser || !currentTeam) return;

    // Optimistic: show the message as sent immediately, roll back on failure.
    const tempId = `tmp-${crypto.randomUUID()}`;
    const savedText = composerText, savedMentions = pendingMentions, savedReply = replyingTo;
    const optimistic = {
      id: tempId, team_id: currentTeam.id, sender_id: currentUser.id, sender_name: currentUser.displayName,
      content, created_at: new Date().toISOString(),
      attachments: savedMentions.filter((m) => m.type !== 'member').map((m) => ({ id: m.id, type: m.type, name: m.name, data: m.data ?? {} })),
      reply_to_id: savedReply?.id, reply_to_sender_name: savedReply?.senderName, reply_to_content: savedReply?.content,
    } as any;
    setMessages((prev) => [...prev, optimistic]);
    setComposerText(''); setPendingMentions([]); setReplyingTo(null); setError('');
    setSending(true);
    try {
      const plainAtts = savedMentions
        .filter((m) => m.type !== 'member')
        .map((m) => {
          // Strip local file path — it's meaningless to the recipient. Oversized/
          // summarized placeholders (see OversizedFilePopup) carry no full/tokenSaving
          // text at all, just the marker + summary.
          const data = m.type === 'speechdoc'
            ? (m.data?.oversized
                ? { oversized: true, sizeBytes: m.data.sizeBytes }
                : m.data?.summarized
                  ? { summarized: true, summary: m.data.summary, sizeBytes: m.data.sizeBytes }
                  : { full: m.data?.full ?? '', tokenSaving: m.data?.tokenSaving ?? '' })
            : (m.data ?? {});
          return { id: m.id, type: m.type, name: m.name, data };
        });
      // Encrypt content + attachment data before it ever leaves the client.
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const { content: encContent, attachments: encAtts } = await encryptOutgoing(key, content, plainAtts);
      const replyToContent = savedReply ? await encryptText(key, savedReply.content) : undefined;
      const res = await window.warroom.chat.sendMessage({
        teamId: currentTeam.id, senderId: currentUser.id, senderName: currentUser.displayName,
        content: encContent,
        attachments: encAtts,
        replyToId: savedReply?.id,
        replyToSenderName: savedReply?.senderName,
        replyToContent,
      });
      if (!res.ok) throw new Error(res.error);
      // Real row arrives via the realtime subscription (fires for the sender's
      // own inserts too) — drop the optimistic placeholder so it isn't duplicated.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      // A speechdoc attachment sent with a real local path gets the same
      // auto-forward-to-Team-Files + live-watch treatment as a manual upload —
      // but only when the full content was actually sent. An oversized
      // attachment (name-only or AI-summarized, see OversizedFilePopup) has no
      // full bytes to forward and stays chat-only.
      for (const m of savedMentions) {
        if (m.type === 'speechdoc' && m.data?.filePath && !m.data?.oversized && !m.data?.summarized) {
          forwardSpeechdocToTeamFiles(currentTeam, currentUser, m.data.filePath, m.name).catch(() => {});
        }
      }
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setComposerText(savedText); setPendingMentions(savedMentions); setReplyingTo(savedReply);
      setError(e?.message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  const hasContent = !!composerText.trim() || pendingMentions.length > 0;

  return (
    <div ref={panelRef} className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2.5 space-y-1.5">
        {loading
          ? <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading messages…</div>
          : messages.length === 0
            ? <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>No messages yet. Say something!</div>
            : messages.flatMap((m, i) => {
              const prev = messages[i - 1];
              const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const nodes: React.ReactNode[] = [];
              if (showDate) nodes.push(<DateSeparator key={`date-${m.id}`} date={formatDateLabel(m.created_at)} />);
              if (editingId === m.id) {
                nodes.push(
                  <div key={m.id} className="flex flex-col items-end gap-1">
                    <textarea
                      className="input w-full resize-none text-sm"
                      rows={2}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                        if (e.key === 'Escape') { setEditingId(null); }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <button className="btn text-xs px-2 py-1" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn-primary text-xs px-2 py-1" onClick={submitEdit}>Save</button>
                    </div>
                  </div>
                );
              } else {
                nodes.push(
                  <ChatMessageBubble key={m.id} message={m} isSelf={m.sender_id === currentUser?.id}
                    onEdit={handleEditMessage} onDelete={handleDeleteMessage}
                    onReply={() => handleReply(m.id, m.sender_name, m.content)}
                    onQuoteClick={scrollToMessage}
                    onPin={() => handleTogglePin(m)} isPinned={pinnedMap.has(m.id)} />
                );
              }
              return nodes;
            })
        }
        <div ref={bottomRef} />
      </div>
      <TypingIndicator scopeKey="team" />

      {/* Composer */}
      <div ref={composerRef} className="shrink-0 px-3 pt-2 pb-2.5 space-y-1.5" style={{ borderTop: '1px solid var(--border-side)' }}>
        {oversized && (
          <OversizedFilePopup
            fileName={oversized.item.name}
            sizeBytes={oversized.sizeBytes}
            allowSummarize={oversized.item.type === 'speechdoc'}
            summarizing={summarizing}
            error={summarizeError}
            onSummarize={summarizeOversized}
            onSendNameOnly={sendOversizedNameOnly}
            onCancel={cancelOversized}
          />
        )}
        {replyingTo && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', borderLeft: '3px solid #0077ed' }}>
            <ReplyIcon />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold" style={{ color: '#0077ed' }}>Replying to {replyingTo.senderName}</div>
              <div className="text-[11px] truncate" style={{ color: 'var(--nav-inactive-color)' }}>{replyingTo.content}</div>
            </div>
            <button onClick={() => setReplyingTo(null)} title="Cancel reply"
              style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}>×</button>
          </div>
        )}
        {pendingMentions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--label-color)' }}>Attaching</span>
            {pendingMentions.map((m) => {
              const icon = TYPE_ICONS[m.type] ?? '📎';
              return (
                <div key={m.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                  {m.type === 'image' && m.data?.src
                    ? <img src={m.data.src} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    : <span className="text-base leading-none shrink-0">{icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{m.name}</div>
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: m.data?.oversized || m.data?.summarized ? '#d97706' : 'var(--nav-inactive-color)' }}>
                      {m.data?.oversized ? 'Too large — name only' : m.data?.summarized ? 'AI summary (too large for full content)' : m.type}
                    </div>
                  </div>
                  <button onClick={() => setPendingMentions((p) => p.filter((x) => x.id !== m.id))}
                    style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="relative">
          {showMentionPicker && (
            <MentionPicker query={mentionQuery} onSelect={handleMentionSelect} onClose={() => setShowMentionPicker(false)} />
          )}
          <textarea ref={textareaRef} className="input w-full resize-none text-sm" rows={2}
            placeholder="@ to attach or mention"
            style={{ paddingRight: 40, paddingBottom: 34 }}
            value={composerText} onChange={handleComposerChange}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              if (e.key === 'Escape') { setShowMentionPicker(false); if (!showMentionPicker) setReplyingTo(null); }
            }} />
          <div className="absolute bottom-1.5 right-1.5">
            <SendDictateButton
              hasContent={hasContent} sending={sending} isRecording={isRecording} dictationStatus={dictationStatus}
              onSend={sendMessage} onStartDictation={startDictation} onStopDictation={stopDictation}
              variant="solid" size={26}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Mirrors the manual "+ Add file" upload path in TeamFiles.tsx so a speechdoc
// attached straight to a chat message (not via the Team Files tab) still ends
// up in Team Files and gets the same local-file auto-update watch — see the
// Chat() top-level effect that listens for 'chat:localTeamFileChanged'. Only
// fires for team-room sends; DMs/group DMs intentionally have no Files list.
async function forwardSpeechdocToTeamFiles(currentTeam: any, currentUser: any, filePath: string, filename: string) {
  const bytesRes = await window.warroom.fs.readFileBytes(filePath);
  if (!bytesRes.ok || !bytesRes.base64) return;
  const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
  const [encName, encData] = await Promise.all([
    encryptText(key, filename),
    encryptText(key, bytesRes.base64),
  ]);
  const res = await window.warroom.teamFiles.upload({
    teamId: currentTeam.id, uploaderId: currentUser.id, uploaderName: currentUser.displayName,
    name: encName, dataB64: encData,
  });
  if (res.ok && res.data) await window.warroom.teamFiles.watchLocal(res.data.id, filePath);
}

// ─── All chats (team room + DMs + group DMs) ───────────────────────────────────

function AllChatsList({ onOpenTeam, onOpenDM }: { onOpenTeam: () => void; onOpenDM: (ch: DMChannel) => void }) {
  const { currentTeam, currentUser, teamMembers, presenceState } = useApp();
  const [channels, setChannels] = useState<DMChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDM, setShowNewDM] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  // Email lookup state
  const [emailInput, setEmailInput] = useState('');
  const [emailLooking, setEmailLooking] = useState(false);
  const [emailResults, setEmailResults] = useState<EmailLookupResult[]>([]);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (!currentTeam) return;
    window.warroom.chat.getDMChannels(currentTeam.id).then((res) => {
      if (res.ok) setChannels(res.data as DMChannel[]);
      setLoading(false);
    });
  }, [currentTeam?.id]);

  async function lookupEmail() {
    const email = emailInput.trim();
    if (!email) return;
    setEmailLooking(true);
    setEmailError('');
    const res = await window.warroom.chat.lookupUserByEmail(email);
    setEmailLooking(false);
    if (!res.ok) { setEmailError('Lookup failed: ' + res.error); return; }
    if (!res.data) { setEmailError('No account found with that email.'); return; }
    // Don't add duplicates
    if (!emailResults.find((r) => r.userId === res.data!.userId) &&
        !teamMembers.find((m) => m.user_id === res.data!.userId)) {
      setEmailResults((prev) => [...prev, { ...res.data!, email }]);
    }
    // Auto-select
    setSelectedMembers((prev) => prev.includes(res.data!.userId) ? prev : [...prev, res.data!.userId]);
    setEmailInput('');
  }

  async function createDM() {
    if (!currentTeam || !currentUser || selectedMembers.length === 0) return;
    setCreating(true);
    const teamRecips = teamMembers
      .filter((m) => selectedMembers.includes(m.user_id))
      .map((m) => ({ userId: m.user_id, displayName: m.display_name }));
    const emailRecips = emailResults
      .filter((r) => selectedMembers.includes(r.userId))
      .map((r) => ({ userId: r.userId, displayName: r.displayName }));
    const members = [
      { userId: currentUser.id, displayName: currentUser.displayName },
      ...teamRecips,
      ...emailRecips,
    ];
    const name = selectedMembers.length > 1 ? (groupName.trim() || null) : null;
    const res = await window.warroom.chat.createDM(currentTeam.id, members, name ?? undefined);
    if (res.ok) {
      const ch = res.data as DMChannel;
      setChannels((prev) => [ch, ...prev]);
      setShowNewDM(false);
      setSelectedMembers([]);
      setGroupName('');
      setEmailResults([]);
      setEmailInput('');
      onOpenDM(ch);
    }
    setCreating(false);
  }

  function cancelNew() {
    setShowNewDM(false);
    setSelectedMembers([]);
    setGroupName('');
    setEmailResults([]);
    setEmailInput('');
    setEmailError('');
  }

  const otherMembers = teamMembers.filter((m) => m.user_id !== currentUser?.id);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-2">
        {currentTeam && !showNewDM && (
          <button className="w-full text-left px-3 py-2.5 rounded-lg transition flex items-center gap-2.5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--ink)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; }}
            onClick={onOpenTeam}>
            <ChatAvatar spec={{ kind: 'team', name: currentTeam.name }} size={26} />
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{currentTeam.name}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>Team room</div>
            </div>
          </button>
        )}
        {loading ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : channels.map((ch) => {
          const others = ch.members.filter((m) => m.user_id !== currentUser?.id);
          const name = ch.name ?? (others.length ? others.map((m) => m.display_name).join(', ') : ch.members[0]?.display_name ?? 'DM');
          const isGroup = ch.members.length > 2;
          const spec: AvatarSpec = isGroup
            ? { kind: 'group', members: ch.members.map((m) => ({ id: m.user_id, name: m.display_name })) }
            : { kind: 'dm', id: (others[0] ?? ch.members[0])?.user_id ?? ch.id, name };
          const online = isGroup ? undefined : isUserOnline(presenceState, (others[0] ?? ch.members[0])?.user_id ?? '');
          return (
            <button key={ch.id} className="w-full text-left px-3 py-2.5 rounded-lg transition flex items-center gap-2.5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--ink)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; }}
              onClick={() => onOpenDM(ch)}>
              <ChatAvatar spec={spec} size={26} online={online} />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{name}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
                  {ch.members.length} member{ch.members.length !== 1 ? 's' : ''}
                </div>
              </div>
            </button>
          );
        })}

        {showNewDM && (
          <div className="rounded-lg p-3 space-y-2.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
            <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>New message</div>

            {/* Email lookup for non-members */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--nav-inactive-color)' }}>
                Add by email
              </div>
              <div className="flex gap-1.5">
                <input
                  className="input flex-1 text-xs"
                  placeholder="someone@school.edu"
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupEmail(); } }}
                />
                <button className="btn text-xs px-2 py-1 shrink-0" onClick={lookupEmail}
                  disabled={emailLooking || !emailInput.trim()}>
                  {emailLooking ? '…' : 'Add'}
                </button>
              </div>
              {emailError && (
                <p className="text-[10px] mt-1" style={{ color: '#ef4444' }}>{emailError}</p>
              )}
              {/* Email-looked-up people */}
              {emailResults.map((r) => (
                <label key={r.userId} className="flex items-center gap-2 cursor-pointer mt-1.5">
                  <input type="checkbox" checked={selectedMembers.includes(r.userId)}
                    onChange={(e) => setSelectedMembers((prev) =>
                      e.target.checked ? [...prev, r.userId] : prev.filter((id) => id !== r.userId)
                    )} />
                  <span className="text-xs" style={{ color: 'var(--ink)' }}>{r.displayName}</span>
                  <span className="text-[10px] truncate" style={{ color: 'var(--nav-inactive-color)' }}>{r.email}</span>
                </label>
              ))}
            </div>

            {/* Team members */}
            {otherMembers.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--nav-inactive-color)' }}>
                  Team members
                </div>
                {otherMembers.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2 cursor-pointer mb-1">
                    <input type="checkbox" checked={selectedMembers.includes(m.user_id)}
                      onChange={(e) => setSelectedMembers((prev) =>
                        e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id)
                      )} />
                    <span className="text-xs" style={{ color: 'var(--ink)' }}>{m.display_name}</span>
                    <span className="text-[10px] capitalize" style={{ color: 'var(--nav-inactive-color)' }}>{m.role}</span>
                  </label>
                ))}
              </div>
            )}

            {selectedMembers.length > 1 && (
              <input className="input w-full text-xs" placeholder="Group name (optional)"
                value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            )}
            <div className="flex gap-2 pt-0.5">
              <button className="btn-primary text-xs px-3 py-1" onClick={createDM}
                disabled={creating || selectedMembers.length === 0}>
                {creating ? '…' : 'Start'}
              </button>
              <button className="btn text-xs px-3 py-1" onClick={cancelNew}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {!showNewDM && (
        <div className="shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--border-side)' }}>
          <button className="btn-primary w-full text-xs py-1.5" onClick={() => setShowNewDM(true)}>
            + New message
          </button>
        </div>
      )}
    </div>
  );
}

interface EmailLookupResult { userId: string; displayName: string; email: string; }

// ─── DM body ──────────────────────────────────────────────────────────────────

function DMBody({ channel }: { channel: DMChannel }) {
  const { currentUser, currentTeam, teamMembers } = useApp();
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [adding, setAdding] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<'idle' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const notifyTyping = useTypingTracker(channel.id);
  const [pinnedMap, setPinnedMap] = useState<Map<string, string>>(new Map());

  useAutoGrowTextarea(textareaRef, panelRef, composerText);

  useEffect(() => {
    window.warroom.pins.getAll({ dmChannelId: channel.id }).then((res) => {
      if (res.ok) setPinnedMap(new Map((res.data as PinnedMessage[]).filter((p) => p.message_id).map((p) => [p.message_id as string, p.id])));
    });
  }, [channel.id]);

  async function handleTogglePin(m: DMMessage) {
    if (!currentTeam || !currentUser) return;
    const existingPinId = pinnedMap.get(m.id);
    if (existingPinId) {
      const res = await window.warroom.pins.unpin(existingPinId);
      if (res.ok) setPinnedMap((prev) => { const next = new Map(prev); next.delete(m.id); return next; });
      return;
    }
    const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
    const [senderName, content] = await Promise.all([encryptText(key, m.sender_name), encryptText(key, m.content)]);
    const res = await window.warroom.pins.pin({
      dmChannelId: channel.id, messageId: m.id, senderName, content,
      pinnedById: currentUser.id, pinnedByName: currentUser.displayName,
    });
    if (res.ok && res.data) setPinnedMap((prev) => new Map(prev).set(m.id, res.data.id));
  }

  useEffect(() => {
    loadMessages();
    window.warroom.chat.subscribeDM(channel.id);
    const off = window.warroom.chat.onNewDMMessage(async (msg: any) => {
      if (msg.dm_channel_id !== channel.id) return;
      let decoded = msg;
      try {
        if (currentTeam) {
          const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
          decoded = await decryptMessage(key, msg);
        }
      } catch {}
      setMessages((prev) => prev.find((m) => m.id === decoded.id) ? prev : [...prev, decoded]);
    });
    return () => { off(); window.warroom.chat.unsubscribeDM(); };
  }, [channel.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadMessages() {
    setLoading(true);
    const res = await window.warroom.chat.getDMMessages(channel.id);
    if (res.ok) {
      try {
        if (currentTeam) {
          const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
          const decrypted = await Promise.all((res.data as any[]).map((m) => decryptMessage(key, m)));
          setMessages(decrypted as DMMessage[]);
        } else {
          setMessages(res.data as DMMessage[]);
        }
      } catch {
        setMessages(res.data as DMMessage[]);
      }
    }
    setLoading(false);
  }

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const [replyingTo, setReplyingTo] = React.useState<{ id: string; senderName: string; content: string } | null>(null);

  function handleReply(id: string, senderName: string, content: string) {
    setReplyingTo({ id, senderName, content });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background-color 0.3s';
    el.style.backgroundColor = 'var(--nav-hover-bg)';
    setTimeout(() => { el.style.backgroundColor = ''; }, 900);
  }

  async function startDictation() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) { setIsRecording(false); return; }
        setIsRecording(false);
        setDictationStatus('transcribing');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const text = await transcribeRecording(blob, recorder.mimeType);
        if (text) setComposerText((prev) => (prev ? prev + ' ' : '') + text);
        setDictationStatus('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch { setIsRecording(false); }
  }

  function stopDictation() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
  }

  async function send() {
    if (!composerText.trim() || !currentUser || !currentTeam) return;
    const tempId = `tmp-${crypto.randomUUID()}`;
    const savedText = composerText, savedReply = replyingTo;
    const optimistic = {
      id: tempId, dm_channel_id: channel.id, sender_id: currentUser.id, sender_name: currentUser.displayName,
      content: savedText.trim(), created_at: new Date().toISOString(),
      reply_to_id: savedReply?.id, reply_to_sender_name: savedReply?.senderName, reply_to_content: savedReply?.content,
    } as any;
    setMessages((prev) => [...prev, optimistic]);
    setComposerText(''); setReplyingTo(null); setError('');
    setSending(true);
    try {
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const replyToContent = savedReply ? await encryptText(key, savedReply.content) : undefined;
      const res = await window.warroom.chat.sendDMMessage({
        dmChannelId: channel.id, senderId: currentUser.id,
        senderName: currentUser.displayName, content: await encryptText(key, savedText.trim()),
        replyToId: savedReply?.id,
        replyToSenderName: savedReply?.senderName,
        replyToContent,
      });
      if (!res.ok) throw new Error(res.error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setComposerText(savedText); setReplyingTo(savedReply);
      setError(e?.message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function submitEdit() {
    if (!editingId || !editingText.trim() || !currentTeam) { setEditingId(null); return; }
    const plain = editingText.trim();
    const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
    const res = await window.warroom.chat.editDMMessage(editingId, await encryptText(key, plain));
    if (res.ok) setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, content: plain, edited: true } as any : m));
    setEditingId(null); setEditingText('');
  }

  async function handleDelete(id: string) {
    const res = await window.warroom.chat.deleteDMMessage(id);
    if (res.ok) setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  const memberIdsInChannel = new Set(channel.members.map((m) => m.user_id));
  const addableMembers = teamMembers.filter((m) => !memberIdsInChannel.has(m.user_id));

  async function addMember(userId: string, displayName: string) {
    setAdding(true);
    await window.warroom.chat.addDMMember(channel.id, userId, displayName);
    setAdding(false);
    setShowAddMember(false);
  }

  const hasContent = !!composerText.trim();

  return (
    <div ref={panelRef} className="flex flex-col h-full">
      {/* Member pills */}
      <div className="flex flex-wrap gap-1 px-3 pt-2 pb-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border-side)' }}>
        {channel.members.map((m) => (
          <span key={m.user_id} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--bg-card)', color: 'var(--nav-active-color)', border: '1px solid var(--border-side)' }}>
            {m.display_name}
          </span>
        ))}
        {addableMembers.length > 0 && (
          <button className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: 'transparent', border: '1px dashed var(--border-side)', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}
            onClick={() => setShowAddMember((v) => !v)}>
            + Add
          </button>
        )}
        {showAddMember && addableMembers.length > 0 && (
          <div className="w-full mt-1 rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
            {addableMembers.map((m) => (
              <button key={m.user_id} className="w-full text-left px-3 py-1.5 text-xs transition"
                style={{ color: 'var(--ink)', background: 'transparent' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                onClick={() => addMember(m.user_id, m.display_name)} disabled={adding}>
                {m.display_name} <span style={{ color: 'var(--nav-inactive-color)' }}>({m.role})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2.5 space-y-1.5">
        {loading
          ? <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
          : messages.length === 0
            ? <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>No messages yet</div>
            : messages.flatMap((m, i) => {
              const prev = messages[i - 1];
              const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const nodes: React.ReactNode[] = [];
              if (showDate) nodes.push(<DateSeparator key={`date-${m.id}`} date={formatDateLabel(m.created_at)} />);
              if (editingId === m.id) {
                nodes.push(
                  <div key={m.id} className="flex flex-col items-end gap-1">
                    <textarea className="input w-full resize-none text-sm" rows={2}
                      value={editingText} onChange={(e) => setEditingText(e.target.value)} autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                        if (e.key === 'Escape') setEditingId(null);
                      }} />
                    <div className="flex gap-1.5">
                      <button className="btn text-xs px-2 py-1" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn-primary text-xs px-2 py-1" onClick={submitEdit}>Save</button>
                    </div>
                  </div>
                );
              } else {
                nodes.push(
                  <DMMessageBubble key={m.id} message={m} isSelf={m.sender_id === currentUser?.id}
                    onEdit={(id, txt) => { setEditingId(id); setEditingText(txt); }}
                    onDelete={handleDelete}
                    onReply={() => handleReply(m.id, m.sender_name, m.content)}
                    onQuoteClick={scrollToMessage}
                    onPin={() => handleTogglePin(m)} isPinned={pinnedMap.has(m.id)} />
                );
              }
              return nodes;
            })
        }
        <div ref={bottomRef} />
      </div>
      <TypingIndicator scopeKey={channel.id} />

      {/* Composer */}
      <div className="shrink-0 px-3 pt-2 pb-2.5 space-y-1.5" style={{ borderTop: '1px solid var(--border-side)' }}>
        {replyingTo && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', borderLeft: '3px solid #0077ed' }}>
            <ReplyIcon />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold" style={{ color: '#0077ed' }}>Replying to {replyingTo.senderName}</div>
              <div className="text-[11px] truncate" style={{ color: 'var(--nav-inactive-color)' }}>{replyingTo.content}</div>
            </div>
            <button onClick={() => setReplyingTo(null)} title="Cancel reply"
              style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}>×</button>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="relative">
          <textarea ref={textareaRef} className="input w-full resize-none text-sm" rows={2}
            placeholder="Message…"
            style={{ paddingRight: 40, paddingBottom: 34 }}
            value={composerText}
            onChange={(e) => { setComposerText(e.target.value); notifyTyping(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape') setReplyingTo(null);
            }} />
          <div className="absolute bottom-1.5 right-1.5">
            <SendDictateButton
              hasContent={hasContent} sending={sending} isRecording={isRecording} dictationStatus={dictationStatus}
              onSend={send} onStartDictation={startDictation} onStopDictation={stopDictation}
              variant="solid" size={26}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DM message bubble ────────────────────────────────────────────────────────

function DMMessageBubble({ message: m, isSelf, onEdit, onDelete, onReply, onQuoteClick, onPin, isPinned }: {
  message: DMMessage; isSelf: boolean;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onReply: () => void;
  onQuoteClick: (id: string) => void;
  onPin: () => void;
  isPinned: boolean;
}) {
  const { flowsIndex, setFlowsIndex, update, setView } = useApp();
  const [hovered, setHovered] = React.useState(false);

  async function importFlow(att: any) {
    // Live flow: join the same realtime doc instead of cloning it.
    if (att.data?.live && att.data?.flowId) {
      const id = att.data.flowId as string;
      const meta: FlowMeta = { id, name: att.name, event: att.data?.event ?? 'policy', live: true, teamId: att.data?.teamId, createdAt: new Date().toISOString() };
      const exists = flowsIndex.some((f) => f.id === id);
      const newIndex = exists ? flowsIndex.map((f) => (f.id === id ? { ...f, ...meta } : f)) : [...flowsIndex, meta];
      setFlowsIndex(newIndex);
      await window.warroom.storage.write('flows_index', newIndex);
      if (!exists) await window.warroom.storage.write(`flow_data_${id}`, att.data ?? {});
      setView({ kind: 'flow', flowId: id });
      return;
    }
    const newId = crypto.randomUUID();
    const meta: FlowMeta = { id: newId, name: att.name, event: att.data?.event ?? 'policy', createdAt: new Date().toISOString() };
    const newIndex = [...flowsIndex, meta];
    setFlowsIndex(newIndex);
    await window.warroom.storage.write('flows_index', newIndex);
    await window.warroom.storage.write(`flow_data_${newId}`, att.data ?? {});
    setView({ kind: 'flow', flowId: newId });
  }

  async function importCase(att: any) {
    if (!att.data?.case) return;
    const c = att.data.case;
    const newCaseId = crypto.randomUUID();
    const blocks: Record<string, any> = {};
    if (att.data.blocks) {
      Object.values(att.data.blocks as any).forEach((b: any) => {
        blocks[b.id] = { ...b, caseId: newCaseId };
      });
    }
    await update((db) => ({
      ...db,
      cases: { ...db.cases, [newCaseId]: { ...c, id: newCaseId, name: `${c.name} (shared)` } },
      blocks: { ...db.blocks, ...blocks },
    }));
    setView({ kind: 'case', caseId: newCaseId });
  }

  async function importOpponent(att: any) {
    if (!att.data?.opponent) return;
    const newId = crypto.randomUUID();
    await update((db) => ({ ...db, opponents: { ...db.opponents, [newId]: { ...att.data.opponent, id: newId } } }));
  }

  async function importTournament(att: any) {
    if (!att.data?.tournament) return;
    const newId = crypto.randomUUID();
    await update((db) => ({
      ...db,
      tournaments: { ...db.tournaments, [newId]: { ...att.data.tournament, id: newId, name: `${att.data.tournament.name} (shared)` } },
    }));
    setView({ kind: 'tournament', tournamentId: newId });
  }

  const attachments = (m as any).attachments ?? [];
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      id={`msg-${m.id}`}
      className={`flex flex-col gap-0.5 rounded-lg ${isSelf ? 'items-end' : 'items-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sender name (others only) */}
      {!isSelf && (
        <span className="text-[11px] font-semibold px-0.5" style={{ color: 'var(--nav-active-color)' }}>{m.sender_name}</span>
      )}

      {/* Quoted reply preview */}
      {m.reply_to_id && (
        <button
          onClick={() => onQuoteClick(m.reply_to_id!)}
          className="max-w-[85%] flex flex-col items-start text-left px-2 py-1 rounded-md transition"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', borderLeft: '3px solid #0077ed', cursor: 'pointer' }}
        >
          <span className="text-[9px] font-semibold" style={{ color: '#0077ed' }}>{m.reply_to_sender_name}</span>
          <span className="text-[10px] truncate w-full" style={{ color: 'var(--nav-inactive-color)' }}>{m.reply_to_content}</span>
        </button>
      )}

      {/* Bubble */}
      <div className="w-fit max-w-[85%] px-2.5 py-1.5 rounded-xl text-[13px] leading-snug"
        style={isSelf
          ? { background: '#0077ed', color: '#ffffff', overflowWrap: 'break-word', wordBreak: 'break-word' }
          : { background: 'var(--bg-card)', color: 'var(--ink)', border: '1px solid var(--border-side)', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
        {linkifyText(m.content, m.id)}
      </div>

      {/* Attachment chips — same component as team chat */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-w-[85%]">
          {attachments.map((att: any) =>
            att.type === 'image'
              ? <DMImageAttachment key={att.id} att={att} />
              : <ChatAttachmentChip key={att.id} attachment={att} isSelf={isSelf}
                  onImportFlow={importFlow}
                  onImportCase={importCase}
                  onImportOpponent={importOpponent}
                  onImportTournament={importTournament}
                />
          )}
        </div>
      )}

      {/* Footer: edit/delete (own) + timestamp — buttons always in DOM to prevent layout shift */}
      <div className={`flex items-center h-4 gap-0.5 px-0.5 -mt-0.5 ${isSelf ? 'justify-end' : 'justify-start'}`}>
        {isSelf && (
          <>
            <button
              onClick={() => onEdit(m.id, m.content)}
              title="Edit"
              className="w-5 h-5 flex items-center justify-center rounded transition"
              style={{
                color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
                cursor: hovered ? 'pointer' : 'default',
                opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
            ><DMPencilIcon /></button>
            <button
              onClick={() => onDelete(m.id)}
              title="Delete"
              className="w-5 h-5 flex items-center justify-center rounded transition"
              style={{
                color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
                cursor: hovered ? 'pointer' : 'default',
                opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
            ><DMTrashIcon /></button>
          </>
        )}
        <button
          onClick={onPin}
          title={isPinned ? 'Unpin' : 'Pin'}
          className="w-5 h-5 flex items-center justify-center rounded transition"
          style={{
            color: isPinned ? '#d97706' : 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
            cursor: hovered || isPinned ? 'pointer' : 'default',
            opacity: hovered || isPinned ? 1 : 0, pointerEvents: hovered || isPinned ? 'auto' : 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#d97706'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = isPinned ? '#d97706' : 'var(--nav-inactive-color)'; }}
        ><PinIcon /></button>
        <button
          onClick={onReply}
          title="Reply"
          className="w-5 h-5 flex items-center justify-center rounded transition"
          style={{
            color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
            cursor: hovered ? 'pointer' : 'default',
            opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
        ><ReplyIcon /></button>
        <span className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>{time}</span>
        {(m as any).edited && <span className="text-[9px]" style={{ color: 'var(--nav-inactive-color)' }}>(edited)</span>}
      </div>
    </div>
  );
}

function DMImageAttachment({ att }: { att: any }) {
  const [lightbox, setLightbox] = React.useState(false);
  const src = att.data?.src;
  if (!src) return null;
  return (
    <>
      <img src={src} alt={att.name} className="rounded-xl cursor-pointer object-cover max-h-52"
        style={{ maxWidth: '100%', border: '1px solid var(--border-side)' }}
        onClick={() => setLightbox(true)} />
      {lightbox && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(false)}>
          <img src={src} alt={att.name} className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dmChannelTitle(channel: DMChannel, selfId?: string) {
  const others = channel.members.filter((m) => m.user_id !== selfId);
  if (others.length === 0) return channel.members[0]?.display_name ?? 'DM';
  return others.map((m) => m.display_name).join(', ');
}

const TYPE_ICONS: Record<string, string> = {
  case: '📁', block: '📄', flow: '⬜', opponent: '🥊', member: '👤', speechdoc: '📝', 'speech-doc': '📝', tournament: '🏆',
};

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="flex-1 h-px" style={{ background: 'var(--border-side)' }} />
      <span
        className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
        style={{ color: 'var(--nav-inactive-color)', background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}
      >
        {date}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--border-side)' }} />
    </div>
  );
}

function formatDateLabel(isoString: string): string {
  const d = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const msgDay = d.toDateString();
  if (msgDay === today.toDateString()) return 'Today';
  if (msgDay === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded-md transition text-xs"
      style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

function DMIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 9h8M8 13h5" /><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" /></svg>;
}
function FilesIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}
function SettingsIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}
function SignOutIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
}
function DMPencilIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function DMTrashIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>;
}
function ReplyIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>;
}
