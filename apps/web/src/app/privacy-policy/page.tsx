import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy · fork ai',
  description: 'How fork ai collects, uses, and protects your data.',
};

const LAST_UPDATED = '4 June 2026';
const CONTACT = 'support@forkai.in';

export default function PrivacyPolicyPage() {
  return (
    <div className="legal-overlay">
      <style>{`
        /* Own scroll container — the app sets body{overflow:hidden} globally,
           so this page must scroll itself. */
        .legal-overlay {
          position: fixed;
          inset: 0;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          background: #f4f4f2;
          padding: 32px 16px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }
        .legal {
          width: 100%;
          max-width: 680px;
          margin: auto;
          padding: 40px 44px 56px;
          background: #ffffff;
          border: 1px solid rgba(10,10,10,0.10);
          border-radius: 12px;
          box-shadow: 0 12px 40px rgba(10,10,10,0.10);
          font-family: var(--sans);
          font-size: 15px;
          line-height: 1.6;
          color: #1a1a1a;
        }
        .legal h1 {
          font-size: 27px;
          line-height: 1.2;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
        }
        .legal .updated {
          font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace;
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #8a8a8a;
          margin: 0 0 32px;
        }
        .legal h2 {
          font-size: 19px;
          margin: 32px 0 8px;
          letter-spacing: -0.005em;
        }
        .legal p, .legal li { margin: 0 0 11px; }
        .legal ul { padding-left: 20px; }
        .legal a { color: #1a1a1a; text-decoration: underline; }
        .legal strong { font-weight: 600; }
        .legal .back {
          display: inline-block;
          margin-bottom: 28px;
          font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-decoration: none;
          color: #8a8a8a;
        }
        @media (max-width: 768px) {
          .legal-overlay { padding: 0; background: #ffffff; }
          .legal {
            border: 0; border-radius: 0; box-shadow: none;
            padding: 28px 20px 64px; max-width: none;
          }
        }
        @media (prefers-color-scheme: dark) {
          .legal-overlay { background: #0e0e0e; }
          .legal {
            background: #191919; color: #e8e8e8;
            border-color: rgba(255,255,255,0.10);
            box-shadow: 0 12px 40px rgba(0,0,0,0.4);
          }
          .legal a { color: #e8e8e8; }
          .legal .updated, .legal .back { color: #888; }
          @media (max-width: 768px) {
            .legal-overlay, .legal { background: #191919; }
          }
        }
      `}</style>

      <main className="legal">
      <a className="back" href="/">← fork ai</a>

      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <p>
        This policy explains what information fork ai (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you
        use the fork ai website and mobile apps (the &ldquo;Service&rdquo;), how we use it, and the choices
        you have. By using the Service you agree to this policy.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> When you sign up we store your email address. Authentication
          is handled by Amazon Cognito; passwords are managed by Cognito and are never stored by us in
          readable form.
        </li>
        <li>
          <strong>Research content.</strong> The questions you ask, the AI-generated answers, and anything you
          create in the app — branches, notes, callouts, and highlights — are stored so we can show your
          workspace and history across sessions.
        </li>
        <li>
          <strong>Usage and billing records.</strong> We record per-request model usage to operate the
          credit/billing system, and payment records when you purchase credit.
        </li>
        <li>
          <strong>Technical data.</strong> Standard request data (such as IP address and device/browser
          information) is processed by our hosting providers to deliver and secure the Service.
        </li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide the core Service — generating answers and saving your research workspace.</li>
        <li>To authenticate you and keep your account secure.</li>
        <li>To operate billing and credit, and to process payments.</li>
        <li>To send transactional emails (verification codes, password resets, account notices).</li>
        <li>To maintain, debug, and improve the Service.</li>
      </ul>

      <h2>Third-party services</h2>
      <p>
        We share only the data necessary for these providers to perform their function on our behalf:
      </p>
      <ul>
        <li>
          <strong>AI model providers.</strong> Your questions and the relevant context are sent to the model
          you select to generate answers — Anthropic (Claude), Google (Gemini), or DeepSeek. Do not submit
          information you do not want processed by these providers.
        </li>
        <li>
          <strong>Amazon Web Services.</strong> We use AWS for authentication (Cognito), data storage
          (DynamoDB), and email delivery (SES).
        </li>
        <li>
          <strong>Notion.</strong> Only if you choose to connect it. With your authorization we read pages you
          select and write exported research into your Notion workspace. You can disconnect at any time.
        </li>
        <li>
          <strong>Razorpay.</strong> If you purchase credit, payment is processed by Razorpay. Card and
          payment details are handled by Razorpay, not by us.
        </li>
      </ul>

      <h2>Cookies and local storage</h2>
      <p>
        We use a session cookie to keep you signed in, and your browser&rsquo;s local storage to remember
        preferences (such as theme and your current session). We do not use third-party advertising or
        cross-site tracking cookies.
      </p>

      <h2>Data retention</h2>
      <p>
        We retain your account and research content for as long as your account is active. You can request
        deletion of your account and associated data at any time (see Contact). Some records required for
        legal, accounting, or fraud-prevention purposes (such as payment records) may be retained for a
        longer period.
      </p>

      <h2>Your rights</h2>
      <p>
        You can request access to, correction of, or deletion of your personal data by emailing us. We will
        respond within a reasonable time. To delete your account and all associated research content, contact{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Children</h2>
      <p>
        The Service is not directed to children under 13 (or the minimum age required in your jurisdiction),
        and we do not knowingly collect their personal data.
      </p>

      <h2>Security</h2>
      <p>
        We use industry-standard measures to protect your data, including encrypted transport (HTTPS) and
        managed cloud infrastructure. No method of transmission or storage is completely secure, so we cannot
        guarantee absolute security.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be reflected by updating the
        &ldquo;Last updated&rdquo; date above and, where appropriate, by notice within the Service.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data? Email us at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
      </main>
    </div>
  );
}
