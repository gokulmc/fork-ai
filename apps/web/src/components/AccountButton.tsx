'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import { getUsageEvents, createRechargeOrder, verifyPayment, type UsageEvent } from '@/lib/api';

const PW_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$/;

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

function groupByDay(events: UsageEvent[]): { date: string; totalCost: number }[] {
  const map = new Map<string, number>();
  for (const ev of events) {
    const label = new Date(ev.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    map.set(label, (map.get(label) ?? 0) + ev.costUsd);
  }
  return Array.from(map.entries()).map(([date, totalCost]) => ({ date, totalCost }));
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
  const [termsOpen, setTermsOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[] | null>(null);
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

  function openBilling() {
    setOpen(false);
    setBillingOpen(true);
    if (usageEvents === null && idToken) {
      setUsageLoading(true);
      getUsageEvents(idToken)
        .then(setUsageEvents)
        .catch(() => setUsageEvents([]))
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
      const order = await createRechargeOrder(idToken, amountUsd);
      const inrDisplay = (order.amountInr / 100).toLocaleString('en-IN', {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0,
      });

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountInr,
          currency: 'INR',
          name: 'fork ai',
          description: `Add $${amountUsd.toFixed(2)} credit (${inrDisplay})`,
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
              // Refresh usage events list
              setUsageEvents(null);
              if (idToken) {
                getUsageEvents(idToken).then(setUsageEvents).catch(() => setUsageEvents([]));
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
            <div style={{ fontSize: 10, letterSpacing: '0.06em', color: hasCredit ? 'rgba(10,10,10,0.5)' : '#c0392b', marginBottom: 10 }}>
              {balanceLabel}
            </div>
          )}
          <div style={{ height: 1, background: 'rgba(10,10,10,0.08)', marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={openBilling} style={menuBtnStyle}>
              Billing
            </button>
            {!isGoogle && (
              <button onClick={() => { setOpen(false); setChangePwOpen(true); }} style={menuBtnStyle}>
                Change password
              </button>
            )}
            <button onClick={() => { setOpen(false); setTermsOpen(true); }} style={menuBtnStyle}>
              Terms &amp; conditions
            </button>
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
              <button
                onClick={openRecharge}
                disabled={rechargeLoading}
                style={submitBtnStyle}
              >
                Add Credit
              </button>
            </div>

            {/* Balance */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(10,10,10,0.4)', marginBottom: 6, textTransform: 'uppercase' }}>Balance</div>
              {localBalance == null ? (
                <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>Loading…</div>
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

            {/* Usage history */}
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(10,10,10,0.4)', marginBottom: 10, textTransform: 'uppercase' }}>
              Usage history
            </div>
            <div style={{ height: 112, overflowY: 'auto' }}>
              {usageLoading ? (
                <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>Loading…</div>
              ) : !usageEvents || usageEvents.length === 0 ? (
                <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.4)' }}>No usage yet.</div>
              ) : (
                groupByDay(usageEvents).map(day => (
                  <div key={day.date} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 11, color: 'rgba(10,10,10,0.7)',
                    padding: '5px 0', borderBottom: '1px solid rgba(10,10,10,0.06)',
                    height: 28, alignItems: 'center', boxSizing: 'border-box',
                  }}>
                    <span>{day.date}</span>
                    <span style={{ color: '#c0392b' }}>−${day.totalCost.toFixed(4)}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => { setBillingOpen(false); closeRecharge(); }} style={cancelBtnStyle}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms & Conditions overlay */}
      {termsOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) setTermsOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(580px, 92vw)',
            maxHeight: '82vh',
            display: 'flex', flexDirection: 'column',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)' }}>
                Terms &amp; Conditions
              </div>
              <button onClick={() => setTermsOpen(false)} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 14, color: 'rgba(10,10,10,0.4)', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, fontSize: 11, lineHeight: 1.7, color: 'rgba(10,10,10,0.8)', letterSpacing: '0.02em' }}>
              <TermsContent />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, flexShrink: 0 }}>
              <button onClick={() => setTermsOpen(false)} style={cancelBtnStyle}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TermsContent() {
  const h2: React.CSSProperties = { fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#0a0a0a', marginTop: 20, marginBottom: 6 };
  const p: React.CSSProperties = { margin: '0 0 10px' };
  const li: React.CSSProperties = { marginBottom: 4 };
  return (
    <div>
      <p style={{ ...p, color: 'rgba(10,10,10,0.5)', fontSize: 10 }}>Last updated: May 2026</p>

      <div style={h2}>1. Agreement</div>
      <p style={p}>By accessing or using fork ai, you agree to be bound by these Terms and Conditions. If you disagree with any part, please do not use the service.</p>

      <div style={h2}>2. About fork ai</div>
      <p style={p}>fork ai is an AI-powered branching research workspace operated by <strong>CURIOSTEM LEARNING PRIVATE LIMITED</strong> — RSF No 34/3, Door No 155/1, Sakthi Nagar, Thindal, Erode – 638012, Tamil Nadu, India. GST: 33AAMCC6984A1ZM.</p>

      <div style={h2}>3. Accounts &amp; Eligibility</div>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}>You must be at least 13 years old to use fork ai.</li>
        <li style={li}>You are responsible for maintaining the security of your account credentials.</li>
        <li style={li}>One account per person. We reserve the right to terminate duplicate accounts.</li>
        <li style={li}>You agree to provide accurate information when creating your account.</li>
      </ul>

      <div style={h2}>4. Credits &amp; Billing</div>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}>fork ai operates on a prepaid credit model. Credits are denominated in USD.</li>
        <li style={li}>New accounts receive a one-time complimentary signup credit. The amount is subject to change without notice.</li>
        <li style={li}>Credits are non-refundable once purchased, except as required by applicable law.</li>
        <li style={li}>Payments are processed by Razorpay in INR at the prevailing exchange rate at the time of purchase. Exchange rate fluctuations may affect the effective USD value of your credit.</li>
        <li style={li}>LLM calls consume credits based on token usage (input + output tokens), multiplied by a usage multiplier. The effective rate is visible in your account billing panel.</li>
        <li style={li}>Guest sessions (via share links) consume credits from the session owner's account.</li>
        <li style={li}>We reserve the right to adjust pricing and the credit multiplier. Changes take effect for new calls and will be communicated in advance where practicable.</li>
        <li style={li}>Unused credits do not expire, but we reserve the right to expire credits with at least 90 days' notice.</li>
      </ul>

      <div style={h2}>5. Acceptable Use</div>
      <p style={p}>You agree not to:</p>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}>Reverse-engineer, scrape, or exploit the service beyond its intended purpose.</li>
        <li style={li}>Use fork ai to generate harmful, illegal, deceptive, or abusive content.</li>
        <li style={li}>Attempt to circumvent usage limits, billing, or authentication.</li>
        <li style={li}>Resell, sublicense, or redistribute access to the service.</li>
        <li style={li}>Use automated scripts to generate content at scale without prior written consent.</li>
      </ul>

      <div style={h2}>6. Guest Access &amp; Sharing</div>
      <p style={p}>Share links grant read and LLM-branch access to a specific research session. Session owners are responsible for all LLM costs incurred by guests via their share link. Revoke share links at any time to remove guest access. We are not liable for content created by guests.</p>

      <div style={h2}>7. Content &amp; Intellectual Property</div>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}>Research content generated by the LLM is provided for informational purposes only. We make no representations as to its accuracy, completeness, or fitness for any particular purpose.</li>
        <li style={li}>You retain ownership of your input queries. You grant CURIOSTEM LEARNING PRIVATE LIMITED a limited, non-exclusive licence to process them solely to provide the service.</li>
        <li style={li}>The fork ai platform, brand, design, and codebase are owned by CURIOSTEM LEARNING PRIVATE LIMITED. All rights reserved.</li>
      </ul>

      <div style={h2}>8. Limitation of Liability</div>
      <p style={p}>To the maximum extent permitted by applicable law, CURIOSTEM LEARNING PRIVATE LIMITED shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of fork ai. Our total aggregate liability for any claim shall not exceed the credit balance held in your account at the time of the claim.</p>

      <div style={h2}>9. Privacy &amp; Data</div>
      <p style={p}>Your research sessions are stored in AWS infrastructure (ap-south-1). Queries are processed through the Anthropic API. We do not sell your personal data. By using fork ai you consent to this processing.</p>

      <div style={h2}>10. Termination</div>
      <p style={p}>We reserve the right to suspend or terminate accounts that violate these Terms, with or without notice. Unused credits at termination are non-refundable unless required by law.</p>

      <div style={h2}>11. Governing Law</div>
      <p style={p}>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of Erode, Tamil Nadu, India.</p>

      <div style={h2}>12. Changes to These Terms</div>
      <p style={p}>We may update these Terms at any time. Continued use of fork ai after changes are published constitutes your acceptance of the revised Terms. Material changes will be communicated via email where practicable.</p>

      <div style={h2}>13. Contact</div>
      <p style={p}>For questions about these Terms, contact us at <strong>info@stemlabs.co.in</strong>.</p>
    </div>
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
