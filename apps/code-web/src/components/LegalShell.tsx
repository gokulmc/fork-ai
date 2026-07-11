import { ThemeScript } from './ThemeScript';

// Shared chrome for the legal pages (privacy, terms). Uses the app's design
// tokens so the pages match the rest of the app, with dark mode via ThemeScript.
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      <div className="legal-overlay">
        <style>{`
          /* Own scroll container — the app sets body{overflow:hidden} globally,
             so this page must scroll itself. */
          .legal-overlay {
            position: fixed; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
            background: var(--bg); padding: 32px 16px;
            display: flex; justify-content: center; align-items: flex-start;
            font-family: var(--mono); color: var(--ink);
          }
          .legal {
            width: 100%; max-width: 680px; margin: auto;
            padding: 40px 44px 56px;
            background: var(--paper);
            border: 1px solid var(--line);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-2);
            font-family: var(--mono); font-size: 12.5px; line-height: 1.75; letter-spacing: 0.01em; color: var(--ink);
          }
          .legal h1 { font-family: var(--mono); font-weight: 600; font-size: 15px; line-height: 1.3; text-transform: uppercase; letter-spacing: 0.16em; margin: 0 0 8px; }
          .legal .updated { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 30px; }
          .legal h2 { font-family: var(--mono); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink); margin: 28px 0 8px; }
          .legal p, .legal li { margin: 0 0 10px; }
          .legal ul { padding-left: 18px; }
          .legal a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 2px; }
          .legal a:hover { text-decoration-color: var(--ink); }
          .legal strong { font-weight: 600; }
          .legal .back { display: inline-block; margin-bottom: 28px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; color: var(--ink-3); }
          .legal .back:hover { color: var(--ink); }
          @media (max-width: 768px) {
            .legal-overlay { padding: 0; }
            .legal { border: 0; border-radius: 0; box-shadow: none; padding: 28px 20px 64px; max-width: none; }
          }
        `}</style>

        <main className="legal">
          <a className="back" href="/">← fork ai</a>
          <h1>{title}</h1>
          <p className="updated">Last updated: {updated}</p>
          {children}
        </main>
      </div>
    </>
  );
}
