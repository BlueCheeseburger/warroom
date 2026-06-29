import React, { useEffect, useState } from 'react';
import { useApp } from '../store/appStore';
import { ChatMember } from '../types';

interface Props {
  onClose: () => void;
}

export default function RoomSettings({ onClose }: Props) {
  const { currentTeam, currentUser, setCurrentTeam, setTeamMembers } = useApp();
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(currentTeam?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isOwner = currentUser?.id === currentTeam?.owner_id;
  const noOwner = currentTeam?.owner_id === null || currentTeam?.owner_id === undefined;
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!currentTeam) return;
    window.warroom.chat.getMembers(currentTeam.id).then((res) => {
      if (res.ok) {
        setMembers(res.data as ChatMember[]);
        setTeamMembers(res.data as ChatMember[]);
      }
      setLoading(false);
    });
  }, [currentTeam?.id]);

  async function handleRename() {
    if (!currentTeam || !nameValue.trim()) return;
    setSaving(true); setError('');
    const res = await window.warroom.chat.renameTeam(currentTeam.id, nameValue.trim());
    if (res.ok) {
      setCurrentTeam(res.data as any);
      setRenaming(false);
    } else {
      setError(res.error ?? 'Failed to rename');
    }
    setSaving(false);
  }

  async function handleClaimOwnership() {
    if (!currentTeam) return;
    setClaiming(true);
    const res = await window.warroom.chat.claimOwnership(currentTeam.id);
    if (res.ok) setCurrentTeam(res.data as any);
    else setError(res.error ?? 'Failed to claim ownership');
    setClaiming(false);
  }

  async function handleKick(userId: string) {
    if (!currentTeam) return;
    const res = await window.warroom.chat.kickMember(currentTeam.id, userId);
    if (res.ok) {
      const next = members.filter((m) => m.user_id !== userId);
      setMembers(next);
      setTeamMembers(next);
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: 'var(--bg-main)' }}>
      {/* Header */}
      <div className="glass-titlebar h-10 flex items-center gap-2 px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-side)' }}>
        <button onClick={onClose} className="text-xs mr-1" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}>
          ←
        </button>
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--ink)' }}>Room Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">
        {/* Room name */}
        <div>
          <div className="label mb-2">Room Name</div>
          {renaming ? (
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                autoFocus
              />
              <button className="btn text-xs px-2" onClick={handleRename} disabled={saving}>
                {saving ? '…' : 'Save'}
              </button>
              <button className="btn text-xs px-2" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{currentTeam?.name}</span>
              {isOwner && (
                <button className="btn text-xs px-2 py-0.5" onClick={() => setRenaming(true)}>Rename</button>
              )}
              {!isOwner && !noOwner && (
                <span className="text-xs" style={{ color: 'var(--nav-inactive-color)' }}>(only owner can rename)</span>
              )}
              {noOwner && (
                <button className="btn text-xs px-2 py-0.5" onClick={handleClaimOwnership} disabled={claiming}>
                  {claiming ? '…' : 'Claim ownership'}
                </button>
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>

        {/* Members */}
        <div>
          <div className="label mb-2">Members ({members.length})</div>
          {loading ? (
            <div className="text-xs" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: 'var(--nav-hover-bg)', color: 'var(--nav-active-color)' }}>
                    {m.display_name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>
                      {m.display_name}
                      {m.user_id === currentUser?.id && (
                        <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--nav-inactive-color)' }}>(you)</span>
                      )}
                      {m.user_id === currentTeam?.owner_id && (
                        <span className="ml-1 text-[10px] font-normal" style={{ color: '#0077ed' }}>owner</span>
                      )}
                    </div>
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>{m.role}</div>
                  </div>
                  {isOwner && m.user_id !== currentUser?.id && (
                    <button
                      className="text-[10px] px-2 py-0.5 rounded"
                      style={{ background: 'transparent', border: '1px solid var(--border-side)', color: '#b3261e', cursor: 'pointer' }}
                      onClick={() => handleKick(m.user_id)}
                    >
                      Kick
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite code */}
        <div>
          <div className="label mb-2">Invite Code</div>
          <div className="text-sm font-mono px-3 py-2 rounded-lg select-all"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--ink)' }}>
            {currentTeam?.invite_code}
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--nav-inactive-color)' }}>
            Share this code so teammates can join with "Join team"
          </p>
        </div>
      </div>
    </div>
  );
}
