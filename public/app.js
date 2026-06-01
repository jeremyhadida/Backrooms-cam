// Backrooms Cam — app.js
const FILTER = {
  grain:      0.25,  // intensité du grain analogique
  vignette:   0.65,  // puissance de la vignette
  scanlines:  0.50,  // opacité des scanlines CCTV
  saturation: 0.82,  // désaturation globale (0=couleur pleine, 1=gris total)
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

  // Distorsion barrel (lentille caméra cheap)
  vec2 centered = uv - 0.5;
  float dist = dot(centered, centered);
  uv += centered * dist * 0.04;

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Aberration chromatique horizontale (décalage luma/chroma VHS)
  float ca = 0.004;
  vec4 color;
  color.r = texture2D(u_texture, uv + vec2(ca,  0.0)).r;
  color.g = texture2D(u_texture, uv).g;
  color.b = texture2D(u_texture, uv - vec2(ca * 0.6, 0.0)).b;
  color.a = 1.0;

  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 gray  = vec3(luma);

  // Désaturation sélective (look Backrooms/Lightroom):
  // Rouges -94%, Oranges -95%, Cyan -100%, Verts +17%
  float redness  = max(0.0, color.r - max(color.g, color.b));
  float cyanness = max(0.0, min(color.g, color.b) - color.r);
  float greenBoost = max(0.0, color.g - max(color.r, color.b));
  color.rgb = mix(color.rgb, gray, clamp(redness  * 5.5, 0.0, 0.94));
  color.rgb = mix(color.rgb, gray, clamp(cyanness * 5.0, 0.0, 1.0));
  color.rgb = mix(color.rgb, color.rgb + vec3(-0.01, 0.02, -0.01), clamp(greenBoost * 3.0, 0.0, 1.0));

  // Désaturation globale (Vibrance -45, Saturation -30 → ~35% sat résiduelle)
  color.rgb = mix(gray, color.rgb, 1.0 - u_saturation);

  // Contraste élevé (+48) via S-curve + exposition -0.23
  color.rgb *= 0.95;
  color.rgb = vec3(
    sCurve(color.rgb.r * 1.22 - 0.10),
    sCurve(color.rgb.g * 1.22 - 0.10),
    sCurve(color.rgb.b * 1.22 - 0.10)
  );

  // Highlight rolloff (-80 highlights, -55 whites) — filmic
  color.rgb = color.rgb / (color.rgb + vec3(0.25)) * 1.25;

  // Blacks crush (-25 blacks)
  color.rgb = max(color.rgb - vec3(0.032), vec3(0.0));

  // Cast fluorescent backrooms (ombres verts/sales, temp +19)
  float shadowMask = 1.0 - smoothstep(0.0, 0.45, luma);
  color.r += shadowMask * 0.018;
  color.g += shadowMask * 0.045;  // pousse vert dans les ombres (fluo)
  color.b -= shadowMask * 0.012;

  // Bandes de tracking VHS (bruit horizontal animé)
  float trackY   = floor(uv.y * 90.0 + u_time * 7.0);
  float tracking = rand(vec2(trackY, u_time * 0.3)) * 0.028;
  color.rgb += tracking * (1.0 - luma) * 0.6;

  // Scanlines CCTV fines
  float scanline = sin(uv.y * 580.0 * 3.14159) * 0.5 + 0.5;
  color.rgb *= 1.0 - u_scanlines * (1.0 - scanline) * 0.65;

  // Grain analogique (plus fort dans les ombres — capteur CCD)
  float noise = rand(uv * vec2(1366.0, 768.0) + fract(u_time * 19.7)) - 0.5;
  float shadowBoost = 1.0 + (1.0 - luma) * 1.8;
  color.rgb += noise * u_grain * shadowBoost;

  // Vignette
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
  if (winRatio > camRatio) {
    // Fenêtre plus large → pillarbox
    const vpH = ch;
    const vpW = Math.round(vpH * camRatio);
    gl.viewport(Math.round((cw - vpW) / 2), 0, vpW, vpH);
  } else {
    // Fenêtre plus haute → letterbox
    const vpW = cw;
    const vpH = Math.round(vpW / camRatio);
    gl.viewport(0, Math.round((ch - vpH) / 2), vpW, vpH);
  }
}

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
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
  showToast('Conversion en cours…');
  try {
    const res  = await fetch('/save-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`✓ Enregistré : ${data.filename}`);
  } catch (err) {
    showToast(`Erreur enregistrement : ${err.message}`, 6000);
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
