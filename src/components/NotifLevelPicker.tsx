import React, { useState } from 'react';
import { ChatNotifLevel, getChatNotifLevel, setChatNotifLevel } from '../lib/chatPrefs';

const OPTIONS: { value: ChatNotifLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'All messages', hint: 'Notify for every new message here' },
  { value: 'mentions', label: 'Mentions & replies', hint: 'Only when you’re @mentioned or replied to' },
  { value: 'none', label: 'Nothing', hint: 'No desktop notifications from this chat' },
];

// Per-chat desktop notification level, shared by RoomSettings.tsx (chatId
// 'team') and DMSettings.tsx (chatId = the dm_channel_id). Local-only
// preference — see chatPrefs.ts.
export default function NotifLevelPicker({ chatId }: { chatId: string }) {
  const [level, setLevel] = useState<ChatNotifLevel>(getChatNotifLevel(chatId));

  return (
    <div>
      <div className="label mb-2">Notifications</div>
      <div className="space-y-1.5">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer"
            style={{ background: level === o.value ? 'var(--nav-hover-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
            <input
              type="radio"
              className="mt-0.5"
              checked={level === o.value}
              onChange={() => { setChatNotifLevel(chatId, o.value); setLevel(o.value); }}
            />
            <div>
              <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{o.label}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>{o.hint}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
