const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = 3000;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/save-recording', express.raw({ type: 'video/webm', limit: '2gb' }));

app.post('/save-recording', (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const webmPath = path.join(RECORDINGS_DIR, `${ts}.webm`);
  const mp4Path  = path.join(RECORDINGS_DIR, `${ts}.mp4`);

  console.log(`[REC] body type: ${typeof req.body}, isBuffer: ${Buffer.isBuffer(req.body)}, size: ${req.body ? req.body.length : 'N/A'} bytes`);

  if (!Buffer.isBuffer(req.body) || req.body.length === 0)
    return res.status(400).json({ error: `Body invalide (taille: ${req.body ? req.body.length : 0})` });

  fs.writeFileSync(webmPath, req.body);
  console.log(`[REC] WebM écrit: ${webmPath}`);

  execFile(ffmpegPath, [
    '-i', webmPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',  // libx264 exige dimensions paires
    '-movflags', '+faststart',
    mp4Path
  ], (err, stdout, stderr) => {
    try { fs.unlinkSync(webmPath); } catch (_) {}
    if (err) {
      console.error(`[REC] ffmpeg erreur:\n${stderr}`);
      return res.status(500).json({ error: `ffmpeg: ${stderr.split('\n').slice(-4).join(' | ')}` });
    }
    console.log(`[REC] MP4 créé: ${mp4Path}`);
    res.json({ filename: path.basename(mp4Path) });
  });
});

app.listen(PORT, () => {
  console.log(`Backrooms Cam → http://localhost:${PORT}`);
});
