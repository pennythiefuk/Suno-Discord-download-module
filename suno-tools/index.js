const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } = require('discord.js');
const suno = require('./lib/suno.js');
const { makeMp3, ffmpegVersion, uploadLimitFor } = require('./lib/audio.js');
const { createVoice } = require('./lib/voice.js');

// Suno Tools — download and play PUBLIC Suno songs in Discord. See README.txt for setup.
//
//   const sunoTools = require('./suno-tools')(client, require('./suno-tools/suno.config.js'));

const DEFAULTS = {
  prefix: '!',
  commands: { song: 'song', songStyle: 'songstyle', convert: 'convert', play: 'sunoplay', skip: 'sunoskip', stop: 'sunostop', queue: 'sunoqueue', autoConvert: 'sunoauto' },
  autoConvert: true,
  ffmpegPath: 'ffmpeg',
  mp3Bitrate: 192,
  cooldownSeconds: 15,
  lyricsFile: true,
  clientToken: '',
  dataFile: path.join(process.cwd(), 'suno-tools-data.json'),
  voice: { enabled: true, maxQueue: 100, leaveAfterSeconds: 120, volume: 0.8, playButton: true },
};
const PREFIX = 'sunotools';

function setupSunoTools(client, userConfig = {}) {
  const config = {
    ...DEFAULTS,
    ...userConfig,
    commands: { ...DEFAULTS.commands, ...(userConfig.commands || {}) },
    voice: { ...DEFAULTS.voice, ...(userConfig.voice || {}) },
  };
  const log = (...args) => console.warn('[suno]', ...args);
  const voice = config.voice.enabled ? createVoice({ config, log }) : null;
  const auth = config.clientToken ? suno.createAuth(String(config.clientToken).trim(), log) : null;
  let ffmpegOk = true;

  warnAboutSetup(client, config, voice);
  ffmpegVersion(config.ffmpegPath).then((v) => {
    ffmpegOk = Boolean(v);
    if (!v) log(`ffmpeg wasn't found at "${config.ffmpegPath}" — downloads and voice won't work until it's installed. See "INSTALLING FFMPEG" in README.txt.`);
  });
  if (auth) auth.check().then((ok) => ok && console.log('[suno] Signed in with your __client token — searches use Suno’s full search.'));

  // --- small saved settings: channels where auto-convert is off ------------------------------------------------------
  const dataFile = path.resolve(config.dataFile);
  let data = { autoConvertOff: {} };
  try {
    data = { autoConvertOff: {}, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) };
  } catch {}
  const save = () => {
    fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${dataFile}.tmp`, dataFile);
  };

  // --- finding songs --------------------------------------------------------------------------------------------------
  const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);

  /** Songs for a search: Suno's own search when a token works, else the public Explore lists. */
  async function searchSongs(query) {
    const viaToken = auth ? await auth.search(query, 20) : null;
    if (viaToken?.length) return viaToken;
    const pool = await suno.getPool();
    return suno.searchPool(pool.songs, query);
  }

  async function songsForStyle(style) {
    const matchesStyle = (s) => suno.searchPool([s], style, { styleOnly: true }).length > 0;
    if (auth) {
      const found = await auth.search(style, 50);
      const styled = (found || []).filter(matchesStyle);
      if (styled.length) return styled;
    }
    const pool = await suno.getPool();
    return suno.searchPool(pool.songs, style, { styleOnly: true });
  }

  /**
   * What a command's words point at: a Suno link (song / playlist / @profile), "@handle", a search, or nothing (a random
   * trending song). Returns { songs, label } — songs best-first.
   */
  async function findSongs(text) {
    const words = String(text || '').trim();
    const link = suno.findSunoLink(words);
    if (link) {
      const r = await suno.resolveLink(link);
      return { songs: r.songs, label: r.kind === 'song' ? null : r.name, kind: r.kind };
    }
    const handle = /^@([a-zA-Z0-9_.-]{2,})$/.exec(words);
    if (handle) {
      const r = await suno.resolveLink(`https://suno.com/@${handle[1]}`);
      return { songs: r.songs, label: r.name, kind: 'profile' };
    }
    if (!words) {
      const pool = await suno.getPool();
      return { songs: shuffle(pool.trending), label: 'Trending', kind: 'random' };
    }
    return { songs: await searchSongs(words), label: null, kind: 'search' };
  }

  // --- the song card (cover, style, length, model, lyrics file, the MP3) ------------------------------------------------
  function songCard(song, mp3) {
    const embed = new EmbedBuilder()
      .setColor(0x8288fe)
      .setTitle(song.title.slice(0, 256))
      .setURL(song.url)
      .setFooter({ text: 'Made with Suno · public song' });
    if (song.artist) embed.setAuthor({ name: song.artist.slice(0, 256), iconURL: song.artistIcon || undefined, url: song.handle ? `https://suno.com/@${song.handle}` : undefined });
    if (song.imageUrl) embed.setThumbnail(song.imageUrl);
    const fields = [];
    if (song.tags) fields.push({ name: 'Style', value: String(song.tags).slice(0, 1024) });
    if (song.duration) fields.push({ name: 'Length', value: `${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, '0')}`, inline: true });
    if (song.model) fields.push({ name: 'Model', value: String(song.model).slice(0, 100), inline: true });
    embed.addFields(fields);
    const safeName = song.title.replace(/[^\p{L}\p{N} _().-]/gu, '').trim().slice(0, 80) || 'suno-song';
    const files = [new AttachmentBuilder(mp3, { name: `${safeName}.mp3` })];
    if (config.lyricsFile && song.lyrics && song.lyrics.trim().length > 20) files.push(new AttachmentBuilder(Buffer.from(song.lyrics, 'utf8'), { name: `${safeName} - lyrics.txt` }));
    const components = [];
    if (voice?.available && config.voice.playButton) {
      components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:play:${song.id}`).setLabel('Play in voice').setEmoji('▶️').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setLabel('Open on Suno').setStyle(ButtonStyle.Link).setURL(song.url)));
    }
    return { embeds: [embed], files, components, allowedMentions: { parse: [], repliedUser: false } };
  }

  // One download/convert at a time (they're heavy), plus a per-person cooldown.
  let chain = Promise.resolve();
  const queued = (job) => (chain = chain.then(job, job));
  const lastUsed = new Map();
  function cooldownLeft(userId) {
    const left = (lastUsed.get(userId) || 0) + config.cooldownSeconds * 1000 - Date.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Downloads the first song in `songs` that works and posts its card. Returns the song, or throws. */
  async function postFirstWorking(message, songs, { quiet = false } = {}) {
    if (!ffmpegOk) throw new Error("ffmpeg isn't installed on the bot's computer, so songs can't be converted yet");
    let lastErr = null;
    for (const song of songs.slice(0, 4)) {
      try {
        const mp3 = await makeMp3(song, { ffmpegPath: config.ffmpegPath, maxBytes: uploadLimitFor(message.guild), bitrate: config.mp3Bitrate });
        await message.reply(songCard(song, mp3));
        return song;
      } catch (err) {
        lastErr = err;
        if (!quiet) log(`skipped "${song.title}": ${err.message}`);
      }
    }
    throw lastErr || new Error('nothing to download');
  }

  async function withStatus(message, text, work) {
    const status = await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
    try {
      await work();
      await status?.delete().catch(() => {});
    } catch (err) {
      const msg = `✗ ${String(err.message).slice(0, 300)}`;
      if (status) await status.edit({ content: msg }).catch(() => {});
      else await message.reply({ content: msg, allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  }

  // --- commands -------------------------------------------------------------------------------------------------------
  const cmd = config.commands;
  const HELP = {
    song: `\`${config.prefix}${cmd.song}\` a random trending song · \`${config.prefix}${cmd.song} <search>\` · \`${config.prefix}${cmd.song} @creator\` · \`${config.prefix}${cmd.song} <Suno link>\``,
    songStyle: `\`${config.prefix}${cmd.songStyle} <style>\` — a random song in that style, e.g. \`${config.prefix}${cmd.songStyle} lofi\``,
    play: `\`${config.prefix}${cmd.play} <Suno link, playlist, @creator or search>\` — plays in your voice channel (nothing after it = a trending song)`,
  };

  async function onCommand(message, name, rest) {
    const busy = cooldownLeft(message.author.id);
    const needsCooldown = [cmd.song, cmd.songStyle, cmd.convert].includes(name);
    if (needsCooldown && busy) return void message.reply({ content: `Slow down — try again in ${busy}s.`, allowedMentions: { repliedUser: false } }).catch(() => {});

    if (name === cmd.song) {
      lastUsed.set(message.author.id, Date.now());
      return withStatus(message, rest ? `🔎 Looking for **${rest.slice(0, 80)}** on Suno…` : '🎲 Grabbing a trending Suno song…', () =>
        queued(async () => {
          const { songs, kind } = await findSongs(rest);
          if (!songs.length) throw new Error(`no public Suno songs found for "${rest}".${auth ? '' : ' (Searches cover Suno’s Explore lists — see the README to search everything.)'}`);
          const pick = kind === 'search' || kind === 'song' ? songs : shuffle(songs);
          await postFirstWorking(message, pick);
        })
      );
    }

    if (name === cmd.songStyle) {
      if (!rest) {
        const pool = await suno.getPool().catch(() => null);
        return void message.reply({ content: `${HELP.songStyle}${pool?.styles?.length ? `\nPopular: ${pool.styles.join(', ')}` : ''}`, allowedMentions: { repliedUser: false } });
      }
      lastUsed.set(message.author.id, Date.now());
      return withStatus(message, `🎨 Finding a **${rest.slice(0, 60)}** song…`, () =>
        queued(async () => {
          const songs = await songsForStyle(rest);
          if (!songs.length) {
            const pool = await suno.getPool().catch(() => null);
            throw new Error(`no public songs in the style "${rest}" right now.${pool?.styles?.length ? ` Try: ${pool.styles.slice(0, 8).join(', ')}` : ''}`);
          }
          await postFirstWorking(message, shuffle(songs));
        })
      );
    }

    if (name === cmd.convert) {
      const link = suno.findSunoLink(rest);
      if (!link) return; // not a Suno link — left for any other !convert your bot has
      lastUsed.set(message.author.id, Date.now());
      return withStatus(message, '⟳ Downloading from Suno…', () =>
        queued(async () => {
          const r = await suno.resolveLink(link);
          if (r.kind !== 'song') throw new Error(`that's a Suno ${r.kind} — ${cmd.convert} takes one song. Use \`${config.prefix}${cmd.play}\` to play a whole ${r.kind} in voice.`);
          await postFirstWorking(message, r.songs);
        })
      );
    }

    if (voice && name === cmd.play) {
      if (!ffmpegOk) return void message.reply({ content: "ffmpeg isn't installed on the bot's computer, so voice playback won't work yet.", allowedMentions: { repliedUser: false } });
      try {
        const { songs, kind, label } = await findSongs(rest);
        if (!songs.length) return void message.reply({ content: `No public Suno songs found for "${rest}".`, allowedMentions: { repliedUser: false } });
        const list = kind === 'search' ? songs.slice(0, 1) : kind === 'random' ? songs.slice(0, 1) : kind === 'profile' ? shuffle(songs) : songs;
        const reply = await voice.add(message.member, message.channel, list);
        if (reply) await message.reply({ content: label && list.length > 1 ? `${reply} from **${label}**` : reply, allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        await message.reply({ content: `✗ ${err.message}`, allowedMentions: { repliedUser: false } }).catch(() => {});
      }
      return;
    }
    if (voice && name === cmd.skip) return void message.reply({ content: voice.skip(message.guild.id), allowedMentions: { parse: [], repliedUser: false } });
    if (voice && name === cmd.stop) return void message.reply({ content: voice.stop(message.guild.id), allowedMentions: { parse: [], repliedUser: false } });
    if (voice && name === cmd.queue) return void message.reply({ content: voice.queueText(message.guild.id), allowedMentions: { parse: [], repliedUser: false } });

    if (name === cmd.autoConvert) {
      if (!message.member?.permissions?.has(PermissionFlagsBits.ManageChannels)) return void message.reply({ content: 'You need the **Manage Channels** permission for that.', allowedMentions: { repliedUser: false } });
      const off = /\boff\b/i.test(rest);
      if (off) data.autoConvertOff[message.channel.id] = true;
      else delete data.autoConvertOff[message.channel.id];
      save();
      return void message.reply({ content: off ? '✓ Suno links in this channel won’t be converted automatically.' : '✓ Suno song links posted in this channel will be turned into MP3s automatically.', allowedMentions: { repliedUser: false } });
    }
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author?.bot) return;
    const content = message.content || '';
    try {
      if (content.startsWith(config.prefix)) {
        const [word, ...rest] = content.slice(config.prefix.length).split(/\s+/);
        const name = word.toLowerCase();
        if (Object.values(cmd).includes(name)) return void (await onCommand(message, name, rest.join(' ').trim()));
        return;
      }
      // Auto-convert: a message with a Suno SONG link (not inside <angle brackets>, which means "no preview, please").
      if (!config.autoConvert || data.autoConvertOff[message.channel.id]) return;
      const link = suno.findSunoLink(content);
      if (!link || content.includes(`<${link}`) || /\/(playlist|@)/.test(link)) return;
      queued(async () => {
        try {
          const r = await suno.resolveLink(link);
          if (r.kind === 'song') await postFirstWorking(message, r.songs, { quiet: true });
        } catch {
          // not a public song, or it didn't download — leave the link alone and say nothing
        }
      });
    } catch (err) {
      log('command failed:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton?.() || !interaction.customId.startsWith(`${PREFIX}:play:`)) return;
    try {
      const id = interaction.customId.split(':')[2];
      if (!voice?.available) return void (await interaction.reply({ content: 'Voice playback isn’t set up on this bot.', flags: MessageFlags.Ephemeral }));
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const song = await suno.getSong(id);
      const reply = await voice.add(interaction.member, interaction.channel, [song]);
      await interaction.editReply({ content: reply || `▶ Playing **${song.title}**` });
    } catch (err) {
      await interaction.editReply?.({ content: `✗ ${err.message}` }).catch(() => {});
    }
  });

  // --- for bots that already have their own music player ------------------------------------------------------------
  return {
    /**
     * Turns a Suno link (song, playlist, short link, @profile), "@handle" or search words into public songs your own
     * player can stream: [{ title, artist, url, audioUrl, imageUrl, duration, tags }]. audioUrl is an .mp4 whose sound
     * ffmpeg (or anything ffmpeg-based, like most music bots) can play directly.
     */
    resolve: async (text) => (await findSongs(text)).songs,
    /** Search public Suno songs (Suno's full search with a token, else the Explore lists). */
    search: searchSongs,
    /** Public songs in a style. */
    byStyle: songsForStyle,
    /** True when `text` contains a Suno link. */
    isSunoLink: (text) => Boolean(suno.findSunoLink(text)),
  };
}

function warnAboutSetup(client, config, voice) {
  const has = (bit) => client.options.intents?.has?.(bit);
  const missing = [];
  if (!has(GatewayIntentBits.Guilds)) missing.push('Guilds');
  if (!has(GatewayIntentBits.GuildMessages)) missing.push('GuildMessages');
  if (!has(GatewayIntentBits.MessageContent)) missing.push('MessageContent');
  if (voice && !has(GatewayIntentBits.GuildVoiceStates)) missing.push('GuildVoiceStates (for voice playback)');
  if (missing.length) console.warn(`[suno] Your client is missing these intents: ${missing.join(', ')}. See README.txt.`);
  if (voice && !voice.available) console.warn('[suno] Voice playback is on, but @discordjs/voice isn’t installed — run: npm install @discordjs/voice   (or set voice.enabled: false)');
}

module.exports = setupSunoTools;
module.exports.setupSunoTools = setupSunoTools;
