import React, { useEffect, useState } from 'react';
import { useApp } from '../store/appStore';
import { DMChannel } from '../types';
import { ChatAvatar, AvatarSpec } from './Avatar';
import { GROUPS } from './ShortcutsOverlay';
import {
  QuickChatPin, getQuickChatPins, setQuickChatPins, specForQuickChatPin,
  readQuickChatBinding, writeQuickChatBinding, clearQuickChatBinding, findQuickChatConflict,
} from '../lib/chatPrefs';
import { bindingFromEvent, isBindingValid, formatBinding, KeyBinding } from '../lib/shortcutPrefs';

const isMac = window.warroom?.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

function conflictLabel(id: string): string {
  if (id.startsWith('Pin: ')) return id;
  return GROUPS.flatMap((g) => g.shortcuts).find((s) => s.id === id)?.label ?? id;
}

export default function QuickChatPicker({ onClose }: { onClose: () => void }) {
  const { currentTeam, currentUser } = useApp();
  const [channels, setChannels] = useState<DMChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ pinId: string; binding: KeyBinding; withId: string } | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const existing = getQuickChatPins();
    const map: Record<string, boolean> = {};
    existing.forEach((p) => { map[p.id] = true; });
    setSelected(map);
    if (!currentTeam) { setLoading(false); return; }
    window.warroom.chat.getDMChannels(currentTeam.id).then((res) => {
      if (res.ok) setChannels(res.data as DMChannel[]);
      setLoading(false);
    });
  }, [currentTeam?.id]);

  useEffect(() => {
    if (!recordingId) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecordingId(null); return; }
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
      const binding = bindingFromEvent(e);
      if (!isBindingValid(binding)) return;
      const shortcutId = `quickchat-${recordingId}`;
      const clash = findQuickChatConflict(recordingId!, binding);
      if (clash) { setConflict({ pinId: recordingId!, binding, withId: clash.label }); setRecordingId(null); return; }
      writeQuickChatBinding(shortcutId, binding);
      setRecordingId(null);
      bump((t) => t + 1);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recordingId]);

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function save() {
    const pins: QuickChatPin[] = [];
    if (selected['team'] && currentTeam) {
      const shortcutId = readQuickChatBinding('quickchat-team') ? 'quickchat-team' : undefined;
      pins.push({ id: 'team', kind: 'team', name: currentTeam.name, shortcutId });
    }
    channels.forEach((ch) => {
      if (!selected[ch.id]) return;
      const shortcutId = readQuickChatBinding(`quickchat-${ch.id}`) ? `quickchat-${ch.id}` : undefined;
      const others = ch.members.filter((m) => m.user_id !== currentUser?.id);
      const name = ch.name ?? (others.length ? others.map((m) => m.display_name).join(', ') : ch.members[0]?.display_name ?? 'DM');
      pins.push({
        id: ch.id, kind: 'dm', name, shortcutId,
        memberIds: ch.members.map((m) => m.user_id),
        memberNames: ch.members.map((m) => m.display_name),
      });
    });
    setQuickChatPins(pins);
    onClose();
  }

  function resolveConflictBy(choice: 'rebind-existing' | 'pick-different') {
    if (!conflict) return;
    if (choice === 'pick-different') { setConflict(null); setRecordingId(conflict.pinId); return; }
    // "rebind existing" — only fully resolvable inline when the clash is with
    // another quick-chat pin (both live in our own registry); a clash with a
    // core app shortcut sends the user to the full Shortcuts overlay instead,
    // since re-recording an arbitrary core shortcut needs that overlay's own
    // recording UI.
    if (conflict.withId.startsWith('Pin: ')) {
      const otherName = conflict.withId.slice('Pin: '.length);
      const pins = getQuickChatPins();
      const other = pins.find((p) => p.name === otherName);
      if (other?.shortcutId) clearQuickChatBinding(other.shortcutId);
      writeQuickChatBinding(`quickchat-${conflict.pinId}`, conflict.binding);
      setConflict(null);
      bump((t) => t + 1);
    } else {
      setConflict(null);
      onClose();
      useApp.getState().setShortcutsOpen(true);
    }
  }

  const allItems: { id: string; kind: 'team' | 'dm'; spec: AvatarSpec; name: string }[] = [];
  if (currentTeam) allItems.push({ id: 'team', kind: 'team', spec: { kind: 'team', name: currentTeam.name }, name: currentTeam.name });
  channels.forEach((ch) => {
    const others = ch.members.filter((m) => m.user_id !== currentUser?.id);
    const name = ch.name ?? (others.length ? others.map((m) => m.display_name).join(', ') : ch.members[0]?.display_name ?? 'DM');
    const spec = specForQuickChatPin({
      id: ch.id, kind: 'dm', name,
      memberIds: ch.members.map((m) => m.user_id),
      memberNames: ch.members.map((m) => m.display_name),
    });
    allItems.push({ id: ch.id, kind: 'dm', spec, name });
  });

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="rounded-xl p-4 flex flex-col gap-3" style={{ width: 380, maxHeight: '80vh', background: 'var(--bg-elevated)', border: '1px solid var(--border-med)', boxShadow: '0 8px 40px rgba(0,0,0,0.28)' }}
        onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Pin to top bar</div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>Choose rooms and DMs, and set an optional shortcut.</p>
        </div>

        {conflict && (
          <div className="rounded-lg p-2.5 text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
            <div style={{ color: 'var(--ink)' }}>
              <strong>{formatBinding(conflict.binding, MOD)}</strong> is already used by <strong>{conflictLabel(conflict.withId)}</strong>.
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn text-[11px] px-2 py-1" onClick={() => resolveConflictBy('pick-different')}>Pick a different key</button>
              <button className="btn-primary text-[11px] px-2 py-1" onClick={() => resolveConflictBy('rebind-existing')}>
                {conflict.withId.startsWith('Pin: ') ? 'Use it here instead' : "Open Shortcuts to rebind"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin space-y-1" style={{ maxHeight: 320 }}>
          {loading ? (
            <div className="text-xs text-center py-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
          ) : allItems.length === 0 ? (
            <div className="text-xs text-center py-6" style={{ color: 'var(--nav-inactive-color)' }}>Nothing to pin yet.</div>
          ) : allItems.map((item) => {
            const shortcutId = `quickchat-${item.id}`;
            const binding = readQuickChatBinding(shortcutId);
            const recording = recordingId === item.id;
            return (
              <div key={item.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg" style={{ background: selected[item.id] ? 'var(--nav-hover-bg)' : 'transparent' }}>
                <input type="checkbox" checked={!!selected[item.id]} onChange={() => toggle(item.id)} />
                <ChatAvatar spec={item.spec} size={26} />
                <span className="flex-1 text-xs truncate" style={{ color: 'var(--ink)' }}>{item.name}</span>
                {recording ? (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ border: '1px dashed var(--accent)', color: 'var(--accent)' }}>Press new keys…</span>
                ) : binding ? (
                  <button
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-med)', color: 'var(--ink)', cursor: 'pointer' }}
                    title="Click to change, or clear below"
                    onClick={() => setRecordingId(item.id)}
                  >
                    {formatBinding(binding, MOD)}
                  </button>
                ) : (
                  <button
                    className="text-[10px]"
                    style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}
                    onClick={() => setRecordingId(item.id)}
                  >
                    + shortcut
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn-primary flex-1 text-xs py-1.5" onClick={save}>Save pins</button>
          <button className="btn text-xs py-1.5 px-3" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
