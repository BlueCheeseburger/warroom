import React, { useState, useEffect } from 'react';
import { Dots } from './Spinner';

const EVENT_OPTIONS = [
  { value: 'hspolicy', label: 'HS Policy' },
  { value: 'hsld',     label: 'HS LD' },
  { value: 'hspf',     label: 'HS PF' },
  { value: 'ndtceda',  label: 'College Policy (NDT/CEDA)' },
  { value: 'nfald',    label: 'College LD (NFA-LD)' },
];

type Step = 'event' | 'opencaselist' | 'gemini' | 'done';

interface Props {
  onDone: () => void;
}

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>('event');

  // event
  const [event, setEvent] = useState('hspolicy');

  // opencaselist
  const [ocUser, setOcUser] = useState('');
  const [ocPass, setOcPass] = useState('');
  const [ocLoading, setOcLoading] = useState(false);
  const [ocError, setOcError] = useState('');
  const [ocSaved, setOcSaved] = useState(false);

  // gemini
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiSaved, setGeminiSaved] = useState(false);

  // Pre-fill any credentials already saved in Settings.
  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gemini'),
      window.warroom?.secure.get('oc_username'),
      window.warroom?.secure.get('oc_password'),
      window.warroom?.storage.read('app_settings'),
    ]).then(([k, u, p, s]) => {
      if (k) setGeminiKey(k);
      if (u) setOcUser(u);
      if (p) setOcPass(p);
      if ((s as any)?.event) setEvent((s as any).event);
    });
  }, []);

  async function markDone() {
    await window.warroom?.storage.write('onboarding_done', true);
    onDone();
  }

  async function saveEvent() {
    await window.warroom?.storage.write('app_settings', { event });
    setStep('opencaselist');
  }

  async function saveOC() {
    if (!ocUser.trim() || !ocPass.trim()) { setStep('gemini'); return; }
    setOcLoading(true); setOcError('');
    try {
      const res = await window.warroom.opencaselist.login(ocUser.trim(), ocPass.trim());
      if (res && typeof res === 'object' && !(res as any).ok) throw new Error((res as any).error ?? 'Login failed');
      await window.warroom.secure.set('oc_username', ocUser.trim());
      await window.warroom.secure.set('oc_password', ocPass.trim());
      setOcSaved(true);
      setTimeout(() => setStep('gemini'), 800);
    } catch (e: any) {
      setOcError(e?.message ?? 'Login failed — check credentials');
    } finally {
      setOcLoading(false);
    }
  }

  async function saveGemini() {
    if (geminiKey.trim()) {
      await window.warroom.secure.set('gemini', geminiKey.trim());
      setGeminiSaved(true);
    }
    setTimeout(() => setStep('done'), geminiKey.trim() ? 600 : 0);
  }

  const TOTAL = 3;
  const stepIndex = { event: 0, opencaselist: 1, gemini: 2, done: 3 }[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-elevated w-full max-w-md mx-4 p-8" style={{ borderRadius: 18 }}>

        {/* Header row: progress bar + exit button */}
        {step !== 'done' ? (
          <div className="flex items-center gap-3 mb-6">
            <div className="flex gap-1.5 flex-1">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <div
                  key={i}
                  className="h-1 rounded-full flex-1 transition-all duration-300"
                  style={{ background: i < stepIndex ? 'var(--item-selected-bg)' : i === stepIndex ? '#0077ed' : 'var(--border-med)' }}
                />
              ))}
            </div>
            <button
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink/35 hover:text-ink/70 hover:bg-black/8 transition text-base shrink-0"
              onClick={markDone}
              title="Skip setup"
            >
              ×
            </button>
          </div>
        ) : null}

        {step === 'event' && (
          <>
            <div className="label mb-1">Step 1 of 3</div>
            <h2 className="text-lg font-semibold text-ink mb-1">What event do you do?</h2>
            <p className="text-xs text-ink/50 mb-5">Used to pre-select the right OpenCaselist database for opponent research.</p>
            <div className="space-y-2 mb-6">
              {EVENT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                  style={{
                    background: event === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                    color: event === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                    borderColor: event === o.value ? 'transparent' : 'var(--border-med)',
                  }}
                  onClick={() => setEvent(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button className="btn-primary px-5 py-2 text-sm" onClick={saveEvent}>Continue</button>
            </div>
          </>
        )}

        {step === 'opencaselist' && (
          <>
            <div className="label mb-1">Step 2 of 3</div>
            <h2 className="text-lg font-semibold text-ink mb-1">OpenCaselist credentials</h2>
            <p className="text-xs text-ink/50 mb-5">Lets you pull opponent disclosure data. Uses your <span className="font-medium">opencaselist.com</span> account. Credentials are stored encrypted on your device.</p>
            <div className="space-y-2 mb-2">
              <input
                className="input w-full"
                placeholder="Username"
                value={ocUser}
                autoComplete="username"
                onChange={(e) => setOcUser(e.target.value)}
              />
              <input
                className="input w-full"
                type="password"
                placeholder="Password"
                value={ocPass}
                autoComplete="current-password"
                onChange={(e) => setOcPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !ocLoading && saveOC()}
              />
              {ocError && <div className="text-xs text-red-600">{ocError}</div>}
            </div>
            <div className="flex items-center justify-between mt-5">
              <button className="text-xs text-ink/40 hover:text-ink/60 transition" onClick={() => setStep('gemini')}>
                Skip for now
              </button>
              <button
                className="btn-primary px-5 py-2 text-sm flex items-center gap-2"
                onClick={saveOC}
                disabled={ocLoading}
              >
                {ocLoading ? <><Dots /><span>Logging in…</span></> : ocSaved ? 'Saved ✓' : 'Save & continue'}
              </button>
            </div>
          </>
        )}

        {step === 'gemini' && (
          <>
            <div className="label mb-1">Step 3 of 3</div>
            <h2 className="text-lg font-semibold text-ink mb-1">Gemini API key</h2>
            <p className="text-xs text-ink/50 mb-5">Powers AI card extraction and block suggestions. Get a free key from <span className="font-medium">aistudio.google.com</span>. Stored encrypted on device.</p>
            <input
              className="input w-full font-mono text-xs mb-2"
              type="password"
              placeholder="AIza…"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGemini()}
            />
            <div className="flex items-center justify-between mt-5">
              <button className="text-xs text-ink/40 hover:text-ink/60 transition" onClick={saveGemini}>
                Skip for now
              </button>
              <button className="btn-primary px-5 py-2 text-sm" onClick={saveGemini}>
                {geminiSaved ? 'Saved ✓' : 'Save & continue'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-4">
            <div className="text-4xl mb-4">✓</div>
            <h2 className="text-lg font-semibold text-ink mb-2">You're all set</h2>
            <p className="text-sm text-ink/50 mb-6">You can update these anytime in Settings.</p>
            <button className="btn-primary px-6 py-2 text-sm" onClick={markDone}>Get started</button>
          </div>
        )}
      </div>
    </div>
  );
}
