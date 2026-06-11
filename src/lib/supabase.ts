// All Supabase calls go through the Electron main process via IPC.
// The main process has no CSP restrictions and handles auth persistence.

export async function signIn(email: string, password: string) {
  const res = await window.warroom.chat.signIn(email, password);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export async function signUp(email: string, password: string, displayName: string) {
  const res = await window.warroom.chat.signUp(email, password, displayName);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export async function signOut() {
  await window.warroom.chat.signOut();
}
