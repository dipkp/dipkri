import { Client, IntentsBitField, Events } from "discord.js";
import config from "./config.ts";
import axios from "axios";
import { redisCount } from "./utils/redis.ts";

// URL to invite bot: https://discord.com/api/oauth2/authorize?client_id=1071394728513380372&permissions=2147485696&scope=bot

const HOST_NAME = process.env.PUBLIC_APP_URL || "http://localhost:8080";
const API_NAME = process.env.PUBLIC_API_URL || "http://localhost:8080";

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages],
});

client.on("ready", () => {
  console.log("I am ready!");
  console.log("bot is in %s guilds", client.guilds.cache.size);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "watch") {
    const preload = interaction.options.get("video")?.value;
    // Ask the room API for a fresh room
    const response = await axios.post(API_NAME + "/createRoom", {
      video: preload,
    });
    redisCount("discordBotWatch");
    // Return the generated room URL
    await interaction.reply({
      content: `Created a new room${
        preload ? ` with video ${preload}` : ""
      }!
${HOST_NAME + "/watch" + response.data.name}
`,
    });
  }
});

client.login(config.DISCORD_BOT_TOKEN);
