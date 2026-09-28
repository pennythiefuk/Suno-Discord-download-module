# Suno Discord download module

Download and play **public** Suno songs in Discord. A drop-in module for any [discord.js](https://discord.js.org) v14 bot.

| Command | What it does |
|---|---|
| `!song` | A random trending Suno song, posted as an MP3 with its cover, style and lyrics |
| `!song <search>` | The best match for your search, e.g. `!song summer rain` |
| `!song @creator` | A random song by that Suno creator |
| `!song <Suno link>` | That song |
| `!songstyle <style>` | A random song in that style, e.g. `!songstyle lofi` |
| `!convert <Suno song link>` | The song as an MP3 (other links are left alone for any `!convert` your bot already has) |
| *automatic* | Post a Suno song link and the bot replies with the MP3 (`!sunoauto off` turns it off per channel) |
| `!sunoplay <link / playlist / @creator / search>` | Plays it in your voice channel (a playlist queues it all) |
| `!sunoskip` `!sunostop` `!sunoqueue` | Voice controls, plus a **▶ Play in voice** button under every song card |

Every command name can be changed in `suno-tools/suno.config.js`.

> **Public songs only.** This works with songs that have been published on suno.com. Private, unlisted and unpublished songs — including your own unpublished ones — can't be found, downloaded or played. The songs belong to their creators; every card links back to the song on Suno.

## Quick setup

1. Copy the `suno-tools` folder into your bot's folder.
2. `npm install @discordjs/voice` (only needed for voice playback).
3. Install **ffmpeg** — Windows: `winget install --id Gyan.FFmpeg -e` · Mac: `brew install ffmpeg` · Linux: `sudo apt install ffmpeg` · hosting panels: `npm install ffmpeg-static` and set `ffmpegPath: require('ffmpeg-static')`.
4. Turn on **Message Content Intent** in the [Discord Developer Portal](https://discord.com/developers/applications) (your bot → Bot → Privileged Gateway Intents).
5. Add one line after your client is created (with the `Guilds`, `GuildMessages`, `MessageContent` and `GuildVoiceStates` intents):

   ```js
   const sunoTools = require('./suno-tools')(client, require('./suno-tools/suno.config.js'));
   ```
6. Restart your bot.

Full step-by-step instructions, troubleshooting, and how to use it with a music player your bot already has: **[suno-tools/README.txt](suno-tools/README.txt)**. There's also a tiny standalone bot to try it with: [`example-bot.js`](example-bot.js).

## Search: works with no account, broader with a token

By default, searches cover Suno's public **Explore** lists (Trending, Staff Picks, New Songs, genre and mood lists — a few hundred songs that change every day). No account needed.

**Optional:** add a `__client` token from a Suno account to `.env` as `SUNO_CLIENT_TOKEN=...` and searches use Suno's own search, covering every public song. If the token stops working, the bot falls back to the public lists by itself.

> ⚠️ **Use a throwaway account — never your main Suno account.** The token is as good as that account's password, and automated use may be against Suno's terms.
>
> ⚠️ **Still public songs only.** The token only widens the *search*. It never gives access to private or unpublished songs.

How to get the token is explained step by step in [suno-tools/README.txt](suno-tools/README.txt) under **BROADER SEARCH**.

## Requirements

- Node.js 18+
- discord.js 14
- ffmpeg
- `@discordjs/voice` (for voice playback only)

## License

[MIT](LICENSE) — free to use, change and share, including in your own bots. The songs themselves belong to their creators on Suno.
