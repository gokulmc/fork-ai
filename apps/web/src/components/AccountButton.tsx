'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import { getMe, getUsageEvents, getCreditEvents, createRechargeOrder, verifyPayment, getReferralLink, updatePersona, type UsageEvent, type CreditEvent } from '@/lib/api';

const PW_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$/;

// Shown in the persona editor the first time, before anything is saved. Editing
// and saving this (or a replacement) is what activates persona injection.
const DEFAULT_PERSONA =
  "Respond with warmth and genuine enthusiasm. I'm a curious person who values clear, depth-first explanations with concrete examples. My background: [add your profession or field here]. Tailor analogies and detail to that context, and don't shy away from nuance.";

function isGoogleUser(idToken?: string): boolean {
  if (!idToken) return false;
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Array.isArray(payload.identities) &&
      (payload.identities as Array<{ providerType: string }>).some(i => i.providerType === 'Google');
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

function detectPaymentCurrency(): 'INR' | 'USD' {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (tz === 'Asia/Calcutta' || tz === 'Asia/Kolkata') ? 'INR' : 'USD';
  } catch {
    return 'INR';
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById('rzp-checkout-js')) { resolve(); return; }
    const s = document.createElement('script');
    s.id = 'rzp-checkout-js';
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
}

const PACKAGES: { label: string; usd: number }[] = [
  { label: '$5', usd: 5 },
  { label: '$10', usd: 10 },
];

function groupByDay(events: UsageEvent[]): { date: string; isoDate: string; totalCost: number }[] {
  const map = new Map<string, { isoDate: string; totalCost: number }>();
  for (const ev of events) {
    const d = ev.createdAt.slice(0, 10); // YYYY-MM-DD
    const label = new Date(ev.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const existing = map.get(d);
    if (existing) existing.totalCost += ev.costUsd;
    else map.set(d, { isoDate: ev.createdAt, totalCost: ev.costUsd });
  }
  return Array.from(map.entries()).map(([, v]) => ({
    date: new Date(v.isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    isoDate: v.isoDate,
    totalCost: v.totalCost,
  }));
}

interface AccountButtonProps {
  creditBalance?: number | null;
  onCreditUpdated?: (newBalance: number) => void;
}

export function AccountButton({ creditBalance, onCreditUpdated }: AccountButtonProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[] | null>(null);
  const [creditEvents, setCreditEvents] = useState<CreditEvent[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Recharge state
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [customUsd, setCustomUsd] = useState('');
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [rechargeError, setRechargeError] = useState<string | null>(null);
  const [rechargeSuccess, setRechargeSuccess] = useState<number | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Balance shown in billing overlay — starts from prop, updates after recharge
  const [localBalance, setLocalBalance] = useState<number | null | undefined>(creditBalance);
  useEffect(() => { setLocalBalance(creditBalance); }, [creditBalance]);
  // True only when we have no balance to show AND the last fetch failed — drives the
  // billing overlay's error+retry state so it never hangs on "Loading…" forever.
  const [balanceError, setBalanceError] = useState(false);

  // Referral modal state
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralUrl, setReferralUrl] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);

  // Persona modal state
  const [personaOpen, setPersonaOpen] = useState(false);
  const [personaText, setPersonaText] = useState('');
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [personaSuccess, setPersonaSuccess] = useState(false);

  if (!session?.user?.email) return null;

  const email = session.user.email;
  const isGoogle = isGoogleUser(session.idToken);
  const idToken = session.idToken ?? '';

  const hasCredit = localBalance == null || localBalance > 0;
  const balanceLabel = localBalance == null
    ? null
    : localBalance <= 0
      ? 'Out of credit'
      : `$${localBalance.toFixed(2)} remaining`;

  function resetChangePw() {
    setChangePwOpen(false);
    setError(null);
    setSuccess(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
  }

  function openReferral() {
    setOpen(false);
    setReferralOpen(true);
    if (!referralUrl && !referralLoading && idToken) {
      setReferralLoading(true);
      getReferralLink(idToken)
        .then(r => setReferralUrl(r.url))
        .catch(() => {})
        .finally(() => setReferralLoading(false));
    }
  }

  function copyReferralLink() {
    if (!referralUrl) return;
    void navigator.clipboard.writeText(referralUrl).then(() => {
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 1500);
    });
  }

  // Cache-first: keep showing the current balance while re-reading the live value.
  function refreshBalance() {
    if (!idToken) return;
    setBalanceError(false);
    getMe(idToken)
      .then(me => {
        const b = me.creditUsd ?? null;
        setLocalBalance(b);
        if (b != null) onCreditUpdated?.(b);
      })
      .catch(() => setBalanceError(true));
  }

  function openBilling() {
    setOpen(false);
    setBillingOpen(true);
    refreshBalance();
    if (usageEvents === null && idToken) {
      setUsageLoading(true);
      Promise.all([
        getUsageEvents(idToken).catch(() => [] as UsageEvent[]),
        getCreditEvents(idToken).catch(() => [] as CreditEvent[]),
      ])
        .then(([usage, credits]) => { setUsageEvents(usage); setCreditEvents(credits); })
        .finally(() => setUsageLoading(false));
    }
  }

  function openRecharge() {
    setRechargeOpen(true);
    setRechargeError(null);
    setRechargeSuccess(null);
    setCustomUsd('');
  }

  function closeRecharge() {
    setRechargeOpen(false);
    setRechargeError(null);
    setRechargeSuccess(null);
    setCustomUsd('');
  }

  async function startRecharge(amountUsd: number) {
    if (rechargeLoading) return;
    setRechargeError(null);
    setRechargeLoading(true);

    try {
      await loadRazorpayScript();
      const currency = detectPaymentCurrency();
      const order = await createRechargeOrder(idToken, amountUsd, currency);

      const rzpAmount = order.currency === 'USD'
        ? Math.round(order.amountUsd * 100)
        : order.amountInr;

      const description = order.currency === 'USD'
        ? `Add $${amountUsd.toFixed(2)} credit`
        : `Add $${amountUsd.toFixed(2)} credit (${(order.amountInr / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })})`;

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: rzpAmount,
          currency: order.currency,
          name: 'fork ai',
          description,
          theme: { color: '#0a0a0a' },
          handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            try {
              const result = await verifyPayment(
                idToken,
                response.razorpay_order_id,
                response.razorpay_payment_id,
                response.razorpay_signature,
              );
              const credited = result.credited;
              setRechargeSuccess(credited);
              const updated = (localBalance ?? 0) + credited;
              setLocalBalance(updated);
              onCreditUpdated?.(updated);
              // Refresh billing history
              setUsageEvents(null);
              setCreditEvents(null);
              if (idToken) {
                Promise.all([
                  getUsageEvents(idToken).catch(() => [] as UsageEvent[]),
                  getCreditEvents(idToken).catch(() => [] as CreditEvent[]),
                ]).then(([usage, credits]) => { setUsageEvents(usage); setCreditEvents(credits); });
              }
              resolve();
            } catch {
              reject(new Error('Payment verification failed — contact support if credit was deducted.'));
            }
          },
          modal: {
            ondismiss: () => reject(new Error('cancelled')),
          },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      if (msg !== 'cancelled') setRechargeError(msg);
    } finally {
      setRechargeLoading(false);
    }
  }

  function resetPersona() {
    setPersonaOpen(false);
    setPersonaError(null);
    setPersonaSuccess(false);
  }

  function openPersona() {
    setOpen(false);
    setPersonaOpen(true);
    setPersonaError(null);
    setPersonaSuccess(false);
    // Prefill with the saved persona, or the default starter text on first use.
    if (idToken) {
      getMe(idToken)
        .then(me => setPersonaText(me.persona?.trim() ? me.persona : DEFAULT_PERSONA))
        .catch(() => setPersonaText(prev => prev || DEFAULT_PERSONA));
    } else {
      setPersonaText(prev => prev || DEFAULT_PERSONA);
    }
  }

  async function handleSavePersona() {
    if (personaLoading) return;
    const text = personaText.trim();
    if (!text) {
      setPersonaError('Persona cannot be empty');
      return;
    }
    setPersonaLoading(true);
    setPersonaError(null);
    try {
      await updatePersona(idToken, text);
      setPersonaSuccess(true);
      setTimeout(resetPersona, 1500);
    } catch {
      setPersonaError('Could not save — try again');
    } finally {
      setPersonaLoading(false);
    }
  }

  async function handleChangePw() {
    if (!currentPw || !newPw || !confirmPw || loading) return;
    if (!PW_REGEX.test(newPw)) {
      setError('Min 8 chars · uppercase · lowercase · number · symbol (@$!%*?&_-#)');
      return;
    }
    if (newPw !== confirmPw) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.error) {
        setError(data.error === 'CurrentPasswordIncorrect' ? 'Current password is incorrect' : data.error);
      } else {
        setSuccess(true);
        setTimeout(resetChangePw, 1500);
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Gear button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 60,
          width: 36, height: 36, borderRadius: '50%',
          background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(10,10,10,0.08)',
        }}
        aria-label="Account"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" stroke="#555" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </button>

      {/* Popover backdrop */}
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />}

      {/* Popover */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 68, left: 24, zIndex: 60,
          background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
          borderRadius: 6, padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(10,10,10,0.10)',
          minWidth: 220,
          fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
        }}>
          <div style={{ fontSize: 11, color: '#0a0a0a', marginBottom: 6, letterSpacing: '0.02em', wordBreak: 'break-all' }}>
            {email}
          </div>
          {balanceLabel && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.06em', color: hasCredit ? 'rgba(10,10,10,0.5)' : '#c0392b' }}>
                {balanceLabel}
              </span>
              <button
                onClick={openReferral}
                style={{
                  background: 'none', border: '1px solid rgba(10,10,10,0.2)',
                  borderRadius: 3, padding: '2px 7px', cursor: 'pointer',
                  fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
                  fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'rgba(10,10,10,0.5)',
                }}
              >
                Refer
              </button>
            </div>
          )}
          <div style={{ height: 1, background: 'rgba(10,10,10,0.08)', marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={openPersona} style={menuBtnStyle}>
              Persona
            </button>
            <button onClick={openBilling} style={menuBtnStyle}>
              Billing
            </button>
            {!isGoogle && (
              <button onClick={() => { setOpen(false); setChangePwOpen(true); }} style={menuBtnStyle}>
                Change password
              </button>
            )}
            <button onClick={() => void signOut()} style={{ ...menuBtnStyle, color: '#c0392b' }}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Change password overlay */}
      {changePwOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) resetChangePw(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(360px, 90vw)',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)', marginBottom: 20 }}>
              Change password
            </div>

            {success ? (
              <div style={{ fontSize: 11, color: '#27ae60', letterSpacing: '0.06em' }}>Password updated.</div>
            ) : (
              <>
                {([ ['current password', currentPw, setCurrentPw], ['new password', newPw, setNewPw], ['confirm new password', confirmPw, setConfirmPw] ] as [string, string, (v: string) => void][]).map(([placeholder, value, setter]) => (
                  <input
                    key={placeholder}
                    type="password"
                    value={value}
                    onChange={e => { setError(null); setter(e.target.value); }}
                    onKeyDown={e => { if (e.key === 'Enter') void handleChangePw(); }}
                    placeholder={placeholder}
                    disabled={loading}
                    style={{
                      display: 'block', width: '100%', boxSizing: 'border-box',
                      border: 0, borderBottom: '1px solid rgba(10,10,10,0.12)',
                      padding: '10px 0', marginBottom: 14,
                      fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a',
                      background: 'transparent', outline: 'none', letterSpacing: '0.04em',
                    }}
                  />
                ))}

                {error && (
                  <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 12, letterSpacing: '0.04em' }}>{error}</div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button onClick={resetChangePw} style={cancelBtnStyle}>Cancel</button>
                  <button onClick={() => void handleChangePw()} disabled={loading} style={submitBtnStyle}>
                    {loading ? '…' : 'Update'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Persona overlay */}
      {personaOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) resetPersona(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(460px, 92vw)',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)', marginBottom: 12 }}>
              Persona
            </div>

            {personaSuccess ? (
              <div style={{ fontSize: 11, color: '#27ae60', letterSpacing: '0.06em' }}>Persona saved.</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.55)', letterSpacing: '0.03em', lineHeight: 1.5, marginBottom: 14 }}>
                  Added to the context of every AI answer. Takes effect once you save it.
                </div>
                <textarea
                  value={personaText}
                  onChange={e => { setPersonaError(null); setPersonaText(e.target.value); }}
                  disabled={personaLoading}
                  rows={6}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box',
                    border: '1px solid rgba(10,10,10,0.12)', borderRadius: 6,
                    padding: '12px', marginBottom: 14, resize: 'vertical',
                    fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a', lineHeight: 1.6,
                    background: 'transparent', outline: 'none', letterSpacing: '0.02em',
                  }}
                />

                {personaError && (
                  <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 12, letterSpacing: '0.04em' }}>{personaError}</div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button onClick={resetPersona} style={cancelBtnStyle}>Cancel</button>
                  <button onClick={() => void handleSavePersona()} disabled={personaLoading} style={submitBtnStyle}>
                    {personaLoading ? '…' : 'Save to Persona'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Billing overlay */}
      {billingOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) { setBillingOpen(false); closeRecharge(); } }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(400px, 90vw)',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)' }}>
                Billing
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={openReferral} style={cancelBtnStyle}>
                  Refer and get $5
                </button>
                <button
                  onClick={openRecharge}
                  disabled={rechargeLoading}
                  style={submitBtnStyle}
                >
                  Add Credit
                </button>
              </div>
            </div>

            {/* Balance */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(10,10,10,0.4)', marginBottom: 6, textTransform: 'uppercase' }}>Balance</div>
              {localBalance == null ? (
                balanceError ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: '#c0392b', letterSpacing: '0.04em' }}>Couldn&apos;t load balance.</span>
                    <button onClick={refreshBalance} style={cancelBtnStyle}>Retry</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>Loading…</div>
                )
              ) : localBalance <= 0 ? (
                <div style={{ fontSize: 13, color: '#c0392b', letterSpacing: '0.04em' }}>Out of credit — add credit to continue.</div>
              ) : (
                <div style={{ fontSize: 20, color: '#0a0a0a', letterSpacing: '-0.02em' }}>${localBalance.toFixed(2)}</div>
              )}
            </div>

            {/* Recharge panel */}
            {rechargeOpen && (
              <div style={{
                marginBottom: 20,
                border: '1px solid rgba(10,10,10,0.10)',
                borderRadius: 6, padding: '16px',
                background: 'rgba(10,10,10,0.02)',
              }}>
                <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(10,10,10,0.4)', marginBottom: 12, textTransform: 'uppercase' }}>
                  Select amount
                </div>

                {rechargeSuccess != null ? (
                  <div style={{ fontSize: 11, color: '#27ae60', letterSpacing: '0.04em' }}>
                    ${rechargeSuccess.toFixed(2)} credit added.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {PACKAGES.map(pkg => (
                        <button
                          key={pkg.usd}
                          onClick={() => void startRecharge(pkg.usd)}
                          disabled={rechargeLoading}
                          style={{
                            flex: 1, padding: '8px 0',
                            background: '#0a0a0a', color: '#fff', border: 0,
                            borderRadius: 4, cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.06em',
                            opacity: rechargeLoading ? 0.6 : 1,
                          }}
                        >
                          {pkg.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(10,10,10,0.4)' }}>$</span>
                      <input
                        ref={customInputRef}
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Custom (min $1)"
                        value={customUsd}
                        onChange={e => { setRechargeError(null); setCustomUsd(e.target.value); }}
                        disabled={rechargeLoading}
                        style={{
                          flex: 1, border: 0, borderBottom: '1px solid rgba(10,10,10,0.15)',
                          padding: '6px 0', background: 'transparent', outline: 'none',
                          fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a',
                        }}
                      />
                      <button
                        onClick={() => {
                          const v = parseFloat(customUsd);
                          if (!customUsd || isNaN(v) || v < 1) {
                            setRechargeError('Minimum $1');
                            return;
                          }
                          void startRecharge(v);
                        }}
                        disabled={rechargeLoading || !customUsd}
                        style={submitBtnStyle}
                      >
                        Pay
                      </button>
                    </div>

                    {rechargeError && (
                      <div style={{ fontSize: 10, color: '#c0392b', marginTop: 8, letterSpacing: '0.04em' }}>{rechargeError}</div>
                    )}
                    {rechargeLoading && (
                      <div style={{ fontSize: 10, color: 'rgba(10,10,10,0.4)', marginTop: 8 }}>Opening payment…</div>
                    )}
                  </>
                )}

                {rechargeSuccess == null && (
                  <button onClick={closeRecharge} style={{ ...cancelBtnStyle, marginTop: 12, fontSize: 9 }}>Cancel</button>
                )}
              </div>
            )}

            {/* Billing history — usage (debits) + credit events (credits) */}
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(10,10,10,0.4)', marginBottom: 10, textTransform: 'uppercase' }}>
              Billing history
            </div>
            <div style={{ height: 140, overflowY: 'auto' }}>
              {usageLoading ? (
                <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>Loading…</div>
              ) : (() => {
                const rows: Array<{ isoDate: string; label: string; amount: number; positive: boolean; key: string }> = [];
                for (const ev of (creditEvents ?? [])) {
                  const label = ev.type === 'REFERRAL' ? 'Referral credit' : 'Top-up';
                  rows.push({ isoDate: ev.createdAt, label, amount: ev.amountUsd, positive: true, key: ev.creditEventId });
                }
                for (const day of groupByDay(usageEvents ?? [])) {
                  rows.push({ isoDate: day.isoDate, label: 'Usage', amount: day.totalCost, positive: false, key: `usage-${day.isoDate.slice(0, 10)}` });
                }
                rows.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
                if (rows.length === 0) return <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>No activity yet.</div>;
                return rows.map(row => (
                  <div key={row.key} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: 11, color: 'rgba(10,10,10,0.7)',
                    padding: '5px 0', borderBottom: '1px solid rgba(10,10,10,0.06)',
                    height: 28, boxSizing: 'border-box',
                  }}>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>{new Date(row.isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      {row.positive && <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#27ae60', opacity: 0.8 }}>{row.label}</span>}
                    </span>
                    <span style={{ color: row.positive ? '#27ae60' : '#c0392b' }}>
                      {row.positive ? '+' : '−'}${row.positive ? row.amount.toFixed(2) : row.amount.toFixed(4)}
                    </span>
                  </div>
                ));
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => { setBillingOpen(false); closeRecharge(); }} style={cancelBtnStyle}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Referral modal */}
      {referralOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) setReferralOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(380px, 90vw)',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)', marginBottom: 20 }}>
              Your referral link
            </div>
            <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.6)', marginBottom: 16, lineHeight: 1.5 }}>
              Share this link. When someone signs up and makes their first query, you both earn $5 credit.
            </div>
            {referralLoading ? (
              <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)', marginBottom: 20 }}>Generating link…</div>
            ) : referralUrl ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <input
                  readOnly
                  value={referralUrl}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  style={{
                    flex: 1, border: '1px solid rgba(10,10,10,0.15)',
                    borderRadius: 4, padding: '8px 10px',
                    fontFamily: 'inherit', fontSize: 10, color: '#0a0a0a',
                    background: 'rgba(10,10,10,0.02)', outline: 'none',
                    letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                />
                <button onClick={copyReferralLink} style={submitBtnStyle}>
                  {referralCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#c0392b', marginBottom: 20 }}>Could not load link — try again.</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setReferralOpen(false)} style={cancelBtnStyle}>Close</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

const font = "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace";

const menuBtnStyle: React.CSSProperties = {
  background: 'none', border: 0, padding: '6px 0', cursor: 'pointer',
  fontFamily: font, fontSize: 11, letterSpacing: '0.06em',
  color: 'rgba(10,10,10,0.75)', textAlign: 'left', width: '100%',
};

const cancelBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid rgba(10,10,10,0.15)',
  borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
  fontFamily: font, fontSize: 10, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(10,10,10,0.5)',
};

const submitBtnStyle: React.CSSProperties = {
  background: '#0a0a0a', border: 0,
  borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
  fontFamily: font, fontSize: 10, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#ffffff',
};
