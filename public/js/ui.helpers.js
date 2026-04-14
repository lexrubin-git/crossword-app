/**
 * ui.helpers.js — Reusable UI utility functions shared
 * by all page controllers.
 */

import { PLAYER_COLORS } from '../state.js';

// ── Toast ──────────────────────────────────────────

let _toastTimer = null;

/**
 * Show a brief toast notification.
 * @param {string} msg
 * @param {number} [duration=2000]
 */
export function showToast(msg, duration = 2000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Overlay helpers ────────────────────────────────

/** Open an overlay by ID. */
export function openOverlay(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

/** Close an overlay by ID. */
export function closeOverlay(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// ── Color swatch renderer ──────────────────────────

/**
 * Render color swatches into a container.
 * @param {string|Element} container  – ID string or DOM element
 * @param {string}         selected   – currently selected hex color
 * @param {string[]}       [taken=[]] – hex colors already taken by others
 * @param {function}       onChange   – called with hex color when swatch clicked
 */
export function renderSwatches(container, selected, taken = [], onChange) {
  const el = typeof container === 'string'
    ? document.getElementById(container)
    : container;
  if (!el) return;

  el.innerHTML = '';
  PLAYER_COLORS.forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    if (color === selected) sw.classList.add('selected');
    if (taken.includes(color)) sw.classList.add('taken');
    sw.style.background = color;
    sw.addEventListener('click', () => {
      el.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      sw.classList.add('selected');
      onChange(color);
    });
    el.appendChild(sw);
  });
}

// ── Avatar helpers ─────────────────────────────────

/**
 * Build an initials-based avatar fallback style string.
 * Returns { background, text } for inline styling.
 */
export function getAvatarStyle(color) {
  return { background: color };
}

/**
 * Apply an avatar (data-URL or color) to a DOM element.
 * Renders pixel art as a background image, or falls back
 * to the player color + initials.
 * @param {Element} el
 * @param {{ name:string, color:string, avatar?:string }} player
 */
export function applyAvatar(el, { name, color, avatar }) {
  if (avatar) {
    el.style.background = `url(${avatar}) center/cover, ${color}`;
    el.textContent = '';
  } else {
    el.style.background = color;
    el.textContent = (name || '?')[0].toUpperCase();
  }
}

// ── Waiting-dots animation ─────────────────────────

/**
 * Start the "…" waiting dots animation on an element.
 * @returns {function} stop – call to clear the interval
 */
export function startWaitingDots(el) {
  const frames = ['', '.', '..', '...'];
  let i = 0;
  const id = setInterval(() => {
    el.textContent = frames[i++ % frames.length];
  }, 500);
  return () => clearInterval(id);
}

// ── Context menu ───────────────────────────────────

/**
 * Position and open a context menu near an event target.
 * @param {string}   menuId
 * @param {MouseEvent} event
 */
export function openCtxMenu(menuId, event) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  menu.classList.add('open');
  menu.style.top  = `${event.clientY}px`;
  menu.style.left = `${event.clientX}px`;

  // Close on next click outside
  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('open');
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Timer formatting ───────────────────────────────

/** Format seconds as m:ss */
export function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ── Debounce ───────────────────────────────────────
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
