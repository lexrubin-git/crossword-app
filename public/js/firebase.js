/**
 * firebase.js — Initialises Firebase directly.
 * Config is safe to include here since Firebase Hosting
 * is protected by Firebase Security Rules, not the API key.
 */

import { initializeApp, getApps }
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

const firebaseConfig = {
  apiKey:            "AIzaSyBBPKt8u3hkRkFZ0kFurQ6tmEDJQlWNDhw",
  authDomain:        "crosswordlex.firebaseapp.com",
  databaseURL:       "https://crosswordlex-default-rtdb.firebaseio.com",
  projectId:         "crosswordlex",
  storageBucket:     "crosswordlex.firebasestorage.app",
  messagingSenderId: "1005145578019",
  appId:             "1:1005145578019:web:588bb7573d14b15455af96"
};

window._fb = window._fb || (() => {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db  = getDatabase(app);
  return {
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
})();

console.log('✓ Firebase connected');
window.dispatchEvent(new Event('firebase-ready'));
