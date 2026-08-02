// Chat-panel display prefs (Files bar style) and Quick Chat pins — both
// localStorage-backed, both need adding to SETTINGS_LOCALSTORAGE_KEYS in
// src/utils/settingsExport.ts when introduced (done alongside this file).

import { isShortcutDisabled, getEffectiveBinding, DEFAULT_BINDINGS, type KeyBinding } from './shortcutPrefs';
import type { AvatarSpec } from '../components/Avatar';

const CHANGE_EVENT = 'warroom-chat-prefs-change';
function notify() { window.dispatchEvent(new Event(CHANGE_EVENT)); }
export function onChatPrefsChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

// ─── Files bar style (team rooms only — DMs have no Files list) ───────────────

export type FilesBarStyle = 'split' | 'icon';

export function getFilesBarStyle(): FilesBarStyle {
  try { return (localStorage.getItem('warroom-files-bar-style') as FilesBarStyle) || 'split'; } catch { return 'split'; }
}
export function setFilesBarStyle(v: FilesBarStyle) {
  try { localStorage.setItem('warroom-files-bar-style', v); } catch {}
  notify();
}

// ─── Quick chat pins ────────────────────────────────────────────────────────

export interface QuickChatPin {
  id: string;               // stable pin id — 'team' for the team room, else the dm_channel_id
  kind: 'team' | 'dm';
  name: string;              // display name at pin time (team name / dm title)
  memberIds?: string[];      // dm/group only — for the avatar
  memberNames?: string[];
  shortcutId?: string;       // e.g. `quickchat-<id>` — only set once a shortcut is assigned
}

export function isQuickChatEnabled(): boolean {
  try { return localStorage.getItem('warroom-quick-chat-enabled') === '1'; } catch { return false; }
}
export function setQuickChatEnabled(v: boolean) {
  try { localStorage.setItem('warroom-quick-chat-enabled', v ? '1' : '0'); } catch {}
  notify();
}

export function getQuickChatPins(): QuickChatPin[] {
  try { return JSON.parse(localStorage.getItem('warroom-quick-chat-pins') ?? '[]'); } catch { return []; }
}
export function setQuickChatPins(pins: QuickChatPin[]) {
  try { localStorage.setItem('warroom-quick-chat-pins', JSON.stringify(pins)); } catch {}
  notify();
}

function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.key.toLowerCase() === b.key.toLowerCase();
}

// Every rebindable shortcut in the app (see CLAUDE.md: "Keyboard shortcuts
// must not conflict") lives in one of two places — the static app registry
// (shortcutPrefs.ts's DEFAULT_BINDINGS) or another quick-chat pin's binding —
// so a new pin binding has to be checked against both.
export function findQuickChatConflict(excludePinId: string, binding: KeyBinding): { label: string } | null {
  for (const id of Object.keys(DEFAULT_BINDINGS)) {
    if (isShortcutDisabled(id)) continue;
    const b = getEffectiveBinding(id);
    if (b && bindingsEqual(b, binding)) return { label: id };
  }
  for (const pin of getQuickChatPins()) {
    if (pin.id === excludePinId || !pin.shortcutId) continue;
    const custom = readQuickChatBinding(pin.shortcutId);
    if (custom && bindingsEqual(custom, binding)) return { label: `Pin: ${pin.name}` };
  }
  return null;
}

const QC_BINDINGS_KEY = 'warroom-quick-chat-bindings';
function readAllQuickChatBindings(): Record<string, KeyBinding> {
  try { return JSON.parse(localStorage.getItem(QC_BINDINGS_KEY) ?? '{}'); } catch { return {}; }
}
export function readQuickChatBinding(shortcutId: string): KeyBinding | null {
  return readAllQuickChatBindings()[shortcutId] ?? null;
}
export function writeQuickChatBinding(shortcutId: string, binding: KeyBinding) {
  const all = readAllQuickChatBindings();
  all[shortcutId] = binding;
  try { localStorage.setItem(QC_BINDINGS_KEY, JSON.stringify(all)); } catch {}
}
export function clearQuickChatBinding(shortcutId: string) {
  const all = readAllQuickChatBindings();
  delete all[shortcutId];
  try { localStorage.setItem(QC_BINDINGS_KEY, JSON.stringify(all)); } catch {}
}

export function specForQuickChatPin(pin: QuickChatPin): AvatarSpec {
  if (pin.kind === 'team') return { kind: 'team', name: pin.name };
  const ids = pin.memberIds ?? [];
  const names = pin.memberNames ?? [];
  if (ids.length > 2) return { kind: 'group', members: ids.map((id, i) => ({ id, name: names[i] ?? '?' })) };
  return { kind: 'dm', id: ids[0] ?? pin.name, name: names[0] ?? pin.name };
}

interface KeyEventLike { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string; }
export function eventMatchesQuickChatBinding(e: KeyEventLike, b: KeyBinding): boolean {
  const mod = e.metaKey || e.ctrlKey;
  return mod === b.mod && e.shiftKey === b.shift && e.altKey === b.alt && e.key.toLowerCase() === b.key.toLowerCase();
}

// ─── Per-chat desktop notification level ───────────────────────────────────────
// 'team' for the team room, else the dm_channel_id — same id scheme as Quick Chat
// pins. Personal display preference, so it's local-only (not synced to Supabase).

export type ChatNotifLevel = 'all' | 'mentions' | 'none';
const NOTIF_LEVELS_KEY = 'warroom-chat-notif-levels';

function readNotifLevels(): Record<string, ChatNotifLevel> {
  try { return JSON.parse(localStorage.getItem(NOTIF_LEVELS_KEY) ?? '{}'); } catch { return {}; }
}
export function getChatNotifLevel(chatId: string): ChatNotifLevel {
  return readNotifLevels()[chatId] ?? 'all';
}
export function setChatNotifLevel(chatId: string, level: ChatNotifLevel) {
  const all = readNotifLevels();
  all[chatId] = level;
  try { localStorage.setItem(NOTIF_LEVELS_KEY, JSON.stringify(all)); } catch {}
  notify();
}

// ─── Presence helpers ───────────────────────────────────────────────────────
// presenceState is one array per connected client (Supabase auto-assigns the
// outer key) — these flatten/query it so components don't need to know that shape.

export interface PresenceEntry { userId: string; displayName: string; typing: string | null }

export function presenceList(state: Record<string, PresenceEntry[]>): PresenceEntry[] {
  return Object.values(state).flat();
}
export function isUserOnline(state: Record<string, PresenceEntry[]>, userId: string): boolean {
  return presenceList(state).some((p) => p.userId === userId);
}
export function typingDisplayNamesFor(state: Record<string, PresenceEntry[]>, scopeKey: string, excludeUserId?: string): string[] {
  return presenceList(state)
    .filter((p) => p.typing === scopeKey && p.userId !== excludeUserId)
    .map((p) => p.displayName);
}
