const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  ApplicationCommandOptionType,
  ChannelType,
  REST,
  Routes
} = require('discord.js');
require('dotenv').config();
const http = require('http');
const https = require('https');
const axios = require('axios');

// Minimal health endpoint for Render web service port binding
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(port, () => {
  console.log(`Health server listening on port ${port}`);
});

// Helper function to fetch Mojang UUID using native HTTPS
function fetchMojangUUID(ign) {
  return new Promise((resolve, reject) => {
    const encodedIgn = encodeURIComponent(ign);
    const url = `https://api.mojang.com/users/profiles/minecraft/${encodedIgn}`;

    console.log(`Fetching UUID for IGN: "${ign}" -> encoded: "${encodedIgn}"`);
    console.log(`Making request to: ${url}`);

    const startTime = Date.now();
    const request = https.get(url, {
      headers: {
        'User-Agent': 'UltraTiers-Bot/1.0',
        'Accept': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const endTime = Date.now();
        console.log(`Request completed in ${endTime - startTime}ms`);
        console.log(`Response status: ${res.statusCode}`);

        if (res.statusCode === 200) {
          try {
            const jsonData = JSON.parse(data);
            console.log('Response data:', jsonData);
            const uuid = jsonData?.id;
            if (uuid) {
              console.log(`Found UUID: ${uuid}`);
              resolve(uuid);
            } else {
              console.error('No UUID in response');
              reject(new Error('UUID not found'));
            }
          } catch (parseError) {
            console.error('JSON parse error:', parseError);
            reject(parseError);
          }
        } else {
          console.error(`HTTP ${res.statusCode} error`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    request.on('error', (err) => {
      console.error('Request error:', err.message);
      reject(err);
    });

    request.on('timeout', () => {
      console.error('Request timed out');
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const supabaseUrl = process.env.SUPABASE_URL || 'https://lkjfkbififhwgvamffir.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxramZrYmlmaWZod2d2YW1mZmlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjQxMTg5NywiZXhwIjoyMDkxOTg3ODk3fQ.RIOy8Q1Q7lNlqk5PHg3TBBBHKMvu9up1He38ymxy3cQ';
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: ws
  }
});
const fs = require('fs');
const path = require('path');

async function upsertPlayerTier({ uuid, ign, region, gamemode, newTier }) {
  const { data: player, error } = await supabase.from('players').select('*').eq('uuid', uuid).single();
  if (error && error.code !== 'PGRST116') throw error;
  let tiers = player ? player.tiers || [] : [];
  const existing = tiers.find(t => t.gamemode === gamemode);
  if (existing) {
    existing.tier = newTier;
  } else {
    tiers.push({ gamemode, tier: newTier });
  }
  const { error: upsertError } = await supabase.from('players').upsert({
    uuid,
    ign,
    region,
    tiers,
    last_tested: new Date().toISOString()
  });
  if (upsertError) throw upsertError;
}

// ---------------------------
// CONFIGURATION
// ---------------------------
const TOKEN = process.env.TOKEN || "MTM3MDA0MDE0NjE1MzQ0MzMzOA.GX6-Gl.ZvampFY-XfKwIW8DH05nwkxy5-HMHEL5IqM_IE";
const CLIENT_ID = process.env.CLIENT_ID || "1370040146153443338";
const MAX_QUEUE = parseInt(process.env.MAX_QUEUE, 10) || 10;
const RESULTS_CHANNEL_ID = process.env.RESULTS_CHANNEL_ID || "1493278543323332732";

// Server configurations
const MAIN_SERVER = {
  GUILD_ID: "1493278541909987389",
  WELCOME_CHANNEL: null,
  TICKETS_CHANNEL: "1493278543587840119",
  LT3_CATEGORY: null,
  STAFF_APP_CATEGORY: null,
  TESTER_APP_CATEGORY: null,
  MEMBER_ROLE: null
};

const SUPPORT_SERVER = {
  GUILD_ID: "1493278541909987389",
  WELCOME_CHANNEL: null,
  TICKETS_CHANNEL: "1493278543587840119",
  GENERAL_QUESTIONS_CATEGORY: null,
  BAN_APPEAL_CATEGORY: null,
  PLAYER_REPORT_CATEGORY: null,
  STAFF_REPORT_CATEGORY: null,
  MEMBER_ROLE: null
};

// Helper to get config for a guild
function getServerConfig(guildId) {
  if (guildId === MAIN_SERVER.GUILD_ID) return MAIN_SERVER;
  if (guildId === SUPPORT_SERVER.GUILD_ID) return SUPPORT_SERVER;
  return null;
}

const QUEUE_CHANNELS = {
  EU: "1446490459378684007",
  NA: "1450615743451500685",
  ME: "1450615846706614476",
  AS: "1450615880084881499",
  SA: "1450990028971966727",
  AU: "1451153370885914730",
  AF: "1451195742784848024"
};

// ---------------------------
// CLIENT SETUP
// ---------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ---------------------------
// In-memory queues
// Map<guildId, Map<queueKey, { region, mode, testers: [], users: [], messageId?: string }>>
const queues = new Map();


const testerStats = new Map();

// Map<userId, { ign: string, modes: Set<string> }>
const testerProfile = new Map();
const TESTER_PROFILE_FILE = path.join(__dirname, 'testerProfile.json');

function loadTesterProfile() {
  if (!fs.existsSync(TESTER_PROFILE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(TESTER_PROFILE_FILE, 'utf8'));
    for (const [id, obj] of Object.entries(raw)) {
      testerProfile.set(id, { ign: obj.ign, modes: new Set(obj.modes) });
    }
  } catch (e) { console.error('Failed to load testerProfile:', e); }
}

function saveTesterProfile() {
  const out = {};
  for (const [id, obj] of testerProfile.entries()) {
    out[id] = { ign: obj.ign, modes: Array.from(obj.modes) };
  }
  fs.writeFileSync(TESTER_PROFILE_FILE, JSON.stringify(out, null, 2));
}

const lockedUsers = new Map();

// Map<channelId, { creatorId, testedId? }> - tracks ticket metadata
const ticketOwners = new Map();

// Map<testerDiscordId, ignLower>
const testerIGNs = new Map();

// Category IDs
const QUEUE_CATEGORY_ID = "1446810464452481146"; // queue tickets
const LT3_CATEGORY_ID = "1474360748074467479"; // LT3+ tickets
const SUPPORT_CATEGORY_ID = "1466209732544040960"; // support tickets (updated to requested ID)
const REPORT_CATEGORY_ID = "1474360220066254848"; // report tickets

// Channel names for logging
const TICKET_LOGS_CHANNEL_NAME = "『🔒』ticket-logs";
const SECRET_LOGS_CHANNEL_NAME = "『🔒』secret-logs";
const STAFF_LOGS_CHANNEL_NAME = "『🔒』staff-logs";

// Mode category IDs
const MAIN_CATEGORY_ID = "1466211539940806768";
const SUB_CATEGORY_ID = "1466204994960097433";
const EXTRA_CATEGORY_ID = "1466205685405712629";
const BONUS_CATEGORY_ID = "1466205763059056805";

const INVITES_FILE = path.join(__dirname, 'invites.json');

// Map<userId, number>
const monthlyTesterStats = new Map();

// Map<userId, number>
const highResultStats = new Map();

// Map<guildId, Map<inviteCode, uses>>
const invitesCache = new Map();

// { guildId: { inviterId: count } }
let inviteStats = {};
let LT3_TICKETS_ENABLED = true;

const TESTING_LOGS_CHANNEL_NAME = "『📚』testing-logs";

function makeUniqueChannelName(guild, base) {
  base = String(base).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!guild.channels.cache.some(c => c.name === base)) return base;
  // append short timestamp hex to avoid exposing user id
  const suffix = (Date.now() % 0xffff).toString(16);
  return `${base}-${suffix}`;
}

function userHasOpenTicket(userId, type) {
  for (const [chId, meta] of ticketOwners.entries()) {
    if (!meta) continue;
    if (meta.creatorId === userId && (!type || meta.type === type)) return true;
  }
  return false;
}

// Helper to get the correct category ID based on server and ticket type
function getCategoryForTicket(guildId, ticketType) {
  const serverConfig = getServerConfig(guildId);
  if (!serverConfig) return null;
  
  if (guildId === SUPPORT_SERVER.GUILD_ID) {
    switch (ticketType) {
      case 'support_general':
      case 'support':
        return serverConfig.GENERAL_QUESTIONS_CATEGORY;
      case 'support_banappeal':
      case 'banappeal':
        return serverConfig.BAN_APPEAL_CATEGORY;
      case 'support_playerreport':
      case 'playerreport':
        return serverConfig.PLAYER_REPORT_CATEGORY;
      case 'support_staffreport':
      case 'staffreport':
        return serverConfig.STAFF_REPORT_CATEGORY;
      default:
        return null;
    }
  } else if (guildId === MAIN_SERVER.GUILD_ID) {
    switch (ticketType) {
      case 'main_lt3':
      case 'lt3':
        return serverConfig.LT3_CATEGORY;
      case 'main_staffapp':
      case 'staffapp':
        return serverConfig.STAFF_APP_CATEGORY;
      case 'main_testerapp':
      case 'testerapp':
        return serverConfig.TESTER_APP_CATEGORY;
      default:
        return null;
    }
  }
  return null;
}

// Helper to create a ticket channel with the correct category for the server
async function createTicketChannel(guild, name, ticketType, permissionOverwrites) {
  const guildId = guild.id;
  const categoryId = getCategoryForTicket(guildId, ticketType);
  
  // Validate category exists in this guild
  let validCategoryId = null;
  if (categoryId) {
    const category = guild.channels.cache.get(categoryId);
    if (category && category.type === ChannelType.GuildCategory) {
      validCategoryId = categoryId;
    } else {
      console.warn(`Category ${categoryId} not found in guild ${guild.id}, creating channel without parent`);
    }
  }
  
  return await guild.channels.create({
    name: name,
    type: ChannelType.GuildText,
    parent: validCategoryId,
    permissionOverwrites: permissionOverwrites
  });
}

// Give member role to user when they create a ticket
async function giveMemberRole(guild, userId) {
  const serverConfig = getServerConfig(guild.id);
  if (!serverConfig || !serverConfig.MEMBER_ROLE) return;
  
  const memberRole = guild.roles.cache.get(serverConfig.MEMBER_ROLE);
  if (!memberRole) {
    console.warn(`Member role ${serverConfig.MEMBER_ROLE} not found in guild ${guild.id}`);
    return;
  }
  
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(memberRole.id)) {
      await member.roles.add(memberRole);
      console.log(`Added member role to user ${userId} in guild ${guild.id}`);
    }
  } catch (err) {
    console.error(`Failed to add member role to user ${userId}:`, err);
  }
}

// Send a plain-text transcript of a ticket channel to the log channel
async function sendTicketLog(channel) {
  try {
    if (!channel) return;
    const logChannel = channel.guild.channels.cache.find(c => c.name === TICKET_LOGS_CHANNEL_NAME);
    if (!logChannel) return;

    // Fetch entire message history by paginating in batches of 100
    const allMsgs = [];
    let lastId = null;
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const batch = await channel.messages.fetch(options).catch(() => null);
      if (!batch || batch.size === 0) break;
      allMsgs.push(...Array.from(batch.values()));
      // `batch.last()` is the oldest message in the returned collection
      lastId = batch.last().id;
      if (batch.size < 100) break;
      // small pause to be gentle on rate limits
      await new Promise(r => setTimeout(r, 250));
    }

    // sort oldest->newest
    allMsgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const meta = ticketOwners.get(channel.id) || {};

    let out = `Ticket transcript: ${channel.name}\n`;
    out += `Type: ${meta.type || 'unknown'}\n`;
    out += `Creator: ${meta.creatorId ? `<@${meta.creatorId}> (${meta.creatorId})` : 'unknown'}\n`;
    if (meta.testedId) out += `TestedId: <@${meta.testedId}> (${meta.testedId})\n`;
    out += `Archived at: ${new Date().toISOString()}\n\n`;

    for (const m of allMsgs) {
      const time = new Date(m.createdTimestamp).toISOString();
      const author = m.author ? `${m.author.tag} <@${m.author.id}>` : `Unknown <${m.author?.id || '??'}>`;
      let parts = [];
      if (m.system) {
        parts.push(`[SYSTEM MESSAGE]`);
      }
      if (m.reference && m.reference.messageId) {
        parts.push(`[reply_to: ${m.reference.messageId}]`);
      }
      if (m.content) parts.push(m.content.replace(/\r\n/g, '\n'));

      // embeds: include basic embed info
      if (m.embeds && m.embeds.length) {
        for (const e of m.embeds) {
          const ed = [];
          if (e.title) ed.push(`Embed Title: ${e.title}`);
          if (e.description) ed.push(`Embed Desc: ${e.description}`);
          if (e.url) ed.push(`Embed URL: ${e.url}`);
          if (e.fields && e.fields.length) ed.push(`Embed Fields: ${e.fields.map(f => `${f.name}: ${f.value}`).join(' | ')}`);
          if (e.footer?.text) ed.push(`Embed Footer: ${e.footer.text}`);
          if (ed.length) parts.push(`(embed) ${ed.join(' ; ')}`);
        }
      }

      if (m.attachments && m.attachments.size) {
        const urls = Array.from(m.attachments.values()).map(a => a.url).join(' ');
        parts.push(`[attachments: ${urls}]`);
      }

      if (m.editedTimestamp) parts.push(`[edited at: ${new Date(m.editedTimestamp).toISOString()}]`);

      const content = parts.join('\n');
      out += `[${time}] ${author}: ${content}\n`;
    }

    const filename = `${channel.name.replace(/[^a-z0-9-_\.]/gi, '_')}_log.txt`;
    // Send only the file attachment so no visible message appears outside the TXT file
    await logChannel.send({ files: [{ attachment: Buffer.from(out, 'utf8'), name: filename }] }).catch(() => {});
  } catch (err) {
    console.error("Failed sending ticket log:", err);
  }
}

// ---------------------------
// Cooldowns
// Map<guildId, Map<userId, Map<mode, timestamp>>>
// ---------------------------
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');
const TESTER_STATS_FILE = path.join(__dirname, "testerStats.json");
const MONTHLY_TESTER_STATS_FILE = path.join(__dirname, "testerStatsMonthly.json");
const HIGH_RESULT_STATS_FILE = path.join(__dirname, "highResultStats.json");
const MONTH_META_FILE = path.join(__dirname, "month.json");
const QUEUES_FILE = path.join(__dirname, 'queues.json');
const TICKET_OWNERS_FILE = path.join(__dirname, 'ticketOwners.json');
const LT3_STATE_FILE = path.join(__dirname, 'lt3State.json');
const cooldowns = new Map();

const MODE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const NITRO_COOLDOWN_MS = 1 * 24 * 60 * 60 * 1000; // 1 day

const MODE_IMAGES = {
  Axe: "https://yourcdn.com/modes/axe.png",
  Sword: "https://yourcdn.com/modes/sword.png",
  Bow: "https://yourcdn.com/modes/bow.png",
  // Add all your mode images
};

const MODE_EMOJIS = {
  Axe: "🪓",
  Sword: "🗡️",
  Bow: "🏹",
  Vanilla: "🧱",
  NethOP: "🔥",
  Pot: "🧪",
  UHC: "🥊",
  SMP: "🌍",
  Mace: "🔨",
  "Spear Mace": "🔱",
  "Diamond SMP": "💎",
  "OG Vanilla": "🧱",
  Bed: "🛏️",
  DeBuff: "💀",
  Speed: "⚡",
  Manhunt: "🏃",
  Elytra: "🪂",
  "Spear Elytra": "🪂",
  "Diamond Survival": "💎",
  Minecart: "🚂",
  Creeper: "💣",
  Trident: "🔱",
  AxePot: "🪓",
  Pearl: "🧿",
  Bridge: "🌉",
  Sumo: "🤼",
  OP: "⚡",
  Pufferfish: "🐡"
};

// ---------------------------
// Constants: modes, regions, tiers
// ---------------------------
const regions = ["EU", "AS", "SA", "NA", "ME", "AU", "AF"];
const modes = [
  "No Mode",
  "Axe","Sword","Bow","Vanilla","NethOP","Pot","UHC","SMP","Mace","Spear Mace","Diamond SMP",
  "OG Vanilla","Bed","DeBuff","Speed","Manhunt","Elytra","Spear Elytra","Diamond Survival","Minecart",
  "Creeper","Trident","AxePot","Pearl","Bridge","Sumo","OP","Pufferfish",
];

// Grouped mode categories (used for commands and selection choices)
const MODE_CATEGORIES = {
  mainmodes: ["Axe","Sword","Vanilla","NethOP","Pot","UHC","SMP","Mace"],
  submodes: ["Bow","Diamond SMP","OG Vanilla","Bed","DeBuff","Speed","Manhunt","Elytra","Diamond Survival","Minecart","Creeper","Trident"],
  extramodes: ["Pufferfish","AxePot","OP","Spear Elytra","Spear Mace"],
  bonusmodes: ["Sumo","Bridge","Pearl"]
};

const TIER_PAGE_CATEGORIES = {
  main: { label: "Main Modes", modes: MODE_CATEGORIES.mainmodes },
  sub: { label: "Sub Modes", modes: MODE_CATEGORIES.submodes },
  extra: { label: "Extra Modes", modes: MODE_CATEGORIES.extramodes },
  bonus: { label: "Bonus Modes", modes: MODE_CATEGORIES.bonusmodes }
};

function getGamemodeIconUrl(gamemode) {
  return `https://www.ultratiers.com/gamemodes/${encodeURIComponent(gamemode)}.png`;
}

function buildTierNavigationButtons(activeCategory, uuid) {
  const row = new ActionRowBuilder();
  for (const [key, config] of Object.entries(TIER_PAGE_CATEGORIES)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tiers_page_${key}_${uuid}`)
        .setLabel(config.label)
        .setStyle(key === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return [row];
}

function buildTiersEmbed(ign, player, categoryKey, uuid) {
  const category = TIER_PAGE_CATEGORIES[categoryKey] || TIER_PAGE_CATEGORIES.main;
  const tierMap = (Array.isArray(player.tiers) ? player.tiers : []).reduce((acc, tierInfo) => {
    if (tierInfo && tierInfo.gamemode) {
      acc[tierInfo.gamemode] = tierInfo;
    }
    return acc;
  }, {});

  // Use player UUID if available, otherwise use provided uuid
  // Use Minotar body render for thumbnail and Minotar bust for image (shows top part)
  const thumbnailUrl = `https://render.crafty.gg/3d/bust/${encodeURIComponent(ign)}`;

  const embed = new EmbedBuilder()
    .setTitle(`${ign}'s Tier Profile`)
    .setDescription(`Use the buttons below to switch categories.`)
    .setColor(0xffb300)
    .setThumbnail(thumbnailUrl)
    .setFooter({ text: `Page ${Object.keys(TIER_PAGE_CATEGORIES).indexOf(categoryKey) + 1}/4` })
    .setTimestamp();

  for (const mode of category.modes) {
    const entry = tierMap[mode] || {};
    const currentTier = entry.tier || "Unknown";
    const peakTier = entry.peak || currentTier;

    embed.addFields({
      name: mode,
      value: `Tier: **${currentTier}**\nPeak: **${peakTier}**`,
      inline: true
    });
  }

  return embed;
}

const REGION_ROLES = {
  EU: "1471891535871213733",
  NA: "1471891535871213733",
  ME: "1471891535871213733",
  AS: "1471891535871213733",
  SA: "1471891535871213733",
  AU: "1471891535871213733",
  AF: "1471891535871213733"
};

const previousTiers = ["Unranked", "LT3", "HT4", "LT4", "HT5", "LT5"];
const newTiers = ["HT1", "HT2", "HT3", "HT4", "HT5", "LT1", "LT2", "LT3", "LT4", "LT5"];
const resultTiers = ["LT5", "HT5", "LT4", "HT4", "LT3"]; // max LT3 for /result
const allTiers = ["Unranked", "LT5", "HT5", "LT4", "HT4", "LT3", "HT3", "LT2", "HT2", "LT1", "HT1"];

// mapping from tier names to discord role IDs (provided by user)
const TIER_ROLE_IDS = {
  HT1: "1493281098254389469",
  LT1: "1493281119729094856",
  HT2: "1493281162121052210",
  LT2: "1493281262096351322",
  HT3: "1493283914851024936",
  LT3: "1493282909551988749",
  HT4: "1493282830678229184",
  LT4: "1493284583544721468",
  HT5: "1493281531572125727",
  LT5: "1493281573011980458"
};

// ---------------------------
// Command definitions (for registration)
// ---------------------------
const commands = [
{
  name: "tiertests",
  description: "Show a user's test stats, IGN, and tested modes.",
  options: [
    {
      name: "player",
      type: ApplicationCommandOptionType.User,
      description: "The Discord user to check",
      required: true
    }
  ]
},
{
  name: "test",
  description: "Open a testing queue (Tester role required)",
  options: [
    { 
      name: "ign", 
      type: ApplicationCommandOptionType.String, 
      description: "Your Minecraft IGN", 
      required: true 
    },
    { 
      name: "region", 
      type: ApplicationCommandOptionType.String, 
      description: "Choose your region", 
      required: true, 
      choices: regions.map(r => ({ name: r, value: r })) 
    },
...getModeOptions(),
  ]
},
{
  name: "retire",
  description: "Retire a player from a specific gamemode on the website",
  options: [
    {
      name: "ign",
      type: 3,
      description: "Minecraft IGN",
      required: true
    },
...getModeOptions(),
  ]
},
{
  name: "rename",
  description: "Rename the current channel",
  options: [
    {
      name: "name",
      description: "The new channel name",
      type: 3,
      required: true
    }
  ]
},
{
  name: "lt3tickets",
  description: "Enable or disable LT3+ ticket button (Owner only)",
  options: [
    {
      name: "state",
      description: "Enable or disable",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "Enable", value: "enable" },
        { name: "Disable", value: "disable" }
      ]
    }
  ]
},
{
  name: "leaderboard_monthly",
  description: "Top testers this month"
},
// removed: leaderboard_highresults command
{
  name: "highresult",
  description: "Post a high-tier test result (Owner only)",
  options: [
    {
      name: "tested_player",
      type: ApplicationCommandOptionType.User,
      description: "The tested Discord user",
      required: true
    },
    {
      name: "tested_ign",
      type: ApplicationCommandOptionType.String,
      description: "Tested player's IGN",
      required: true
    },
    {
      name: "passed",
      type: ApplicationCommandOptionType.Boolean,
      description: "Did the player pass?",
      required: true
    },
    {
      name: "testing_tier",
      type: ApplicationCommandOptionType.String,
      description: "Testing tier",
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
...getModeOptions(),
    {
      name: "region",
      type: ApplicationCommandOptionType.String,
      description: "Region",
      required: true,
      choices: regions.map(r => ({ name: r, value: r }))
    },
    {
      name: "tester_tier",
      type: ApplicationCommandOptionType.String,
      description: "Tier of tester(s)",
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },

    // Fight 1 (required)
    { name: "result1", type: ApplicationCommandOptionType.String, description: "Fight 1 result", required: true, choices: [{ name: "Won", value: "Won" }, { name: "Lost", value: "Lost" }] },
    { name: "score_player1", type: ApplicationCommandOptionType.Integer, description: "Player score for fight 1", required: true },
    { name: "score_tester1", type: ApplicationCommandOptionType.Integer, description: "Tester score for fight 1", required: true },
    { name: "tester1", type: ApplicationCommandOptionType.String, description: "Tester IGN for fight 1", required: true },

    // Fight 2 (optional)
    { name: "result2", type: ApplicationCommandOptionType.String, description: "Fight 2 result", required: false, choices: [{ name: "Won", value: "Won" }, { name: "Lost", value: "Lost" }] },
    { name: "score_player2", type: ApplicationCommandOptionType.Integer, description: "Player score for fight 2", required: false },
    { name: "score_tester2", type: ApplicationCommandOptionType.Integer, description: "Tester score for fight 2", required: false },
    { name: "tester2", type: ApplicationCommandOptionType.String, description: "Tester IGN for fight 2", required: false },

    // Fight 3 (optional)
    { name: "result3", type: ApplicationCommandOptionType.String, description: "Fight 3 result", required: false, choices: [{ name: "Won", value: "Won" }, { name: "Lost", value: "Lost" }] },
    { name: "score_player3", type: ApplicationCommandOptionType.Integer, description: "Player score for fight 3", required: false },
    { name: "score_tester3", type: ApplicationCommandOptionType.Integer, description: "Tester score for fight 3", required: false },
    { name: "tester3", type: ApplicationCommandOptionType.String, description: "Tester IGN for fight 3", required: false },

    // Demotion (optional)
    { name: "demoted", type: ApplicationCommandOptionType.Boolean, description: "Was the player demoted?", required: false },
    { name: "demoted_to", type: ApplicationCommandOptionType.String, description: "Tier demoted to", required: false, choices: allTiers.map(t => ({ name: t, value: t })) }
  ]
},
{
  name: "mainmodes",
  description: "Show testers assigned to a main mode",
  options: [
    {
      name: "mode",
      description: "Gamemode",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: MODE_CATEGORIES.mainmodes.map(m => ({ name: m, value: m }))
    }
  ]
},
{
  name: "submodes",
  description: "Show testers assigned to a sub mode",
  options: [
    {
      name: "mode",
      description: "Gamemode",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: MODE_CATEGORIES.submodes.map(m => ({ name: m, value: m }))
    }
  ]
},
{
  name: "extramodes",
  description: "Show testers assigned to an extra mode",
  options: [
    {
      name: "mode",
      description: "Gamemode",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: MODE_CATEGORIES.extramodes.map(m => ({ name: m, value: m }))
    }
  ]
},
{
  name: "bonusmodes",
  description: "Show testers assigned to a bonus mode",
  options: [
    {
      name: "mode",
      description: "Gamemode",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: MODE_CATEGORIES.bonusmodes.map(m => ({ name: m, value: m }))
    }
  ]
},
  { name: "leave", description: "Leave the testing queue" },
  {
    name: "cooldown",
    description: "View your remaining queue cooldowns"
  },
  { name: "stop", description: "Stop your testing queue (Tester role required)" },
  { name: "next", description: "Create a private ticket for the next person in the queue (Tester only)" },
  {
    name: "tiers",
    description: "View all tiers a player has been tested in",
    options: [
      {
        name: "ign",
        type: ApplicationCommandOptionType.String,
        description: "Minecraft IGN",
        required: true
      }
    ]
  },
  {
  name: "code",
  description: "Generate a login code for a player (Owner only)",
  options: [
    {
      name: "ign",
      type: ApplicationCommandOptionType.String,
      description: "Minecraft IGN",
      required: true
    }
  ]
},
  { 
  name: "close", 
  description: "Close the current ticket" 
},
{
  name: "tester",
  description: "Add a player as a tester on the website (separate from tiers)",
  options: [
    {
      name: "ign",
      type: ApplicationCommandOptionType.String,
      description: "Minecraft IGN",
      required: true
    },
    ...getModeOptions(),
    {
      name: "region",
      type: ApplicationCommandOptionType.String,
      description: "Region",
      required: true,
      choices: regions.map(r => ({ name: r, value: r }))
    }
  ]
},
  {
    name: "result",
    description: "Submit a test result (Tester role required)",
    options: [
      { name: "ign", type: ApplicationCommandOptionType.String, description: "In-game name", required: true },
      { name: "region", type: ApplicationCommandOptionType.String, description: "Region", required: true, choices: regions.map(r => ({ name: r, value: r })) },
      ...getModeOptions(),
      { name: "new_tier", type: ApplicationCommandOptionType.String, description: "New earned tier", required: true, choices: resultTiers.map(t => ({ name: t, value: t })) }
    ]
  },
  {
  name: "testdone",
  description: "Manually adjust how many tests a tester has done (Owner only)",
  options: [
    {
      name: "tester",
      type: ApplicationCommandOptionType.User,
      description: "The tester to modify",
      required: true
    },
    {
      name: "tests",
      type: ApplicationCommandOptionType.Integer,
      description: "Number of tests to ADD (use negative to remove)",
      required: true
    }
  ]
},
  {
  name: "leaderboard",
  description: "Shows the top 10 testers with the most tests done"
},
{
  name: "addtester",
  description: "Add a tester to this ticket (Admin only)",
  options: [
    {
      name: "user",
      type: ApplicationCommandOptionType.User,
      description: "Tester to add",
      required: true
    }
  ]
},
{
  name: "removetester",
  description: "Remove a tester from this ticket (Admin only)",
  options: [
    {
      name: "user",
      type: ApplicationCommandOptionType.User,
      description: "Tester to remove",
      required: true
    }
  ]
},
{
  name: "ratebuilder",
  description: "Rate a builder across multiple build skills",
  options: [
    {
      name: "ign",
      description: "Builder's in-game name",
      type: ApplicationCommandOptionType.String,
      required: true
    },
    {
      name: "region",
      description: "Builder's region",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: regions.map(r => ({ name: r, value: r }))
    },

    {
      name: "composition",
      description: "Overall composition and layout quality",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "buildings",
      description: "Structure and building quality",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "organics",
      description: "Organic shapes such as trees, rocks, terrain",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "terrain",
      description: "Terrain shaping and landscaping",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "details",
      description: "Detailing quality and block usage",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "colouring",
      description: "Color palette and block color harmony",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: allTiers.map(t => ({ name: t, value: t }))
    },
    {
      name: "testers",
      description: "Tester IGN(s) or Discord tag(s)",
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
},
  {
    name: "nitro",
    description: "Give a player Nitro styling on the website (Owner role required)",
    options: [{ name: "ign", type: ApplicationCommandOptionType.String, description: "Player IGN", required: true }]
  },
{
  name: "manual",
  description: "Manually submit a result outside tickets (Owner role required)",
  options: [
    { name: "ign", type: ApplicationCommandOptionType.String, description: "In-game name", required: true },
    { name: "region", type: ApplicationCommandOptionType.String, description: "Region", required: true, choices: regions.map(r => ({ name: r, value: r })) },
    ...getModeOptions(),
    { name: "previous_tier", type: ApplicationCommandOptionType.String, description: "Previous tier", required: true, choices: allTiers.map(t => ({ name: t, value: t })) },
    { name: "new_tier", type: ApplicationCommandOptionType.String, description: "New earned tier", required: true, choices: allTiers.map(t => ({ name: t, value: t })) },
  ]
},
  { name: "supportcreate", description: "Create a support ticket (General Question, Ban Appeal, Player/Staff Report)" },
  { name: "maincreate", description: "Create a main ticket (LT3+ Test, Staff Application, Tester Application)" }
  ,{
    name: "moveticket",
    description: "Move the current ticket to a different category (Handler only)",
    options: [
      {
        name: "category",
        type: ApplicationCommandOptionType.String,
        description: "Target category",
        required: true,
        choices: [
          { name: "Main", value: "1466211539940806768" },
          { name: "Sub", value: "1466204994960097433" },
          { name: "Extra", value: "1466205685405712629" },
          { name: "Bonus", value: "1466205763059056805" }
        ]
      }
    ]
  }
  ,
    
];

// Persistent tester info for /tiertests
const TESTER_INFO_FILE = path.join(__dirname, "testerInfo.json");
const testerInfo = new Map();
function loadTesterInfo() {
  if (!fs.existsSync(TESTER_INFO_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(TESTER_INFO_FILE, "utf8"));
    for (const [id, info] of Object.entries(raw)) {
      testerInfo.set(id, info);
    }
  } catch {}
}
function saveTesterInfo() {
  fs.writeFileSync(TESTER_INFO_FILE, JSON.stringify(Object.fromEntries(testerInfo), null, 2));
}
loadTesterInfo();

// Deduplicate commands by name before registration
const uniqueCommands = [];
const seenCommands = new Set();
for (const cmd of commands) {
  if (!seenCommands.has(cmd.name)) {
    seenCommands.add(cmd.name);
    uniqueCommands.push(cmd);
  }
}

// register commands
(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: uniqueCommands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

// ---------------------------
// Config: channel/category IDs
// ---------------------------
const TICKET_CATEGORY_ID = "1446810464452481146";
const TICKET_CHANNEL_ID = "1448341581559238777";
const COMMANDS_CHANNEL_NAME = "🤖︱commands";
const TICKET_CHANNEL_NAME = "『👑』tickets";

// ---------------------------
// Helpers
// ---------------------------
// Ensure supabase is initialized before you use it
// ---------------------------
// /code command (Owner only)
// ---------------------------

async function upsertBuilderRatings({
  uuid,
  ign,
  region,
  composition,
  buildings,
  organics,
  terrain,
  details,
  colouring
}) {
  const { error } = await supabase.from('builder_ratings').insert({
    uuid,
    ign,
    region,
    composition,
    buildings,
    organics,
    terrain,
    details,
    colouring,
    created_at: new Date().toISOString()
  });
  if (error) throw error;
}

// Fetch the player's current tiers from the website, determine the
// highest-ranked tier they currently hold across all gamemodes, and
// ensure the corresponding Discord role is applied (removing other
// tier roles as necessary). This helper is used after both `/result`
// and `/manual` operations.
async function syncMemberTierRole(member, uuid) {
  if (!member || !uuid) return;
  let highestTier = "Unranked";
  try {
    const { data: player, error } = await supabase.from('players').select('tiers').eq('uuid', uuid).single();
    if (error) return;
    if (Array.isArray(player?.tiers)) {
      for (const t of player.tiers) {
        const idx = allTiers.indexOf(t.tier);
        if (idx > allTiers.indexOf(highestTier)) {
          highestTier = t.tier;
        }
      }
    }
    let currentTier = "Unranked";
    for (const [tier, roleId] of Object.entries(TIER_ROLE_IDS)) {
      if (member.roles.cache.has(roleId)) {
        const idx = allTiers.indexOf(tier);
        if (idx > allTiers.indexOf(currentTier)) {
          currentTier = tier;
        }
      }
    }
    if (currentTier === highestTier) {
      return;
    }
    const keepId = TIER_ROLE_IDS[highestTier];
    for (const rid of Object.values(TIER_ROLE_IDS)) {
      if (rid !== keepId && member.roles.cache.has(rid)) {
        await member.roles.remove(rid).catch(console.warn);
      }
    }
    if (highestTier !== "Unranked" && keepId && !member.roles.cache.has(keepId)) {
      await member.roles.add(keepId).catch(console.warn);
    }
  } catch (err) {
    console.warn("Failed to sync tier role for member", member?.id, err);
  }
}

async function addWebsiteTester({ uuid, name, mode, region }) {
  const { error } = await supabase.from('testers').upsert({
    uuid,
    name,
    mode: JSON.stringify(mode),
    region
  });
  if (error) throw error;
}

function loadMonthlyTesterStats() {
  if (!fs.existsSync(MONTHLY_TESTER_STATS_FILE)) return;

  const raw = JSON.parse(fs.readFileSync(MONTHLY_TESTER_STATS_FILE, "utf8"));
  for (const [id, count] of Object.entries(raw)) {
    monthlyTesterStats.set(id, count);
  }
}

function saveMonthlyTesterStats() {
  fs.writeFileSync(
    MONTHLY_TESTER_STATS_FILE,
    JSON.stringify(Object.fromEntries(monthlyTesterStats), null, 2)
  );
}

function saveQueues() {
  try {
    const out = {};
    for (const [guildId, guildMap] of queues.entries()) {
      out[guildId] = {};
      for (const [key, q] of guildMap.entries()) {
        out[guildId][key] = {
          region: q.region,
          mode: q.mode,
          testers: Array.isArray(q.testers) ? q.testers : [],
          users: Array.isArray(q.users) ? q.users : [],
          messageId: q.messageId || null
        };
      }
    }
    fs.writeFileSync(QUEUES_FILE, JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('Failed to save queues:', err);
  }
}

function loadQueues() {
  if (!fs.existsSync(QUEUES_FILE)) return;
  try {
    const text = fs.readFileSync(QUEUES_FILE, 'utf8');
    if (!text.trim()) {
      // file is empty or just whitespace – nothing to load
      console.warn('Queues file is empty, skipping load');
      return;
    }
    const raw = JSON.parse(text);
    for (const [guildId, guildObj] of Object.entries(raw)) {
      const map = new Map();
      for (const [key, q] of Object.entries(guildObj)) {
        map.set(key, {
          region: q.region,
          mode: q.mode,
          testers: Array.isArray(q.testers) ? q.testers : [],
          users: Array.isArray(q.users) ? q.users : [],
          messageId: q.messageId || null
        });
      }
      queues.set(guildId, map);
    }
  } catch (err) {
    console.error('Failed to load queues:', err);
    // If JSON was malformed we don't want to continually log the same error
    // on each restart; delete the file so the bot can recreate it fresh.
    if (err instanceof SyntaxError) {
      try {
        fs.unlinkSync(QUEUES_FILE);
        console.warn('Corrupt queues file removed');
      } catch {}
    }
  }
}

function saveTicketOwners() {
  try {
    fs.writeFileSync(TICKET_OWNERS_FILE, JSON.stringify(Object.fromEntries(ticketOwners), null, 2));
  } catch (err) {
    console.error('Failed to save ticketOwners:', err);
  }
}

function loadTicketOwners() {
  if (!fs.existsSync(TICKET_OWNERS_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(TICKET_OWNERS_FILE, 'utf8'));
    for (const [chId, meta] of Object.entries(raw)) {
      ticketOwners.set(chId, meta);
    }
  } catch (err) {
    console.error('Failed to load ticketOwners:', err);
  }
}

function loadLT3State() {
  if (!fs.existsSync(LT3_STATE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(LT3_STATE_FILE, "utf8"));
    LT3_TICKETS_ENABLED = raw.enabled === true;
  } catch (err) {
    console.warn("Failed to load LT3 state:", err);
  }
}

function saveLT3State() {
  try {
    fs.writeFileSync(
      LT3_STATE_FILE,
      JSON.stringify({ enabled: LT3_TICKETS_ENABLED }, null, 2)
    );
  } catch (err) {
    console.error("Failed to save LT3 state:", err);
  }
}

function loadHighResultStats() {
  if (!fs.existsSync(HIGH_RESULT_STATS_FILE)) return;

  const raw = JSON.parse(fs.readFileSync(HIGH_RESULT_STATS_FILE, "utf8"));
  for (const [id, count] of Object.entries(raw)) {
    highResultStats.set(id, count);
  }
}

function saveHighResultStats() {
  fs.writeFileSync(
    HIGH_RESULT_STATS_FILE,
    JSON.stringify(Object.fromEntries(highResultStats), null, 2)
  );
}

// ---------------------------
// Fetch all testers from website
// ---------------------------
// ---------------------------
// Fetch all testers from your website API
// ---------------------------
async function fetchAllWebsiteTesters() {
  try {
    const { data, error } = await supabase.from('testers').select('*');
    if (error) throw error;
    return data.map(t => {
      let mode = [];
      if (t.mode) {
        if (Array.isArray(t.mode)) {
          mode = t.mode;
        } else if (typeof t.mode === 'string') {
          try {
            const parsed = JSON.parse(t.mode);
            mode = Array.isArray(parsed) ? parsed : [t.mode];
          } catch {
            mode = [t.mode];
          }
        } else {
          mode = [t.mode];
        }
      }
      return {
        username: t.name,
        mode,
        region: t.region || "Unknown"
      };
    });
  } catch (err) {
    console.error("Failed to fetch testers:", err);
    return [];
  }
}

function loadTesterStats() {
  if (!fs.existsSync(TESTER_STATS_FILE)) return;

  const raw = JSON.parse(fs.readFileSync(TESTER_STATS_FILE, "utf8"));
  for (const [testerId, count] of Object.entries(raw)) {
    testerStats.set(testerId, count);
  }
}

async function getWebsiteTester(uuid) {
  try {
    const { data, error } = await supabase.from('testers').select('*').eq('uuid', uuid).single();
    if (error) return null;
    if (data && data.mode) {
      if (typeof data.mode === 'string') {
        try {
          data.mode = JSON.parse(data.mode);
        } catch {
          data.mode = [data.mode];
        }
      }
    }
    return data;
  } catch {
    return null;
  }
}

function getModeOptions() {
  const half = Math.ceil((modes.length - 1) / 2); // exclude "No Mode" from split
  const normalModes = modes.slice(1); // all except "No Mode"
  return [
    {
      name: "mode_a",
      type: ApplicationCommandOptionType.String,
      description: "Choose your mode (A–N)",
      required: true,
      choices: [{ name: "No Mode", value: "No Mode" }, ...normalModes.slice(0, half).map(m => ({ name: m, value: m }))]
    },
    {
      name: "mode_b",
      type: ApplicationCommandOptionType.String,
      description: "Choose your mode (O–Z)",
      required: true,
      choices: [{ name: "No Mode", value: "No Mode" }, ...normalModes.slice(half).map(m => ({ name: m, value: m }))]
    }
  ];
}

async function handleCodeCommand(interaction) {
  await interaction.deferReply({ flags: 64 });

  if (!hasRole(interaction.member, "Owner")) {
    return safeReply(interaction, { content: "❌ No permission" });
  }

  const ign = interaction.options.getString("ign");
  if (!ign) return safeReply(interaction, { content: "❌ IGN required" });

  try {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    const { error } = await supabase.from('codes').insert({
      ign,
      login: code,
      created_at: new Date().toISOString()
    });
    if (error) throw error;
    return safeReply(interaction, {
      content: `✅ Login code for **${ign}**: **${code}**`
    });
  } catch (err) {
    console.error("Error generating login code:", err);
    return safeReply(interaction, {
      content: "⚠️ An error occurred while generating the login code."
    });
  }
}

function getQueueChannel(guild, region) {
    const channelId = QUEUE_CHANNELS[region];
    if (!channelId) return null;
    return guild.channels.cache.get(channelId) || null;
}

function saveCooldowns() {
  const obj = {};

  for (const [guildId, guildMap] of cooldowns.entries()) {
    obj[guildId] = {};
    for (const [userId, userMap] of guildMap.entries()) {
      obj[guildId][userId] = Object.fromEntries(userMap);
    }
  }

  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(obj, null, 2));
}

function checkMonthlyReset() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;

  let storedMonth = null;
  if (fs.existsSync(MONTH_META_FILE)) {
    storedMonth = JSON.parse(fs.readFileSync(MONTH_META_FILE, "utf8")).month;
  }

  if (storedMonth !== currentMonth) {
    monthlyTesterStats.clear();
    saveMonthlyTesterStats();
    fs.writeFileSync(MONTH_META_FILE, JSON.stringify({ month: currentMonth }));
    console.log("📅 Monthly leaderboard reset");
  }
}

function isUserInAnyQueue(guildId, userId) {
  const guildQueues = queues.get(guildId);
  if (!guildQueues) return false;

  for (const q of guildQueues.values()) {
    if (q.users.includes(userId)) return true;
  }
  return false;
}

async function notifyFirstInQueue(guild, queueObj, userId) {
  if (!guild || queueObj.users.length !== 1) return; // only when they become FIRST

  const logsChannel = guild.channels.cache.find(
    c => c.name === TESTING_LOGS_CHANNEL_NAME
  );
  if (!logsChannel) return;

  const testerMentions =
    queueObj.testers.length > 0
      ? queueObj.testers.map(id => `<@${id}>`).join(", ")
      : "No tester";

  await logsChannel.send({
    content: `📢 **The player <@${userId}> is now first in the ${queueObj.mode} queue ${testerMentions}!**`
  }).catch(() => {});
}

function loadInvites() {
  if (fs.existsSync(INVITES_FILE)) {
    inviteStats = JSON.parse(fs.readFileSync(INVITES_FILE, 'utf8'));
  }
}

function saveInvites() {
  fs.writeFileSync(INVITES_FILE, JSON.stringify(inviteStats, null, 2));
}

function loadCooldowns() {
  if (!fs.existsSync(COOLDOWN_FILE)) return;

  const raw = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));

  for (const guildId of Object.keys(raw)) {
    const guildMap = new Map();
    for (const userId of Object.keys(raw[guildId])) {
      guildMap.set(userId, new Map(Object.entries(raw[guildId][userId])));
    }
    cooldowns.set(guildId, guildMap);
  }
}
function buildQueueEmbed(queueObj) {
  const { region, mode, testers, users } = queueObj;
  const embed = new EmbedBuilder()
    .setTitle(`Tester(s) Available! [${region} - ${mode}]`)
    .setDescription("🧊 The queue updates automatically. Use /leave to remove yourself from the queue.")
    .setColor(0x5865f2)
    .addFields(
      { name: `Queue (${users.length}/${MAX_QUEUE}):`, value: users.length === 0 ? "(empty)" : users.map((u,i) => `**${i+1}.** <@${u}>`).join("\n") },
      { name: "Tester(s):", value: testers.length === 0 ? "None" : testers.map((id, i) => `${i+1}. <@${id}>`).join("\n") }
    );
  return embed;
}
function createJoinButton(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`join_queue_${queueKey}`).setLabel("Join Queue").setStyle(ButtonStyle.Primary)
  );
}
function hasRole(member, roleName) {
  if (!member || !member.roles) return false;
  // Map old role names to new symbols
  const roleMap = {
    'SuperOwner': '+++++',
    'Management': '++++',
    'Owner': '+++',
    'Admin': '++',
    'Handler': '+',
  };
  const mappedRole = roleMap[roleName] || roleName;
  const r = member.roles.cache.find(r => r.name === mappedRole);
  return !!r;
}

function setModeCooldown(guildId, userId, mode, member) {
  if (!cooldowns.has(guildId)) cooldowns.set(guildId, new Map());
  const guildCooldowns = cooldowns.get(guildId);

  if (!guildCooldowns.has(userId)) guildCooldowns.set(userId, new Map());
  const userCooldowns = guildCooldowns.get(userId);

  // Use 1-day cooldown if user has Nitro role
  const hasNitro = member?.roles?.cache?.some(r => r.name === "Nitro");
  const cooldownMs = hasNitro ? NITRO_COOLDOWN_MS : MODE_COOLDOWN_MS;

  userCooldowns.set(mode, Date.now() + cooldownMs);
  saveCooldowns();
}

function getModeCooldown(guildId, userId, mode) {
  const expiry =
    cooldowns.get(guildId)?.get(userId)?.get(mode) || null;

  if (!expiry) return null;

  if (Date.now() > expiry) {
    cooldowns.get(guildId)?.get(userId)?.delete(mode);
    saveCooldowns();
    return null;
  }

  return expiry;
}

function saveTesterStats() {
  fs.writeFileSync(
    TESTER_STATS_FILE,
    JSON.stringify(Object.fromEntries(testerStats), null, 2)
  );
}

function formatRemaining(ms) {
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return `${days} day${days !== 1 ? "s" : ""}`;
}

// safe reply helpers — only reply if not replied & not deferred
// convert the simple `{ ephemeral: true }` flag into the newer
// `flags` property so the library stops warning about the deprecated
// option. callers can continue to pass `ephemeral` everywhere.
function normalizePayload(payload = {}) {
  if (payload && typeof payload === 'object' && 'ephemeral' in payload) {
    const { ephemeral, ...rest } = payload;
    if (ephemeral) {
      // 1 << 6 is the value of MessageFlags.Ephemeral
      rest.flags = (rest.flags || 0) | (1 << 6);
    }
    payload = rest;
  }
  return payload;
}

async function safeReply(interaction, payload) {
  payload = normalizePayload(payload);

  try {
    // If nothing has been sent yet, prefer reply to create the original message
    if (!interaction.deferred && !interaction.replied) {
      return await interaction.reply(payload);
    }

    // Otherwise, try editing the original reply. If the original message
    // cannot be found (10008) or returns 404, fall back to followUp.
    try {
      return await interaction.editReply(payload);
    } catch (err) {
      if (err?.code === 10062) {
        // Unknown interaction / expired — ignore silently
        return null;
      }
      if (err?.code === 10008 || err?.status === 404) {
        // Original message not found — send a followUp instead
        return await interaction.followUp(payload);
      }
      // Unknown error — log and rethrow so callers can handle it if needed
      console.warn("safeReply failed:", err?.message || err);
      throw err;
    }
  } catch (err) {
    // If reply failed due to expired interaction, ignore; otherwise log
    if (err?.code !== 10062) {
      console.warn("safeReply outer failed:", err?.message || err);
    }
  }
}

// shorthand wrapper for interaction.deferReply that also handles the
// `flags` conversion for ephemeral replies. callers can still pass an
// `{ ephemeral: true }` object, the helper will translate it to the new
// format and avoid the runtime deprecation warning.
async function safeDefer(interaction, options = {}) {
  options = normalizePayload(options);
  return interaction.deferReply(options);
}

function buildModeEmbed(mode, testers) {
  // Helper to normalize IGNs for matching (case/whitespace insensitive)
  const normalize = s => String(s).replace(/\s+/g, '').toLowerCase();
  const lines = testers.length
    ? testers.map(t => {
        let discordMention = null;
        const ign = t.username || t.name || "Unknown";
        const testerIGN = normalize(ign);
        for (const [id, prof] of testerProfile.entries()) {
          if (prof.ign && normalize(prof.ign) === testerIGN) {
            discordMention = `<@${id}>`;
            break;
          }
        }
        if (discordMention) {
          return `${discordMention} = ${ign} (${t.region})`;
        } else {
          return `${ign} (${t.region})`;
        }
      })
    : ["No testers found for this mode."];
  return new EmbedBuilder()
    .setTitle(`Testers for ${mode}`)
    .setColor(0x5865f2)
    .setThumbnail(MODE_IMAGES[mode] || null)
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

// ---------------------------
// READY
// ---------------------------
client.once(Events.ClientReady, async () => {
  loadTesterProfile();
  loadCooldowns();
  loadInvites();
  loadTesterStats();
  loadMonthlyTesterStats();
  loadHighResultStats();
  loadLT3State();
  checkMonthlyReset();

  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) continue;

    const map = new Map();
    invites.forEach(inv => map.set(inv.code, inv.uses));
    invitesCache.set(guild.id, map);
  }

  // Load persisted queues and ticket mappings from disk
  loadQueues();
  loadTicketOwners();

  // Recreate or update queue messages for each loaded queue
  for (const [guildId, guildMap] of queues.entries()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    for (const [queueKey, q] of guildMap.entries()) {
      try {
        const region = q.region;
        const roleId = REGION_ROLES[region];
        const queueChannel = guild.channels.cache.get(QUEUE_CHANNELS[region]) || await guild.channels.fetch(QUEUE_CHANNELS[region]).catch(() => null);
        if (!queueChannel) continue;

        const embed = buildQueueEmbed(q);

        if (q.messageId) {
          const msg = await queueChannel.messages.fetch(q.messageId).catch(() => null);
          if (msg) {
            await msg.edit({ content: roleId ? `<@&${roleId}>` : null, embeds: [embed], components: [createJoinButton(queueKey)], allowedMentions: roleId ? { roles: [roleId] } : {} }).catch(() => {});
            continue;
          }
        }

        // If no existing message, send a new one and persist its id
        const sent = await queueChannel.send({ content: roleId ? `<@&${roleId}>` : null, embeds: [embed], components: [createJoinButton(queueKey)], allowedMentions: roleId ? { roles: [roleId] } : {} }).catch(() => null);
        if (sent) {
          q.messageId = sent.id;
          try { saveQueues(); } catch (e) {}
        }
      } catch (err) {
        console.warn('Failed to restore queue', queueKey, err?.message || err);
      }
    }
  }

  console.log(`Logged in as ${client.user.tag}`);
});

// ---------------------------
// Single InteractionCreate handler (ALL interactions)
// ---------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // BUTTONS
    if (interaction.isButton()) {
      const id = interaction.customId;
      // Allow modal-opening buttons to SHOW a modal (can't defer before showModal)
      const modalButtons = ["open_ht3_ticket", "open_support_ticket", "open_report_ticket", "support_general", "support_banappeal", "support_playerreport", "support_staffreport", "main_lt3", "main_staffapp", "main_testerapp"];
      if (!modalButtons.includes(id) && !id.startsWith('tiers_page_')) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 }).catch(() => {});
        }
      }

      if (id === "open_support_ticket") {
        // Show a modal to collect support description
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const modal = new ModalBuilder()
          .setCustomId('support_ticket_modal')
          .setTitle('Open Support Ticket')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('support_description')
                .setLabel('Describe your issue')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
            )
          );

        return interaction.showModal(modal).catch(() => {});
}

      if (id === "open_report_ticket") {
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const modal = new ModalBuilder()
          .setCustomId('report_ticket_modal')
          .setTitle('Report a Player/Staff')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('report_target')
                .setLabel('Who are you reporting? (IGN or Discord)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('report_description')
                .setLabel('Describe the report')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
            )
          );

        return interaction.showModal(modal).catch(() => {});
      }

      // OPEN LT3+ TICKET — show modal to collect IGN, Mode, Tier
      if (id === "open_ht3_ticket") {

        if (!LT3_TICKETS_ENABLED) {
          return interaction.reply({
            content: "LT3+ tests are currently closed.",
            ephemeral: true
          }).catch(() => {});
        }

        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const modal = new ModalBuilder()
          .setCustomId('lt3_ticket_modal')
          .setTitle('Open LT3+ Test Ticket')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('lt3_ign')
                .setLabel('Your Minecraft IGN')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('lt3_mode')
                .setLabel('Mode')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('lt3_tier')
                .setLabel('Tier to test for')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            )
          );

        return interaction.showModal(modal).catch(() => {});
      }

      if (id.startsWith('tiers_page_')) {
        const [,, category, uuid] = id.split('_');
        const page = TIER_PAGE_CATEGORIES[category] ? category : 'main';

        let player = null;
        try {
          const { data, error } = await supabase.from('players').select('*').eq('uuid', uuid).single();
          if (!error) {
            player = data;
          }
          if (!player || !player.uuid) throw new Error('Player not found');
        } catch (err) {
          console.warn('Direct player fetch failed for /tiers button:', err?.message || err);
          try {
            const { data, error } = await supabase.from('players').select('*');
            if (error) throw error;
            player = Array.isArray(data) ? data.find(p => p.uuid === uuid || p.uuid === uuid.toLowerCase()) : null;
          } catch (fallbackErr) {
            console.warn('Fallback player list fetch failed for /tiers button:', fallbackErr?.message || fallbackErr);
          }
        }

        if (!player) {
          return interaction.update({ content: '⚠️ Could not load player tier data. Please try again.', embeds: [], components: [] });
        }

        const embed = buildTiersEmbed(player.name || 'Unknown', player, page, uuid);
        const components = buildTierNavigationButtons(page, uuid);
        return interaction.update({ embeds: [embed], components });
      }


// ----------------- REQUEST HELP (separate block) -----------------
if (id === "request_help") {

  const testersRole = interaction.guild.roles.cache.find(r => r.name === "Tester");
  if (!testersRole) return safeReply(interaction, { content: "Tester role not found.", ephemeral: true });

  // Notify testers in the ticket
  await interaction.channel.send({
    content: `🔔 <@&${testersRole.id}> <@${interaction.user.id}> is requesting assistance!`,
  });

  return safeReply(interaction, { content: "Testers have been notified.", ephemeral: true });
}

// ----------------- SUPPORT TICKET BUTTONS -----------------
if (id === "support_general") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('support_general_modal')
    .setTitle('General Question')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('support_subject')
          .setLabel('Subject')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('support_description')
          .setLabel('Describe your question')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

if (id === "support_banappeal") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('support_banappeal_modal')
    .setTitle('Ban Appeal')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banappeal_ign')
          .setLabel('Your IGN')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banappeal_reason')
          .setLabel('Reason for ban')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banappeal_appeal')
          .setLabel('Why should you be unbanned?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

if (id === "support_playerreport") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('support_playerreport_modal')
    .setTitle('Player Report')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('report_player_ign')
          .setLabel('Player IGN to report')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('report_player_reason')
          .setLabel('Reason for report')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

if (id === "support_staffreport") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('support_staffreport_modal')
    .setTitle('Staff Report')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('report_staff_name')
          .setLabel('Staff member (IGN or Discord)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('report_staff_reason')
          .setLabel('Reason for report')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

// ----------------- MAIN TICKET BUTTONS -----------------
if (id === "main_lt3") {
  if (!LT3_TICKETS_ENABLED) {
    return interaction.reply({ content: "LT3+ tests are currently closed.", ephemeral: true }).catch(() => {});
  }
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('main_lt3_modal')
    .setTitle('LT3+ Test Ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('lt3_ign')
          .setLabel('Your Minecraft IGN')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('lt3_mode')
          .setLabel('Mode')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('lt3_tier')
          .setLabel('Tier to test for')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

if (id === "main_staffapp") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('main_staffapp_modal')
    .setTitle('Staff Application')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('staffapp_ign')
          .setLabel('Your IGN')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('staffapp_experience')
          .setLabel('Previous staff experience')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('staffapp_why')
          .setLabel('Why do you want to be staff?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

if (id === "main_testerapp") {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('main_testerapp_modal')
    .setTitle('Tester Application')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('testerapp_ign')
          .setLabel('Your IGN')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('testerapp_modes')
          .setLabel('Modes you can test (list)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('testerapp_experience')
          .setLabel('Testing experience')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal).catch(() => {});
}

      // JOIN QUEUE
      if (id.startsWith("join_queue_")) {
  const queueKey = id.replace("join_queue_", "");
  const guildId = interaction.guildId;

// ❌ Block if user is already in ANY queue
if (isUserInAnyQueue(guildId, interaction.user.id)) {
  return safeReply(interaction, {
    content: "❌ You are already in a queue. Please leave it before joining another one.",
    ephemeral: true
  });
}

// 🔒 Block if user is currently locked (being tested)
if (lockedUsers.get(guildId)?.has(interaction.user.id)) {
  return safeReply(interaction, {
    content: "❌ You are currently being tested and cannot join another queue.",
    ephemeral: true
  });
}

  if (!queues.has(guildId) || !queues.get(guildId).has(queueKey)) {
    return safeReply(interaction, { content: "This queue no longer exists.", ephemeral: true });
  }

  const queueObj = queues.get(guildId).get(queueKey);

  // Check mode cooldown
  const cooldownUntil = getModeCooldown(
    interaction.guildId,
    interaction.user.id,
    queueObj.mode
  );

  if (cooldownUntil) {
    const remaining = formatRemaining(cooldownUntil - Date.now());
    return safeReply(interaction, {
      content: `⏳ You are on cooldown for **${queueObj.mode}**.\nYou can rejoin this mode in **${remaining}**.`,
      ephemeral: true
    });
  }

  if (queueObj.users.includes(interaction.user.id)) {
    return safeReply(interaction, { content: "You are already in the queue.", ephemeral: true });
  }

  if (queueObj.users.length >= MAX_QUEUE) {
    return safeReply(interaction, { content: "The queue is full.", ephemeral: true });
  }

  queueObj.users.push(interaction.user.id);
  try { saveQueues(); } catch (e) {}

  await notifyFirstInQueue(
    interaction.guild,
    queueObj,
    interaction.user.id
  );

  // Update queue embed if possible
  if (queueObj.messageId) {
    try {
const queueChannel = getQueueChannel(interaction.guild, queueObj.region);
if (!queueChannel) return;

const msg = await queueChannel.messages
  .fetch(queueObj.messageId)
  .catch(() => null);
      if (msg) await msg.edit({ embeds: [buildQueueEmbed(queueObj)], components: [createJoinButton(queueKey)] }).catch(() => {});
    } catch (err) {
      console.warn("Failed to update queue embed after join:", err?.message || err);
    }
  }

  return safeReply(interaction, { content: "✅ You joined the queue!", ephemeral: true });
}

      // CLOSE TICKET
// ----------------- CLOSE TICKET (queue vs others)
if (id === "close_queue_ticket") {
  const testerRole = interaction.guild.roles.cache.find(r => r.name === "Tester");
  const member = interaction.guild.members.cache.get(interaction.user.id);

  if (!testerRole || !member.roles.cache.has(testerRole.id)) {
    return safeReply(interaction, {
      content: "❌ Only users with the Tester role can close queue tickets.",
      ephemeral: true
    });
  }

  // try to unlock tested user from our ticketOwners mapping
  try {
    const meta = ticketOwners.get(interaction.channel?.id);
    if (meta && meta.testedId) {
      lockedUsers.get(interaction.guildId)?.delete(meta.testedId);
    }
  } catch (e) {}

  await safeReply(interaction, { content: "Closing queue ticket...", ephemeral: true });

  setTimeout(async () => {
    try {
      // Send transcript to logs
      try { await sendTicketLog(interaction.channel); } catch (e) {}
      // cleanup ticketOwners mapping for this channel
      try { ticketOwners.delete(interaction.channel?.id); } catch (e) {}
      try { saveTicketOwners(); } catch (e) {}
      if (interaction.channel?.deletable) {
        await interaction.channel.delete();
      }
    } catch (err) {
      console.error("Failed deleting queue ticket channel:", err);
    }
  }, 500);

  return;
}

// ----------------- CLOSE REGULAR TICKET (Everyone) -----------------
if (id === "close_ticket") {
  await safeReply(interaction, { content: "Closing ticket...", ephemeral: true });

  setTimeout(async () => {
    try {
      try { await sendTicketLog(interaction.channel); } catch (e) {}
      try { ticketOwners.delete(interaction.channel?.id); } catch (e) {}
      try { saveTicketOwners(); } catch (e) {}
      if (interaction.channel?.deletable) {
        await interaction.channel.delete();
      }
    } catch (err) {
      console.error("Failed deleting ticket channel:", err);
    }
  }, 500);

  return;
}

      // Unknown button -> ignore gracefully
      return;
    }

    // MODAL SUBMISSIONS
    if (interaction.isModalSubmit && interaction.isModalSubmit()) {
      const cid = interaction.customId;
      const guild = interaction.guild;
      if (!guild) return;

      const handlerRole = guild.roles.cache.find(r => r.name === 'Handler');
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      const userId = member?.id || interaction.user.id;

      // ----------------- SUPPORT TICKET MODALS -----------------
      // General Question
      if (cid === 'support_general_modal') {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        const subject = interaction.fields.getTextInputValue('support_subject');
        const desc = interaction.fields.getTextInputValue('support_description');

        if (userHasOpenTicket(interaction.user.id, 'support_general')) {
          return safeReply(interaction, { content: 'You already have an open support ticket.', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `general-${subject}`);
        const channel = await createTicketChannel(guild, channelName, 'support_general', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 ${subject} ↴`)
          .setDescription(desc)
          .setColor(0x00bfff)
          .setFooter({ text: 'UltraTiers • General Question' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'support_general' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Support ticket created: ${channel}`, ephemeral: true });
      }

      // Ban Appeal
      if (cid === 'support_banappeal_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const ign = interaction.fields.getTextInputValue('banappeal_ign');
        const reason = interaction.fields.getTextInputValue('banappeal_reason');
        const appeal = interaction.fields.getTextInputValue('banappeal_appeal');

        if (userHasOpenTicket(interaction.user.id, 'support_banappeal')) {
          return safeReply(interaction, { content: 'You already have an open support ticket.', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `banappeal-${ign}`);
        const channel = await createTicketChannel(guild, channelName, 'support_banappeal', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 Ban Appeal ↴`)
          .addFields(
            { name: 'IGN', value: ign },
            { name: 'Ban Reason', value: reason },
            { name: 'Appeal', value: appeal }
          )
          .setColor(0xffaa00)
          .setFooter({ text: 'UltraTiers • Ban Appeal' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'support_banappeal' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Ban appeal ticket created: ${channel}`, ephemeral: true });
      }

      // Player Report
      if (cid === 'support_playerreport_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const playerIgn = interaction.fields.getTextInputValue('report_player_ign');
        const reportReason = interaction.fields.getTextInputValue('report_player_reason');

        if (userHasOpenTicket(interaction.user.id, 'support_playerreport')) {
          return safeReply(interaction, { content: 'You already have an open support ticket.', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `playerreport-${playerIgn}`);
        const channel = await createTicketChannel(guild, channelName, 'support_playerreport', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 Player Report ↴`)
          .addFields(
            { name: 'Player', value: playerIgn },
            { name: 'Reason', value: reportReason }
          )
          .setColor(0xff0000)
          .setFooter({ text: 'UltraTiers • Player Report' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'support_playerreport' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Player report ticket created: ${channel}`, ephemeral: true });
      }

      // Staff Report
      if (cid === 'support_staffreport_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const staffName = interaction.fields.getTextInputValue('report_staff_name');
        const reportReason = interaction.fields.getTextInputValue('report_staff_reason');

        if (userHasOpenTicket(interaction.user.id, 'support_staffreport')) {
          return safeReply(interaction, { content: 'You already have an open support ticket.', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `staffreport-${staffName}`);
        const channel = await createTicketChannel(guild, channelName, 'support_staffreport', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 Staff Report ↴`)
          .addFields(
            { name: 'Staff Member', value: staffName },
            { name: 'Reason', value: reportReason }
          )
          .setColor(0xff0000)
          .setFooter({ text: 'UltraTiers • Staff Report' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'support_staffreport' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Staff report ticket created: ${channel}`, ephemeral: true });
      }

      // ----------------- MAIN TICKET MODALS -----------------
      // LT3+ Test
      if (cid === 'main_lt3_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const ign = interaction.fields.getTextInputValue('lt3_ign');
        const mode = interaction.fields.getTextInputValue('lt3_mode');
        const tier = interaction.fields.getTextInputValue('lt3_tier');

        if (userHasOpenTicket(interaction.user.id, 'main_lt3')) {
          return safeReply(interaction, { content: 'You already have an open ticket!', ephemeral: true });
        }

        const testerRole = guild.roles.cache.find(r => r.name === 'Tester');
        const verifiedRole = guild.roles.cache.find(r => /verified\s*test(er|ers)?/i.test(r.name));

        const ticketName = makeUniqueChannelName(guild, `lt3-${ign}`);
        const ticketChannel = await createTicketChannel(guild, ticketName, 'main_lt3', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          testerRole ? { id: testerRole.id, deny: [PermissionsBitField.Flags.ViewChannel] } : null,
          verifiedRole ? { id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] } : null,
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 LT3+ Test ↴`)
          .addFields(
            { name: 'IGN', value: ign || 'N/A' },
            { name: 'Mode', value: mode || 'N/A' },
            { name: 'Tier', value: tier || 'N/A' }
          )
          .setColor(0xffffff)
          .setFooter({ text: 'UltraTiers • LT3+ Test' })
          .setTimestamp();

        await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(ticketChannel.id, { creatorId: interaction.user.id, type: 'main_lt3' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `LT3+ ticket created: ${ticketChannel}`, ephemeral: true });
      }

      // Staff Application
      if (cid === 'main_staffapp_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const ign = interaction.fields.getTextInputValue('staffapp_ign');
        const experience = interaction.fields.getTextInputValue('staffapp_experience');
        const why = interaction.fields.getTextInputValue('staffapp_why');

        if (userHasOpenTicket(interaction.user.id, 'main_staffapp')) {
          return safeReply(interaction, { content: 'You already have an open ticket!', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `staffapp-${ign}`);
        const channel = await createTicketChannel(guild, channelName, 'main_staffapp', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 Staff Application ↴`)
          .addFields(
            { name: 'IGN', value: ign },
            { name: 'Experience', value: experience },
            { name: 'Why do you want to be staff?', value: why }
          )
          .setColor(0x5865f2)
          .setFooter({ text: 'UltraTiers • Staff Application' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'main_staffapp' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Staff application ticket created: ${channel}`, ephemeral: true });
      }

      // Tester Application
      if (cid === 'main_testerapp_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const ign = interaction.fields.getTextInputValue('testerapp_ign');
        const modes = interaction.fields.getTextInputValue('testerapp_modes');
        const experience = interaction.fields.getTextInputValue('testerapp_experience');

        if (userHasOpenTicket(interaction.user.id, 'main_testerapp')) {
          return safeReply(interaction, { content: 'You already have an open ticket!', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, `testerapp-${ign}`);
        const channel = await createTicketChannel(guild, channelName, 'main_testerapp', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle(`🤶 Tester Application ↴`)
          .addFields(
            { name: 'IGN', value: ign },
            { name: 'Modes', value: modes },
            { name: 'Experience', value: experience }
          )
          .setColor(0x5865f2)
          .setFooter({ text: 'UltraTiers • Tester Application' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'main_testerapp' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        
        // Give member role
        await giveMemberRole(guild, userId);
        
        return safeReply(interaction, { content: `Tester application ticket created: ${channel}`, ephemeral: true });
      }

      // Legacy support (keep for backward compatibility)
      if (cid === 'support_ticket_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const desc = interaction.fields.getTextInputValue('support_description');

        if (userHasOpenTicket(interaction.user.id, 'support')) {
          return safeReply(interaction, { content: 'You already have an open support ticket.', ephemeral: true });
        }

        const channelName = makeUniqueChannelName(guild, 'support-help');
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: SUPPORT_CATEGORY_ID,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
          ].filter(Boolean)
        });

        const embed = new EmbedBuilder()
          .setTitle('🎫 Support Ticket')
          .setDescription(desc)
          .setColor(0x00bfff)
          .setFooter({ text: 'UltraTiers • Support Ticket' })
          .setTimestamp();

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(channel.id, { creatorId: interaction.user.id, type: 'support' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        return safeReply(interaction, { content: `Support ticket created: ${channel}`, ephemeral: true });
      }

      if (cid === 'lt3_ticket_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const ign = interaction.fields.getTextInputValue('lt3_ign');
        const mode = interaction.fields.getTextInputValue('lt3_mode');
        const tier = interaction.fields.getTextInputValue('lt3_tier');

        if (userHasOpenTicket(interaction.user.id, 'lt3')) {
          return safeReply(interaction, { content: 'You already have an open ticket!', ephemeral: true });
        }

        const testerRole = guild.roles.cache.find(r => r.name === 'Tester');
        const verifiedRole = guild.roles.cache.find(r => /verified\s*test(er|ers)?/i.test(r.name));

        const ticketName = makeUniqueChannelName(guild, 'ticket-lt3');
        const ticketChannel = await guild.channels.create({
          name: ticketName,
          type: ChannelType.GuildText,
          parent: LT3_CATEGORY_ID,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            testerRole ? { id: testerRole.id, deny: [PermissionsBitField.Flags.ViewChannel] } : null,
            verifiedRole ? { id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] } : null,
            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            handlerRole ? { id: handlerRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
          ].filter(Boolean)
        });

        const embed = new EmbedBuilder()
          .setTitle('🎫 LT3+ Test Ticket')
          .addFields(
            { name: 'IGN', value: ign || 'N/A' },
            { name: 'Mode', value: mode || 'N/A' },
            { name: 'Tier', value: tier || 'N/A' }
          )
          .setColor(0xffffff)
          .setTimestamp();

        await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(ticketChannel.id, { creatorId: interaction.user.id, type: 'lt3' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        return safeReply(interaction, { content: `Ticket created: ${ticketChannel}`, ephemeral: true });
      }

      if (cid === 'report_ticket_modal') {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const target = interaction.fields.getTextInputValue('report_target');
        const desc = interaction.fields.getTextInputValue('report_description');

        if (userHasOpenTicket(interaction.user.id, 'report')) {
          return safeReply(interaction, { content: 'You already have an open report ticket.', ephemeral: true });
        }

        const adminRole = guild.roles.cache.find(r => r.name === 'Admin');
        const reportName = makeUniqueChannelName(guild, 'ticket-report');
        const reportChannel = await createTicketChannel(guild, reportName, 'report', [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          adminRole ? { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null
        ].filter(Boolean));

        const embed = new EmbedBuilder()
          .setTitle('🚨 Report')
          .addFields(
            { name: 'Reported', value: target },
            { name: 'Description', value: desc }
          )
          .setColor(0xff0000)
          .setTimestamp();

        await reportChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger))] }).catch(() => {});
        try { ticketOwners.set(reportChannel.id, { creatorId: interaction.user.id, type: 'report' }); } catch (e) {}
        try { saveTicketOwners(); } catch (e) {}
        return safeReply(interaction, { content: `Report ticket created: ${reportChannel}`, ephemeral: true });
      }
    }

    // CHAT INPUT COMMANDS
    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    // Helper: role checks
    const isOwner = hasRole(interaction.member, "Owner");
    const isTester = hasRole(interaction.member, "Tester");
    const isManagement = hasRole(interaction.member, "Management");
    const isSuperOwner = hasRole(interaction.member, "SuperOwner");
    const isAdmin = hasRole(interaction.member, "Admin");
    const isHandler = hasRole(interaction.member, "Handler");

    // List of staff commands (update as needed)
    // Staff commands to log (excluding Tester-only commands)
    const staffCommands = [
      "lt3tickets", "code", "supportcreate", "maincreate", // +++++
      "retire", "highresult", // ++++
      "manual", "tester", // +++
      "addtester", "removetester", // ++
      "rename", "moveticket" // +
    ];

    // If a staff command (not Tester-only) is used, log it as an embed
    if (staffCommands.includes(cmd)) {
      try {
        const logChannel = interaction.guild.channels.cache.find(c => c.name === STAFF_LOGS_CHANNEL_NAME);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle(`Staff Command Used`)
            .setDescription(`**/${cmd}** command was used by <@${interaction.user.id}>`)
            .addFields(
              { name: "User", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
              { name: "Command", value: `/${cmd}`, inline: true },
              { name: "Channel", value: interaction.channel ? `<#${interaction.channel.id}>` : "Unknown", inline: true }
            )
            .setColor(0xffc107)
            .setTimestamp();
          await logChannel.send({ embeds: [embed] });
        }
      } catch (e) {
        console.warn("Failed to log staff command usage:", e);
      }
    }

// ----------------- rename (Handler only) -----------------
if (cmd === "rename") {

  await interaction.deferReply({ flags: 64 });

  const guild = interaction.guild;
  const member = interaction.member;
  const channel = interaction.channel;
  const newName = interaction.options.getString("name");

  if (!guild || !member || !channel) {
    return safeReply(interaction, {
      content: "❌ This command can only be used in a server."
    });
  }

  // ✅ REQUIRE Handler role
  if (!hasRole(member, "Handler")) {
    return safeReply(interaction, {
      content: "❌ You must have the Handler role to use this command."
    });
  }

  // Rename channel
  try {
    await channel.setName(newName);

    // Send an embed to the channel showing the rename event
    const embed = new EmbedBuilder()
      .setTitle('Channel Renamed')
      .setDescription(`This ticket was renamed to **${newName}**`)
      .addFields(
        { name: 'Renamed By', value: `<@${member.id}>`, inline: true },
        { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
      )
      .setColor(0x00bfff)
      .setTimestamp();
    await channel.send({ embeds: [embed] });

    return safeReply(interaction, {
      content: `✅ Channel renamed to **${newName}**`
    });

  } catch (err) {
    console.error("Rename failed:", err);

    return safeReply(interaction, {
      content: "❌ Failed to rename channel."
    });
  }
}

// ---------------------------
// MODE CATEGORY COMMANDS (PNG kit images + tester list)
// ---------------------------
if (
  interaction.commandName === "mainmodes" ||
  interaction.commandName === "submodes" ||
  interaction.commandName === "extramodes" ||
  interaction.commandName === "bonusmodes"
) {
  await interaction.deferReply();

  let input = interaction.options.getString("mode").toLowerCase();
  const allTesters = await fetchAllWebsiteTesters();

  const validModes = MODE_CATEGORIES[interaction.commandName];

  // Filter modes starting with input
  const matchingModes = validModes.filter(m => m.toLowerCase().startsWith(input));

  if (matchingModes.length === 0) {
    return safeReply(interaction, { content: "❌ No matching mode found." });
  }

  // If multiple matches, just show them as a list
  if (matchingModes.length > 1) {
    return safeReply(interaction, {
      content: `Multiple matches found:\n${matchingModes.map(m => `• ${m}`).join("\n")}`
    });
  }

  const mode = matchingModes[0];

  // Try to find a PNG that contains the mode name (normalize names to ignore spaces/punctuation)
  const kitsDir = path.join(__dirname, "kitsmodes");
  let kitFileName = null;
  if (fs.existsSync(kitsDir)) {
    const kitFiles = fs.readdirSync(kitsDir);
    const normalize = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedMode = normalize(mode);
    // Build normalized filename map
    const mapped = kitFiles.map(f => ({ file: f, name: normalize(path.parse(f).name) }));
    // 1) exact match of filename (preferred)
    let exact = mapped.find(x => x.name === normalizedMode);
    if (exact) {
      kitFileName = exact.file;
    } else {
      // 2) candidates that include the mode token
      const candidates = mapped.filter(x => x.name.includes(normalizedMode));
      if (candidates.length) {
        // prefer those that start with the token (e.g., 'smpkit' for 'smp')
        let pick = candidates.find(x => x.name.startsWith(normalizedMode));
        // then prefer those that end with the token
        if (!pick) pick = candidates.find(x => x.name.endsWith(normalizedMode));
        // otherwise pick the shortest filename (closest match)
        if (!pick) pick = candidates.reduce((a, b) => (a.name.length <= b.name.length ? a : b));
        kitFileName = pick.file;
      } else {
        // final fallback: any part of the full filename (including extension)
        kitFileName = kitFiles.find(f => normalize(f).includes(normalizedMode));
      }
    }
  }

  if (!kitFileName) {
    return safeReply(interaction, {
      content: `❌ PNG not found for **${mode}**`
    });
  }

  const kitFilePath = path.join(__dirname, "kitsmodes", kitFileName);

  // Filter testers who have this mode (case-insensitive exact match)
  const normalizedModeLower = mode.toLowerCase();
  const filtered = allTesters.filter(t => Array.isArray(t.mode) && t.mode.some(m => String(m).toLowerCase() === normalizedModeLower));

  // Use buildModeEmbed to include Discord linking logic
  const embed = buildModeEmbed(mode, filtered);
  // Attach image as a file and reference it via attachment:// in the embed data
  embed.data.image = { url: "attachment://" + kitFileName };
  return safeReply(interaction, {
    embeds: [embed],
    files: [kitFilePath]
  });
}

    // ----------------- retire (Owner only) -----------------
if (cmd === "retire") {
  if (!isManagement) {
    return safeReply(interaction, {
      content: "❌ You must have the ++++ role to use this command.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ flags: 64 });

  const ign = interaction.options.getString("ign");
  // Read both mode fields
const modeA = interaction.options.getString("mode_a");
const modeB = interaction.options.getString("mode_b");

// Build array of selected modes
let modes = [modeA, modeB].filter(Boolean);

// Remove "No Mode" / "Do Nothing" if another real mode exists
if (modes.includes("No Mode") && modes.length > 1) {
  modes = modes.filter(m => m !== "No Mode");
}

// If nothing left, keep "Do Nothing"
if (!modes.length) modes = ["No Mode"];

// Combine into a single string for the API
const mode = modes.join(", ");

  // 🔑 Fetch Minecraft UUID
  let mcUUID = null;
  try {
    const resp = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
      { timeout: 115000 }
    );
    mcUUID = resp.data?.id || null;
  } catch {
    return safeReply(interaction, { content: "❌ Could not fetch your Minecraft UUID. Make sure your IGN is correct." });
  }

  try {
    const { data: player, error } = await supabase.from('players').select('*').eq('uuid', mcUUID).single();
    if (error && error.code !== 'PGRST116') throw error;
    const tiers = player?.tiers || [];
    const updatedTiers = tiers.filter(t => t.gamemode !== mode);
    const { error: updateError } = await supabase.from('players').update({ tiers: updatedTiers }).eq('uuid', mcUUID);
    if (updateError) throw updateError;

    return safeReply(interaction, {
      content:
        `🪦 **${ign}** has been **retired from ${mode}**.\n` +
        `That gamemode is now removed from their tiers.`
    });
  } catch (err) {
    console.error("Retire failed:", err);
    return safeReply(interaction, { content: "❌ Failed to retire that player." });
  }
}

// ----------------- supportcreate -----------------
if (cmd === "supportcreate") {
  await interaction.deferReply({ flags: 64 });
  if (!isSuperOwner) {
    return safeReply(interaction, { 
      content: "❌ You must have the +++++ role to use this command.", 
      ephemeral: true 
    });
  }

  // Get the correct tickets channel based on server
  const serverConfig = getServerConfig(interaction.guildId);
  const ticketsChannelId = serverConfig ? serverConfig.TICKETS_CHANNEL : null;
  const ticketsChannel = ticketsChannelId 
    ? interaction.guild?.channels.cache.get(ticketsChannelId)
    : null;

  // Must use in tickets channel
  if (!ticketsChannel || interaction.channelId !== ticketsChannel.id) {
    return safeReply(interaction, {
      content: `❌ This command can only be used in ${
        ticketsChannel ? `<#${ticketsChannel.id}>` : 'the tickets channel'
      }.`,
      ephemeral: true
    });
  }

  const channel = ticketsChannel;
  if (!channel) {
    return safeReply(interaction, { content: "Ticket channel not found." });
  }

  const embed = new EmbedBuilder()
    .setTitle("🎫 Open a Ticket")
    .setDescription(
      "Choose the type of support ticket you want to open:\n\n" +
      "• **General Question** – for general questions or assistance.\n" +
      "• **Ban Appeal** – to appeal a ban from the server.\n" +
      "• **Player Report** – to report a player for rule violations.\n" +
      "• **Staff Report** – to report a staff member for misconduct."
    )
    .setColor(0x00bfff)
    .setFooter({ text: "UltraTiers" })
    .setTimestamp();

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("support_general")
      .setLabel("General Question")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("support_banappeal")
      .setLabel("Ban Appeal")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("support_playerreport")
      .setLabel("Player Report")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("support_staffreport")
      .setLabel("Staff Report")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [embed], components: [buttonRow] }).catch(err => {
    console.error("Failed to send support ticket message:", err);
  });

  return safeReply(interaction, { content: "Support ticket options sent!" });
}


// ----------------- maincreate -----------------
if (cmd === "maincreate") {
  await interaction.deferReply({ ephemeral: true });

  // Must have +++++ role
  if (!isSuperOwner) {
    return safeReply(interaction, { 
      content: "❌ You must have the +++++ role to use this command.", 
      ephemeral: true 
    });
  }

  // Get the correct tickets channel based on server
  const serverConfig = getServerConfig(interaction.guildId);
  const ticketsChannelId = serverConfig ? serverConfig.TICKETS_CHANNEL : null;
  const ticketsChannel = ticketsChannelId 
    ? interaction.guild?.channels.cache.get(ticketsChannelId)
    : null;

  // Must use in tickets channel
  if (!ticketsChannel || interaction.channelId !== ticketsChannel.id) {
    return safeReply(interaction, {
      content: `❌ This command can only be used in ${
        ticketsChannel ? `<#${ticketsChannel.id}>` : `\`${TICKET_CHANNEL_NAME}\``
      }.`,
      ephemeral: true
    });
  }

  const channel = ticketsChannel;
  if (!channel) {
    return safeReply(interaction, { content: "Ticket channel not found." });
  }

  const embed = new EmbedBuilder()
    .setTitle("🎫 Open a Ticket")
    .setDescription(
      "Choose the type of main ticket you want to open:\n\n" +
      "• **LT3+ Test Ticket** – for requesting a tier test from our testers.\n" +
      "• **Staff Application** – to apply for a staff position.\n" +
      "• **Tester Application** – to apply to become a tester."
    )
    .setColor(0x5865f2)
    .setFooter({ text: "UltraTiers" })
    .setTimestamp();

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("main_lt3")
      .setLabel("LT3+ Test")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("main_staffapp")
      .setLabel("Staff Application")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("main_testerapp")
      .setLabel("Tester Application")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [buttonRow] }).catch(err => {
    console.error("Failed to send main ticket message:", err);
  });

  return safeReply(interaction, { content: "Main ticket options sent!" });
}

// ----------------- moveticket (Handler only) -----------------
if (cmd === "moveticket") {
  await interaction.deferReply({ flags: 64 });

  if (!hasRole(interaction.member, "Handler")) {
    return safeReply(interaction, { content: "❌ You must have the Handler role to use this command.", ephemeral: true });
  }

  const categoryId = interaction.options.getString("category");
  if (!interaction.channel) return safeReply(interaction, { content: "❌ Channel not found.", ephemeral: true });

  try {
    // Capture existing permission overwrites before moving
    const currentOverwrites = interaction.channel.permissionOverwrites.cache.map(ow => ({
      id: ow.id,
      type: ow.type,
      allow: ow.allow.bitfield,
      deny: ow.deny.bitfield
    }));

    // Move to new category
    await interaction.channel.setParent(categoryId);

    // Reapply the same permission overwrites to prevent them from being reset
    await interaction.channel.permissionOverwrites.set(currentOverwrites);

    return safeReply(interaction, { content: `✅ Ticket moved and permissions preserved.`, ephemeral: true });
  } catch (err) {
    console.error("Failed to move ticket:", err);
    return safeReply(interaction, { content: "❌ Failed to move the ticket.", ephemeral: true });
  }
}
// ----------------- tiertests (Anyone) -----------------
if (cmd === "tiertests") {
  (async () => {
    await interaction.deferReply({ ephemeral: false });
    const user = interaction.options.getUser("player");
    const stats = testerStats.get(user.id) || 0;
    const prof = testerProfile.get(user.id);
    const ign = prof?.ign || "Unknown";
    const modes = prof?.modes ? Array.from(prof.modes).join(", ") : "None";

    // Minecraft character image (bust)
    const mcImage = ign && ign !== "Unknown"
      ? `https://render.crafty.gg/3d/bust/${encodeURIComponent(ign)}.png`
      : null;

    const embed = new EmbedBuilder()
      .setTitle(`Tier Test Stats for ${user.username}`)
      .setColor("#ff9900") // orange
      .addFields(
        { name: "Discord", value: `<@${user.id}>` },
        { name: "IGN", value: ign },
        { name: "Tests Done", value: `${stats}` },
        { name: "Tested Modes", value: modes || "None" }
      )
      .setTimestamp();
    if (mcImage) embed.setThumbnail(mcImage);
    return safeReply(interaction, { embeds: [embed] });
  })();
}
    // ----------------- test (Tester only) -----------------
// ----------------- test (Tester only) -----------------
if (cmd === "test") {
  try {
    await interaction.deferReply({ ephemeral: true });

    // ✅ Role check
    if (!isTester) {
      return safeReply(interaction, {
        content: "❌ You must have the Tester role to use this command."
      });
    }

    // ✅ Fetch options
    const ign = interaction.options.getString("ign"); // NEW: require IGN
    const region = interaction.options.getString("region");
    // Read both mode fields
const modeA = interaction.options.getString("mode_a");
const modeB = interaction.options.getString("mode_b");

// Build array of selected modes
let selectedModes = [modeA, modeB].filter(Boolean);

// Remove "Do Nothing" if another real mode exists
if (selectedModes.includes("No Mode") && selectedModes.length > 1) {
  selectedModes = selectedModes.filter(m => m !== "No Mode");
}

// If nothing left, keep "Do Nothing"
if (!selectedModes.length) selectedModes = ["No Mode"];
    const guildId = interaction.guildId;

    if (!ign) {
      return safeReply(interaction, { content: "❌ You must provide your Minecraft IGN." });
    }

    // ---------- FETCH UUID ----------
    let mcUUID;
    try {
        const resp = await axios.get(
  `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
  { timeout: 30000 }
);
        mcUUID = resp.data?.id || null;
    } catch {
        mcUUID = null;
    }

    // ---------- CHECK WEBSITE TESTER DATA ----------
    const testerData = await getWebsiteTester(mcUUID);
    if (!testerData) {
        return safeReply(interaction, { content: "❌ You are not registered as a tester on the website.\nMake sure your IGN is registered." });
    }

    // 🔹 MODE CHECK
// Check that at least one of the selected modes exists on the website
const approvedModes = selectedModes.filter(m => testerData.mode.includes(m));
if (!approvedModes.length) {
  return safeReply(interaction, {
    content:
      `❌ You are not approved to test **${selectedModes.join(", ")}**.\n` +
      `Approved modes: **${testerData.mode.join(", ")}**`
  });
}

// ✅ Use the approved modes for the queue
const mode = approvedModes.join(", ");

    // 🔹 REGION CHECK
    if (testerData.region !== region) {
        return safeReply(interaction, {
            content:
              `❌ You are registered as a **${testerData.region}** tester, not **${region}**.`
        });
    }

    // ================= QUEUE LOGIC =================
    // Store tester IGN and modes for /tiertests
    try {
      let prof = testerProfile.get(interaction.user.id) || { ign, modes: new Set() };
      prof.ign = ign;
      for (const m of approvedModes) prof.modes.add(m);
      testerProfile.set(interaction.user.id, prof);
      saveTesterProfile();
    } catch (e) { console.warn('Failed to update testerProfile:', e); }
    const queueKey = `${region}|${mode}`;

    if (!queues.has(guildId)) queues.set(guildId, new Map());
    const guildQueues = queues.get(guildId);

    // Prevent tester from opening multiple queues
    for (const q of guildQueues.values()) {
        if (q.testers.includes(interaction.user.id)) {
            return safeReply(interaction, { content: "❌ You are already testing another queue." });
        }
    }

    // Create or add tester to queue
    if (!guildQueues.has(queueKey)) {
        guildQueues.set(queueKey, {
            region,
            mode,
            testers: [interaction.user.id],
            users: []
        });
        try { saveQueues(); } catch (e) {}
    } else {
        guildQueues.get(queueKey).testers.push(interaction.user.id);
        try { saveQueues(); } catch (e) {}
    }

    // store this tester's IGN (lowercase) for ticket naming
    try {
        testerIGNs.set(interaction.user.id, ign.toLowerCase());
    } catch (e) {}

    const queueObj = guildQueues.get(queueKey);
    const embed = buildQueueEmbed(queueObj);
    const roleId = REGION_ROLES[region];

    // 🔒 Get correct queue channel for this region
// 🔒 Get correct queue channel for this region
let queueChannel;
try {
  queueChannel = await interaction.guild.channels.fetch(QUEUE_CHANNELS[region]);
} catch (err) {
  console.error(`Failed to fetch queue channel for ${region}:`, err);
  return safeReply(interaction, { content: `❌ Queue channel for **${region}** not found.` });
}

if (!queueChannel) {
  return safeReply(interaction, { content: `❌ Queue channel for **${region}** not found.` });
}

// Update or send queue message
let botMsg;
try {
  const messages = await queueChannel.messages.fetch({ limit: 50 });
  botMsg = messages.find(
    m => m.author?.id === client.user.id && m.embeds?.[0]?.title?.includes(`[${region} - ${mode}]`)
  );
} catch {
  botMsg = null;
}

if (botMsg) {
  await botMsg.edit({
    content: roleId ? `<@&${roleId}>` : null,
    embeds: [embed],
    components: [createJoinButton(queueKey)],
    allowedMentions: roleId ? { roles: [roleId] } : {}
  });
  queueObj.messageId = botMsg.id;
  try { saveQueues(); } catch (e) {}
} else {
  const sent = await queueChannel.send({
    content: roleId ? `<@&${roleId}>` : null,
    embeds: [embed],
    components: [createJoinButton(queueKey)],
    allowedMentions: roleId ? { roles: [roleId] } : {}
  });
  if (sent) {
    queueObj.messageId = sent.id;
    try { saveQueues(); } catch (e) {}
  }
}

    return safeReply(interaction, {
      content: "✅ Queue opened successfully!"
    });
  } catch (err) {
    console.error("❌ /test command crashed:", err);
    if (interaction.deferred || interaction.replied) {
      await safeReply(interaction, { content: "❌ An internal error occurred while opening the queue." }).catch(() => {});
    }
  }
}

// ----------------- lt3tickets (Owner only) -----------------
if (cmd === "lt3tickets") {

  if (!isManagement) {
    return safeReply(interaction, {
      content: "❌ You must have the ++++ role to use this command.",
      ephemeral: true
    });
  }

  const state = interaction.options.getString("state");

  if (state === "enable") {
    LT3_TICKETS_ENABLED = true;
    saveLT3State();
    return safeReply(interaction, {
      content: "✅ LT3+ ticket button has been ENABLED.",
      ephemeral: true
    });
  }

  if (state === "disable") {
    LT3_TICKETS_ENABLED = false;
    saveLT3State();
    return safeReply(interaction, {
      content: "🚫 LT3+ ticket button has been DISABLED.",
      ephemeral: true
    });
  }
}

    // ----------------- nitro (Owner only) -----------------
if (cmd === "nitro") {
  if (!isOwner) return safeReply(interaction, { content: "❌ You must have the Owner role to use this command.", ephemeral: true });

  const ign = interaction.options.getString("ign");

  // fetch UUID
  let mcUUID = null;
  try {
    const resp = await axios.get(
  `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
  { timeout: 30000 }
);
    mcUUID = resp.data?.id || null;
  } catch (err) {
    return safeReply(interaction, { content: "Could not find that Minecraft IGN.", ephemeral: true });
  }

  try {
    const { data: player, error } = await supabase.from('players').select('*').eq('uuid', mcUUID).single();
    if (error && error.code !== 'PGRST116') throw error;
    const tiers = player?.tiers || [];
    const { error: upsertError } = await supabase.from('players').upsert({
      uuid: mcUUID,
      ign,
      tiers,
      nitro: true,
      last_tested: new Date().toISOString()
    });
    if (upsertError) throw upsertError;
    return safeReply(interaction, { content: `✨ **${ign}** has been granted Nitro styling!`, ephemeral: true });
  } catch (err) {
    console.error("Nitro update failed:", err);
    return safeReply(interaction, { content: "Failed to update Nitro status.", ephemeral: true });
  }
}

    // ----------------- stop (Tester only) -----------------
    if (cmd === "stop") {
      await interaction.deferReply({ ephemeral: true });
      if (!isTester) return safeReply(interaction, { content: "You must have the Tester role to stop a queue.", ephemeral: true });

      const guildId = interaction.guildId;
      if (!queues.has(guildId)) return safeReply(interaction, { content: "No active queues.", ephemeral: true });

      let stoppedQueueKey = null;
      for (const [key, q] of queues.get(guildId).entries()) {
        if (q.testers.includes(interaction.user.id)) {
          q.testers = q.testers.filter(t => t !== interaction.user.id);
          try { saveQueues(); } catch (e) {}
          if (q.testers.length === 0) {
            // delete queue
            queues.get(guildId).delete(key);
            try { saveQueues(); } catch (e) {}
            // delete message if possible (best-effort)
            if (q.messageId) {
              try {
const queueChannel = getQueueChannel(interaction.guild, q.region);
if (!queueChannel) return;

const msg = await queueChannel.messages.fetch(q.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
              } catch {}
            }
          } else {
            // update embed
            if (q.messageId) {
              try {
const queueChannel = getQueueChannel(interaction.guild, q.region);
if (!queueChannel) return;

const msg = await queueChannel.messages.fetch(q.messageId).catch(() => null);
                if (msg) await msg.edit({ embeds: [buildQueueEmbed(q)], components: [createJoinButton(key)] }).catch(() => {});
              } catch {}
            }
          }
          stoppedQueueKey = key;
          break;
        }
      }

      if (!stoppedQueueKey) return safeReply(interaction, { content: "You do not have an active queue to stop.", ephemeral: true });
      return safeReply(interaction, { content: "You have stopped your queue.", ephemeral: true });
    }

    if (cmd === "leaderboard_monthly") {
  await interaction.deferReply();

  if (monthlyTesterStats.size === 0) {
    return safeReply(interaction, { content: "No tests recorded this month yet." });
  }

  const top = [...monthlyTesterStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const desc = top
    .map((e, i) => `**${i + 1}.** <@${e[0]}> → **${e[1]} tests**`)
    .join("\n");

  return safeReply(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle("📅 Monthly Tester Leaderboard")
        .setColor("#4caf50")
        .setDescription(desc)
        .setTimestamp()
    ]
  });
}

// leaderboard_highresults handler removed

if (cmd === "highresult") {
    if (!isManagement) {
      return safeReply(interaction, { content: "❌ You must have the ++++ role to use this command.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const testedUser = interaction.options.getUser("tested_player");
    const testedIGN = interaction.options.getString("tested_ign");
    const passed = interaction.options.getBoolean("passed");
    const testingTier = interaction.options.getString("testing_tier");
    const region = interaction.options.getString("region");
    const testerTier = interaction.options.getString("tester_tier");
    const demoted = interaction.options.getBoolean("demoted");
    const demotedTo = interaction.options.getString("demoted_to");
    const demotedToTier = demotedTo || "Unranked";

    // Read both mode fields
    const modeA = interaction.options.getString("mode_a");
    const modeB = interaction.options.getString("mode_b");

    // Build array of selected modes
    let selectedModes = [modeA, modeB].filter(Boolean);

    // Remove "No Mode" / "Do Nothing" if another real mode exists
    if (selectedModes.includes("No Mode") && selectedModes.length > 1) {
      selectedModes = selectedModes.filter(m => m !== "No Mode");
    }

    // If nothing left, keep "Do Nothing"
    if (!selectedModes.length) selectedModes = ["No Mode"];

    // Use for embed, API, previous-tier lookup, etc.
    const mode = selectedModes.join(", ");

    // Fetch UUID
    let mcUUID = null;
    try {
        const resp = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(testedIGN)}`, { timeout: 30000 });
        mcUUID = resp.data?.id || null;
    } catch {}

    // Fetch previous tier
    let previousTier = "Unranked";
    if (mcUUID) {
        try {
            const { data: player, error } = await supabase.from('players').select('tiers').eq('uuid', mcUUID).single();
            if (!error) {
                const tierObj = player?.tiers?.find(t => t.gamemode === mode);
                previousTier = tierObj?.tier || "Unranked";
            }
        } catch {}
    }

    // Determine new tier
    let newTier = previousTier;
    if (passed) newTier = testingTier;
    if (demoted && demotedTo) newTier = demotedTo;

    // if the tier actually changed then update the website record as well
    if (mcUUID && newTier !== previousTier) {
      try {
        await upsertPlayerTier({
          uuid: mcUUID,
          ign: testedIGN,
          region,
          gamemode: mode,
          newTier
        });
      } catch (err) {
        console.error("Failed to update player data (highresult):", err);
      }
    }

    // Build high result message
    let message = `<@${testedUser.id}> – ${testedIGN} has **${passed ? "Passed" : "Failed"}** their **${testingTier}** Test in **${mode}**\n`;
    message += `**\n__${testerTier} Fights:__**\n> ${interaction.options.getString("result1")} ${interaction.options.getInteger("score_player1")}-${interaction.options.getInteger("score_tester1")} vs. ${interaction.options.getString("tester1")}`;
    if (interaction.options.getString("result2")) {
        message += `\n> ${interaction.options.getString("result2")} ${interaction.options.getInteger("score_player2")}-${interaction.options.getInteger("score_tester2")} vs. ${interaction.options.getString("tester2")}`;
    }
    if (interaction.options.getString("result3")) {
        message += `\n> ${interaction.options.getString("result3")} ${interaction.options.getInteger("score_player3")}-${interaction.options.getInteger("score_tester3")} vs. ${interaction.options.getString("tester3")}`;
    }
    if (demoted && demotedTo) {
        message += `\n-# ${testedIGN} has been demoted to ${demotedTo}`;
    }

    const ownerId = interaction.user.id;
    const current = highResultStats.get(ownerId) || 0;
    highResultStats.set(ownerId, current + 1);
    saveHighResultStats();

    // Send to high-results channel
    const highResultsChannel = interaction.guild.channels.cache.find(c => c.name === "『🏆』high-results");
    if (highResultsChannel) await highResultsChannel.send({ content: message });

    // after posting the message, try to sync the tier role of the tested Discord user
    if (mcUUID) {
        const member = await interaction.guild.members.fetch(testedUser.id).catch(() => null);
        if (member) {
            await syncMemberTierRole(member, mcUUID);
        }
    }

    // send clean embed to results channel
    const resultsChannel = interaction.guild.channels.cache.get(RESULTS_CHANNEL_ID) || await interaction.guild.channels.fetch(RESULTS_CHANNEL_ID).catch(() => null);
    if (resultsChannel) {
        const embed = new EmbedBuilder()
            .setTitle("Tier Test Result! 🏆")
            .setColor("#fff353")
            .setThumbnail(`https://render.crafty.gg/3d/bust/${encodeURIComponent(testedIGN)}`)
            .addFields(
                { name: "IGN", value: testedIGN },
                { name: "Region", value: region },
                { name: "Gamemode", value: mode },
                { name: "Previous Tier", value: previousTier },
                { name: "New Tier", value: newTier }
            )
            .setTimestamp();
        await resultsChannel.send({ embeds: [embed] });
    }
}

if (cmd === "ratebuilder") {
  await interaction.deferReply({ ephemeral: true });

  const ign = interaction.options.getString("ign");
  const region = interaction.options.getString("region") || "Unknown";
const composition = interaction.options.getString("composition");
const buildings = interaction.options.getString("buildings");
const organics = interaction.options.getString("organics");
const terrain = interaction.options.getString("terrain");
const details = interaction.options.getString("details");
const colouring = interaction.options.getString("colouring");
  const testers = interaction.options.getString("testers") || "N/A";

  // 🔑 Fetch Minecraft UUID
  let uuid;
  try {
    const resp = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
      { timeout: 30000 }
    );
    uuid = resp.data?.id;
  } catch {
    uuid = null;
  }

  if (!uuid) {
    return safeReply(interaction, { content: "❌ Could not fetch Minecraft UUID for this IGN." });
  }

  // 🔧 Save to database via helper
  try {
    await upsertBuilderRatings({
  uuid,
  ign,
  region,
  composition,
  buildings,
  organics,
  terrain,
  details,
  colouring
});
    } catch (err) {
    console.error("Failed to upsert builder ratings:", err);
    return safeReply(interaction, { content: "❌ Failed to save builder rating to the database." });
  }

  // 🔎 Find ratings channel
  const ratingsChannel = interaction.guild.channels.cache.find(
    c => c.name === "『🏆』ratings"
  );

  if (!ratingsChannel) {
    return safeReply(interaction, { content: "❌ Ratings channel not found." });
  }

  // 🏗️ Build embed
  const embed = new EmbedBuilder()
    .setTitle("Rating Result! 🏆")
    .setColor("#fff353")
    .setThumbnail(`https://render.crafty.gg/3d/bust/${encodeURIComponent(ign)}`)
    .addFields(
      { name: "Builder", value: ign },
      { name: "Region", value: region },
  { name: "Composition", value: composition },
  { name: "Buildings", value: buildings },
  { name: "Organics", value: organics },
  { name: "Terrain", value: terrain },
  { name: "Details", value: details },
  { name: "Colouring", value: colouring },
  { name: "Tester(s)", value: testers }
)
    .setTimestamp();

  // 📤 Send embed to ratings channel
  await ratingsChannel.send({ embeds: [embed] });

  // ✅ Acknowledge command
  return safeReply(interaction, { content: "✅ Builder rating posted in 『🏆』ratings and saved to database." });
}
    // ----------------- next (Tester only) -----------------
if (cmd === "next") {
  await interaction.deferReply({ ephemeral: true });
  if (!isTester)
    return safeReply(interaction, { content: "Tester role required." });

  const guildQueues = queues.get(interaction.guildId);
  if (!guildQueues)
    return safeReply(interaction, { content: "No active queues." });

  // 🔴 FIND THE QUEUE THIS TESTER OWNS
  let queueKey = null;
  let queueObj = null;

  for (const [key, q] of guildQueues.entries()) {
    if (q.testers.includes(interaction.user.id)) {
      queueKey = key;
      queueObj = q;
      break;
    }
  }

  if (!queueObj)
    return safeReply(interaction, {
      content: "You are not assigned to any active queue."
    });

  if (queueObj.users.length === 0)
    return safeReply(interaction, {
      content: "Your queue is empty."
    });

  // ✅ CORRECT USER
  const nextUserId = queueObj.users.shift();
  try { saveQueues(); } catch (e) {}

  // 🔒 Lock user so they can't join another queue
if (!lockedUsers.has(interaction.guildId)) {
  lockedUsers.set(interaction.guildId, new Set());
}
lockedUsers.get(interaction.guildId).add(nextUserId);

  // notify new first
  if (queueObj.users.length > 0) {
    await notifyFirstInQueue(interaction.guild, queueObj, queueObj.users[0]);
  }

  // update embed
  if (queueObj.messageId) {
    try {
      const queueChannel = getQueueChannel(interaction.guild, queueObj.region);
if (!queueChannel) return;

const msg = await queueChannel.messages.fetch(queueObj.messageId).catch(() => null);
      await msg.edit({
        embeds: [buildQueueEmbed(queueObj)],
        components: [createJoinButton(queueKey)]
      });
    } catch {}
  }

  // create ticket
  const member = await interaction.guild.members.fetch(nextUserId).catch(() => null);
  const testerMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  // build ticket name from tester IGN (fallback to username)
  const testerIgn = testerIGNs.get(interaction.user.id) || interaction.user.username || interaction.user.id;
  const safeIgn = String(testerIgn).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  const ticketChannel = await interaction.guild.channels.create({
    name: `ticket-${safeIgn}`,
    type: ChannelType.GuildText,
    parent: QUEUE_CATEGORY_ID,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: member?.id || nextUserId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: testerMember?.id || interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]
  });

  // Track the single tester who created this ticket and the tested user id
  try {
    ticketOwners.set(ticketChannel.id, { creatorId: interaction.user.id, testedId: nextUserId, type: 'queue' });
    try { saveTicketOwners(); } catch (e) {}
  } catch (err) {
    console.warn("Failed to set ticket owner mapping:", err);
  }

  await ticketChannel.send({
    content: `<@${nextUserId}> <@${interaction.user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle("🎫 Testing Ticket")
        .setDescription("You are next in the queue!")
        .setColor(0x5865f2)
        .setTimestamp()
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_queue_ticket")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  });

  return safeReply(interaction, { content: `Ticket created for <@${nextUserId}>` });
}

// ----------------- testdone (Owner only) -----------------
if (cmd === "testdone") {
  await interaction.deferReply({ ephemeral: true });
  if (!isSuperOwner) {
    return safeReply(interaction, { content: "❌ You must have the +++++ role to use this command." });
  }

  const testerUser = interaction.options.getUser("tester");
  const amount = interaction.options.getInteger("tests");

  if (!testerUser) {
    return safeReply(interaction, { content: "❌ Tester not found." });
  }

  const current = testerStats.get(testerUser.id) || 0;
  const updated = Math.max(0, current + amount); // prevent negative totals

  testerStats.set(testerUser.id, updated);
  saveTesterStats();

  return safeReply(interaction, {
    content:
      `✅ **Tester stats updated**\n` +
      `👤 Tester: <@${testerUser.id}>\n` +
      `📊 Previous: **${current}**\n` +
      `➕ Change: **${amount}**\n` +
        `🏁 New Total: **${updated}**`
  });
}

    // ----------------- leave (Anyone but only if in queue) -----------------
if (cmd === "leave") {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!queues.has(guildId)) {
    return safeReply(interaction, { content: "No active queues." });
  }

  let foundQueue = null;
  let queueKey = null;

  for (const [key, q] of queues.get(guildId).entries()) {
    if (q.users.includes(interaction.user.id)) {
      foundQueue = q;
      queueKey = key;
      q.users = q.users.filter(u => u !== interaction.user.id);
      try { saveQueues(); } catch (e) {}
      break;
    }
  }

  if (!foundQueue) {
    return safeReply(interaction, { content: "You are not in any queue." });
  }

  if (foundQueue.messageId) {
    try {
      const queueChannel = getQueueChannel(interaction.guild, foundQueue.region);
if (!queueChannel) return;

const msg = await queueChannel.messages.fetch(foundQueue.messageId).catch(() => null);
      await msg.edit({
        embeds: [buildQueueEmbed(foundQueue)],
        components: [createJoinButton(queueKey)]
      });
    } catch {}
  }

  return safeReply(interaction, { content: "You have left the queue." });
}

// ----------------- close (Anyone, ticket only) -----------------
if (cmd === "close") {
  if (!interaction.channel || !interaction.channel.name.startsWith("ticket-")) {
    return safeReply(interaction, {
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

  try {
    const meta = ticketOwners.get(interaction.channel?.id);
    if (meta && meta.testedId) lockedUsers.get(interaction.guildId)?.delete(meta.testedId);
  } catch (e) {}
  await safeReply(interaction, {
    content: "Closing ticket...",
    ephemeral: true
  });

  // cleanup ticketOwners mapping for this channel
  try { ticketOwners.delete(interaction.channel?.id); } catch (e) {}
  try { saveTicketOwners(); } catch (e) {}

  await safeReply(interaction, {
    content: "Closing ticket...",
    ephemeral: true
  });

  setTimeout(async () => {
    try {
      try { await sendTicketLog(interaction.channel); } catch (e) {}
      if (interaction.channel?.deletable) {
        await interaction.channel.delete();
      }
    } catch (err) {
      console.error("Failed deleting ticket:", err);
    }
  }, 500);

  return;
}

if (cmd === "code") {
  if (!hasRole(interaction.member, "SuperOwner")) {
    return interaction.reply({
      content: "❌ You must have the +++++ role to use this command.",
      ephemeral: true
    });
  }
  return handleCodeCommand(interaction);
}

    // ----------------- cooldown (Anyone) -----------------
    if (cmd === "cooldown") {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      const userCooldowns = cooldowns.get(guildId)?.get(userId);

      if (!userCooldowns || userCooldowns.size === 0) {
        return interaction.reply({
          content: "✅ You have no active cooldowns.",
          ephemeral: true
        });
      }

      const lines = [];

      for (const [mode, expiry] of userCooldowns.entries()) {
        if (Date.now() > expiry) continue;

        const remaining = formatRemaining(expiry - Date.now());
        lines.push(`• **${mode}** → ${remaining}`);
      }

      if (lines.length === 0) {
        return interaction.reply({
          content: "✅ You have no active cooldowns.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: `⏳ **Your active cooldowns:**\n${lines.join("\n")}`,
        ephemeral: true
      });
    }

    // ----------------- result (Tester only; must be used in ticket channel) -----------------
// ----------------- result (Tester only; must be used in ticket channel) -----------------
if (cmd === "result") {
  // Defer reply immediately to avoid timeout
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  // Role & channel checks
  if (!isTester) {
    return safeReply(interaction, {
      content: "You must have the Tester role to use this command.",
      ephemeral: true
    });
  }

  if (!interaction.channel?.name?.startsWith("ticket-")) {
    return safeReply(interaction, {
      content: "This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

  const ign = interaction.options.getString("ign");
  const region = interaction.options.getString("region");
  // Read both mode fields safely
let modes = [
  interaction.options.getString("mode_a"),
  interaction.options.getString("mode_b")
].filter(Boolean) // remove null/undefined
  .filter(m => m !== "No Mode"); // remove "No Mode"

// Combine modes into a single string for embed or website
const gamemode = modes.length > 0 ? modes.join(", ") : "None";

  const newTier = interaction.options.getString("new_tier");

  let previousTier = "Unranked";
  let mcUUID = null;

  // ---------- FETCH UUID ----------
  try {
    const resp = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
      { timeout: 30000 }
    );
    mcUUID = resp.data?.id || null;
  } catch (err) {
    console.warn("Failed to fetch UUID:", err?.message || err);
  }

  // ---------- FETCH PREVIOUS TIER ----------
  if (mcUUID) {
    try {
      const { data: player, error } = await supabase.from('players').select('tiers').eq('uuid', mcUUID).single();
      if (!error) {
        const tierObj = player?.tiers?.find(t => t.gamemode === gamemode);
        previousTier = tierObj?.tier || "Unranked";
      }
    } catch (err) {
      console.warn("Failed to fetch player data:", err?.message || err);
      previousTier = "Unranked";
    }
  }

  // ---------- FETCH TICKET METADATA ----------
  const meta = ticketOwners.get(interaction.channel.id);
  if (!meta || !meta.creatorId) {
    return safeReply(interaction, {
      content: "❌ This ticket is not linked to a queue tester. Results can only be submitted in tickets created by queue testers.",
      ephemeral: true
    });
  }

  // only the creator (tester) or Owner role may submit results
  if (meta.creatorId !== interaction.user.id && !isOwner) {
    return safeReply(interaction, {
      content: "❌ You can only submit results in tickets created by your queue.",
      ephemeral: true
    });
  }

  // ensure this is a queue ticket (not lt3/support/report)
  if (meta.type !== 'queue') {
    return safeReply(interaction, {
      content: "❌ /result can only be used inside queue tickets.",
      ephemeral: true
    });
  }

  // fetch tested member id from metadata
  const testedId = meta.testedId;
  const testedMember = testedId ? await interaction.guild.members.fetch(testedId).catch(() => null) : null;
  if (!testedMember) {
    return safeReply(interaction, {
      content: "❌ Could not find the tested player in this server.",
      ephemeral: true
    });
  }

  // ---------- FIND RESULTS CHANNEL ----------
  const resultsChannel = interaction.guild.channels.cache.get(RESULTS_CHANNEL_ID) || await interaction.guild.channels.fetch(RESULTS_CHANNEL_ID).catch(() => null);

  if (!resultsChannel) {
    return safeReply(interaction, {
      content: "Results channel not found.",
      ephemeral: true
    });
  }

  // ---------- CREATE EMBED ----------
  // Store tester IGN and modes for /tiertests (in case not already stored)
  try {
    let prof = testerProfile.get(testerId) || { ign, modes: new Set() };
    prof.ign = ign;
    for (const m of modes) prof.modes.add(m);
    testerProfile.set(testerId, prof);
    saveTesterProfile();
  } catch (e) { console.warn('Failed to update testerProfile:', e); }
  const testerId = interaction.user.id;
  const testsDone = (testerStats.get(testerId) || 0) + 1;

  const outEmbed = new EmbedBuilder()
    .setTitle("Tier Test Result! 🏆")
    .setColor("#fff353")
    .setThumbnail(`https://render.crafty.gg/3d/bust/${encodeURIComponent(ign)}`)
    .addFields(
      { name: "Tester", value: `<@${testerId}>`},
      { name: "Tests Completed", value: `${testsDone}`},
      { name: "IGN", value: ign},
      { name: "Region", value: region},
      { name: "Gamemode", value: gamemode},
      { name: "Previous Tier", value: previousTier},
      { name: "New Tier", value: newTier}
    )
    .setTimestamp();

  try {
    await resultsChannel.send({
      content: `<@${testedMember.id}>`,
      embeds: [outEmbed]
    });
  } catch (err) {
    console.error("Failed to send result to channel:", err);
  }

  // ---------- APPLY COOLDOWN & UNLOCK USER ----------
  setModeCooldown(interaction.guildId, testedMember.id, gamemode, testedMember);
  lockedUsers.get(interaction.guildId)?.delete(testedMember.id);

  // ---------- UPDATE QUEUE EMBED ----------
  const guildQueues = queues.get(interaction.guildId);
  if (guildQueues) {
    for (const [queueKey, queueObj] of guildQueues.entries()) {
      if (queueObj.users.includes(testedMember.id)) {
        // Remove the tested member from the queue
        queueObj.users = queueObj.users.filter(u => u !== testedMember.id);
        try { saveQueues(); } catch (e) {}

        // Update queue embed if we have a messageId
        if (queueObj.messageId) {
          try {
const queueChannel = getQueueChannel(interaction.guild, queueObj.region);
if (!queueChannel) return;

const msg = await queueChannel.messages.fetch(queueObj.messageId).catch(() => null);
            if (msg) {
              await msg.edit({
                embeds: [buildQueueEmbed(queueObj)],
                components: [createJoinButton(queueKey)]
              });
            }
          } catch (err) {
            console.warn("Failed to update queue after result:", err);
          }
        }

        // Notify next user in queue
        if (queueObj.users.length > 0) {
          await notifyFirstInQueue(interaction.guild, queueObj, queueObj.users[0]);
        }

        break;
      }
    }
  }

  // ---------- WEBSITE UPDATE ----------
  if (mcUUID) {
    try {
      await upsertPlayerTier({
        uuid: mcUUID,
        ign,
        region,
        gamemode,
        newTier
      });

      // update Discord role based on the player's highest current tier on the
      // website; testedMember is guaranteed to exist earlier in this flow
      if (mcUUID && testedMember) {
        await syncMemberTierRole(testedMember, mcUUID);
      }

      const current = testerStats.get(testerId) || 0;
      testerStats.set(testerId, current + 1);
      saveTesterStats();

      const monthlyCurrent = monthlyTesterStats.get(testerId) || 0;
      monthlyTesterStats.set(testerId, monthlyCurrent + 1);
      saveMonthlyTesterStats();

      setTimeout(async () => {
  try {
    // cleanup ticket owner mapping then delete channel
    try { ticketOwners.delete(interaction.channel?.id); } catch (e) {}
    try { saveTicketOwners(); } catch (e) {}
    if (interaction.channel?.deletable) {
      await interaction.channel.delete();
    }
  } catch (err) {
    console.error("Failed to auto-close ticket after /result:", err);
  }
}, 5000); // 5 seconds delay

      return safeReply(interaction, {
        content: "✅ Result submitted successfully and player data updated!",
        ephemeral: true
      });
    } catch (err) {
      console.error("Failed to update player data:", err);
      return safeReply(interaction, {
        content: "⚠️ Result submitted but failed to update player data on the website.",
        ephemeral: true
      });
    }
  }

  return safeReply(interaction, {
    content: "✅ Result submitted, but could not fetch Minecraft UUID to update website.",
    ephemeral: true
  });
}

if (cmd === "addtester") {
  // the API sometimes returns 503, especially during an outage or heavy load.
  // deferReply will throw in that case and bubble out to the global catch block,
  // which then tries to report an error on an already-expired interaction.
  // quietly catch failures so the rest of the command can still run or at least
  // fail gracefully.
  try {
    await interaction.deferReply({ flags: 64 }); // 64 = MessageFlags.Ephemeral
  } catch (err) {
    if (err.status === 503) {
      console.warn("deferReply hit Service Unavailable – Discord may be down");
    } else {
      console.warn("deferReply failed:", err?.message || err);
    }
    // we'll continue anyway; safeReply will handle the final reply if possible
  }

  if (!hasRole(interaction.member, "Admin")) {
    return safeReply(interaction, { content: "❌ Admin role required." });
  }

  if (!interaction.channel?.name?.startsWith("ticket-") && !interaction.channel?.name?.startsWith("support-help")) {
    return safeReply(interaction, { content: "❌ This command can only be used in a ticket." });
  }

  const user = interaction.options.getUser("user");

  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });


  return safeReply(interaction, { content: `✅ <@${user.id}> has been added to this ticket.` });
}

if (cmd === "removetester") {
  await interaction.deferReply({ ephemeral: true });

  if (!hasRole(interaction.member, "Admin")) {
    return safeReply(interaction, { content: "❌ Admin role required." });
  }

  if (!interaction.channel?.name?.startsWith("ticket-") && !interaction.channel?.name?.startsWith("support-help")) {
    return safeReply(interaction, { content: "❌ This command can only be used in a ticket." });
  }

  const user = interaction.options.getUser("user");

  await interaction.channel.permissionOverwrites.delete(user.id);


  return safeReply(interaction, { content: `✅ <@${user.id}> has been removed from this ticket.` });
}


// ----------------- tester (Owner only) -----------------
if (cmd === "tester") {
  await interaction.deferReply({ ephemeral: true });
  if (!isOwner) {
    return safeReply(interaction, { content: "❌ You must have the +++ role to use this command." });
  }

  const ign = interaction.options.getString("ign");
  const region = interaction.options.getString("region") || "Unknown"; // fallback

  // Fetch Minecraft UUID
  let mcUUID;
  try {
    mcUUID = await fetchMojangUUID(ign);
  } catch (err) {
    console.error("Failed to fetch UUID for tester command:", err?.message || err);
    return safeReply(interaction, { content: "❌ Minecraft IGN not found." });
  }

  const modeA = interaction.options.getString("mode_a");
  const modeB = interaction.options.getString("mode_b");

  // --- Build array for API ---
  let newModes = [modeA, modeB].filter(Boolean);

  // Remove "No Mode" if another real mode exists
  if (newModes.includes("No Mode") && newModes.length > 1) {
    newModes = newModes.filter(m => m !== "No Mode");
  }

  // If both are "No Mode" or nothing selected, keep "No Mode"
  if (!newModes.length) newModes = ["No Mode"];

  // Add timeout wrapper for Supabase operations
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), 10000)
    );

    // 1️⃣ Fetch existing tester data from Supabase
    let existingModes = [];
    try {
      const fetchPromise = supabase.from('testers').select('mode').eq('uuid', mcUUID).single();
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      if (error && error.code !== 'PGRST116') throw error;
      if (data && data.mode) {
        if (Array.isArray(data.mode)) {
          existingModes = data.mode;
        } else if (typeof data.mode === 'string') {
          try {
            const parsed = JSON.parse(data.mode);
            existingModes = Array.isArray(parsed) ? parsed : [data.mode];
          } catch {
            existingModes = [data.mode];
          }
        } else {
          existingModes = [data.mode];
        }
      }
    } catch (fetchErr) {
      console.warn("Failed to fetch existing tester modes:", fetchErr?.message || fetchErr);
      existingModes = [];
    }

    const allModes = Array.from(new Set([...existingModes, ...newModes]));

    const upsertPromise = addWebsiteTester({
      uuid: mcUUID,
      name: ign,
      mode: allModes,
      region
    });

    await Promise.race([upsertPromise, timeoutPromise]);

    return safeReply(interaction, { content: `✅ **${ign}** has been added as a **Tester**.\n**Modes:** ${allModes.join(", ")}\n**Region:** ${region}` });
  } catch (err) {
    console.error("Failed to add tester:", err?.message || err);
    return safeReply(interaction, { content: "⚠️ Failed to add tester. Check server logs." });
  }
}


if (cmd === "tiers") {
  if (!interaction.channel || interaction.channel.name !== "🤖︱commands") {
    return interaction.reply({
      content: "❌ This command can only be used in **🤖︱commands**.",
      ephemeral: true
    });
  }

  await interaction.deferReply();

  const ign = interaction.options.getString("ign");

  // Fetch UUID
  let mcUUID = null;
  try {
    const resp = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
      { timeout: 30000 }
    );
    mcUUID = resp.data?.id || null;
  } catch {
    return interaction.followUp({ content: "❌ Minecraft IGN not found." });
  }

  if (!mcUUID) {
    return interaction.followUp({ content: "❌ Minecraft IGN not found." });
  }

  let player = null;
  try {
    const { data, error } = await supabase.from('players').select('*').eq('uuid', mcUUID).single();
    if (!error) {
      player = data;
    }
  } catch {
    player = null;
  }

  if (!player) {
    return interaction.followUp({ content: `❌ Could not fetch tier data for **${ign}**.` });
  }

  const embed = buildTiersEmbed(ign, player, 'main', mcUUID);
  const components = buildTierNavigationButtons('main', mcUUID);
  return interaction.followUp({ embeds: [embed], components });
}

if (cmd === "leaderboard") {
  await interaction.deferReply({ ephemeral: false });

  if (testerStats.size === 0) {
    return safeReply(interaction, { content: "No tester stats available yet." });
  }

  // Sort testers by tests completed (descending) and take top 10
  const topTesters = [...testerStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const leaderboard = topTesters
    .map((entry, index) => `**${index + 1}.** <@${entry[0]}> → **${entry[1]} tests**`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🏆 Tester Leaderboard")
    .setDescription(leaderboard)
    .setColor("#ffb300")
    .setTimestamp();

  return safeReply(interaction, { embeds: [embed] });
}

    // ----------------- manual (Owner only) -----------------
if (cmd === "manual") {
    if (!isOwner) {
      return safeReply(interaction, { content: "❌ You must have the +++ role to use this command." });
    }

  const ign = interaction.options.getString("ign");
  const region = interaction.options.getString("region");
  const previousTier = interaction.options.getString("previous_tier");
  const newTier = interaction.options.getString("new_tier");

// Read both mode fields safely
let modes = [
  interaction.options.getString("mode_a"),
  interaction.options.getString("mode_b")
].filter(Boolean) // remove null/undefined
  .filter(m => m !== "No Mode"); // remove "No Mode"

// Combine modes into a single string for embed or website
const gamemode = modes.length > 0 ? modes.join(", ") : "None";

const embed = new EmbedBuilder()
  .setTitle("Manual Tier Test Result! 🏆")
  .setColor('#ffb300')
  .setThumbnail(`https://render.crafty.gg/3d/bust/${encodeURIComponent(ign)}`)
  .addFields(
    { name: "IGN", value: ign },
    { name: "Region", value: region },
    { name: "Gamemode", value: gamemode },
    { name: "Previous Tier", value: previousTier },
    { name: "New Tier", value: newTier },
    { name: "Moderator", value: `<@${interaction.user.id}>` }
  ).setTimestamp();


  const secretLogsChannel = interaction.guild.channels.cache.find(c => c.name === SECRET_LOGS_CHANNEL_NAME);
  if (!secretLogsChannel) return safeReply(interaction, { content: "Secret logs channel not found.", ephemeral: true });

  await secretLogsChannel.send({ embeds: [embed] }).catch(err => console.error("Failed to send to secret logs:", err));

  let mcUUID = null;
  try {
    const resp = await axios.get(
  `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,
  { timeout: 30000 }
);
    mcUUID = resp.data?.id || null;
  } catch (err) {
    console.warn("Failed to fetch UUID for manual:", err?.message || err);
  }

  if (mcUUID) {
    try {
      await upsertPlayerTier({
        uuid: mcUUID,
        ign,
        region,
        gamemode,
        newTier
      });

      // attempt to locate a guild member matching the IGN so we can update
      // their tier role as well; this is best-effort and will quietly
      // skip if the user isn't on the server
      const member = interaction.guild.members.cache.find(m => {
        const uname = m.user.username.toLowerCase();
        const nick = (m.nickname || "").toLowerCase();
        return uname === ign.toLowerCase() || nick === ign.toLowerCase();
      });
      if (member) {
        await syncMemberTierRole(member, mcUUID);
      }

      return safeReply(interaction, { content: "Manual result submitted successfully!", ephemeral: true });
    } catch (err) {
      console.error("Failed to update player data (manual):", err);
      return safeReply(interaction, { content: "Result submitted but failed to update player data on the website.", ephemeral: true });
    }
  } else {
    return safeReply(interaction, { content: "Result submitted, but could not fetch Minecraft UUID.", ephemeral: true });
  }
}
    // Unhandled command: ignore
  } catch (err) {
    // Global catch for the handler - avoid crashing the process
    console.error("Unhandled interaction error:", err);
    try {
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "An unexpected error occurred while handling your request.", ephemeral: true });
      } else if (interaction && interaction.deferred) {
        await safeReply(interaction, { content: "An unexpected error occurred while handling your request." });
      }
    } catch (replyErr) {
      console.error("Failed to report error to interaction:", replyErr);
    }
  }
});

// ---------------------------
// GuildMemberAdd welcome handler
// ---------------------------
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;

    const newInvites = await guild.invites.fetch();
    const oldInvites = invitesCache.get(guild.id) || new Map();

    let usedInvite = null;

    for (const invite of newInvites.values()) {
      const oldUses = oldInvites.get(invite.code) || 0;
      if (invite.uses > oldUses) {
        usedInvite = invite;
        break;
      }
    }

    // Update cache
    const updatedMap = new Map();
    newInvites.forEach(inv => updatedMap.set(inv.code, inv.uses));
    invitesCache.set(guild.id, updatedMap);

    // Track inviter
    let inviterText = "Unknown";
    if (usedInvite && usedInvite.inviter) {
      const inviterId = usedInvite.inviter.id;

      if (!inviteStats[guild.id]) inviteStats[guild.id] = {};
      inviteStats[guild.id][inviterId] =
        (inviteStats[guild.id][inviterId] || 0) + 1;

      saveInvites();

      const totalInvites = inviteStats[guild.id][inviterId];
      inviterText = `<@${inviterId}> (**${totalInvites} invites**)`;
    }

    // Auto Member role - use server-specific role
    const serverConfig = getServerConfig(guild.id);
    
    if (serverConfig && serverConfig.MEMBER_ROLE) {
      const memberRole = guild.roles.cache.get(serverConfig.MEMBER_ROLE);
      if (memberRole) {
        await member.roles.add(memberRole).catch(() => {});
      }
    } else {
      // Fallback to role named "Member"
      const memberRole = guild.roles.cache.find(r => r.name === 'Member');
      if (memberRole) await member.roles.add(memberRole).catch(() => {});
    }

    // Welcome message
    const channel = guild.channels.cache.find(ch => ch.name === '『👋』welcome');
    if (!channel) return;

    const welcomeEmbed = new EmbedBuilder()
      .setColor('#ffffff')
      .setTitle(`🎉 Welcome ${member.user.username}!`)
      .setDescription(
        `Glad to have you here! Please take a moment to read the rules and get ready for your first test.\n\n` +
        `👤 **Invited by:** ${inviterText}\n\n` +
        `📌 **Get Started:**\n` +
        `• Head to **#test-queues** for your tier test\n` +
        `• Check **#results** for progress\n\n` +
        `🌐 Website: [UltraTiers](https://www.ultratiers.com/)\n\n Have fun and enjoy your time here!`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'UltraTiers', iconURL: member.guild.iconURL({ dynamic: true }) })
      .setTimestamp();

    await channel.send({ embeds: [welcomeEmbed] });

  } catch (err) {
    console.error("Invite tracking failed:", err);
  }
});

// ---------------------------
// Start bot
// ---------------------------
client.login(TOKEN).catch(err => {
  console.error("Failed to login. Make sure BOT_TOKEN is set and valid. Error:", err);
});