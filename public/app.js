// Backrooms Cam — app.js
// ── PARAMÈTRES (ajuster à chaud, puis rafraîchir) ────────────────────────────
const FILTER = {
  grain:      0.20,   // Film Grain 20%
  vignette:   0.25,   // Vignette intensity 25%
  scanlines:  0.10,   // Scanlines opacity 10%
  saturation: 0.80,   // Désaturation 80% (monochrome)
  warmth:     0.0,
};

// ── Shaders ───────────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord  = a_texCoord;
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_time;
uniform float u_grain;
uniform float u_vignette;
uniform float u_scanlines;
uniform float u_saturation;
uniform float u_jitter;
uniform float u_glitch;
uniform float u_glitch_line;
varying vec2 v_texCoord;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_texCoord;

  // ── 1. Lens Distortion (0.03) ─────────────────────────────────────────────
  vec2 c = uv - 0.5;
  uv += c * dot(c, c) * 0.03;

  // ── 2. Horizontal Jitter VHS (2px) ───────────────────────────────────────
  float lineN = floor(uv.y * 240.0);
  float jRand = rand(vec2(lineN, floor(u_time * 6.0)));
  uv.x += step(0.94, jRand) * (rand(vec2(lineN, u_time)) - 0.5) * u_jitter * 0.008;

  // ── 3. Glitch — Horizontal Tear ──────────────────────────────────────────
  if (u_glitch > 0.5 && uv.y < u_glitch_line) {
    uv.x += (rand(vec2(uv.y * 17.0, u_time * 50.0)) - 0.5) * 0.10;
  }

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // ── 4. Chromatic Aberration (0.002) ──────────────────────────────────────
  float ca = 0.002;
  vec4 color;
  color.r = texture2D(u_texture, uv + vec2(ca, 0.0)).r;
  color.g = texture2D(u_texture, uv).g;
  color.b = texture2D(u_texture, uv - vec2(ca * 0.5, 0.0)).b;
  color.a = 1.0;

  // ── 5. Gaussian Blur (1.5px edge softening) ───────────────────────────────
  float bs = 0.0023;
  vec4 blurred =
    texture2D(u_texture, uv + vec2(-bs,-bs)) * 0.0625 +
    texture2D(u_texture, uv + vec2(0.0,-bs)) * 0.125  +
    texture2D(u_texture, uv + vec2( bs,-bs)) * 0.0625 +
    texture2D(u_texture, uv + vec2(-bs,0.0)) * 0.125  +
    texture2D(u_texture, uv              )  * 0.25   +
    texture2D(u_texture, uv + vec2( bs,0.0)) * 0.125  +
    texture2D(u_texture, uv + vec2(-bs, bs)) * 0.0625 +
    texture2D(u_texture, uv + vec2(0.0, bs)) * 0.125  +
    texture2D(u_texture, uv + vec2( bs, bs)) * 0.0625;
  color.rgb = mix(color.rgb, blurred.rgb, 0.55);

  // ── 6. Ghosting (5%) + Motion Smear (3%) ─────────────────────────────────
  vec3 ghost = texture2D(u_texture, uv + vec2(0.005, 0.0)).rgb;
  color.rgb  = mix(color.rgb, ghost, 0.05);
  vec3 smear = texture2D(u_texture, uv + vec2(0.003, 0.001)).rgb;
  color.rgb  = mix(color.rgb, smear, 0.03);

  // ── 7. JPEG Block Artifacts (medium) ─────────────────────────────────────
  float bw = 1.0 / 80.0;
  float bh = 1.0 / 60.0;
  vec2  blockUV  = (floor(uv / vec2(bw, bh)) + 0.5) * vec2(bw, bh);
  float blockRnd = rand(vec2(floor(uv.x / bw), floor(uv.y / bh)));
  color.rgb = mix(color.rgb, texture2D(u_texture, blockUV).rgb, 0.10);
  color.rgb += (blockRnd - 0.5) * 0.025;

  // ── 8. Shadow Crush (+15%) ───────────────────────────────────────────────
  color.rgb = max(color.rgb - vec3(0.038), vec3(0.0)) / (1.0 - 0.038);

  // ── 9. Highlight Clip (+20%) ─────────────────────────────────────────────
  color.rgb = min(color.rgb, vec3(0.85)) / 0.85;

  // ── 10. Brightness -10%, Contrast +20%, Gamma 0.9 ────────────────────────
  color.rgb *= 0.90;
  color.rgb  = (color.rgb - 0.5) * 1.20 + 0.5;
  color.rgb  = clamp(color.rgb, 0.0, 1.0);
  color.rgb  = pow(color.rgb, vec3(1.0 / 0.9));

  // ── 11. Désaturation -80% (monochrome) ───────────────────────────────────
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb  = mix(vec3(luma), color.rgb, 1.0 - u_saturation);

  // ── 12. Tint Backrooms #7B8D4D / #C5B76E (Green/Yellow) ──────────────────
  // Tint normalisé (max canal = 1.0) : #7B8D4D → (0.872, 1.0, 0.546)
  vec3 tintDark  = vec3(0.872, 1.000, 0.546);  // ombres (#7B8D4D norm)
  vec3 tintLight = vec3(0.990, 0.972, 0.703);  // hautes lumières (#C5B76E norm)
  vec3 tint      = mix(tintDark, tintLight, luma);
  color.rgb = mix(color.rgb, color.rgb * tint, 0.72);
  color.rgb = clamp(color.rgb, 0.0, 1.0);

  // ── 13. Bloom (threshold 0.8, intensity 0.3) ─────────────────────────────
  float bright = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float bloomF = max(0.0, bright - 0.8) * 5.0;
  float bls    = 0.007;
  vec3 bloomS  = (
    texture2D(u_texture, uv + vec2( bls, 0.0)).rgb +
    texture2D(u_texture, uv - vec2( bls, 0.0)).rgb +
    texture2D(u_texture, uv + vec2(0.0,  bls)).rgb +
    texture2D(u_texture, uv - vec2(0.0,  bls)).rgb
  ) * 0.25;
  bloomS       = mix(bloomS, bloomS * tint, 0.72);
  color.rgb   += bloomS * bloomF * 0.30;

  // ── 14. Tracking bands VHS ───────────────────────────────────────────────
  float trackY   = floor(uv.y * 80.0 + u_time * 5.0);
  float tracking = rand(vec2(trackY, u_time * 0.2)) * 0.018;
  color.rgb += tracking * (1.0 - luma) * 0.5;

  // ── 15. Scanlines (10% opacité, spacing 3px à 480 lignes) ────────────────
  float sl     = step(3.0, mod(uv.y * 480.0, 4.0));
  color.rgb   *= 1.0 - sl * u_scanlines;

  // ── 16. Film Grain 20% monochrome animé ──────────────────────────────────
  float noise  = rand(uv * vec2(640.0, 480.0) + fract(u_time * 23.7)) - 0.5;
  float shBoost= 1.0 + (1.0 - luma) * 1.2;
  color.rgb   += vec3(noise) * u_grain * shBoost;

  // ── 17. Vignette (25%, feather 70%) ──────────────────────────────────────
  float vd   = length(uv - 0.5) / 0.7071;
  float vig  = 1.0 - smoothstep(0.3, 1.0, vd) * u_vignette;
  color.rgb *= vig;

  // ── 18. Glitch Static Burst ───────────────────────────────────────────────
  if (u_glitch > 0.5) {
    float st = rand(vec2(uv.x * 200.0 + u_time * 500.0, uv.y * 200.0));
    if (st > 0.88) color.rgb = vec3(st * tint);
  }

  gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
}`;

// ── WebGL setup ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const gl     = canvas.getContext('webgl', { preserveDrawingBuffer: true });
const video  = document.getElementById('video');

if (!gl) {
  document.getElementById('toast').textContent = 'WebGL non disponible';
  document.getElementById('toast').classList.add('show');
  throw new Error('WebGL not supported');
}

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compileShader(gl.VERTEX_SHADER,   VERT_SRC));
gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, FRAG_SRC));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
  throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

const QUAD = new Float32Array([
  -1,-1, 0,1,   1,-1, 1,1,   -1,1, 0,0,
  -1, 1, 0,0,   1,-1, 1,1,    1,1, 1,0,
]);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

const aPos = gl.getAttribLocation(prog, 'a_position');
const aTex = gl.getAttribLocation(prog, 'a_texCoord');
gl.enableVertexAttribArray(aPos);
gl.enableVertexAttribArray(aTex);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

const uTime       = gl.getUniformLocation(prog, 'u_time');
const uGrain      = gl.getUniformLocation(prog, 'u_grain');
const uVignette   = gl.getUniformLocation(prog, 'u_vignette');
const uScanlines  = gl.getUniformLocation(prog, 'u_scanlines');
const uSaturation = gl.getUniformLocation(prog, 'u_saturation');
const uJitter     = gl.getUniformLocation(prog, 'u_jitter');
const uGlitch     = gl.getUniformLocation(prog, 'u_glitch');
const uGlitchLine = gl.getUniformLocation(prog, 'u_glitch_line');

gl.uniform1f(uGrain,      FILTER.grain);
gl.uniform1f(uVignette,   FILTER.vignette);
gl.uniform1f(uScanlines,  FILTER.scanlines);
gl.uniform1f(uSaturation, FILTER.saturation);
gl.uniform1f(uJitter,     1.0);
gl.uniform1f(uGlitch,     0.0);
gl.uniform1f(uGlitchLine, 0.5);
gl.clearColor(0, 0, 0, 1);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

function showToast(msg, duration = 4000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Caméra ────────────────────────────────────────────────────────────────────

let vpRect = { x: 0, y: 0, w: 0, h: 0 };
let currentDeviceId = localStorage.getItem('deviceId') || null;

async function startCamera(deviceId) {
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  try {
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    currentDeviceId = stream.getVideoTracks()[0].getSettings().deviceId;
    localStorage.setItem('deviceId', currentDeviceId);
    updateViewport();
  } catch (err) {
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      localStorage.removeItem('deviceId');
      return startCamera(null);
    }
    throw err;
  }
}

async function populateCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sel = document.getElementById('camera-select');
  sel.innerHTML = '';
  devices.filter(d => d.kind === 'videoinput').forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Caméra ${sel.options.length + 1}`;
    if (d.deviceId === currentDeviceId) opt.selected = true;
    sel.appendChild(opt);
  });
}

document.getElementById('camera-select').addEventListener('change', e => {
  startCamera(e.target.value).catch(err => showToast(`Erreur caméra : ${err.message}`));
});

// ── Viewport 4:3 forcé ────────────────────────────────────────────────────────

function updateViewport() {
  const cw = canvas.width, ch = canvas.height;
  const camRatio = 4 / 3;  // Output 4:3 (640x480)
  const winRatio = cw / ch;
  let vpX, vpY, vpW, vpH;
  if (winRatio > camRatio) {
    vpH = ch; vpW = Math.round(vpH * camRatio);
    vpX = Math.round((cw - vpW) / 2); vpY = 0;
  } else {
    vpW = cw; vpH = Math.round(vpW / camRatio);
    vpX = 0; vpY = Math.round((ch - vpH) / 2);
  }
  gl.viewport(vpX, vpY, vpW, vpH);
  vpRect = { x: vpX, y: vpY, w: vpW, h: vpH };
  positionOverlays();
}

function positionOverlays() {
  const hud = document.getElementById('hud');
  hud.style.left   = vpRect.x + 'px';
  hud.style.top    = vpRect.y + 'px';
  hud.style.width  = vpRect.w + 'px';
  hud.style.height = vpRect.h + 'px';
  const ctrl = document.getElementById('controls');
  ctrl.style.right  = (canvas.width  - vpRect.x - vpRect.w + 20) + 'px';
  ctrl.style.bottom = (canvas.height - vpRect.y - vpRect.h + 20) + 'px';
}

function resize() {
  canvas.width  = window.innerWidth  & ~1;
  canvas.height = window.innerHeight & ~1;
  updateViewport();
}
window.addEventListener('resize', resize);
resize();

// ── Render loop 15 FPS ───────────────────────────────────────────────────────

const TARGET_FPS    = 15;
const FRAME_MS      = 1000 / TARGET_FPS;
let   lastFrameTime = 0;

function render(now) {
  requestAnimationFrame(render);
  if (now - lastFrameTime < FRAME_MS) return;
  lastFrameTime = now;
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1f(uTime, now * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// ── Glitch system (every 5–20 s, 1–3 frames) ─────────────────────────────────

function triggerGlitch() {
  gl.uniform1f(uGlitch,     1.0);
  gl.uniform1f(uGlitchLine, Math.random());
  const duration = (Math.floor(Math.random() * 3) + 1) * FRAME_MS;
  setTimeout(() => {
    gl.uniform1f(uGlitch, 0.0);
    scheduleGlitch();
  }, duration);
}

function scheduleGlitch() {
  setTimeout(triggerGlitch, (Math.random() * 15 + 5) * 1000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await startCamera(currentDeviceId);
    await populateCameraList();
    requestAnimationFrame(render);
    scheduleGlitch();
  } catch (err) {
    showToast(`Erreur : ${err.message || "Impossible d'accéder à la caméra"}`, 8000);
  }
})();

// ── HUD ───────────────────────────────────────────────────────────────────────

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function updateHUD() {
  const d  = new Date();
  const mm = pad(d.getMonth() + 1), dd = pad(d.getDate()), yyyy = d.getFullYear();
  const hh = pad(d.getHours()), mi = pad(d.getMinutes()), ss = pad(d.getSeconds());
  document.getElementById('hud-date').textContent = `${mm}/${dd}/${yyyy}`;
  document.getElementById('hud-time').textContent = `${hh}:${mi}:${ss}`;
}
setInterval(updateHUD, 1000);
updateHUD();

function makeEditable(elId, storageKey, defaultVal) {
  const el = document.getElementById(elId);
  el.textContent = localStorage.getItem(storageKey) || defaultVal;
  el.addEventListener('click', () => {
    const cur = el.textContent;
    const inp = document.createElement('input');
    inp.value = cur;
    inp.style.cssText = 'background:transparent;border:none;border-bottom:1px solid #9aad6a;color:inherit;font:inherit;letter-spacing:inherit;outline:none;width:200px;';
    el.textContent = '';
    el.appendChild(inp);
    inp.focus(); inp.select();
    const save = () => {
      const val = inp.value.trim() || cur;
      el.textContent = val;
      localStorage.setItem(storageKey, val);
    };
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

makeEditable('cam-id',       'camId',       'CAMERA 07');
makeEditable('cam-level',    'camLevel',    'LEVEL 2');
makeEditable('cam-location', 'camLocation', 'THE BACKROOMS');

// ── Contrôles flottants ───────────────────────────────────────────────────────

const controls = document.getElementById('controls');
let hideTimer  = null;

function showControls() {
  controls.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.remove('visible'), 3000);
}

document.addEventListener('mousemove', showControls);
document.addEventListener('touchstart', showControls);

document.getElementById('btn-camera').addEventListener('click', () => {
  document.getElementById('ctrl-camera').classList.toggle('open');
  clearTimeout(hideTimer);
});

// ── Enregistrement ────────────────────────────────────────────────────────────

let mediaRecorder = null;
let recChunks     = [];
const btnRec      = document.getElementById('btn-rec');
const recStatus   = document.getElementById('rec-status');

async function saveRecording() {
  const blob = new Blob(recChunks, { type: 'video/webm' });
  if (blob.size < 1000) { showToast('Enregistrement vide', 5000); return; }
  showToast('Conversion en cours…');
  try {
    const res  = await fetch('/save-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`✓ Enregistré : ${data.filename}`);
  } catch (err) {
    showToast(`Erreur : ${err.message}`, 8000);
  }
}

function startRecording() {
  const stream   = canvas.captureStream(TARGET_FPS);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  recChunks     = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop          = saveRecording;
  mediaRecorder.start(1000);
  btnRec.classList.add('recording');
  recStatus.textContent = 'STATUS: RECORDING';
  showToast('⏺ Enregistrement démarré');
}

function stopRecording() {
  mediaRecorder.stop();
  btnRec.classList.remove('recording');
  recStatus.textContent = 'STATUS: MONITORING';
}

btnRec.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else startRecording();
  showControls();
});
