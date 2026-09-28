// A complete tiny bot that only does Suno Tools — handy for trying it out.
// It sits next to the suno-tools folder. To run it:
//   npm install discord.js@14 @discordjs/voice dotenv
//   put DISCORD_TOKEN=... (and optionally SUNO_CLIENT_TOKEN=...) in a file called .env next to this one
//   node example-bot.js

try {
  require('dotenv').config(); // reads the .env file, if dotenv is installed
} catch {}

const { Client, Events, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
});

require('./suno-tools')(client, require('./suno-tools/suno.config.js'));

client.once(Events.ClientReady, () => console.log(`Logged in as ${client.user.tag} — try !song in your server.`));
client.login(process.env.DISCORD_TOKEN);
