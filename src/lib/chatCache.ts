// Local-only "instant open" cache for chat message lists — decrypted messages
// for the last few chats the user has opened, so reopening one of them shows
// something immediately instead of a blank "Loading messages…" while the
// Supabase round trip + decrypt runs. Never synced; same trust tier as any
// other local userData file (team_file_watches.json, flows_index, etc).
//
// The real fetch always still runs and replaces whatever was cached — this is
// a "show something now, reconcile shortly after" cache, not a source of truth.

const INDEX_KEY = 'chat_cache_index';
const MAX_CHATS = 5;
const MAX_MESSAGES = 50;

interface CacheIndexEntry { chatId: string; lastOpened: string; }

function cacheKey(chatId: string): string {
  return `chat_cache_${chatId}`;
}

async function readIndex(): Promise<CacheIndexEntry[]> {
  try {
    const idx = await window.warroom.storage.read(INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  } catch { return []; }
}

export async function getCachedMessages<T>(chatId: string): Promise<T[] | null> {
  try {
    const data = await window.warroom.storage.read(cacheKey(chatId));
    return Array.isArray(data) && data.length > 0 ? (data as T[]) : null;
  } catch { return null; }
}

// Called after every successful real fetch (full replace) and on every
// realtime-delivered message (incremental) — bumps this chat to
// most-recently-opened and evicts the oldest beyond MAX_CHATS.
export async function setCachedMessages(chatId: string, messages: any[]): Promise<void> {
  try {
    await window.warroom.storage.write(cacheKey(chatId), messages.slice(-MAX_MESSAGES));
    const idx = await readIndex();
    const next = [{ chatId, lastOpened: new Date().toISOString() }, ...idx.filter((e) => e.chatId !== chatId)];
    const kept = next.slice(0, MAX_CHATS);
    const evicted = next.slice(MAX_CHATS);
    await window.warroom.storage.write(INDEX_KEY, kept);
    for (const e of evicted) { try { await window.warroom.storage.write(cacheKey(e.chatId), null); } catch {} }
  } catch {}
}
