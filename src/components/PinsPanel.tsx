import React, { useEffect, useState } from 'react';
import { useApp } from '../store/appStore';
import { PinnedMessage } from '../types';
import { getTeamKey, decryptText } from '../lib/chatCrypto';

interface DecryptedPin extends Omit<PinnedMessage, 'sender_name' | 'content'> {
  sender_name: string;
  content: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Shared pin board for a team room or a DM/group DM — scope is exactly one of
// teamId/dmChannelId, matching pinned_messages' constraint. Content is a
// snapshot encrypted the same way as a reply-to quote, so a pin survives the
// original message being edited or deleted.
export default function PinsPanel({ teamId, dmChannelId, onJumpTo }: { teamId?: string; dmChannelId?: string; onJumpTo: (messageId: string) => void }) {
  const { currentTeam } = useApp();
  const [pins, setPins] = useState<DecryptedPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const scope = teamId ? { teamId } : { dmChannelId };

  useEffect(() => {
    if (!currentTeam) return;
    load();
    window.warroom.pins.subscribe(scope);
    const off = window.warroom.pins.onChange(async (p) => {
      if (!currentTeam) return;
      if (p.eventType === 'DELETE') {
        setPins((prev) => prev.filter((x) => x.id !== p.row.id));
        return;
      }
      try {
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const decrypted: DecryptedPin = {
          ...p.row, sender_name: await decryptText(key, p.row.sender_name), content: await decryptText(key, p.row.content),
        };
        setPins((prev) => {
          const idx = prev.findIndex((x) => x.id === decrypted.id);
          const next = idx === -1 ? [decrypted, ...prev] : prev.map((x, i) => (i === idx ? decrypted : x));
          return [...next].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
      } catch {}
    });
    return () => { off(); window.warroom.pins.unsubscribe(scope); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTeam?.id, teamId, dmChannelId]);

  async function load() {
    if (!currentTeam) return;
    setLoading(true);
    const res = await window.warroom.pins.getAll(scope);
    if (res.ok) {
      try {
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const decrypted = await Promise.all((res.data as PinnedMessage[]).map(async (p) => ({
          ...p, sender_name: await decryptText(key, p.sender_name), content: await decryptText(key, p.content),
        })));
        setPins(decrypted);
      } catch { setPins([]); }
    } else {
      setError(res.error ?? 'Failed to load pins');
    }
    setLoading(false);
  }

  async function handleUnpin(pin: DecryptedPin) {
    setUnpinningId(pin.id);
    const res = await window.warroom.pins.unpin(pin.id);
    if (res.ok) setPins((prev) => prev.filter((p) => p.id !== pin.id));
    else setError(res.error ?? 'Failed to unpin');
    setUnpinningId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-2">
        {error && <p className="text-xs pb-1" style={{ color: '#ef4444' }}>{error}</p>}
        {loading ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : pins.length === 0 ? (
          <div className="text-xs text-center pt-6 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No pinned messages yet.<br />Hover a message and click the pin icon to add one here.
          </div>
        ) : pins.map((p) => (
          <div key={p.id} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{p.sender_name}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{timeAgo(p.created_at)}</span>
            </div>
            <p className="text-xs mt-1 whitespace-pre-wrap break-words" style={{ color: 'var(--ink)' }}>{p.content}</p>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>Pinned by {p.pinned_by_name}</span>
              <div className="flex items-center gap-2">
                {p.message_id && (
                  <button className="text-[10px]" style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={() => onJumpTo(p.message_id!)}>Jump to message</button>
                )}
                <button className="text-[10px]" style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: unpinningId === p.id ? 'default' : 'pointer' }}
                  onClick={() => handleUnpin(p)} disabled={unpinningId === p.id}>
                  {unpinningId === p.id ? 'Unpinning…' : 'Unpin'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
