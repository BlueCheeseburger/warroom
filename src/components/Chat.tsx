import React, { useState, useEffect, useRef } from 'react';
import { linkifyText } from '../lib/linkify';

function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

import { useApp, FlowMeta } from '../store/appStore';
import { signOut } from '../lib/supabase';
import { getTeamKey, encryptText, encryptOutgoing, decryptMessage } from '../lib/chatCrypto';
import { ChatMessage as ChatMessageType, DMChannel, DMMessage, PendingMention } from '../types';
import ChatMessageBubble, { AttachmentChip as ChatAttachmentChip } from './ChatMessage';
import MentionPicker from './MentionPicker';
import TeamSetup from './TeamSetup';
import RoomSettings from './RoomSettings';

type ChatView = 'team' | 'dm-list' | { kind: 'dm'; channel: DMChannel };

export default function Chat() {
  const { currentUser, currentTeam, chatOpen, setChatOpen, setCurrentUser, setCurrentTeam, setTeamMembers } = useApp();
  const [ready, setReady] = useState(false);
  const [chatView, setChatView] = useState<ChatView>('team');
  const [showSettings, setShowSettings] = useState(false);

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

  return (
    <div className="flex flex-col h-full relative w-full" style={{ background: 'var(--bg-main)' }}>
      <ChatHeader
        chatView={chatView}
        onBack={() => setChatView('team')}
        onClose={() => setChatOpen(false)}
        onSettings={() => setShowSettings(true)}
        onDMList={() => setChatView('dm-list')}
        onSignOut={handleSignOut}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!ready ? (
          <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : !currentUser || !currentTeam ? (
          <TeamSetup onDone={() => {}} />
        ) : chatView === 'dm-list' ? (
          <DMList onOpenDM={(ch) => setChatView({ kind: 'dm', channel: ch })} />
        ) : typeof chatView === 'object' && chatView.kind === 'dm' ? (
          <DMBody channel={chatView.channel} onAddMember={() => {}} />
        ) : (
          <ChatBody />
        )}
      </div>
      {showSettings && <RoomSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function ChatHeader({ chatView, onBack, onClose, onSettings, onDMList, onSignOut }: {
  chatView: ChatView;
  onBack: () => void;
  onClose: () => void;
  onSettings: () => void;
  onDMList: () => void;
  onSignOut: () => void;
}) {
  const { currentTeam } = useApp();
  const [copied, setCopied] = React.useState(false);
  const inDM = typeof chatView === 'object' && chatView.kind === 'dm';
  const inDMList = chatView === 'dm-list';

  function handleCopyCode() {
    if (!currentTeam) return;
    navigator.clipboard?.writeText(currentTeam.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  let title = currentTeam ? currentTeam.name : 'Team Chat';
  if (inDMList) title = 'Direct Messages';
  if (inDM) title = (chatView as any).channel.name ?? dmChannelTitle((chatView as any).channel);

  return (
    <div className="h-10 flex items-center gap-2 px-3 shrink-0"
      style={{ borderBottom: '1px solid var(--border-side)', background: 'var(--bg-titlebar)' }}>
      {(inDM || inDMList) && (
        <button onClick={onBack} className="text-sm mr-0.5 shrink-0"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}>
          ←
        </button>
      )}
      <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--ink)' }}>{title}</span>

      {currentTeam && !inDM && !inDMList && (
        <button title={`Invite code — click to copy`}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors shrink-0"
          style={copied
            ? { background: '#166534', color: '#86efac', border: '1px solid #166534' }
            : { background: 'var(--bg-card)', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-side)' }}
          onClick={handleCopyCode}>
          {copied ? '✓ copied' : currentTeam.invite_code}
        </button>
      )}

      {currentTeam && !inDM && !inDMList && (
        <IconBtn title="Direct messages" onClick={onDMList}><DMIcon /></IconBtn>
      )}
      {currentTeam && !inDM && !inDMList && (
        <IconBtn title="Room settings" onClick={onSettings}><SettingsIcon /></IconBtn>
      )}
      <IconBtn title="Sign out" onClick={onSignOut}><SignOutIcon /></IconBtn>
      <IconBtn title="Close chat" onClick={onClose}><CloseIcon /></IconBtn>
    </div>
  );
}

// ─── Team chat body ───────────────────────────────────────────────────────────

function ChatBody() {
  const { currentUser, currentTeam, chatOpen, clearUnread, incrementUnread, db } = useApp();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<'idle' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

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
      // while the chat panel is actually open.
      if (!useApp.getState().chatOpen) incrementUnread();
    });
    return () => { off(); window.warroom.chat.unsubscribe(); };
  }, [currentTeam?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (chatOpen) clearUnread(); }, [chatOpen]);

  // Close picker/attach menu on outside click
  useEffect(() => {
    if (!showMentionPicker && !showAttachMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setShowMentionPicker(false);
        setShowAttachMenu(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showMentionPicker, showAttachMenu]);

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
    const cursor = e.target.selectionStart ?? val.length;
    const match = val.slice(0, cursor).match(/@(\w*)$/);
    if (match) { setShowMentionPicker(true); setMentionQuery(match[1]); }
    else { setShowMentionPicker(false); setMentionQuery(''); }
  }

  async function handleMentionSelect(item: PendingMention) {
    setShowMentionPicker(false);
    let data = item.data;
    if (item.type === 'flow') {
      try { data = await window.warroom?.storage.read(`flow_${item.id}`); } catch {}
    } else if (item.type === 'speechdoc' && item.data?.filePath) {
      // Extract actual doc text so the recipient can read it, not just a local file path
      try {
        const res = await (window.warroom as any)?.speechdoc?.extract(item.data.filePath);
        if (res?.ok) data = { filePath: item.data.filePath, full: res.data.full, tokenSaving: res.data.tokenSaving };
      } catch {}
    }
    setPendingMentions((prev) => prev.find((p) => p.id === item.id) ? prev : [...prev, { ...item, data }]);
    const cursor = textareaRef.current?.selectionStart ?? composerText.length;
    const replaced = composerText.slice(0, cursor).replace(/@\w*$/, `@${item.name.replace(/\s/g, '_')} `);
    setComposerText(replaced + composerText.slice(cursor));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function openAttachPicker() {
    setShowAttachMenu((v) => !v);
    setShowMentionPicker(false);
  }

  function openMentionPicker() {
    setShowAttachMenu(false);
    setShowMentionPicker(true);
    setMentionQuery('');
    setTimeout(() => textareaRef.current?.focus(), 0);
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

  async function handleImageFromFile() {
    setShowAttachMenu(false);
    try {
      const path = await window.warroom?.dialog.openFile(['png', 'jpg', 'jpeg', 'gif', 'webp']);
      if (!path) return;
      const result = await window.warroom?.fs.readFileBytes(path);
      if (!result?.ok || !result.base64) return;
      const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      const src = `data:${mime};base64,${result.base64}`;
      const name = path.split(/[\\/]/).pop() ?? 'image';
      await addImageAttachment(src, name);
    } catch {}
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
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const geminiMime = recorder.mimeType.split(';')[0] || 'audio/webm';
        try {
          const res = await (window.warroom as any)?.dictation?.transcribe(btoa(bin), geminiMime);
          if (res?.ok && res.data) {
            setComposerText((prev) => (prev ? prev + ' ' : '') + res.data.trim());
          }
        } catch {}
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

  async function handleEditMessage(id: string, current: string) {
    setEditingId(id);
    setEditingText(current);
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
    setSending(true); setError('');
    try {
      const plainAtts = pendingMentions
        .filter((m) => m.type !== 'member')
        .map((m) => {
          // Strip local file path — it's meaningless to the recipient
          const data = m.type === 'speechdoc'
            ? { full: m.data?.full ?? '', tokenSaving: m.data?.tokenSaving ?? '' }
            : (m.data ?? {});
          return { id: m.id, type: m.type, name: m.name, data };
        });
      // Encrypt content + attachment data before it ever leaves the client.
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const { content: encContent, attachments: encAtts } = await encryptOutgoing(key, content, plainAtts);
      const res = await window.warroom.chat.sendMessage({
        teamId: currentTeam.id, senderId: currentUser.id, senderName: currentUser.displayName,
        content: encContent,
        attachments: encAtts,
      });
      if (!res.ok) throw new Error(res.error);
      setComposerText(''); setPendingMentions([]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
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
                    onEdit={handleEditMessage} onDelete={handleDeleteMessage} />
                );
              }
              return nodes;
            })
        }
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div ref={composerRef} className="shrink-0 px-3 pt-2 pb-3 space-y-2" style={{ borderTop: '1px solid var(--border-side)' }}>
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
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>{m.type}</div>
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
          {showAttachMenu && (
            <div ref={attachMenuRef}
              className="absolute bottom-full left-0 mb-1 rounded-md shadow-lg overflow-hidden z-50"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', minWidth: 180 }}>
              <AttachMenuItem icon="🔖" label="Cases, flows & more" onClick={openMentionPicker} />
              <AttachMenuItem icon="🖼" label="Attachment" onClick={handleImageFromFile} />
              <div className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--nav-inactive-color)', borderTop: '1px solid var(--border-side)' }}>
                Tip: paste an image from clipboard
              </div>
            </div>
          )}
          <textarea ref={textareaRef} className="input w-full resize-none text-sm" rows={2}
            placeholder="Message… or @ to mention"
            value={composerText} onChange={handleComposerChange}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              if (e.key === 'Escape') { setShowMentionPicker(false); setShowAttachMenu(false); }
            }} />
        </div>
        <div className="flex items-center gap-2">
          <IconBtn title="Attach" onClick={openAttachPicker}>
            <PlusIcon />
          </IconBtn>
          <style>{`@keyframes mic-pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
          <button
            title={isRecording ? 'Stop dictation' : dictationStatus === 'transcribing' ? 'Transcribing…' : 'Dictate'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={isRecording ? stopDictation : dictationStatus === 'idle' ? startDictation : undefined}
            disabled={dictationStatus === 'transcribing'}
            className="w-6 h-6 flex items-center justify-center rounded-md transition"
            style={{
              background: isRecording ? 'rgba(239,68,68,0.1)' : 'transparent',
              border: isRecording ? '1.5px solid #ef4444' : '1.5px solid transparent',
              cursor: dictationStatus === 'transcribing' ? 'default' : 'pointer',
              color: isRecording ? '#ef4444' : dictationStatus === 'transcribing' ? '#4285F4' : 'var(--nav-inactive-color)',
              animation: isRecording || dictationStatus === 'transcribing' ? 'mic-pulse 1.2s ease-in-out infinite' : undefined,
            }}
            onMouseEnter={(e) => { if (!isRecording && dictationStatus === 'idle') { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; } }}
            onMouseLeave={(e) => { if (!isRecording && dictationStatus === 'idle') { (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
          >
            <MicIcon size={14} />
          </button>
          <button className="btn-primary ml-auto text-xs px-3 py-1" onClick={sendMessage}
            disabled={sending || (!composerText.trim() && pendingMentions.length === 0)}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DM list ──────────────────────────────────────────────────────────────────

// Extra recipient found via email lookup (not necessarily a team member)
interface EmailLookupResult { userId: string; displayName: string; email: string; }

function DMList({ onOpenDM }: { onOpenDM: (ch: DMChannel) => void }) {
  const { currentTeam, currentUser, teamMembers } = useApp();
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
        {loading ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : channels.length === 0 && !showNewDM ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>No DMs yet</div>
        ) : channels.map((ch) => (
          <button key={ch.id} className="w-full text-left px-3 py-2.5 rounded-lg transition"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--ink)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; }}
            onClick={() => onOpenDM(ch)}>
            <div className="text-xs font-semibold truncate">{ch.name ?? dmChannelTitle(ch, currentUser?.id)}</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
              {ch.members.length} member{ch.members.length !== 1 ? 's' : ''}
            </div>
          </button>
        ))}

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

// ─── DM body ──────────────────────────────────────────────────────────────────

function DMBody({ channel, onAddMember }: { channel: DMChannel; onAddMember: () => void }) {
  const { currentUser, currentTeam, teamMembers } = useApp();
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [adding, setAdding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  async function send() {
    if (!composerText.trim() || !currentUser || !currentTeam) return;
    setSending(true); setError('');
    try {
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const res = await window.warroom.chat.sendDMMessage({
        dmChannelId: channel.id, senderId: currentUser.id,
        senderName: currentUser.displayName, content: await encryptText(key, composerText.trim()),
      });
      if (!res.ok) throw new Error(res.error);
      setComposerText('');
    } catch (e: any) {
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

  return (
    <div className="flex flex-col h-full">
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
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
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
                    onDelete={handleDelete} />
                );
              }
              return nodes;
            })
        }
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 pt-2 pb-3 space-y-2" style={{ borderTop: '1px solid var(--border-side)' }}>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <textarea className="input w-full resize-none text-sm" rows={2}
          placeholder="Message…"
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="flex justify-end">
          <button className="btn-primary text-xs px-3 py-1" onClick={send}
            disabled={sending || !composerText.trim()}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DM message bubble ────────────────────────────────────────────────────────

function DMMessageBubble({ message: m, isSelf, onEdit, onDelete }: {
  message: DMMessage; isSelf: boolean;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}) {
  const { flowsIndex, setFlowsIndex, update, setView } = useApp();
  const [hovered, setHovered] = React.useState(false);

  async function importFlow(att: any) {
    // Live flow: join the same realtime doc instead of cloning it.
    if (att.data?.live && att.data?.flowId) {
      const id = att.data.flowId as string;
      const meta: FlowMeta = { id, name: att.name, event: att.data?.event ?? 'policy', live: true, teamId: att.data?.teamId };
      const exists = flowsIndex.some((f) => f.id === id);
      const newIndex = exists ? flowsIndex.map((f) => (f.id === id ? { ...f, ...meta } : f)) : [...flowsIndex, meta];
      setFlowsIndex(newIndex);
      await window.warroom.storage.write('flows_index', newIndex);
      if (!exists) await window.warroom.storage.write(`flow_data_${id}`, att.data ?? {});
      setView({ kind: 'flow', flowId: id });
      return;
    }
    const newId = crypto.randomUUID();
    const meta: FlowMeta = { id: newId, name: att.name, event: att.data?.event ?? 'policy' };
    const newIndex = [...flowsIndex, meta];
    setFlowsIndex(newIndex);
    await window.warroom.storage.write('flows_index', newIndex);
    await window.warroom.storage.write(`flow_data_${newId}`, att.data ?? {});
    setView({ kind: 'flow', flowId: newId });
  }

  async function viewSpeechDoc(att: any) {
    if (!att.data?.base64 || !att.data?.filename) return;
    const res = await window.warroom.fs.writeTempFile(att.data.base64, att.data.filename);
    if (res?.ok && res.path) setView({ kind: 'speech-doc', docPath: res.path } as any);
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
      className={`flex flex-col gap-1 ${isSelf ? 'items-end' : 'items-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sender name (others only) */}
      {!isSelf && (
        <span className="text-[11px] font-semibold px-0.5" style={{ color: 'var(--nav-active-color)' }}>{m.sender_name}</span>
      )}

      {/* Bubble */}
      <div className="w-fit max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed"
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
      <div className={`flex items-center h-5 gap-1 px-0.5 ${isSelf ? 'justify-end' : 'justify-start'}`}>
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
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 h-px" style={{ background: 'var(--border-side)' }} />
      <span
        className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
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

function AttachMenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-xs transition"
      style={{ color: 'var(--ink)', background: 'transparent' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      onClick={onClick}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
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

function PlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
function DMIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 9h8M8 13h5" /><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" /></svg>;
}
function SettingsIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}
function SignOutIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
}
function CloseIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}
function DMPencilIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
function DMTrashIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>;
}

