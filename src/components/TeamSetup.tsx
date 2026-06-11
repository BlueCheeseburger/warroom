import React, { useState } from 'react';
import { signIn, signUp } from '../lib/supabase';
import { useApp } from '../store/appStore';
import { ChatUser, ChatTeam } from '../types';

type Step = 'auth' | 'team' | 'forgot';
type AuthMode = 'login' | 'signup';

interface Props {
  onDone: () => void;
}

export default function TeamSetup({ onDone }: Props) {
  const { setCurrentUser, setCurrentTeam } = useApp();
  const [step, setStep] = useState<Step>('auth');
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState<ChatUser | null>(null);

  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetStage, setResetStage] = useState<'email' | 'waiting' | 'newpassword'>('email');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  const [teamMode, setTeamMode] = useState<'create' | 'join'>('create');
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [teamError, setTeamError] = useState('');
  const [teamLoading, setTeamLoading] = useState(false);
  const [role, setRole] = useState<'debater' | 'coach'>('debater');

  async function handleAuth() {
    if (!email.trim() || !password.trim()) return;
    if (authMode === 'signup' && !displayName.trim()) return;
    setAuthLoading(true); setAuthError('');
    try {
      let user: ChatUser;
      if (authMode === 'login') {
        const u = await signIn(email.trim(), password);
        user = { id: u.id, email: u.email ?? email.trim(), displayName: u.displayName ?? email.split('@')[0] };
      } else {
        const u = await signUp(email.trim(), password, displayName.trim());
        user = { id: u.id, email: u.email ?? email.trim(), displayName: displayName.trim() };
      }
      setPendingUser(user);
      setCurrentUser(user);

      // Persist credentials so the session can be silently restored after expiry or app update
      try {
        await window.warroom?.secure.set('chat_email', email.trim());
        await window.warroom?.secure.set('chat_password', password);
      } catch {}

      // Check if already in a team. Retry once — right after signIn the session
      // JWT may not yet be propagated to the query layer, causing getTeam to
      // return null even when the user is in a team.
      let teamRes = await window.warroom.chat.getTeam(user.id);
      if (teamRes.ok && !teamRes.data) {
        await new Promise((r) => setTimeout(r, 400));
        teamRes = await window.warroom.chat.getTeam(user.id);
      }
      if (teamRes.ok && teamRes.data) {
        setCurrentTeam(teamRes.data as ChatTeam);
        onDone();
        return;
      }
      // If getTeam errored (not just "no team"), surface it rather than
      // dumping the user onto the "Create or Join" screen.
      if (!teamRes.ok) {
        setAuthError(`Signed in, but couldn't load your team: ${teamRes.error}. Try again.`);
        return;
      }
      setStep('team');
    } catch (e: any) {
      setAuthError(e?.message ?? 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  }

  // Listen for the deep link callback from main process.
  React.useEffect(() => {
    const off = window.warroom.chat.onAuthRecovery(() => {
      setResetStage('newpassword');
      setStep('forgot');
    });
    return off;
  }, []);

  async function handleSendReset() {
    if (!resetEmail.trim()) return;
    setResetLoading(true); setResetError('');
    try {
      const res = await window.warroom.chat.resetPassword(resetEmail.trim());
      if (!res.ok) throw new Error(res.error);
      setResetStage('waiting');
    } catch (e: any) {
      setResetError(e?.message ?? 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  }

  async function handleUpdatePassword() {
    if (!resetNewPassword.trim() || resetNewPassword.length < 6) {
      setResetError('Password must be at least 6 characters'); return;
    }
    setResetLoading(true); setResetError('');
    try {
      const res = await window.warroom.chat.updatePassword(resetNewPassword);
      if (!res.ok) throw new Error(res.error);
      // Done — go back to login with new password pre-filled
      setPassword(resetNewPassword);
      setResetStage('email'); setResetEmail(''); setResetNewPassword('');
      setStep('auth');
    } catch (e: any) {
      setResetError(e?.message ?? 'Failed to update password');
    } finally {
      setResetLoading(false);
    }
  }

  async function handleTeam() {
    if (!pendingUser) return;
    if (teamMode === 'create' && !teamName.trim()) return;
    if (teamMode === 'join' && !inviteCode.trim()) return;
    setTeamLoading(true); setTeamError('');
    try {
      let team: ChatTeam;
      if (teamMode === 'create') {
        const res = await window.warroom.chat.createTeam(teamName.trim());
        if (!res.ok) throw new Error(res.error);
        team = res.data as ChatTeam;
      } else {
        const res = await window.warroom.chat.joinTeam(inviteCode.trim());
        if (!res.ok) throw new Error(res.error);
        team = res.data as ChatTeam;
      }

      // Membership is granted server-side after re-verifying the invite code, so we
      // pass the code (not just the team id). For a freshly created team this is the
      // code returned by createTeam; for a join it's the code the user entered.
      const joinRes = await window.warroom.chat.joinTeamByCode(team.invite_code, pendingUser.displayName, role);
      if (!joinRes.ok) throw new Error(joinRes.error);
      setCurrentTeam((joinRes.data as ChatTeam) ?? team);
      onDone();
    } catch (e: any) {
      setTeamError(e?.message ?? 'Team setup failed');
    } finally {
      setTeamLoading(false);
    }
  }

  if (step === 'forgot') {
    return (
      <div className="flex flex-col p-4 gap-3 overflow-y-auto">
        <div className="label mb-1">Reset password</div>

        {resetStage === 'email' && (
          <>
            <p className="text-xs" style={{ color: 'var(--nav-inactive-color)' }}>
              Enter your account email and we'll send you a reset link.
            </p>
            <input className="input w-full" type="email" placeholder="Email" value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendReset()} autoFocus />
            {resetError && <p className="text-xs text-red-500">{resetError}</p>}
            <button className="btn-primary w-full" onClick={handleSendReset} disabled={resetLoading}>
              {resetLoading ? 'Sending…' : 'Send reset email'}
            </button>
            <button className="text-xs text-center"
              style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onClick={() => { setStep('auth'); setResetError(''); }}>
              ← Back to sign in
            </button>
          </>
        )}

        {resetStage === 'waiting' && (
          <>
            <p className="text-sm" style={{ color: 'var(--ink)' }}>
              Check your email at <strong>{resetEmail}</strong>.
            </p>
            <p className="text-xs" style={{ color: 'var(--nav-inactive-color)' }}>
              Click the link in the email — it will open Warroom and bring you straight to the password reset screen.
            </p>
            <button className="text-xs text-center mt-1"
              style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onClick={() => { setResetStage('email'); setResetError(''); }}>
              ← Use a different email
            </button>
          </>
        )}

        {resetStage === 'newpassword' && (
          <>
            <p className="text-xs" style={{ color: 'var(--nav-inactive-color)' }}>
              Identity verified. Enter your new password.
            </p>
            <input className="input w-full" type="password" placeholder="New password (min 6 chars)"
              value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUpdatePassword()} autoFocus />
            {resetError && <p className="text-xs text-red-500">{resetError}</p>}
            <button className="btn-primary w-full" onClick={handleUpdatePassword} disabled={resetLoading}>
              {resetLoading ? 'Saving…' : 'Set new password'}
            </button>
          </>
        )}
      </div>
    );
  }

  if (step === 'auth') {
    return (
      <div className="flex flex-col p-4 gap-3 overflow-y-auto">
        <div className="label mb-1">{authMode === 'login' ? 'Sign in to chat' : 'Create account'}</div>
        {authMode === 'signup' && (
          <input className="input w-full" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        )}
        <input className="input w-full" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input w-full" type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAuth()} />
        {authError && <p className="text-xs text-red-500">{authError}</p>}
        <button className="btn-primary w-full" onClick={handleAuth} disabled={authLoading}>
          {authLoading ? 'Working…' : authMode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button className="text-xs text-center"
          style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }}>
          {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
        {authMode === 'login' && (
          <button className="text-xs text-center"
            style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onClick={() => { setResetEmail(email); setStep('forgot'); setAuthError(''); }}>
            Forgot password?
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col p-4 gap-3 overflow-y-auto">
      <div className="label mb-1">Set up your team</div>
      <div className="flex rounded-lg p-0.5 gap-1" style={{ background: 'var(--mode-toggle-bg)' }}>
        {(['create', 'join'] as const).map((m) => (
          <button key={m} onClick={() => setTeamMode(m)}
            className="flex-1 py-1 text-[11px] uppercase tracking-wider rounded-md transition font-bold"
            style={teamMode === m ? { background: 'var(--bg-card)', color: 'var(--nav-active-color)' } : { background: 'transparent', color: 'var(--nav-inactive-color)' }}>
            {m === 'create' ? 'Create team' : 'Join team'}
          </button>
        ))}
      </div>
      {teamMode === 'create'
        ? <input className="input w-full" placeholder="Team name (e.g. Jefferson Debate)" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
        : <input className="input w-full font-mono uppercase tracking-widest" placeholder="Invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
      }
      <div>
        <div className="label mb-1 text-xs">Your role</div>
        <div className="flex gap-2">
          {(['debater', 'coach'] as const).map((r) => (
            <button key={r} onClick={() => setRole(r)} className="flex-1 py-1.5 text-xs rounded-md capitalize transition"
              style={role === r
                ? { background: 'var(--bg-card)', color: 'var(--nav-active-color)', border: '1px solid var(--border-side)' }
                : { background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-side)' }}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {teamError && <p className="text-xs text-red-500">{teamError}</p>}
      <button className="btn-primary w-full" onClick={handleTeam} disabled={teamLoading}>
        {teamLoading ? 'Working…' : teamMode === 'create' ? 'Create team' : 'Join team'}
      </button>
    </div>
  );
}
