// ── pixel-art.js — Vector avatar drawing engine (shared across pages) ──
// Exported functions are called by home.controller and lobby.controller.

export const DRAW_COLORS = [
  '#1a1a1a','#555555','#888888','#bbbbbb','#ffffff',
  '#e05151','#e07c35','#d4a017','#4caf7d',
  '#3b8fd4','#7b61e0','#d45fa3',
];
export const CANVAS_SIZE = 500;

// Shared drawing state — ONE canvas, ONE state, used by whichever overlay is open
let drawColor   = DRAW_COLORS[0];
let eraserMode  = false;
let isDrawing   = false;
let brushSize   = 5;
let brushOpacity = 1;
export let vectorPaths = [];
let currentPath = null;
let undoStack = [];
let redoStack = [];
let customColorSlots = new Array(DRAW_COLORS.length).fill(null);
let nextCustomSlot = 0;
let _drawRAF = null;

// ── Undo / Redo ──
function snapshotPaths() {
  return vectorPaths.map(p => ({ color: p.color, width: p.width, opacity: p.opacity, points: [...p.points] }));
}

function pushUndo() {
  undoStack.push(snapshotPaths());
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
  const u = document.getElementById('pixel-undo-btn');
  const r = document.getElementById('pixel-redo-btn');
  if (u) u.style.opacity = undoStack.length ? '1' : '0.35';
  if (r) r.style.opacity = redoStack.length ? '1' : '0.35';
}

export function undoPixel() {
  if (!undoStack.length) return;
  redoStack.push(snapshotPaths());
  vectorPaths = undoStack.pop();
  drawVectorCanvas();
  updateUndoRedoBtns();
  updateAvatarPreview();
}

export function redoPixel() {
  if (!redoStack.length) return;
  undoStack.push(snapshotPaths());
  vectorPaths = redoStack.pop();
  drawVectorCanvas();
  updateUndoRedoBtns();
  updateAvatarPreview();
}

// ── Tools ──
export function setActiveTool(tool) {
  eraserMode = tool === 'eraser';
  const btn = document.getElementById('pixel-eraser-btn');
  if (btn) btn.classList.toggle('active', eraserMode);
}

export function toggleEraser() { setActiveTool(eraserMode ? 'draw' : 'eraser'); updateCursor(); }

export function clearPixelCanvas() {
  pushUndo();
  vectorPaths = [];
  currentPath = null;
  _bgImage = null;
  drawVectorCanvas();
  updateAvatarPreview();
}

// ── Brush size / opacity ──
export function stepBrushSize(delta) {
  brushSize = Math.min(40, Math.max(1, brushSize + delta));
  const v = document.getElementById('brush-size-val');
  const sl = document.getElementById('size-slider');
  const nm = document.getElementById('size-popover-num');
  if (v) v.textContent = brushSize;
  if (sl) sl.value = brushSize;
  if (nm) nm.textContent = brushSize;
  updateCursor();
}

export function stepOpacity(delta) {
  const pct = Math.min(100, Math.max(10, Math.round(brushOpacity * 100) + delta));
  brushOpacity = pct / 100;
  const v = document.getElementById('brush-opacity-val');
  const sl = document.getElementById('opacity-slider');
  const nm = document.getElementById('opacity-popover-num');
  if (v) v.textContent = pct + '%';
  if (sl) sl.value = pct;
  if (nm) nm.textContent = pct + '%';
}

export function onSizeSlider(val) {
  brushSize = parseInt(val);
  const v = document.getElementById('brush-size-val');
  const nm = document.getElementById('size-popover-num');
  if (v) v.textContent = brushSize;
  if (nm) nm.textContent = brushSize;
  updateCursor();
}

export function onOpacitySlider(val) {
  brushOpacity = parseInt(val) / 100;
  const label = val + '%';
  const v = document.getElementById('brush-opacity-val');
  const nm = document.getElementById('opacity-popover-num');
  if (v) v.textContent = label;
  if (nm) nm.textContent = label;
}

export function toggleAdvanced(which) {
  const wrap       = document.getElementById('advanced-sliders');
  const sizeBlock  = document.getElementById('advanced-size-block');
  const opacBlock  = document.getElementById('advanced-opacity-block');
  const sizeVal    = document.getElementById('brush-size-val');
  const opacVal    = document.getElementById('brush-opacity-val');
  if (!wrap || !sizeBlock || !opacBlock) return;
  if (which === 'size') {
    const isOpen = sizeBlock.style.display !== 'none';
    sizeBlock.style.display = isOpen ? 'none' : 'flex';
    if (sizeVal) sizeVal.style.borderColor = isOpen ? 'transparent' : 'var(--text)';
  } else {
    const isOpen = opacBlock.style.display !== 'none';
    opacBlock.style.display = isOpen ? 'none' : 'flex';
    if (opacVal) opacVal.style.borderColor = isOpen ? 'transparent' : 'var(--text)';
  }
  const anyOpen = sizeBlock.style.display !== 'none' || opacBlock.style.display !== 'none';
  wrap.style.display = anyOpen ? 'flex' : 'none';
}

// ── Palette ──
function isLightColor(hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.65;
}

function swatchBorderStyle(s, hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  s.style.outline = lum < 0.35 ? '1.5px solid rgba(255,255,255,0.22)' : '';
}

function applySelectedSwatch(el, hex) {
  el.classList.add('selected');
  el.classList.toggle('dark-ring', isLightColor(hex));
}

function addCustomColor(hex) {
  const effective = DRAW_COLORS.map((c,i) => customColorSlots[i] !== null ? customColorSlots[i] : c);
  if (effective.includes(hex)) return;
  for (let i = Math.min(nextCustomSlot, DRAW_COLORS.length - 2); i >= 0; i--) {
    customColorSlots[i+1] = customColorSlots[i];
  }
  customColorSlots[0] = hex;
  if (nextCustomSlot < DRAW_COLORS.length) nextCustomSlot++;
  renderPalette();
}

export function renderPalette() {
  const p = document.getElementById('pixel-palette');
  if (!p) return;
  p.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
  p.innerHTML = '';
  const effectiveColors = DRAW_COLORS.map((c,i) => customColorSlots[i] !== null ? customColorSlots[i] : c);
  effectiveColors.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'pixel-color-swatch';
    if (drawColor === c) applySelectedSwatch(s, c);
    s.style.background = c;
    swatchBorderStyle(s, c);
    s.addEventListener('click', () => {
      document.querySelectorAll('.pixel-color-swatch').forEach(x => { x.classList.remove('selected','dark-ring'); });
      document.getElementById('color-wheel-btn')?.classList.remove('selected');
      applySelectedSwatch(s, c);
      drawColor = c;
      setActiveTool('draw');
    });
    p.appendChild(s);
  });
}

export function initPixelPalette() {
  renderPalette();
  const wheelBtn   = document.getElementById('color-wheel-btn');
  const wheelInput = document.getElementById('color-wheel-input');
  if (!wheelInput) return;

  wheelInput.addEventListener('change', () => {
    const hex = wheelInput.value;
    addCustomColor(hex);
    drawColor = hex;
    setActiveTool('draw');
    document.querySelectorAll('.pixel-color-swatch').forEach(x => { x.classList.remove('selected','dark-ring'); });
    const effective = DRAW_COLORS.map((c,i) => customColorSlots[i] !== null ? customColorSlots[i] : c);
    const idx = effective.indexOf(hex);
    const swatches = document.querySelectorAll('.pixel-color-swatch');
    if (idx !== -1 && swatches[idx]) applySelectedSwatch(swatches[idx], hex);
    wheelBtn?.classList.remove('selected');
  });
  wheelInput.addEventListener('input', () => {
    document.querySelectorAll('.pixel-color-swatch').forEach(x => x.classList.remove('selected','dark-ring'));
    wheelBtn?.classList.add('selected');
    drawColor = wheelInput.value;
    setActiveTool('draw');
  });
  wheelInput.addEventListener('click', () => {
    document.querySelectorAll('.pixel-color-swatch').forEach(x => x.classList.remove('selected','dark-ring'));
    wheelBtn?.classList.add('selected');
  });
}

// ── Canvas drawing ──
function scheduleDrawVectorCanvas() {
  if (_drawRAF) return;
  _drawRAF = requestAnimationFrame(() => { _drawRAF = null; drawVectorCanvas(); });
}

export function drawVectorCanvas() {
  const canvas = document.getElementById('pixel-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (_bgImage) ctx.drawImage(_bgImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  [...vectorPaths, ...(currentPath ? [currentPath] : [])].forEach(path => {
    if (path.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = path.opacity !== undefined ? path.opacity : 1;
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
    ctx.stroke();
    ctx.restore();
  });
}

function getPoint(e) {
  const canvas = document.getElementById('pixel-canvas');
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_SIZE / rect.width;
  const scaleY = CANVAS_SIZE / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function startPaint(e) {
  isDrawing = true;
  const pt = getPoint(e);
  currentPath = {
    color: eraserMode ? '#ffffff' : drawColor,
    width: eraserMode ? Math.max(brushSize * 3, 20) : brushSize,
    opacity: eraserMode ? 1 : brushOpacity,
    points: [pt]
  };
}

function continuePaint(e) {
  if (!isDrawing || !currentPath) return;
  currentPath.points.push(getPoint(e));
  scheduleDrawVectorCanvas();
}

function endPaint() {
  if (currentPath && currentPath.points.length >= 1) {
    if (currentPath.points.length === 1) currentPath.points.push({ ...currentPath.points[0] });
    pushUndo();
    vectorPaths.push(currentPath);
  }
  currentPath = null;
  isDrawing = false;
  drawVectorCanvas();
}

function updateCursor() {
  const canvas = document.getElementById('pixel-canvas');
  const cur = document.getElementById('pixel-cursor');
  if (!canvas || !cur) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / CANVAS_SIZE;
  const screenSize = Math.max(4, (eraserMode ? Math.max(brushSize * 3, 20) : brushSize) * scaleX);
  cur.style.width  = screenSize + 'px';
  cur.style.height = screenSize + 'px';
}

// ── Avatar preview ──
export function updateAvatarPreview() {
  const preview = document.getElementById('avatar-preview-canvas');
  if (!preview) return;
  const src = document.getElementById('pixel-canvas');
  if (!src) return;
  const ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, 80, 80);
  ctx.save();
  ctx.beginPath();
  ctx.arc(40, 40, 40, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 80, 80);
  ctx.drawImage(src, 0, 0, 80, 80);
  ctx.restore();
}

// ── Bake canvas to PNG data URL ──
export function bakeAvatarDataUrl() {
  if (!vectorPaths || vectorPaths.length === 0) {
    if (_bgImage) {
      const offscreen = document.createElement('canvas');
      offscreen.width = offscreen.height = CANVAS_SIZE;
      const ctx = offscreen.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.drawImage(_bgImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      return offscreen.toDataURL();
    }
    return null;
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = CANVAS_SIZE;
  const ctx = offscreen.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (_bgImage) ctx.drawImage(_bgImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  vectorPaths.forEach(path => {
    if (path.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = path.opacity !== undefined ? path.opacity : 1;
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
    ctx.stroke();
    ctx.restore();
  });
  return offscreen.toDataURL();
}

// ── Mount shared canvas block into a slot ──
let _bgImage = null;

export function mountDrawBlock(slotId, existingDataUrl = null) {
  const block = document.getElementById('pixel-draw-block');
  const slot  = document.getElementById(slotId);
  if (block && slot) {
    block.style.display = '';
    slot.appendChild(block);
  }
  initPixelPalette();
  if (existingDataUrl) {
    const img = new Image();
    img.onload = () => {
      _bgImage = img;
      vectorPaths = [];
      undoStack = [];
      redoStack = [];
      drawVectorCanvas();
      updateUndoRedoBtns();
    };
    img.src = existingDataUrl;
  } else {
    _bgImage = null;
    drawVectorCanvas();
    updateUndoRedoBtns();
  }

  const canvas = document.getElementById('pixel-canvas');
  const cur    = document.getElementById('pixel-cursor');
  if (!canvas) return;
  canvas.style.cursor = 'none';
  canvas.onmousedown  = e => startPaint(e);
  canvas.onmouseup    = () => { endPaint(); updateAvatarPreview(); };
  canvas.ontouchstart = e => { e.preventDefault(); startPaint(e); };
  canvas.ontouchmove  = e => { e.preventDefault(); continuePaint(e); updateAvatarPreview(); };
  canvas.ontouchend   = () => { endPaint(); updateAvatarPreview(); };
  canvas.onmouseenter = () => { if (cur) { cur.style.display = 'block'; updateCursor(); } };
  canvas.onmouseleave = () => { if (cur) cur.style.display = 'none'; endPaint(); updateAvatarPreview(); };
  let _previewRAF = null;
  canvas.onmousemove  = e => {
    if (cur) { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }
    continuePaint(e);
    if (e.buttons && !_previewRAF) {
      _previewRAF = requestAnimationFrame(() => { _previewRAF = null; updateAvatarPreview(); });
    }
  };
}

// ── Expose to window for inline HTML onclick handlers ──
window.undoPixel        = undoPixel;
window.redoPixel        = redoPixel;
window.toggleEraser     = toggleEraser;
window.clearPixelCanvas = clearPixelCanvas;
window.stepBrushSize    = stepBrushSize;
window.stepOpacity      = stepOpacity;
window.onSizeSlider     = onSizeSlider;
window.onOpacitySlider  = onOpacitySlider;
window.toggleAdvanced   = toggleAdvanced;
