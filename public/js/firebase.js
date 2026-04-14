/**
 * firebase.js — Initialises Firebase by fetching the config
 * from the server's /api/config endpoint.
 *
 * This means no API keys ever appear in committed source code.
 * The server reads them from the .env file (or the hosting
 * platform's environment variables).
 *
 * Exposes window._fb so every page controller can use it:
 *   const { db, ref, onValue, set, update, remove, push, get,
 *           serverTimestamp, onDisconnect } = window._fb;
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  onChildChanged,
  serverTimestamp,
  onDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Fetch config from our own server ──────────────
// The server reads values from .env so keys are never
// in any file that gets committed to GitHub.
async function initFirebase() {
  try {
    const res    = await fetch('/api/config');
    const config = await res.json();

    if (!config.apiKey) {
      console.error('Firebase config missing — check your .env file');
      return;
    }

    const app = initializeApp(config);
    const db  = getDatabase(app);

    // Expose everything controllers need on window._fb
    window._fb = {
      db,
      ref,
      set,
      get,
      update,
      remove,
      push,
      onValue,
      onChildAdded,
      onChildChanged,
      serverTimestamp,
      onDisconnect,
    };

    console.log('✓ Firebase connected');

    // Fire a custom event so controllers that load in
    // parallel know Firebase is ready.
    window.dispatchEvent(new Event('firebase-ready'));

  } catch (err) {
    console.error('Firebase init failed:', err);
  }
}

initFirebase();
