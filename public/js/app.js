// Scotland Yard - App Bootstrap
(function() {
  'use strict';

  // Wait for DOM
  document.addEventListener('DOMContentLoaded', function() {
    // Initialize the UI controller (which creates GameEngine + BoardRenderer)
    window.app = new UIController();
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./sw.js').catch(function() {
        // SW registration failed — app still works fine without it
      });
    });
  }
})();
