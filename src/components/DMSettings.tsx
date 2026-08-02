import React, { useState } from 'react';
import { useApp } from '../store/appStore';
import { DMChannel } from '../types';
import NotifLevelPicker from './NotifLevelPicker';

interface Props {
  channel: DMChannel;
  onClose: () => void;
  onLeft: () => void;
}

export default function DMSettings({ channel, onClose, onLeft }: Props) {
  const { currentUser } = useApp();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  async function handleLeave() {
    if (!currentUser) return;
    setLeaving(true);
    const res = await window.warroom.chat.leaveDM(channel.id, currentUser.id);
    if (res.ok) onLeft();
    else { setError(res.error ?? 'Failed to leave'); setLeaving(false); }
  }

  const isGroup = channel.members.length > 2;

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: 'var(--bg-main)' }}>
      <div className="glass-titlebar h-10 flex items-center gap-2 px-3 shrink-0" style={{ borderBottom: '1px solid var(--border-side)' }}>
        <button onClick={onClose} className="text-xs mr-1" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}>←</button>
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--ink)' }}>{isGroup ? 'Group DM settings' : 'DM settings'}</span>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">
        <div>
          <div className="label mb-2">Members ({channel.members.length})</div>
          <div className="space-y-1.5">
            {channel.members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--nav-hover-bg)', color: 'var(--nav-active-color)' }}>
                  {m.display_name[0]?.toUpperCase()}
                </div>
                <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                  {m.display_name}
                  {m.user_id === currentUser?.id && <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--nav-inactive-color)' }}>(you)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <NotifLevelPicker chatId={channel.id} />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'transparent', border: '1px solid #b3261e', color: '#b3261e', cursor: leaving ? 'default' : 'pointer' }}
          onClick={handleLeave}
          disabled={leaving}
        >
          {leaving ? 'Leaving…' : isGroup ? 'Leave group DM' : 'Leave conversation'}
        </button>
      </div>
    </div>
  );
}
