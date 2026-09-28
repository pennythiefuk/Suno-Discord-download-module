const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ffmpeg jobs: turning a Suno song into an MP3 that fits Discord's upload limit, and a live Opus stream for voice.

function run(cmd, args, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    try {
      os.setPriority(child.pid, 10); // below normal, so the bot (and any music playing) stays smooth
    } catch {}
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error(`ffmpeg wasn't found at "${cmd}" — see "INSTALLING FFMPEG" in README.txt`) : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      if (process.env.SUNO_TOOLS_DEBUG) console.error(`[suno] ${cmd} ${args.join(' ')}\n${stderr}`);
      reject(new Error(`ffmpeg failed (${code === null ? 'timed out' : `exit ${code}`}): ${stderr.trim().split('\n').slice(-2).join(' ')}`));
    });
  });
}

/** Is ffmpeg there? Resolves to its version line, or null. */
function ffmpegVersion(ffmpegPath) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(ffmpegPath, ['-version'], { windowsHide: true });
    } catch {
      return resolve(null);
    }
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.split('\n')[0].trim() : null));
  });
}

/** Downloads `url` to `file` (Node does the download, so ffmpeg only ever reads a local file). */
async function download(url, file, maxBytes = 200 * 1024 * 1024) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot; suno-tools)', Referer: 'https://suno.com/' }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? "that song's audio isn't available" : `download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('that download is too big');
  fs.writeFileSync(file, buf);
  return file;
}

/** The largest file the bot can upload in this server (Discord's limit goes up with server boosts). */
function uploadLimitFor(guild) {
  const tier = guild?.premiumTier || 0;
  return (tier >= 3 ? 100 : tier === 2 ? 50 : 10) * 1024 * 1024;
}

/**
 * The song as an MP3 Buffer, small enough for `maxBytes` (the bitrate drops for long songs), with its title, artist and
 * cover art tagged in so it shows properly in music players.
 */
async function makeMp3(song, { ffmpegPath, maxBytes, bitrate = 192 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-tools-'));
  try {
    const seconds = Number(song.duration) || 240;
    const fits = Math.floor(((maxBytes * 0.94 * 8) / seconds) / 1000); // kbps that fits, with room for the tags
    const kbps = Math.max(48, Math.min(bitrate, fits));
    const out = path.join(dir, 'song.mp3');
    const input = await download(song.audioUrl, path.join(dir, 'song.mp4'));
    const cover = song.imageUrl ? await download(song.imageUrl, path.join(dir, 'cover.img'), 10 * 1024 * 1024).catch(() => null) : null;
    const tags = ['-metadata', `title=${song.title}`, ...(song.artist ? ['-metadata', `artist=${song.artist}`] : []), '-metadata', 'comment=Made with Suno — ' + song.url];
    const plain = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, ...tags, '-id3v2_version', '3', out];
    if (cover) {
      // With the cover art; if the picture can't be used, try again without it.
      try {
        await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-c:v', 'mjpeg', '-vf', 'scale=500:500:force_original_aspect_ratio=decrease', '-disposition:v', 'attached_pic', ...tags, '-id3v2_version', '3', out]);
      } catch {
        await run(ffmpegPath, plain);
      }
    } else {
      await run(ffmpegPath, plain);
    }
    const buffer = fs.readFileSync(out);
    if (buffer.length > maxBytes) throw new Error('the song came out bigger than this server’s upload limit');
    return buffer;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The song as a live Ogg/Opus stream for voice (ffmpeg does the encoding, so no Opus npm package is needed). The song is
 * downloaded first (a few MB, a second or two) and the temp file removed when playback ends.
 * Returns { stream, stop() }.
 */
async function opusStream(song, { ffmpegPath, volume = 1 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-voice-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});
  let input;
  try {
    input = await download(song.audioUrl, path.join(dir, 'song.mp4'));
  } catch (err) {
    cleanup();
    throw err;
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-af', `volume=${volume}`, '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1'];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.env.SUNO_TOOLS_DEBUG && console.error(`[suno] voice ffmpeg: ${d}`));
  child.on('error', () => {});
  child.on('close', cleanup);
  return {
    stream: child.stdout,
    stop: () => {
      try {
        child.kill('SIGKILL');
      } catch {}
    },
  };
}

module.exports = { makeMp3, opusStream, ffmpegVersion, uploadLimitFor };
