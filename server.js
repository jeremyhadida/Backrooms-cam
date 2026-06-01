const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = 3000;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/save-recording', express.raw({ type: 'video/webm', limit: '2gb' }));

app.post('/save-recording', (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const webmPath = path.join(RECORDINGS_DIR, `${ts}.webm`);
  const mp4Path  = path.join(RECORDINGS_DIR, `${ts}.mp4`);

  fs.writeFileSync(webmPath, req.body);

  execFile(ffmpegPath, [
    '-i', webmPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-movflags', '+faststart',
    mp4Path
  ], (err) => {
    fs.unlinkSync(webmPath);
    if (err) return res.status(500).json({ error: err.message });
    res.json({ filename: path.basename(mp4Path) });
  });
});

app.listen(PORT, () => {
  console.log(`Backrooms Cam → http://localhost:${PORT}`);
});
