// Backrooms Cam — app.js
const FILTER = {
  grain:      0.14,
  vignette:   0.88,
  scanlines:  0.22,
  saturation: 0.25,
  warmth:     0.18,
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

void main() {
  vec2 uv = v_texCoord;

  // Légère distorsion barrel (style CRT)
  vec2 centered = uv - 0.5;
  float dist = dot(centered, centered);
  uv += centered * dist * 0.04;

  // Sortir du canvas = noir
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 color = texture2D(u_texture, uv);

  // Désaturation
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(color.rgb, vec3(luma), 1.0 - u_saturation);

  // Teinte chaude ambre
  color.r += u_warmth * luma * 0.6;
  color.g += u_warmth * luma * 0.25;

  // Scanlines
  float line = sin(uv.y * 800.0) * 0.5 + 0.5;
  color.rgb *= 1.0 - u_scanlines * (1.0 - line);

  // Grain animé
  float noise = rand(uv + fract(u_time * 13.7));
  color.rgb += (noise - 0.5) * u_grain;

  // Vignette
  vec2 v = uv * (1.0 - uv.yx);
  float vig = pow(v.x * v.y * 15.0, u_vignette);
  color.rgb *= vig;

  gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
}`;

// ── WebGL setup ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const gl     = canvas.getContext('webgl');
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

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

function render(time) {
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
