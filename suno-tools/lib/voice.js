// A small voice player for Suno songs: a queue per server, skip, stop, and it leaves when the queue's been empty a while.
// Needs the @discordjs/voice package (npm install @discordjs/voice). If it isn't installed, voice commands just say so.

const { opusStream } = require('./audio.js');

let voiceLib = null;
try {
  voiceLib = require('@discordjs/voice');
} catch {
  voiceLib = null;
}

const fmt = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '?:??');

function createVoice({ config, log }) {
  const guilds = new Map(); // guildId -> state

  function stateFor(guild) {
    let s = guilds.get(guild.id);
    if (!s) {
      const { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus } = voiceLib;
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause, maxMissedFrames: 250 } });
      s = { guild, player, connection: null, queue: [], current: null, ffmpeg: null, textChannel: null, idleTimer: null };
      player.on(AudioPlayerStatus.Idle, () => {
        killFfmpeg(s);
        s.current = null;
        playNext(s);
      });
      player.on('error', (err) => {
        log(`voice: "${s.current?.title}" stopped with an error: ${err.message}`);
      });
      guilds.set(guild.id, s);
    }
    return s;
  }

  function killFfmpeg(s) {
    s.ffmpeg?.stop();
    s.ffmpeg = null;
  }

  function leave(s) {
    clearTimeout(s.idleTimer);
    s.queue = [];
    s.current = null;
    s.player.stop(true);
    killFfmpeg(s);
    try {
      s.connection?.destroy();
    } catch {}
    s.connection = null;
    guilds.delete(s.guild.id);
  }

  async function playNext(s) {
    const { createAudioResource, StreamType } = voiceLib;
    clearTimeout(s.idleTimer);
    const song = s.queue.shift();
    if (!song) {
      s.idleTimer = setTimeout(() => leave(s), config.voice.leaveAfterSeconds * 1000);
      s.idleTimer.unref?.();
      return;
    }
    s.current = song;
    try {
      s.ffmpeg = await opusStream(song, { ffmpegPath: config.ffmpegPath, volume: config.voice.volume });
    } catch (err) {
      log(`voice: couldn't load "${song.title}": ${err.message}`);
      s.textChannel?.send({ content: `✗ Couldn't play **${song.title}** — skipping it.`, allowedMentions: { parse: [] } }).catch(() => {});
      s.current = null;
      return playNext(s);
    }
    if (s.current !== song) return void s.ffmpeg.stop(); // stopped/skipped while it was loading
    s.player.play(createAudioResource(s.ffmpeg.stream, { inputType: StreamType.OggOpus }));
    s.textChannel?.send({ content: `▶ Now playing **${song.title}**${song.artist ? ` by ${song.artist}` : ''} · ${fmt(song.duration)}`, allowedMentions: { parse: [] } }).catch(() => {});
  }

  /** Adds songs and joins the person's voice channel. Returns a message to show them. */
  async function add(member, textChannel, songs) {
    if (!voiceLib) return "Voice playback isn't set up on this bot (the @discordjs/voice package isn't installed).";
    const channel = member?.voice?.channel;
    if (!channel) return 'Join a voice channel first.';
    const { joinVoiceChannel, entersState, VoiceConnectionStatus } = voiceLib;
    const s = stateFor(member.guild);
    if (s.connection && s.connection.joinConfig.channelId !== channel.id && (s.current || s.queue.length)) return `I'm already playing in <#${s.connection.joinConfig.channelId}> — join that channel, or stop it first.`;
    s.textChannel = textChannel;
    if (!s.connection || s.connection.joinConfig.channelId !== channel.id || s.connection.state.status === VoiceConnectionStatus.Destroyed) {
      try {
        s.connection?.destroy();
      } catch {}
      s.connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true });
      s.connection.subscribe(s.player);
      s.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([entersState(s.connection, VoiceConnectionStatus.Signalling, 5000), entersState(s.connection, VoiceConnectionStatus.Connecting, 5000)]);
        } catch {
          leave(s); // kicked or the channel went away
        }
      });
      try {
        await entersState(s.connection, VoiceConnectionStatus.Ready, 20000);
      } catch {
        leave(s);
        return "Couldn't join your voice channel — check I have the Connect and Speak permissions there.";
      }
    }
    const room = Math.max(0, config.voice.maxQueue - s.queue.length);
    const added = songs.slice(0, room);
    s.queue.push(...added);
    if (!s.current) playNext(s);
    if (!added.length) return 'The queue is full.';
    if (added.length === 1) return s.current === added[0] ? null : `➕ Queued **${added[0].title}** (#${s.queue.indexOf(added[0]) + 1})`;
    return `➕ Queued ${added.length} songs${songs.length > added.length ? ` (the queue's limit is ${config.voice.maxQueue})` : ''}.`;
  }

  function skip(guildId) {
    const s = guilds.get(guildId);
    if (!s?.current) return 'Nothing is playing.';
    const title = s.current.title;
    if (s.player.state.status === voiceLib.AudioPlayerStatus.Idle) {
      s.current = null; // still loading — playNext sees this and drops it
      playNext(s);
    } else {
      s.player.stop(true); // → Idle → the next song
    }
    return `⏭ Skipped **${title}**.`;
  }

  function stop(guildId) {
    const s = guilds.get(guildId);
    if (!s) return 'Nothing is playing.';
    leave(s);
    return '⏹ Stopped and left the voice channel.';
  }

  function queueText(guildId) {
    const s = guilds.get(guildId);
    if (!s?.current) return 'Nothing is playing.';
    const lines = [`▶ **${s.current.title}**${s.current.artist ? ` by ${s.current.artist}` : ''} · ${fmt(s.current.duration)}`];
    s.queue.slice(0, 10).forEach((song, i) => lines.push(`${i + 1}. ${song.title}${song.artist ? ` — ${song.artist}` : ''} · ${fmt(song.duration)}`));
    if (s.queue.length > 10) lines.push(`…and ${s.queue.length - 10} more`);
    return lines.join('\n');
  }

  return { available: Boolean(voiceLib), add, skip, stop, queueText, _guilds: guilds };
}

module.exports = { createVoice };
