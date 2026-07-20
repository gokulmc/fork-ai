'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { linkGithubInstallation } from '@/lib/api';
import { ThemeScript } from '@/components/ThemeScript';

// GitHub's post-install redirect for the forkai code GitHub App (Setup URL —
// see docs/forkai-code/deploy-cloud-runner.md's registration checklist). This
// is the only piece of UI the GitHub App slice needs: the install itself is a
// plain navigation to `{API_BASE_URL}/github/app/install`, which redirects to
// github.com and back here with `?installation_id=`.
function SetupInner() {
  const installationId = useSearchParams().get('installation_id');
  const { data: authSession, status } = useSession();
  const [state, setState] = useState<'linking' | 'linked' | 'error'>('linking');

  useEffect(() => {
    if (status !== 'authenticated' || !authSession?.idToken || !installationId) return;
    linkGithubInstallation(authSession.idToken, installationId)
      .then(() => setState('linked'))
      .catch(() => setState('error'));
  }, [status, authSession?.idToken, installationId]);

  if (!installationId) {
    return <p className="ghsetup-msg">No installation id on this link — open it from the GitHub App install flow, not directly.</p>;
  }
  if (status === 'unauthenticated') {
    return <p className="ghsetup-msg">Sign in to forkai code, then reopen this link to finish linking the installation.</p>;
  }
  if (state === 'error') {
    return <p className="ghsetup-msg">Could not link the installation — go back to forkai code and try Connect GitHub again.</p>;
  }
  if (state === 'linked') {
    return <p className="ghsetup-msg">Installation linked — <a className="ghsetup-link" href="/?github=connected">back to forkai code</a>.</p>;
  }
  return <p className="ghsetup-msg">Linking your GitHub App installation…</p>;
}

export default function GithubSetupPage() {
  return (
    <>
      <ThemeScript />
      <div className="ghsetup-overlay">
        <style>{`
          .ghsetup-overlay {
            position: fixed; inset: 0; overflow-y: auto;
            background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 16px;
            font-family: var(--mono); color: var(--ink);
          }
          .ghsetup-card {
            width: 100%; max-width: 420px; padding: 32px 28px; text-align: center;
            background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-2);
          }
          .ghsetup-title { font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.16em; margin: 0 0 14px; }
          .ghsetup-msg { font-size: 12.5px; line-height: 1.6; color: var(--ink-3); margin: 0; }
          .ghsetup-link { color: var(--ink); text-decoration: underline; }
        `}</style>
        <main className="ghsetup-card">
          <p className="ghsetup-title">forkai code — GitHub App</p>
          <Suspense fallback={<p className="ghsetup-msg">Loading…</p>}>
            <SetupInner />
          </Suspense>
        </main>
      </div>
    </>
  );
}
