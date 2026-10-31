/* Color theme: dark unless the user picked light in settings. Loaded in <head> so the page never flashes. */
'use strict';

(function () {
  function apply(t) {
    document.documentElement.dataset.theme = t;
    // the Tauri window's title bar follows the page
    const win = window.__TAURI__ && window.__TAURI__.window;
    if (win) win.getCurrentWindow().setTheme(t).catch(() => { /* older shell: title bar stays as is */ });
  }
  let theme = 'dark';
  try { if (localStorage.getItem('tamlul.theme') === 'light') theme = 'light'; } catch (_) { /* */ }
  apply(theme);

  window.tamlulTheme = () => document.documentElement.dataset.theme;
  window.tamlulSetTheme = (t) => {
    try { localStorage.setItem('tamlul.theme', t); } catch (_) { /* */ }
    apply(t);
  };
})();
