// flowSync — binds a Y.Doc to the main-process Supabase Realtime broadcast bridge.
//
// Responsibilities:
//   • load the durable snapshot from the `flows` table on join
//   • relay local Yjs updates out over broadcast; apply remote ones in
//   • awareness (who is editing which cell) for live remote cursors
//   • late-join convergence: when a new peer appears, re-broadcast full state so
//     anyone who joined after the last snapshot still ends up consistent
//   • debounced snapshot persistence back to the `flows` table

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { u8ToB64, b64ToU8, REMOTE_ORIGIN } from './flowDoc';

export interface PresenceUser { id: string; name: string; color: string }
export interface RemoteCursor { user: PresenceUser; cell: string | null }

// SUBSCRIBED = actively syncing. CHANNEL_ERROR/TIMED_OUT/CLOSED = not
// currently synced — edits still save locally (this doc keeps working
// offline), they just aren't reaching teammates until it reconnects.
export type FlowSyncStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'CONNECTING';

export interface FlowSyncHandle {
  doc: Y.Doc;
  awareness: Awareness;
  setActiveCell: (cell: string | null) => void;
  onCursors: (cb: (cursors: RemoteCursor[]) => void) => () => void;
  /** Current + future connection status — see FlowSyncStatus. Fires immediately with whatever's known so far. */
  onStatus: (cb: (status: FlowSyncStatus) => void) => () => void;
  saveSnapshotNow: () => void;
  destroy: () => Promise<void>;
}

const SNAPSHOT_DEBOUNCE = 4000;

export async function createFlowSync(
  flowId: string,
  teamId: string,
  flowName: string,
  me: PresenceUser,
): Promise<FlowSyncHandle> {
  const wr = window.warroom.flowSync;
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState({ user: me, cell: null });

  // 1) Hydrate from the durable snapshot before we go live.
  try {
    const snap = await wr.loadSnapshot(flowId);
    if (snap.ok && snap.data?.content) {
      Y.applyUpdate(doc, b64ToU8(snap.data.content), REMOTE_ORIGIN);
    }
  } catch { /* fall through — broadcast convergence will catch us up */ }

  // 2) Subscribe to the broadcast channel.
  const joinRes = await wr.join(flowId);

  // Connection status — fed by main.ts forwarding every transition on the
  // underlying Supabase channel (join.status changes covers the FIRST one;
  // subsequent drops/reconnects arrive via onStatus below).
  let currentStatus: FlowSyncStatus = joinRes?.ok ? 'SUBSCRIBED' : 'CHANNEL_ERROR';
  const statusSubs = new Set<(s: FlowSyncStatus) => void>();
  function emitStatus(s: FlowSyncStatus) {
    currentStatus = s;
    statusSubs.forEach((cb) => cb(s));
  }
  const offStatus = wr.onStatus(({ flowId: fid, status: s }) => {
    if (fid !== flowId) return;
    emitStatus(s as FlowSyncStatus);
  });

  // 3) Local doc edits → broadcast (skip anything we applied from remote).
  const onDocUpdate = (update: Uint8Array, origin: any) => {
    if (origin === REMOTE_ORIGIN) return;
    wr.broadcastUpdate(flowId, u8ToB64(update));
    scheduleSnapshot();
  };
  doc.on('update', onDocUpdate);

  const offRemoteUpdate = wr.onRemoteUpdate(({ flowId: fid, update }) => {
    if (fid !== flowId || !update) return;
    Y.applyUpdate(doc, b64ToU8(update), REMOTE_ORIGIN);
  });

  // 4) Awareness (cursor presence) over the same channel.
  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: any,
  ) => {
    if (origin === REMOTE_ORIGIN) return;
    const changed = added.concat(updated, removed);
    wr.broadcastAwareness(flowId, u8ToB64(encodeAwarenessUpdate(awareness, changed)));
  };
  awareness.on('update', onAwarenessUpdate);

  const offRemoteAwareness = wr.onRemoteAwareness(({ flowId: fid, awareness: aw }) => {
    if (fid !== flowId || !aw) return;
    applyAwarenessUpdate(awareness, b64ToU8(aw), REMOTE_ORIGIN);
  });

  // 5) Presence: track ourselves, and when the peer set grows, re-broadcast full
  //    state + our awareness so late joiners converge even if they missed deltas.
  wr.track(flowId, { id: me.id, name: me.name, color: me.color });
  let lastPeerCount = 0;
  const offPresence = wr.onPresence(({ flowId: fid, state }) => {
    if (fid !== flowId) return;
    const count = state ? Object.keys(state).length : 0;
    if (count > lastPeerCount) {
      // Someone new arrived — push our entire doc so they catch up.
      wr.broadcastUpdate(flowId, u8ToB64(Y.encodeStateAsUpdate(doc)));
      const ids = Array.from(awareness.getStates().keys());
      wr.broadcastAwareness(flowId, u8ToB64(encodeAwarenessUpdate(awareness, ids)));
    }
    lastPeerCount = count;
  });

  // 6) Debounced snapshot persistence.
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSnapshot() {
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(saveSnapshotNow, SNAPSHOT_DEBOUNCE);
  }
  function saveSnapshotNow() {
    if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
    try { wr.saveSnapshot(flowId, flowName, u8ToB64(Y.encodeStateAsUpdate(doc))); } catch { /* best effort */ }
  }

  // 7) Cursor fan-out to the UI.
  const cursorSubs = new Set<(c: RemoteCursor[]) => void>();
  function emitCursors() {
    const out: RemoteCursor[] = [];
    awareness.getStates().forEach((st: any, clientId: number) => {
      if (clientId === doc.clientID) return;          // skip self
      if (!st?.user) return;
      out.push({ user: st.user, cell: st.cell ?? null });
    });
    cursorSubs.forEach((cb) => cb(out));
  }
  awareness.on('change', emitCursors);

  return {
    doc,
    awareness,
    setActiveCell(cell: string | null) {
      awareness.setLocalStateField('cell', cell);
    },
    onCursors(cb) {
      cursorSubs.add(cb);
      cb([]);
      return () => cursorSubs.delete(cb);
    },
    onStatus(cb) {
      statusSubs.add(cb);
      cb(currentStatus);
      return () => statusSubs.delete(cb);
    },
    saveSnapshotNow,
    async destroy() {
      offStatus();
      saveSnapshotNow();
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      awareness.off('change', emitCursors);
      offRemoteUpdate(); offRemoteAwareness(); offPresence();
      removeAwarenessStates(awareness, [doc.clientID], 'local');
      try { await wr.leave(flowId); } catch { /* ignore */ }
      awareness.destroy();
      doc.destroy();
      cursorSubs.clear();
    },
  };
}
