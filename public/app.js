// Backrooms Cam — app.js
const FILTER = {
  grain:      0.16,  // grain analogique
  vignette:   0.55,  // vignette
  scanlines:  0.28,  // scanlines CCTV
  saturation: 0.40,  // désaturation globale (0=couleur, 1=gris total)
  warmth:     0.15,
};

// ── Shaders ──────────────────────────────────────────────────────────────────

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
uniform float u_warmth;
varying vec2 v_texCoord;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

float sCurve(float v) {
  v = clamp(v, 0.0, 1.0);
  return v * v * (3.0 - 2.0 * v);
}

void main() {
  vec2 uv = v_texCoord;

  // Distorsion barrel légère (lentille caméra bon marché)
  vec2 centered = uv - 0.5;
  float dist = dot(centered, centered);
  uv += centered * dist * 0.025;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Aberration chromatique horizontale (décalage luma/chroma VHS)
  float ca = 0.0025;
  vec4 color;
  color.r = texture2D(u_texture, uv + vec2(ca,  0.0)).r;
  color.g = texture2D(u_texture, uv).g;
  color.b = texture2D(u_texture, uv - vec2(ca * 0.5, 0.0)).b;
  color.a = 1.0;

  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 gray  = vec3(luma);

  // ── Désaturation sélective (palette Backrooms) ────────────────────────────
  // Rouges/oranges → gris (peaux, teintes chaudes non-jaunes)
  float redness  = max(0.0, color.r - max(color.g, color.b));
  // Cyans/bleus → gris (les backrooms n'ont pas de bleu froid)
  float cyanblue = max(0.0, color.b - color.r * 0.8);
  color.rgb = mix(color.rgb, gray, clamp(redness  * 5.0, 0.0, 0.88));
  color.rgb = mix(color.rgb, gray, clamp(cyanblue * 4.0, 0.0, 0.90));

  // ── Désaturation globale modérée — conserver les jaunes! ─────────────────
  // (Lightroom: Vibrance -45, Sat -30 → ~55% de sat résiduelle)
  luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  gray = vec3(luma);
  color.rgb = mix(gray, color.rgb, 1.0 - u_saturation);

  // ── Cast chaud jaune-ambre (signature Backrooms) ──────────────────────────
  // Fluorescent incandescent : boost R+G, réduction forte du bleu
  color.r *= 1.06;
  color.g *= 1.01;
  color.b *= 0.72;
  // Normaliser pour éviter le clipping
  float mx = max(color.r, max(color.g, color.b));
  if (mx > 1.0) color.rgb /= mx;

  // ── Courbe tonale caméra de surveillance ──────────────────────────────────
  // Noirs légèrement levés (pas de vrai noir sur un capteur CCD bon marché)
  color.rgb = color.rgb * 0.92 + 0.03;
  // Contraste via S-curve
  color.rgb = vec3(
    sCurve(color.rgb.r * 1.16 - 0.07),
    sCurve(color.rgb.g * 1.16 - 0.07),
    sCurve(color.rgb.b * 1.16 - 0.07)
  );

  // ── Highlight rolloff (capteur saturé) ───────────────────────────────────
  color.rgb = color.rgb / (color.rgb + vec3(0.20)) * 1.20;

  // ── Bandes de tracking VHS (bruit horizontal animé) ──────────────────────
  float trackY   = floor(uv.y * 75.0 + u_time * 5.0);
  float tracking = rand(vec2(trackY, u_time * 0.2)) * 0.020;
  color.rgb += tracking * (1.0 - luma) * 0.5;

  // ── Scanlines CCTV fines ──────────────────────────────────────────────────
  float scanline = sin(uv.y * 560.0 * 3.14159) * 0.5 + 0.5;
  color.rgb *= 1.0 - u_scanlines * (1.0 - scanline) * 0.55;

  // ── Grain analogique (capteur CCD — plus fort dans les ombres) ───────────
  float noise = rand(uv * vec2(1366.0, 768.0) + fract(u_time * 17.3)) - 0.5;
  float shadowBoost = 1.0 + (1.0 - luma) * 1.4;
  color.rgb += noise * u_grain * shadowBoost;

  // ── Vignette ──────────────────────────────────────────────────────────────
  vec2 v = uv * (1.0 - uv.yx);
  float vig = pow(v.x * v.y * 15.0, u_vignette);
  color.rgb *= vig;

  gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
}`;

// ── WebGL setup ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const gl     = canvas.getContext('webgl', { preserveDrawingBuffer: true });  // requis pour captureStream
const video  = document.getElementById('video');

if (!gl) {
  document.getElementById('toast').textContent = 'WebGL non disponible — activer WebGL dans le navigateur';
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

// Quad plein écran (2 triangles)
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

// Uniforms
const uTime       = gl.getUniformLocation(prog, 'u_time');
const uGrain      = gl.getUniformLocation(prog, 'u_grain');
const uVignette   = gl.getUniformLocation(prog, 'u_vignette');
const uScanlines  = gl.getUniformLocation(prog, 'u_scanlines');
const uSaturation = gl.getUniformLocation(prog, 'u_saturation');
const uWarmth     = gl.getUniformLocation(prog, 'u_warmth');

gl.uniform1f(uGrain,      FILTER.grain);
gl.uniform1f(uVignette,   FILTER.vignette);
gl.uniform1f(uScanlines,  FILTER.scanlines);
gl.uniform1f(uSaturation, FILTER.saturation);
gl.uniform1f(uWarmth,     FILTER.warmth);
gl.clearColor(0, 0, 0, 1);

// Texture webcam
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

// ── Boucle de rendu ───────────────────────────────────────────────────────────

function updateViewport() {
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth  || cw;
  const vh = video.videoHeight || ch;
  const camRatio = vw / vh;
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

  // Contrôles : 20px depuis le coin bas-droit de la zone vidéo
  const ctrl = document.getElementById('controls');
  ctrl.style.right  = (canvas.width  - vpRect.x - vpRect.w + 20) + 'px';
  ctrl.style.bottom = (canvas.height - vpRect.y - vpRect.h + 20) + 'px';
}

function resize() {
  canvas.width  = window.innerWidth  & ~1;  // toujours pair (libx264)
  canvas.height = window.innerHeight & ~1;
  updateViewport();
}
window.addEventListener('resize', resize);
resize();

function render(time) {
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1f(uTime, time * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  requestAnimationFrame(render);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await startCamera(currentDeviceId);
    await populateCameraList();
    requestAnimationFrame(render);
  } catch (err) {
    showToast(`Erreur : ${err.message || 'Impossible d\'accéder à la caméra'}`, 8000);
  }
})();

// ── HUD ───────────────────────────────────────────────────────────────────────

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function updateHUD() {
  const d  = new Date();
  const mm = pad(d.getMonth() + 1), dd = pad(d.getDate()), yyyy = d.getFullYear();
  const hh = pad(d.getHours()), mi = pad(d.getMinutes()), ss = pad(d.getSeconds());
  const cs = pad(Math.floor(d.getMilliseconds() / 10));
  document.getElementById('hud-date').textContent = `${mm}/${dd}/${yyyy}`;
  document.getElementById('hud-time').textContent = `${hh}:${mi}:${ss}.${cs}`;
}
setInterval(updateHUD, 50);
updateHUD();

// Identifiant caméra — restaurer depuis localStorage
const camIdEl = document.getElementById('cam-id');
camIdEl.textContent = localStorage.getItem('camId') || 'CAM-01';

camIdEl.addEventListener('click', () => {
  const current = camIdEl.textContent;
  const input   = document.createElement('input');
  input.value   = current;
  input.style.cssText = [
    'background:transparent',
    'border:none',
    'border-bottom:1px solid #aaa',
    'color:#ddddc8',
    'font-family:inherit',
    'font-size:inherit',
    'font-weight:bold',
    'letter-spacing:1.5px',
    'outline:none',
    'width:180px',
  ].join(';');

  camIdEl.textContent = '';
  camIdEl.appendChild(input);
  input.focus();
  input.select();

  function save() {
    const val = input.value.trim() || current;
    camIdEl.textContent = val;
    localStorage.setItem('camId', val);
  }
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
});

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

// Sélecteur caméra (toggle)
document.getElementById('btn-camera').addEventListener('click', () => {
  document.getElementById('ctrl-camera').classList.toggle('open');
  clearTimeout(hideTimer);
});

// ── Enregistrement ────────────────────────────────────────────────────────────

let mediaRecorder = null;
let recChunks     = [];
const btnRec      = document.getElementById('btn-rec');

async function saveRecording() {
  const blob = new Blob(recChunks, { type: 'video/webm' });
  console.log(`[REC] chunks: ${recChunks.length}, blob: ${blob.size} bytes`);

  if (blob.size < 1000) {
    showToast(`Enregistrement vide (${blob.size} octets) — WebGL preserveDrawingBuffer?`, 7000);
    return;
  }

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
    console.error('[REC] erreur:', err);
    showToast(`Erreur : ${err.message}`, 8000);
  }
}

function startRecording() {
  const stream   = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  recChunks     = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop          = saveRecording;
  mediaRecorder.start(1000);
  btnRec.classList.add('recording');
  showToast('⏺ Enregistrement démarré');
}

function stopRecording() {
  mediaRecorder.stop();
  btnRec.classList.remove('recording');
}

btnRec.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
  showControls();
});
