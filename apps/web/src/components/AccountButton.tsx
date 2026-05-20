'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';

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

export function AccountButton() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!session?.user?.email) return null;

  const email = session.user.email;
  const isGoogle = isGoogleUser(session.idToken);

  function resetChangePw() {
    setChangePwOpen(false);
    setError(null);
    setSuccess(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
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
          <div style={{ fontSize: 11, color: '#0a0a0a', marginBottom: 12, letterSpacing: '0.02em', wordBreak: 'break-all' }}>
            {email}
          </div>
          <div style={{ height: 1, background: 'rgba(10,10,10,0.08)', marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
