'use strict';

// ─── ASCII character sets ─────────────────────────────────────────────────────
const ASCII_STYLES = {
    classic: '@%#*+=-:. ',
    numbers: '9876543210 ',
    hindi:   'भमनरब९५३२१. ',
    matrix:  'ンヲワロレルラヨユヤモメムミマノネヌニナトテツチタソセスシサコケクキカオエウイア10 ',
    blocks:  '█▓▒░  ',
    minimal: '█▓▒:·. '
};

// ─── State ────────────────────────────────────────────────────────────────────
let stream            = null;
let animationFrameId  = null;
let isColorMode       = false;
let hideBoxOverlay    = false;
let densityMultiplier = 1.0;
let currentStyle      = 'classic';
let currentColor        = '#00ff00';
let colorSlots          = ['#00ff00', null, null, null, null];
let activeSlot          = 0;
let loadColorIntoPicker = null;
let onColorChanged      = null;
let ASCII_CHARS         = ASCII_STYLES.classic;
let lastAsciiLines    = [];
let charAspectRatio   = 0.601; // Courier New width/height — measured at init
let styleCharAspect   = 0.601; // re-measured whenever the active charset changes

// Drag / resize
let isDragging = false, isResizing = false, resizeDirection = null;
let dragStartX = 0, dragStartY = 0;
let boxStartX = 0, boxStartY = 0, boxStartWidth = 0, boxStartHeight = 0;
const MIN_BOX_W = 100, MIN_BOX_H = 80;

// Recording
let mediaRecorder = null, recordedChunks = [], isRecording = false;

// FPS tracking
let fpsFrameCount = 0, fpsLastTime = 0;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let video, captureCanvas, captureCtx;
let asciiBox, asciiCanvas, asciiCtx;
let errorMsg;
let downloadTextBtn, downloadImageBtn, downloadVideoBtn, stopVideoBtn;
let countdownOverlay, countdownNumber, fpsDisplay;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    video          = document.getElementById('video');
    captureCanvas  = document.getElementById('captureCanvas');
    captureCtx     = captureCanvas.getContext('2d', { willReadFrequently: true });
    asciiBox       = document.getElementById('asciiBox');
    asciiCanvas    = document.getElementById('asciiCanvas');
    asciiCtx       = asciiCanvas.getContext('2d');
    errorMsg       = document.getElementById('errorMsg');
    downloadTextBtn  = document.getElementById('downloadTextBtn');
    downloadImageBtn = document.getElementById('downloadImageBtn');
    downloadVideoBtn = document.getElementById('downloadVideoBtn');
    stopVideoBtn     = document.getElementById('stopVideoBtn');
    countdownOverlay = document.getElementById('countdownOverlay');
    countdownNumber  = document.getElementById('countdownNumber');
    fpsDisplay       = document.getElementById('fpsDisplay');

    measureCharAspect();

    downloadTextBtn.addEventListener('click', downloadAsText);
    downloadImageBtn.addEventListener('click', downloadAsImage);
    downloadVideoBtn.addEventListener('click', startVideoRecording);
    stopVideoBtn.addEventListener('click', stopVideoRecording);

    setupStyleSelector();
    setupCustomCharset();

    setupDensitySlider();
    setupDisplayToggles();
    setupColorPicker();
    setupColorSlots();
    setupMobilePanel();
    setupDraggablePanel();
    setupInteractiveBox();

    // Auto-start camera on page load
    initCamera();
});

// Measure the actual monospace character width/height ratio once (Courier New baseline)
function measureCharAspect() {
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = '100px "Courier New", monospace';
    charAspectRatio = tmp.measureText('M').width / 100;
    measureStyleCharAspect(); // also seed the per-style value for the initial charset
}

// Re-measure whenever the active charset changes — non-ASCII charsets (Devanagari,
// katakana) fall back to system fonts with very different character widths.
function measureStyleCharAspect() {
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = '100px "Courier New", monospace';
    const nonSpace = [...ASCII_CHARS].filter(c => c.trim());
    if (!nonSpace.length) { styleCharAspect = charAspectRatio; return; }
    // Average the width of up to 8 representative characters
    const samples = nonSpace.slice(0, Math.min(8, nonSpace.length));
    const avgW = samples.reduce((sum, c) => sum + tmp.measureText(c).width, 0) / samples.length;
    styleCharAspect = avgW / 100;
}

// ─── Camera ───────────────────────────────────────────────────────────────────
async function initCamera() {
    errorMsg.style.display = 'none';
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }
        });
        video.srcObject = stream;

        // Wait for metadata before play so dimensions are always ready
        await new Promise(resolve => {
            if (video.readyState >= 1) { resolve(); return; }
            video.addEventListener('loadedmetadata', resolve, { once: true });
        });

        await video.play();

        captureCanvas.width  = video.videoWidth;
        captureCanvas.height = video.videoHeight;

        asciiBox.classList.add('active');
        downloadTextBtn.disabled  = false;
        downloadImageBtn.disabled = false;
        downloadVideoBtn.disabled = false;

        fpsLastTime = performance.now();
        startFrameLoop();
    } catch (err) {
        errorMsg.textContent = `Camera error: ${err.message}`;
        errorMsg.style.display = 'block';
    }
}

function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    video.srcObject = null;
    asciiBox.classList.remove('active');
    downloadTextBtn.disabled  = true;
    downloadImageBtn.disabled = true;
    downloadVideoBtn.disabled = true;
    if (isRecording) stopVideoRecording();
    fpsDisplay.textContent = '-- fps';
}

// ─── Frame loop ───────────────────────────────────────────────────────────────
// Use requestVideoFrameCallback when available — it fires only when a new video
// frame actually arrives, preventing redundant processing of stale frames.
function startFrameLoop() {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        const tick = () => {
            if (!stream) return;
            processAndRender();
            trackFPS();
            video.requestVideoFrameCallback(tick);
        };
        video.requestVideoFrameCallback(tick);
    } else {
        const tick = () => {
            if (!stream) return;
            processAndRender();
            trackFPS();
            animationFrameId = requestAnimationFrame(tick);
        };
        animationFrameId = requestAnimationFrame(tick);
    }
}

function trackFPS() {
    fpsFrameCount++;
    const now = performance.now();
    if (now - fpsLastTime >= 1000) {
        const fps = Math.round(fpsFrameCount * 1000 / (now - fpsLastTime));
        if (fpsDisplay) fpsDisplay.textContent = `${fps} fps`;
        fpsFrameCount = 0;
        fpsLastTime = now;
    }
}

// ─── Core render pipeline ─────────────────────────────────────────────────────
function processAndRender() {
    if (!stream || !video.videoWidth) return;

    // 1. Draw mirrored video frame to capture canvas
    captureCtx.save();
    captureCtx.scale(-1, 1);
    captureCtx.drawImage(video, -captureCanvas.width, 0, captureCanvas.width, captureCanvas.height);
    captureCtx.restore();

    // 2. Get the region of interest
    const imageData = extractRegion();

    // 3. Calculate layout
    const { availW, availH } = getAvailableSize();
    const { asciiW, asciiH, charW, lineH, fontSize } = calcLayout(availW, availH);

    // 4. Resize the display canvas to exactly match the available area
    syncCanvasSize(availW, availH);

    // 5. Convert pixels → ASCII
    const { lines, colorData } = pixelsToAscii(imageData, asciiW, asciiH);
    lastAsciiLines = lines;

    // 6. Render to canvas
    if (isColorMode && colorData) {
        renderColorAscii(colorData, asciiW, asciiH, charW, lineH);
    } else {
        renderMonoAscii(lines, charW, lineH, fontSize);
    }
}

function getAvailableSize() {
    if (hideBoxOverlay) {
        return { availW: window.innerWidth, availH: window.innerHeight };
    }
    const r = asciiBox.getBoundingClientRect();
    return { availW: r.width, availH: r.height };
}

function syncCanvasSize(w, h) {
    const iw = Math.floor(w), ih = Math.floor(h);
    if (asciiCanvas.width !== iw)  asciiCanvas.width  = iw;
    if (asciiCanvas.height !== ih) asciiCanvas.height = ih;
}

function calcLayout(availW, availH) {
    // Use the per-style measured aspect so katakana/Devanagari get the right column count
    const baseH = 8;
    const baseW = baseH * styleCharAspect;

    const asciiW = Math.max(1, Math.round((availW / baseW) * densityMultiplier));
    const asciiH = Math.max(1, Math.round((availH / baseH) * densityMultiplier));

    const charW   = availW / asciiW;
    const lineH   = availH / asciiH;
    const fontSize = Math.min(charW / styleCharAspect, lineH);

    return { asciiW, asciiH, charW, lineH, fontSize };
}

// ─── Region extraction ────────────────────────────────────────────────────────
function extractRegion() {
    if (hideBoxOverlay) {
        return captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
    }

    const boxR  = asciiBox.getBoundingClientRect();
    const vidR  = video.getBoundingClientRect();
    const sx    = captureCanvas.width  / vidR.width;
    const sy    = captureCanvas.height / vidR.height;

    // Both the video element (CSS scaleX(-1)) and the capture canvas (ctx.scale(-1,1))
    // are mirrored the same way, so screen x maps directly to canvas x — no flip needed.
    const relLeft   = boxR.left  - vidR.left;
    const relRight  = boxR.right - vidR.left;
    const relTop    = boxR.top   - vidR.top;
    const relBottom = boxR.bottom - vidR.top;

    const cx = Math.max(0, Math.floor(relLeft * sx));
    const cy = Math.max(0, Math.floor(relTop  * sy));
    const cw = Math.max(1, Math.min(Math.floor((relRight - relLeft) * sx), captureCanvas.width  - cx));
    const ch = Math.max(1, Math.min(Math.floor((relBottom - relTop) * sy), captureCanvas.height - cy));

    return captureCtx.getImageData(cx, cy, cw, ch);
}

// ─── Pixel → ASCII conversion (box-averaged for quality) ─────────────────────
function pixelsToAscii(imageData, targetW, targetH) {
    const { data, width, height } = imageData;
    if (!width || !height) return { lines: [], colorData: null };

    const stepX = width  / targetW;
    const stepY = height / targetH;
    const chars = ASCII_CHARS;
    const lines = [];
    const colorData = isColorMode ? new Array(targetW * targetH) : null;

    for (let row = 0; row < targetH; row++) {
        let line = '';
        const y0 = Math.floor(row * stepY);
        const y1 = Math.min(height - 1, Math.ceil((row + 1) * stepY) - 1);

        for (let col = 0; col < targetW; col++) {
            const x0 = Math.floor(col * stepX);
            const x1 = Math.min(width - 1, Math.ceil((col + 1) * stepX) - 1);

            // Box-average the pixel region for this character cell
            let rSum = 0, gSum = 0, bSum = 0, n = 0;
            for (let py = y0; py <= y1; py++) {
                const rowOff = py * width;
                for (let px = x0; px <= x1; px++) {
                    const i = (rowOff + px) * 4;
                    rSum += data[i];
                    gSum += data[i + 1];
                    bSum += data[i + 2];
                    n++;
                }
            }

            const r = n ? rSum / n : 0;
            const g = n ? gSum / n : 0;
            const b = n ? bSum / n : 0;

            // Perceived luminance
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const ci  = Math.min(chars.length - 1, Math.floor(lum * chars.length));
            const ch  = chars[ci] || ' ';

            line += ch;
            if (isColorMode) {
                colorData[row * targetW + col] = { ch, r: r | 0, g: g | 0, b: b | 0 };
            }
        }
        lines.push(line);
    }

    return { lines, colorData };
}

// ─── Canvas renderers ─────────────────────────────────────────────────────────

function renderMonoAscii(lines, charW, lineH, fontSize) {
    const ctx = asciiCtx;
    const w = asciiCanvas.width, h = asciiCanvas.height;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    ctx.font         = `${fontSize}px "Courier New", monospace`;
    ctx.textBaseline = 'top';

    const filledColors = colorSlots.filter(Boolean);
    if (filledColors.length >= 2) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        filledColors.forEach((c, i) => {
            grad.addColorStop(i / (filledColors.length - 1), c);
        });
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = currentColor;
    }

    if (currentStyle === 'matrix') {
        const [r, g, b] = hexToRgb(currentColor);
        ctx.shadowColor = `rgba(${r},${g},${b},0.85)`;
        ctx.shadowBlur  = 6;
    } else {
        ctx.shadowBlur = 0;
    }

    if (!lines.length) return;

    // Fine-tune: correct sub-pixel rounding only (capped ±5%).
    // Large deviations are now handled by measureStyleCharAspect() at layout time.
    const sample    = lines.find(l => l.length > 0) || lines[0];
    const measuredW = ctx.measureText(sample).width;
    const rawScale  = measuredW > 0 ? w / measuredW : 1;
    const scaleX    = Math.max(0.95, Math.min(1.05, rawScale));

    ctx.save();
    ctx.scale(scaleX, 1);
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], 0, i * lineH);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
}

function renderColorAscii(colorData, asciiW, asciiH, charW, lineH) {
    const ctx = asciiCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, asciiCanvas.width, asciiCanvas.height);

    const fontSize = Math.min(charW / charAspectRatio, lineH);
    ctx.font         = `${fontSize}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    ctx.shadowBlur   = 0;

    let prevFill = '';
    for (let i = 0; i < colorData.length; i++) {
        const cell = colorData[i];
        if (!cell || cell.ch === ' ') continue;

        const col = i % asciiW;
        const row = (i / asciiW) | 0;
        const fill = `rgb(${cell.r},${cell.g},${cell.b})`;

        // Only update fillStyle when color actually changes — minimises GPU state flushes
        if (fill !== prevFill) {
            ctx.fillStyle = fill;
            prevFill = fill;
        }
        ctx.fillText(cell.ch, col * charW, row * lineH);
    }
}

// ─── Style selector ───────────────────────────────────────────────────────────
function setupStyleSelector() {
    document.querySelectorAll('.style-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStyle = btn.dataset.style;
            ASCII_CHARS  = ASCII_STYLES[currentStyle] || ASCII_STYLES.classic;
            measureStyleCharAspect(); // recalculate column width for this charset's font
        });
    });
}

// ─── Custom charset ───────────────────────────────────────────────────────────
function setupCustomCharset() {
    const input = document.getElementById('customCharset');
    const apply = document.getElementById('applyCustom');

    const activate = () => {
        const val = input.value.trim();
        if (val.length < 2) return;
        ASCII_CHARS  = val;
        currentStyle = 'custom';
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        measureStyleCharAspect();
    };

    apply.addEventListener('click', activate);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
}

// ─── Density ──────────────────────────────────────────────────────────────────
function setupDensitySlider() {
    const slider = document.getElementById('densitySlider');
    const label  = document.getElementById('densityValue');
    slider.addEventListener('input', () => {
        densityMultiplier = parseFloat(slider.value);
        label.textContent = densityMultiplier.toFixed(1) + '×';
    });
}

// ─── Display toggles (fullscreen + color mode) ────────────────────────────────
function setupDisplayToggles() {
    document.getElementById('hideBoxToggle').addEventListener('change', e => {
        hideBoxOverlay = e.target.checked;
        applyBoxMode();
    });

    document.getElementById('colorModeToggle').addEventListener('change', e => {
        isColorMode = e.target.checked;
        document.getElementById('colorSection').classList.toggle('dimmed', isColorMode);
    });
}

function applyBoxMode() {
    if (hideBoxOverlay) {
        asciiBox.classList.add('fullscreen');
    } else {
        asciiBox.classList.remove('fullscreen');
        // Restore draggable box to center if it was in fullscreen position
        const hasCustomPos = asciiBox.style.left && asciiBox.style.left !== '0px';
        if (!hasCustomPos) {
            asciiBox.style.width     = '';
            asciiBox.style.height    = '';
            asciiBox.style.top       = '';
            asciiBox.style.left      = '';
            asciiBox.style.transform = '';
        }
    }
}

// ─── Color picker ─────────────────────────────────────────────────────────────
function setupColorPicker() {
    const gradient    = document.getElementById('colorGradient');
    const selector    = document.getElementById('colorSelector');
    const hueSlider   = document.getElementById('hueSlider');
    const hueSelector = document.getElementById('hueSelector');
    const swatch      = document.getElementById('colorSwatch');
    const hexInput    = document.getElementById('hexInput');

    let hue = 120, sat = 100, lit = 50;
    let draggingGrad = false, draggingHue = false;

    function refreshGradientBg() {
        gradient.style.backgroundColor = `hsl(${hue},100%,50%)`;
    }

    function applyHSL() {
        const [r, g, b] = hslToRgb(hue, sat, lit);
        currentColor = rgbToHex(r, g, b);
        swatch.style.background = currentColor;
        hexInput.value = currentColor;
        refreshGradientBg();
        if (onColorChanged) onColorChanged(currentColor);
    }

    loadColorIntoPicker = (hex) => {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        currentColor = hex;
        swatch.style.background = hex;
        hexInput.value = hex;
        syncPickerUI(r, g, b);
    };

    function syncPickerUI(r, g, b) {
        const [h, s, l] = rgbToHsl(r, g, b);
        hue = h; sat = s; lit = l;
        selector.style.left = `${s}%`;
        selector.style.top  = `${100 - l}%`;
        hueSelector.style.left = `${h / 360 * 100}%`;
        refreshGradientBg();
    }

    applyHSL();

    gradient.addEventListener('mousedown', e => { draggingGrad = true; moveGrad(e); });
    hueSlider.addEventListener('mousedown', e => { draggingHue = true; moveHue(e); });

    document.addEventListener('mousemove', e => {
        if (draggingGrad) moveGrad(e);
        if (draggingHue)  moveHue(e);
    });
    document.addEventListener('mouseup', () => { draggingGrad = false; draggingHue = false; });

    function moveGrad(e) {
        const r = gradient.getBoundingClientRect();
        sat = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width  * 100));
        lit = Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / r.height) * 100));
        selector.style.left = `${sat}%`;
        selector.style.top  = `${100 - lit}%`;
        applyHSL();
    }

    function moveHue(e) {
        const r = hueSlider.getBoundingClientRect();
        hue = Math.max(0, Math.min(360, (e.clientX - r.left) / r.width * 360));
        hueSelector.style.left = `${hue / 360 * 100}%`;
        applyHSL();
    }

    hexInput.addEventListener('input', e => {
        let v = e.target.value;
        if (!v.startsWith('#')) v = '#' + v;
        if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
            const r = parseInt(v.slice(1,3),16);
            const g = parseInt(v.slice(3,5),16);
            const b = parseInt(v.slice(5,7),16);
            currentColor = v;
            swatch.style.background = v;
            syncPickerUI(r, g, b);
            if (onColorChanged) onColorChanged(currentColor);
        }
    });

    hexInput.addEventListener('blur', e => {
        let v = e.target.value;
        if (!v.startsWith('#')) v = '#' + v;
        if (!/^#[0-9A-Fa-f]{6}$/.test(v)) e.target.value = currentColor;
    });
}

// ─── Panel setup (collapse + drag) ────────────────────────────────────────────
function setupMobilePanel() {
    const toggle   = document.getElementById('panelToggle');
    const panel    = document.getElementById('stylePanel');
    const backdrop = document.getElementById('panelBackdrop');

    // Mobile bottom-sheet open/close
    function openPanel()  { panel.classList.add('open'); backdrop.classList.add('visible'); toggle.classList.add('active'); }
    function closePanel() { panel.classList.remove('open'); backdrop.classList.remove('visible'); toggle.classList.remove('active'); }

    if (toggle) {
        toggle.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
    }
    if (backdrop) {
        backdrop.addEventListener('click', closePanel);
    }
    document.querySelectorAll('.style-btn').forEach(btn =>
        btn.addEventListener('click', () => { if (window.innerWidth < 768) closePanel(); })
    );

    // Collapse-to-header toggle (desktop + tablet)
    const collapseBtn = document.getElementById('panelCollapseBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('collapsed');
        });
    }
}

// ─── Draggable panel ──────────────────────────────────────────────────────────
function setupDraggablePanel() {
    const panel  = document.getElementById('stylePanel');
    const header = document.getElementById('panelHeader');
    if (!panel || !header) return;

    let dragging = false, startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startX    = e.clientX;
        startY    = e.clientY;
        startLeft = rect.left;
        startTop  = rect.top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const newLeft = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  startLeft + e.clientX - startX));
        const newTop  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop  + e.clientY - startY));
        panel.style.left = newLeft + 'px';
        panel.style.top  = newTop  + 'px';
    });

    document.addEventListener('mouseup', () => { dragging = false; });
}

// ─── Color slots ──────────────────────────────────────────────────────────────
function setupColorSlots() {
    const slotsEl = document.getElementById('colorSlots');

    function renderSlots() {
        slotsEl.innerHTML = '';
        colorSlots.forEach((color, i) => {
            const slot = document.createElement('div');
            if (color !== null) {
                slot.className = 'color-slot filled' + (i === activeSlot ? ' active' : '');
                slot.style.background = color;
                slot.addEventListener('click', () => {
                    activeSlot = i;
                    renderSlots();
                    if (loadColorIntoPicker) loadColorIntoPicker(colorSlots[i]);
                });
                if (i > 0) {
                    const rm = document.createElement('span');
                    rm.className = 'slot-remove';
                    rm.textContent = '×';
                    rm.addEventListener('click', e => {
                        e.stopPropagation();
                        colorSlots[i] = null;
                        if (activeSlot === i) {
                            activeSlot = 0;
                            if (loadColorIntoPicker) loadColorIntoPicker(colorSlots[0]);
                        }
                        renderSlots();
                    });
                    slot.appendChild(rm);
                }
            } else {
                slot.className = 'color-slot empty';
                slot.textContent = '+';
                slot.addEventListener('click', () => {
                    colorSlots[i] = currentColor;
                    activeSlot = i;
                    renderSlots();
                });
            }
            slotsEl.appendChild(slot);
        });
    }

    renderSlots();

    onColorChanged = (color) => {
        colorSlots[activeSlot] = color;
        renderSlots();
    };
}

// ─── Drag + resize box ────────────────────────────────────────────────────────
function setupInteractiveBox() {
    asciiBox.addEventListener('mousedown', onBoxMouseDown);
    asciiBox.addEventListener('touchstart', e => { if (!hideBoxOverlay) onBoxTouchStart(e); }, { passive: false });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   () => { isDragging = isResizing = false; });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  () => { isDragging = isResizing = false; });
    asciiBox.addEventListener('selectstart', e => e.preventDefault());
}

function onBoxMouseDown(e) {
    if (hideBoxOverlay) return;
    beginInteraction(e.clientX, e.clientY, e.target);
    e.preventDefault();
}

function onBoxTouchStart(e) {
    if (e.touches.length !== 1) return;
    beginInteraction(e.touches[0].clientX, e.touches[0].clientY, e.target);
    e.preventDefault();
}

function beginInteraction(cx, cy, target) {
    const isHandle = target.classList.contains('resize-handle');
    if (isHandle) {
        isResizing = true; isDragging = false;
        resizeDirection = getResizeDir(target);
    } else if (target === asciiBox || target === asciiCanvas) {
        isDragging = true; isResizing = false;
    } else { return; }

    asciiBox.style.transform = 'none';
    const r = asciiBox.getBoundingClientRect();
    dragStartX = cx; dragStartY = cy;
    boxStartX = r.left; boxStartY = r.top;
    boxStartWidth = r.width; boxStartHeight = r.height;
    asciiBox.style.left = `${r.left}px`;
    asciiBox.style.top  = `${r.top}px`;
}

function onMouseMove(e) {
    if (!isDragging && !isResizing) return;
    e.preventDefault();
    applyDelta(e.clientX - dragStartX, e.clientY - dragStartY);
}

function onTouchMove(e) {
    if (!isDragging && !isResizing) return;
    applyDelta(e.touches[0].clientX - dragStartX, e.touches[0].clientY - dragStartY);
    e.preventDefault();
}

function applyDelta(dx, dy) {
    if (isDragging) {
        const x = clamp(boxStartX + dx, 0, window.innerWidth  - boxStartWidth);
        const y = clamp(boxStartY + dy, 0, window.innerHeight - boxStartHeight);
        asciiBox.style.left = `${x}px`;
        asciiBox.style.top  = `${y}px`;
    } else if (isResizing) {
        let { nx, ny, nw, nh } = applyResize(dx, dy);
        nx = clamp(nx, 0, window.innerWidth  - nw);
        ny = clamp(ny, 0, window.innerHeight - nh);
        asciiBox.style.left   = `${nx}px`;
        asciiBox.style.top    = `${ny}px`;
        asciiBox.style.width  = `${nw}px`;
        asciiBox.style.height = `${nh}px`;
    }
}

function applyResize(dx, dy) {
    let nx = boxStartX, ny = boxStartY, nw = boxStartWidth, nh = boxStartHeight;
    const d = resizeDirection;

    if (d.includes('e')) nw = Math.max(MIN_BOX_W, boxStartWidth  + dx);
    if (d.includes('s')) nh = Math.max(MIN_BOX_H, boxStartHeight + dy);
    if (d.includes('w')) { nw = Math.max(MIN_BOX_W, boxStartWidth  - dx); nx = boxStartX + (boxStartWidth  - nw); }
    if (d.includes('n')) { nh = Math.max(MIN_BOX_H, boxStartHeight - dy); ny = boxStartY + (boxStartHeight - nh); }

    return { nx, ny, nw, nh };
}

function getResizeDir(el) {
    for (const d of ['nw','ne','sw','se','n','s','w','e']) {
        if (el.classList.contains(`resize-handle-${d}`)) return d;
    }
    return 'se';
}

// ─── Downloads ────────────────────────────────────────────────────────────────
function downloadAsText() {
    if (!lastAsciiLines.length) return;
    const blob = new Blob([lastAsciiLines.join('\n')], { type: 'text/plain' });
    triggerDownload(URL.createObjectURL(blob), `ascii-${Date.now()}.txt`);
}

function downloadAsImage() {
    // The ASCII is already rendered on asciiCanvas — just export it directly
    asciiCanvas.toBlob(blob => {
        triggerDownload(URL.createObjectURL(blob), `ascii-${Date.now()}.png`);
    }, 'image/png');
}

function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Video recording ─────────────────────────────────────────────────────────
function startVideoRecording() {
    if (!stream) return;
    downloadVideoBtn.disabled = true;
    countdownOverlay.style.display = 'flex';
    let count = 3;
    countdownNumber.textContent = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownNumber.textContent = count;
        } else {
            clearInterval(interval);
            countdownOverlay.style.display = 'none';
            beginRecording();
        }
    }, 1000);
}

function beginRecording() {
    // Capture directly from the live ASCII canvas — no extra canvas needed
    const canvasStream = asciiCanvas.captureStream(30);
    recordedChunks = [];
    isRecording = true;

    const supported = ['video/mp4;codecs=h264','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
    const mimeType  = supported.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    try {
        mediaRecorder = new MediaRecorder(canvasStream, { mimeType });

        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(recordedChunks, { type: mimeType });
            triggerDownload(URL.createObjectURL(blob), `ascii-video-${Date.now()}.${ext}`);
            isRecording = false;
            downloadVideoBtn.disabled = false;
            stopVideoBtn.disabled = true;
            stopVideoBtn.style.display = 'none';
        };

        mediaRecorder.start();
        stopVideoBtn.disabled = false;
        stopVideoBtn.style.display = 'inline-block';
    } catch (err) {
        console.error('Recording error:', err);
        isRecording = false;
        downloadVideoBtn.disabled = false;
        alert('Video recording not supported in this browser.');
    }
}

function stopVideoRecording() {
    if (mediaRecorder && isRecording) { isRecording = false; mediaRecorder.stop(); }
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };
    return [hue2rgb(p,q,h+1/3), hue2rgb(p,q,h), hue2rgb(p,q,h-1/3)].map(v => Math.round(v * 255));
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return [h * 360, s * 100, l * 100];
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
