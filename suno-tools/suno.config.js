// Suno Tools — settings. Change what you like, then restart your bot.

module.exports = {
  // Commands people type. Rename any of them here (e.g. play: 'play' if your bot has no other !play).
  prefix: '!',
  commands: {
    song: 'song', //            !song · !song <search> · !song @creator · !song <Suno link>
    songStyle: 'songstyle', //  !songstyle <style>
    convert: 'convert', //      !convert <Suno song link>   (other links are left alone for any !convert your bot already has)
    play: 'sunoplay', //        !sunoplay <Suno link, playlist, @creator or search>  — plays in voice
    skip: 'sunoskip',
    stop: 'sunostop',
    queue: 'sunoqueue',
    autoConvert: 'sunoauto', // !sunoauto off / on — turn auto-convert off or on in one channel (Manage Channels)
  },

  // When someone posts a Suno song link, reply with the song as an MP3 automatically.
  autoConvert: true,

  // ffmpeg converts songs and streams them to voice. 'ffmpeg' if it's installed normally, or the full path
  // (e.g. 'C:/ffmpeg/bin/ffmpeg.exe'), or require('ffmpeg-static') if you installed it with npm. See README.txt.
  ffmpegPath: 'ffmpeg',

  // MP3 quality in kbps. Long songs get a lower bitrate automatically so they fit Discord's upload limit.
  mp3Bitrate: 192,

  // Seconds each person waits between !song / !songstyle / !convert.
  cooldownSeconds: 15,

  // Attach the song's lyrics as a .txt file when it has them.
  lyricsFile: true,

  // OPTIONAL — broader search. Leave empty to search Suno's public Explore lists (works with no account).
  // With a __client token from a THROWAWAY Suno account, searches cover every public song on Suno.
  // Put the token in your .env file as SUNO_CLIENT_TOKEN=... rather than here. See "BROADER SEARCH" in README.txt.
  clientToken: process.env.SUNO_CLIENT_TOKEN || '',

  // Where the per-channel auto-convert setting is saved.
  dataFile: './suno-tools-data.json',

  // Playing songs in voice channels. Needs: npm install @discordjs/voice
  // Turn this off if your bot already has its own music player — see "USING YOUR OWN MUSIC PLAYER" in README.txt.
  voice: {
    enabled: true,
    maxQueue: 100,
    leaveAfterSeconds: 120, // leave the voice channel after the queue has been empty this long
    volume: 0.8, //           0.1 – 2
    playButton: true, //      a "▶ Play in voice" button under each song card
  },
};
