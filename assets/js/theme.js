/* Runs in <head> before first paint: applies the saved theme (default: glow). */
(function () {
  'use strict';
  var KEY = 'northlight.v1.theme', theme = 'glow';
  try { theme = localStorage.getItem(KEY) || 'glow'; } catch (e) { /* storage blocked: default */ }
  var link = document.getElementById('theme-glow');
  if (link) link.disabled = theme === 'light';
  document.documentElement.setAttribute('data-theme', theme);
  window.NL_THEME = {
    get: function () { return document.documentElement.getAttribute('data-theme'); },
    set: function (t) {
      try { localStorage.setItem(KEY, t); } catch (e) { /* ignore */ }
      if (link) link.disabled = t === 'light';
      document.documentElement.setAttribute('data-theme', t);
    }
  };
})();
