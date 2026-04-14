// ── ui.helpers.js — Reusable DOM utilities ──

import { COLORS, state, takenColorHexes } from './state.js';

// ── Color swatch builder ──
export function buildColorSwatches(containerId, selectedHex, takenHexes = new Set(), onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  COLORS.forEach(c => {
    const isTaken = takenHexes.has(c.hex);
    const s = document.createElement('div');
    s.className = 'swatch' + (c.hex === selectedHex ? ' selected' : '') + (isTaken ? ' taken' : '');
    s.style.background = c.hex;
    s.title = isTaken ? `${c.name} (taken)` : c.name;
    s.dataset.hex = c.hex;
    if (!isTaken) {
      s.addEventListener('click', () => {
        container.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
        s.classList.add('selected');
        if (onChange) onChange(COLORS.find(x => x.hex === c.hex));
      });
    }
    container.appendChild(s);
  });
}

// ── Overlay helpers ──
export function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

export function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  // If this overlay contained the shared pixel-draw block, return it to body
  const block = document.getElementById('pixel-draw-block');
  if (block && el.contains(block)) {
    block.style.display = 'none';
    document.body.appendChild(block);
  }
}

// ── Avatar lightbox ──
export function openAvatarLightbox(avatarUrl, colorHex, name, initial) {
  const lb  = document.getElementById('avatar-lightbox');
  const img = document.getElementById('avatar-lightbox-img');
  const nm  = document.getElementById('avatar-lightbox-name');
  if (!lb || !img) return;
  img.style.backgroundColor = colorHex;
  if (avatarUrl) {
    img.style.backgroundImage = `url(${avatarUrl})`;
    img.textContent = '';
  } else {
    img.style.backgroundImage = '';
    img.textContent = initial;
  }
  if (nm) nm.textContent = name;
  lb.style.display = 'flex';
}

export function closeAvatarLightbox() {
  const lb = document.getElementById('avatar-lightbox');
  if (lb) lb.style.display = 'none';
}

// ── Player chip (home screen) ──
export function updateChip() {
  const avatar = document.getElementById('chip-avatar');
  const nameEl = document.getElementById('chip-name');
  if (!avatar || !nameEl) return;
  const { playerName, playerColor, pixelAvatarData } = state;
  avatar.style.background = playerColor.hex;
  if (pixelAvatarData) {
    avatar.style.backgroundImage = `url(${pixelAvatarData})`;
    avatar.style.backgroundSize  = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
  } else {
    avatar.style.backgroundImage = '';
    avatar.textContent = playerName.charAt(0).toUpperCase();
  }
  nameEl.textContent = playerName;
}

// ── Animated waiting dots ──
const _dotsIntervals = {};
export function startDots(elId, intervalKey) {
  stopDots(intervalKey);
  const states = ['.', '..', '...', ''];
  let i = 0;
  _dotsIntervals[intervalKey] = setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) { stopDots(intervalKey); return; }
    i = (i + 1) % states.length;
    el.textContent = states[i];
  }, 500);
}

export function stopDots(key) {
  if (_dotsIntervals[key]) { clearInterval(_dotsIntervals[key]); delete _dotsIntervals[key]; }
}

// ── Expose on window for non-module HTML handlers ──
window.openAvatarLightbox  = openAvatarLightbox;
window.closeAvatarLightbox = closeAvatarLightbox;
window.openOverlay  = (id) => openOverlay(id);
window.closeOverlay = (id) => closeOverlay(id);
