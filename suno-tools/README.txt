SUNO TOOLS — download and play public Suno songs in Discord
============================================================

  !song                      a random trending Suno song, posted as an MP3 with its cover, style and lyrics
  !song <search>             the best match for your search          e.g.  !song summer rain
  !song @creator             a random song by that Suno creator      e.g.  !song @someartist
  !song <Suno link>          that song
  !songstyle <style>         a random song in that style             e.g.  !songstyle lofi
  !convert <Suno song link>  the song as an MP3
  (automatic)                post a Suno song link and the bot replies with the MP3

  Voice channels:
  !sunoplay <link / playlist / @creator / search>   play it in your voice channel (a playlist queues it all)
  !sunoplay                  play a random trending song
  !sunoskip  !sunostop  !sunoqueue
  ▶ Play in voice            a button under every song card

  Server admins (Manage Channels):
  !sunoauto off / on         turn the automatic MP3 replies off or on in that channel

Every command name can be changed in suno.config.js.

PUBLIC SONGS ONLY. This works with songs that have been published on suno.com (the ones anyone
can open without logging in). Private, unlisted and unpublished songs — including your own
unpublished ones — can't be found, downloaded or played. The songs belong to their creators;
every card links back to the song on Suno.

Works with no Suno account at all. Searching without one covers Suno's public Explore lists
(Trending, Staff Picks, New Songs and the genre/mood lists — a few hundred songs that change every
day). To search ALL public songs, see "BROADER SEARCH" below.


WHAT YOU NEED
-------------
- Node.js 18 or newer, and discord.js 14   (npm install discord.js@14)
- ffmpeg — turns songs into MP3s and plays them in voice. See "INSTALLING FFMPEG".
- For voice channels: the @discordjs/voice package (step 2).


SETUP
-----
1) Copy the "suno-tools" folder into your bot's folder.

2) In your bot's folder, run:

       npm install @discordjs/voice

   (Only needed for voice playback. No other audio packages are needed — ffmpeg does the rest.)

3) Install ffmpeg — see "INSTALLING FFMPEG" below.

4) Turn on the Message Content intent:
   https://discord.com/developers/applications → your bot → "Bot" → Privileged Gateway Intents
   → switch on MESSAGE CONTENT INTENT → Save.

5) In your main bot file, make sure your client has these intents, then add the Suno line after it:

       const { Client, GatewayIntentBits } = require('discord.js');

       const client = new Client({
         intents: [
           GatewayIntentBits.Guilds,
           GatewayIntentBits.GuildMessages,
           GatewayIntentBits.MessageContent,
           GatewayIntentBits.GuildVoiceStates, // for voice playback
         ],
       });

       const sunoTools = require('./suno-tools')(client, require('./suno-tools/suno.config.js'));

6) Look through suno-tools/suno.config.js (every setting is explained there), then restart your bot.

The bot needs these permissions in your channels: Send Messages, Attach Files, Embed Links, and for
voice: Connect and Speak. If something's missing, it prints a "[suno]" warning when it starts.


INSTALLING FFMPEG
-----------------
  Windows (PowerShell or Command Prompt):
      winget install --id Gyan.FFmpeg -e
    then CLOSE the window and open a new one.
    No winget? Download the "release essentials" zip from https://www.gyan.dev/ffmpeg/builds/,
    unzip it to C:\ffmpeg, and set  ffmpegPath: 'C:/ffmpeg/bin/ffmpeg.exe'  in suno.config.js.

  Mac (Homebrew, https://brew.sh):
      brew install ffmpeg

  Linux (Ubuntu / Debian):
      sudo apt update && sudo apt install -y ffmpeg

  A hosting panel where you can't install programs (Pterodactyl, etc.):
      npm install ffmpeg-static
    and in suno.config.js:  ffmpegPath: require('ffmpeg-static'),

  Check it works — in a NEW terminal window:   ffmpeg -version
  Using pm2? Run  pm2 kill  and start your bot again after installing, so pm2 can find ffmpeg.


BROADER SEARCH (optional) — the __client token
-----------------------------------------------
Without a token, !song <search> and !songstyle only look through Suno's public Explore lists.
With a __client token from a Suno account, they use Suno's own search, which covers every
public song on Suno. Downloads and playing links work the same either way.

  !! USE A THROWAWAY ACCOUNT — NOT YOUR MAIN SUNO ACCOUNT !!
  - The token is as good as that account's password. Anyone who gets it can use the account.
  - Automated use may be against Suno's terms, and the account could be limited or banned.
  - Make a new, free Suno account just for your bot. Never put credits or anything you care
    about on it.

  !! IT'S STILL PUBLIC SONGS ONLY !!
  The token only widens the SEARCH. It does NOT give access to private or unpublished songs —
  not even ones on that account. The bot only ever finds, downloads and plays published songs.

How to get it (Chrome, Edge or Firefox on a computer):
  1. Open a private/incognito window, go to https://suno.com and sign in with your THROWAWAY account.
  2. Press F12 to open the developer tools.
  3. Chrome/Edge: open the "Application" tab → "Cookies" (left side).
     Firefox:     open the "Storage" tab → "Cookies".
     Click each suno.com entry in the list (e.g. https://suno.com and https://auth.suno.com) and look
     for a cookie named  __client  — copy its whole Value (a long string that starts with "eyJ").
     Can't find it? Use the "Network" tab instead: reload the page, type  client  in the filter box,
     click a request to auth.suno.com, and in its Request Headers find  Cookie:  — copy the part
     after  __client=  up to the next ; (or the end).
  4. Close the window WITHOUT clicking "Sign out" — signing out cancels the token.

Where to put it — in your bot's .env file (the same place as your bot token):

      SUNO_CLIENT_TOKEN=eyJhbGciOi...the whole value...

  suno.config.js already reads it from there. (Not using a .env file? Put it straight into
  clientToken: '...' in suno.config.js — but never share that file or upload it anywhere.)
  Restart your bot. It prints  "[suno] Signed in with your __client token"  when it works.

If the token stops working (it expired, or someone signed out), the bot prints a warning and goes
back to searching the public Explore lists by itself — nothing breaks. Get a new token the same way.


USING YOUR OWN MUSIC PLAYER
---------------------------
If your bot already plays music, set  voice: { enabled: false }  in suno.config.js (two players in
one server would fight over the voice connection) and let your player play Suno songs:

    // e.g. inside your own !play command:
    if (sunoTools.isSunoLink(query)) {
      const songs = await sunoTools.resolve(query);   // a song, a whole playlist, or a creator's songs
      for (const s of songs) yourQueue.add({ title: s.title, url: s.audioUrl, duration: s.duration, thumbnail: s.imageUrl });
    }

s.audioUrl is an .mp4 file with the song's sound — anything built on ffmpeg (most music bots)
can play it directly. Also available: sunoTools.search('words') and sunoTools.byStyle('lofi'),
which return lists of public songs in the same shape.


GOOD TO KNOW
------------
- The MP3s have the title, artist and cover art built in, so they show properly in music apps.
  Long songs get a lower bitrate automatically so they fit Discord's upload limit.
- One song is converted at a time, and each person waits 15 seconds between !song / !songstyle /
  !convert (cooldownSeconds in the config).
- A Suno link inside <angle brackets> is left alone (that's how people say "no preview, please").
- !convert only answers Suno links, so it won't clash with a !convert your bot already has for
  other sites. If your bot already has a !song, rename this one in the config.
- The voice player leaves the channel after the queue has been empty for 2 minutes.
- Audio comes from each song's public preview video on Suno's servers (the same file Discord's own
  link preview uses); ffmpeg takes the sound out of it.


TROUBLESHOOTING
---------------
"ffmpeg wasn't found"                   → see INSTALLING FFMPEG. On Windows, open a new terminal
                                          (and pm2 kill) after installing.
Commands do nothing                      → Message Content intent is off (setup step 4), or the prefix
                                          or command name in the config is different.
"Voice playback isn't set up"            → npm install @discordjs/voice, then restart.
Joins voice but no sound                 → give the bot the Speak permission in that channel.
"that Suno song isn't available"         → it's private, unpublished or deleted — only public songs work.
Searches don't find much                 → that's the public Explore lists; see BROADER SEARCH.
Something else                           → start your bot with SUNO_TOOLS_DEBUG=1 to see ffmpeg's full errors.
