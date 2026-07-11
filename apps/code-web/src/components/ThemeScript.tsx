// Standalone static pages (blog, legal) don't mount <App>, so nothing sets
// `data-theme` from the user's saved tweaks. This tiny pre-paint script mirrors
// the same 'forkai-code.tweaks' localStorage key useTweaks.ts uses, so those
// pages match the app's chosen light/dark theme with no flash. Defaults to
// light (the app default).
export function ThemeScript() {
  const js = `(function(){try{var t=JSON.parse(localStorage.getItem('forkai-code.tweaks')||'{}');document.documentElement.setAttribute('data-theme',t.theme==='dark'?'dark':'light');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
