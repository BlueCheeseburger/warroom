import React, { useEffect, useState } from 'react';
import { useApp } from '../store/appStore';
import { DMChannel, DB } from '../types';
import { getTeamKey, encryptText, encryptAttachmentData } from '../lib/chatCrypto';
import wordIcon from '../assets/word-icon.png';
import excelIcon from '../assets/excel-icon.png';
import sheetsIcon from '../assets/sheets-icon.png';

interface Props {
  type: 'flow' | 'case' | 'block' | 'speech-doc';
  id: string;
  name: string;
  getData: () => Promise<any>;
  onClose: () => void;
  onShared?: () => void;
  // Optional banner shown at the top of the panel (e.g. live-collab explainer).
  collabNote?: string;
  onExportXlsx?: () => Promise<void>;
  onExportDocx?: () => Promise<void>;
  onOpenInExcel?: () => Promise<void>;
  onOpenInSheets?: () => Promise<void>;
  onOpenInWord?: () => void;
}

function dmChannelTitle(ch: DMChannel, myId?: string) {
  return ch.members.filter((m) => m.user_id !== myId).map((m) => m.display_name).join(', ') || ch.name || 'DM';
}

interface EmailRecipient { userId: string; displayName: string; email: string; }

export default function SharePanel({ type, id, name, getData, onClose, onShared, onExportXlsx, onExportDocx, onOpenInExcel, onOpenInSheets, onOpenInWord, collabNote }: Props) {
  const { currentUser, currentTeam, teamMembers, defaultSharePermission, flowsIndex, setFlowsIndex, update, setView } = useApp();
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [shareToRoom, setShareToRoom] = useState(false);
  const [permission, setPermission] = useState<'edit' | 'view'>(defaultSharePermission);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportDocxDone, setExportDocxDone] = useState(false);
  const [openingExcel, setOpeningExcel] = useState(false);
  const [openingSheets, setOpeningSheets] = useState(false);
  const [sheetsConnected, setSheetsConnected] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Email lookup for non-team recipients
  const [emailInput, setEmailInput] = useState('');
  const [emailLooking, setEmailLooking] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailRecipients, setEmailRecipients] = useState<EmailRecipient[]>([]);

  useEffect(() => {
    if (!currentTeam) { setLoading(false); return; }
    window.warroom.chat.getDMChannels(currentTeam.id).then((res) => {
      if (res.ok) setDmChannels(res.data as DMChannel[]);
      setLoading(false);
    });
  }, [currentTeam?.id]);

  useEffect(() => {
    if (!onOpenInSheets) return;
    window.warroom.gdrive.status().then((res) => setSheetsConnected(res.connected));
  }, [!!onOpenInSheets]); // eslint-disable-line react-hooks/exhaustive-deps

  const otherMembers = teamMembers.filter((m) => m.user_id !== currentUser?.id);

  function toggleMember(uid: string) {
    setSelectedMembers((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  }

  async function lookupEmail() {
    const email = emailInput.trim();
    if (!email) return;
    setEmailLooking(true); setEmailError('');
    const res = await window.warroom.chat.lookupUserByEmail(email);
    setEmailLooking(false);
    if (!res.ok) { setEmailError('Lookup failed: ' + res.error); return; }
    if (!res.data) { setEmailError('No Warroom account with that email.'); return; }
    const { userId, displayName } = res.data;
    // Skip if already a listed team member
    if (teamMembers.some((m) => m.user_id === userId)) {
      setEmailError('That person is already in your team.');
      setEmailInput(''); return;
    }
    if (!emailRecipients.find((r) => r.userId === userId)) {
      setEmailRecipients((prev) => [...prev, { userId, displayName, email }]);
    }
    setSelectedMembers((prev) => prev.includes(userId) ? prev : [...prev, userId]);
    setEmailInput('');
  }

  async function handleShare() {
    if (!currentUser || !currentTeam) return;
    const allSelected = [...selectedMembers];
    if (allSelected.length === 0 && !shareToRoom) { setError('Select at least one recipient.'); return; }
    setSharing(true); setError('');

    try {
      const data = await getData();
      // Encrypt content + attachment data with the team key before anything is sent.
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const attachment = { type, name, data: await encryptAttachmentData(key, data ?? {}), permission };
      const sharedContent = await encryptText(key, `Shared "${name}"`);

      // Combine team members + email-looked-up recipients
      const recipientList: { userId: string; displayName: string }[] = [
        ...teamMembers.filter((m) => allSelected.includes(m.user_id))
          .map((m) => ({ userId: m.user_id, displayName: m.display_name })),
        ...emailRecipients.filter((r) => allSelected.includes(r.userId))
          .map((r) => ({ userId: r.userId, displayName: r.displayName })),
      ];

      // Share to each recipient via DM
      for (const recip of recipientList) {
        // Find existing 1:1 DM
        let channel = dmChannels.find(
          (ch) => ch.name === null &&
            ch.members.length === 2 &&
            ch.members.some((m) => m.user_id === recip.userId) &&
            ch.members.some((m) => m.user_id === currentUser.id)
        );

        if (!channel) {
          const res = await window.warroom.chat.createDM(currentTeam.id, [
            { userId: currentUser.id, displayName: currentUser.displayName },
            { userId: recip.userId, displayName: recip.displayName },
          ]);
          if (!res.ok) throw new Error(res.error ?? 'Failed to create DM');
          channel = res.data as DMChannel;
          setDmChannels((prev) => [channel!, ...prev]);
        }

        await window.warroom.chat.sendDMMessage({
          dmChannelId: channel.id,
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          content: sharedContent,
          attachments: [attachment],
        });
      }

      // Share to team room
      if (shareToRoom) {
        await window.warroom.chat.sendMessage({
          teamId: currentTeam.id,
          senderId: currentUser.id,
          senderName: currentUser.displayName,
          content: sharedContent,
          attachments: [attachment],
        });
      }

      // Mark as shared in sidebar
      if (type === 'flow') {
        const newIndex = flowsIndex.map((f) => f.id === id ? { ...f, shared: true } : f);
        setFlowsIndex(newIndex);
        window.warroom.storage.write('flows_index', newIndex);
      } else if (type === 'case') {
        await update((db: DB) => ({
          ...db,
          cases: { ...db.cases, [id]: { ...db.cases[id], shared: true } },
        }));
      }

      setDone(true);
      onShared?.();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to share');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-xl w-80 max-h-[80vh] flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-main)', border: '1px solid var(--border-side)' }}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--border-side)' }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Share</div>
            <div className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: 'var(--nav-inactive-color)' }}>{name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)', fontSize: 18 }}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-4">

          {collabNote && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-lg text-[11px] leading-snug"
              style={{ background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)' }}
            >
              <span className="relative flex h-2 w-2 shrink-0 mt-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: '#16a34a' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#16a34a' }} />
              </span>
              <span>{collabNote}</span>
            </div>
          )}

          {/* ── Open & Export section ── */}
          {(onOpenInWord || onExportDocx || onOpenInExcel || onOpenInSheets || onExportXlsx) && (
            <div>
              <div className="label mb-2">Open &amp; Export</div>
              <div className="space-y-1.5">

                {/* Open in Word */}
                {onOpenInWord && (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                    <img src={wordIcon} alt="Word" width={20} height={20} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Open in Word</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>Edit in Microsoft Word</div>
                    </div>
                    <button className="btn text-xs px-3 py-1 shrink-0" onClick={onOpenInWord}>Open</button>
                  </div>
                )}

                {/* Save as .docx */}
                {onExportDocx && (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                    <div className="shrink-0 w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded"
                      style={{ background: 'var(--mode-toggle-bg)', color: 'var(--nav-inactive-color)' }}>
                      W
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Save as .docx</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>Download as Word document</div>
                    </div>
                    <button
                      className="btn text-xs px-3 py-1 shrink-0"
                      disabled={exportingDocx}
                      onClick={async () => {
                        setExportingDocx(true); setExportDocxDone(false);
                        try {
                          await onExportDocx();
                          setExportDocxDone(true);
                          setTimeout(() => setExportDocxDone(false), 2000);
                        } finally { setExportingDocx(false); }
                      }}
                    >
                      {exportingDocx ? '…' : exportDocxDone ? '✓ Saved' : 'Save'}
                    </button>
                  </div>
                )}

                {/* Open in Excel */}
                {onOpenInExcel && (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                    <img src={excelIcon} alt="Excel" width={20} height={20} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Open in Excel</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>All sheets, live in Excel</div>
                    </div>
                    <button
                      className="btn text-xs px-3 py-1 shrink-0"
                      disabled={openingExcel}
                      onClick={async () => {
                        setOpeningExcel(true);
                        try { await onOpenInExcel(); } finally { setOpeningExcel(false); }
                      }}
                    >
                      {openingExcel ? '…' : 'Open'}
                    </button>
                  </div>
                )}

                {/* Open in Google Sheets */}
                {onOpenInSheets && (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                    <img src={sheetsIcon} alt="Google Sheets" width={20} height={20} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Open in Google Sheets</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>
                        {sheetsConnected === false ? 'Google Drive not connected' : 'Uploads and opens in browser'}
                      </div>
                    </div>
                    {sheetsConnected === false ? (
                      <button
                        className="btn text-xs px-2 py-1 shrink-0"
                        onClick={() => { setView({ kind: 'settings', scrollTo: 'gdrive' }); onClose(); }}
                      >
                        Set up →
                      </button>
                    ) : (
                      <button
                        className="btn text-xs px-3 py-1 shrink-0"
                        disabled={openingSheets || sheetsConnected === null}
                        onClick={async () => {
                          setOpeningSheets(true);
                          try { await onOpenInSheets(); } finally { setOpeningSheets(false); }
                        }}
                      >
                        {openingSheets ? '…' : sheetsConnected === null ? '…' : 'Open'}
                      </button>
                    )}
                  </div>
                )}

                {/* Save as .xlsx */}
                {onExportXlsx && (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                    <div className="shrink-0 w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded"
                      style={{ background: 'var(--mode-toggle-bg)', color: 'var(--nav-inactive-color)' }}>
                      X
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Save as .xlsx</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>Download all sheets as a file</div>
                    </div>
                    <button
                      className="btn text-xs px-3 py-1 shrink-0"
                      disabled={exporting}
                      onClick={async () => {
                        setExporting(true); setExportDone(false);
                        try {
                          await onExportXlsx();
                          setExportDone(true);
                          setTimeout(() => setExportDone(false), 2000);
                        } finally { setExporting(false); }
                      }}
                    >
                      {exporting ? '…' : exportDone ? '✓ Saved' : 'Save'}
                    </button>
                  </div>
                )}

              </div>
            </div>
          )}

          {done ? (
            <div className="text-center py-4 text-sm font-medium" style={{ color: '#059669' }}>
              ✓ Shared successfully
            </div>
          ) : loading ? (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
          ) : !currentUser || !currentTeam ? (
            <div className="text-xs py-4 text-center" style={{ color: 'var(--nav-inactive-color)' }}>Sign in to share</div>
          ) : (
            <>
              {/* Permission */}
              <div>
                <div className="label mb-2">Permission</div>
                <div className="flex rounded-lg p-0.5 w-fit" style={{ background: 'var(--mode-toggle-bg)' }}>
                  {(['edit', 'view'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPermission(p)}
                      className="px-3 py-1 text-xs rounded-md transition-all capitalize"
                      style={permission === p
                        ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', fontWeight: 600 }
                        : { background: 'transparent', color: 'var(--nav-inactive-color)' }}
                    >
                      {p === 'edit' ? 'Can edit' : 'Can view'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipients */}
              <div>
                <div className="label mb-2">Send to</div>
                <div className="space-y-1.5">
                  {/* Team room */}
                  <label
                    className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer"
                    style={{ background: shareToRoom ? 'var(--nav-active-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)' }}
                  >
                    <input type="checkbox" checked={shareToRoom} onChange={(e) => setShareToRoom(e.target.checked)} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{currentTeam.name}</div>
                      <div className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>Team room</div>
                    </div>
                  </label>

                  {/* Individual team members */}
                  {otherMembers.map((m) => {
                    const checked = selectedMembers.includes(m.user_id);
                    const existingDM = dmChannels.find(
                      (ch) => ch.name === null &&
                        ch.members.length === 2 &&
                        ch.members.some((mm) => mm.user_id === m.user_id) &&
                        ch.members.some((mm) => mm.user_id === currentUser.id)
                    );
                    return (
                      <label
                        key={m.user_id}
                        className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer"
                        style={{ background: checked ? 'var(--nav-active-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)' }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(m.user_id)} className="shrink-0" />
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: 'var(--nav-hover-bg)', color: 'var(--nav-active-color)' }}>
                          {m.display_name[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{m.display_name}</div>
                          <div className="text-[10px] capitalize" style={{ color: 'var(--nav-inactive-color)' }}>
                            {existingDM ? 'via DM' : 'new DM'}
                          </div>
                        </div>
                      </label>
                    );
                  })}

                  {/* Email-looked-up recipients */}
                  {emailRecipients.map((r) => {
                    const checked = selectedMembers.includes(r.userId);
                    return (
                      <label
                        key={r.userId}
                        className="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer"
                        style={{ background: checked ? 'var(--nav-active-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)' }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(r.userId)} className="shrink-0" />
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ background: 'var(--nav-hover-bg)', color: 'var(--nav-active-color)' }}>
                          {r.displayName[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{r.displayName}</div>
                          <div className="text-[10px] truncate" style={{ color: 'var(--nav-inactive-color)' }}>{r.email}</div>
                        </div>
                        <button
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                          style={{ color: 'var(--nav-inactive-color)', background: 'transparent' }}
                          onClick={(e) => {
                            e.preventDefault();
                            setEmailRecipients((prev) => prev.filter((x) => x.userId !== r.userId));
                            setSelectedMembers((prev) => prev.filter((x) => x !== r.userId));
                          }}
                          title="Remove"
                        >✕</button>
                      </label>
                    );
                  })}

                  {/* Add by email */}
                  <div className="pt-1">
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
                      <button
                        className="btn text-xs px-2 py-1 shrink-0"
                        onClick={lookupEmail}
                        disabled={emailLooking || !emailInput.trim()}
                      >
                        {emailLooking ? '…' : 'Add'}
                      </button>
                    </div>
                    {emailError && (
                      <p className="text-[10px] mt-1" style={{ color: '#ef4444' }}>{emailError}</p>
                    )}
                  </div>
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}
            </>
          )}
        </div>

        {!done && currentUser && currentTeam && (
          <div className="px-4 pb-4 pt-3 shrink-0" style={{ borderTop: '1px solid var(--border-side)' }}>
            <button
              className="btn-primary w-full text-xs py-2"
              onClick={handleShare}
              disabled={sharing || (selectedMembers.length === 0 && !shareToRoom)}
            >
              {sharing ? 'Sharing…' : 'Share'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
