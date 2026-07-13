// Standalone static pages (blog, legal) don't mount <App>, so nothing sets
// `data-theme` from the user's saved tweaks. This tiny pre-paint script used to
// mirror the 'forkai-code.tweaks' localStorage key useTweaks.ts uses. Dark is
// disabled until the full dark theme ships — force light regardless of any
// stored preference (intentionally ignored, not migrated away).
export function ThemeScript() {
  const js = `(function(){try{document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
