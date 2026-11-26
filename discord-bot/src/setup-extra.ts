import { ActionRowBuilder, ButtonBuilder, ChannelType, EmbedBuilder, type Client, type Guild, type GuildBasedChannel, type MessageCreateOptions, type Role, type TextChannel } from "discord.js";
import { EXTRA_CATEGORIES } from "./layout-extra";
import { CATEGORIES, WEBHOOK_CHANNELS } from "./layout";

const BLUE = 0x2563eb;

/* ---------------- Wipe: remove channels that are not part of the layout ---------------- */

/** Every category and channel the layout keeps, by name. */
function keptNames(): Set<string> {
  const keep = new Set<string>();
  for (const cat of [...CATEGORIES, ...EXTRA_CATEGORIES]) {
    keep.add(`cat:${cat.name}`);
    for (const ch of cat.channels) keep.add(`ch:${ch.name}`);
  }
  return keep;
}

export type WipePlan = { channels: GuildBasedChannel[] };

/** Channels and categories that /setup wipe would delete. Roles and members are never touched. */
export function wipePlan(guild: Guild): WipePlan {
  const keep = keptNames();
  const channels = guild.channels.cache.filter((c) => (c.type === ChannelType.GuildCategory ? !keep.has(`cat:${c.name}`) : !keep.has(`ch:${c.name}`)));
  return { channels: [...channels.values()] };
}

/** Deletes non-category channels first, then categories, so nothing is left orphaned. */
export async function runWipe(guild: Guild): Promise<{ removed: string[]; failed: string[] }> {
  const { channels } = wipePlan(guild);
  const removed: string[] = [];
  const failed: string[] = [];
  const order = [...channels.filter((c) => c.type !== ChannelType.GuildCategory), ...channels.filter((c) => c.type === ChannelType.GuildCategory)];
  for (const c of order) {
    try {
      await c.delete("OnboardOps staff setup: wipe");
      removed.push(c.name);
    } catch {
      failed.push(c.name);
    }
  }
  return { removed, failed };
}

/* ---------------- Nuke: delete EVERY channel, category and deletable role ---------------- */

export type NukePlan = { channels: GuildBasedChannel[]; roles: Role[]; skippedRoles: Role[] };

/** Every channel, category and role in the server that /nuke would delete. */
export async function nukePlan(guild: Guild): Promise<NukePlan> {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const channels = [...guild.channels.cache.values()].filter((c) => !c.isThread());
  const customRoles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.roles.everyone.id && !r.managed);
  const roles = customRoles.filter((r) => r.editable);
  const skippedRoles = customRoles.filter((r) => !r.editable);
  return { channels, roles, skippedRoles };
}

/** Deletes every non-category channel (current channel last), every category, and every deletable role. */
export async function runNuke(guild: Guild, currentChannelId?: string): Promise<{
  removedChannels: string[];
  failedChannels: string[];
  removedRoles: string[];
  failedRoles: string[];
  skippedRoles: string[];
}> {
  const { channels, roles, skippedRoles } = await nukePlan(guild);
  const removedChannels: string[] = [];
  const failedChannels: string[] = [];
  const removedRoles: string[] = [];
  const failedRoles: string[] = [];

  const nonCat = channels.filter((c) => c.type !== ChannelType.GuildCategory && c.id !== currentChannelId);
  const current = channels.filter((c) => c.type !== ChannelType.GuildCategory && c.id === currentChannelId);
  const cats = channels.filter((c) => c.type === ChannelType.GuildCategory);

  for (const r of roles) {
    try {
      await r.delete("OnboardOps staff setup: nuke");
      removedRoles.push(r.name);
    } catch {
      failedRoles.push(r.name);
    }
  }

  for (const c of [...nonCat, ...current, ...cats]) {
    try {
      await c.delete("OnboardOps staff setup: nuke");
      removedChannels.push(c.name);
    } catch {
      failedChannels.push(c.name);
    }
  }

  return {
    removedChannels,
    failedChannels,
    removedRoles,
    failedRoles,
    skippedRoles: skippedRoles.map((r) => r.name),
  };
}

/* ---------------- Bio: the bot's About Me (application description) ---------------- */

export async function setBio(client: Client, text: string): Promise<void> {
  if (!client.application) throw new Error("The bot application is not ready yet.");
  await client.application.edit({ description: text.slice(0, 400) });
}

/* ---------------- Webhooks: one per website notice channel ---------------- */

/** Creates or finds the OnboardOps webhook in each notice channel. The URLs are returned only to the person who ran setup. */
export async function ensureWebhooks(guild: Guild, botId: string): Promise<string[]> {
  const lines: string[] = [];
  for (const [key, channelName] of Object.entries(WEBHOOK_CHANNELS)) {
    const ch = guild.channels.cache.find((c): c is TextChannel => c.type === ChannelType.GuildText && c.name === channelName);
    if (!ch) { lines.push(`# #${channelName} is missing`); continue; }
    const mine = (await ch.fetchWebhooks()).find((w) => w.owner?.id === botId && w.name === "OnboardOps");
    const hook = mine ?? (await ch.createWebhook({ name: "OnboardOps", reason: "Website notices" }));
    lines.push(`DISCORD_WEBHOOK_${key}=${hook.url}`);
  }
  return lines;
}

/* ---------------- Guide embeds: one message per channel, edited in place ---------------- */

type Guide = { channel: string; footer: string; embed: () => EmbedBuilder; buttons?: ActionRowBuilder<ButtonBuilder> };
const field = (name: string, value: string, inline = false) => ({ name, value, inline });

const GUIDES: Guide[] = [
  {
    channel: "resources",
    footer: "OnboardOps guide: resources v1",
    embed: () => new EmbedBuilder().setTitle("Resources").setColor(BLUE).setDescription("The handbooks and tools the team uses. Everyone signs in with their own account.").addFields(
      field("Website", "https://www.onboardops.org"),
      field("Status page", "https://status.onboardops.org"),
      field("Staff console", "https://www.onboardops.org/admin"),
      field("Handbooks", "Incident response, support, security and access, data protection, staff and operations, trust and safety. They live in the staff workspace."),
    ),
  },
  {
    channel: "bot-commands",
    footer: "OnboardOps guide: bot-commands v1",
    embed: () => new EmbedBuilder().setTitle("Staff bot: what it can do").setColor(BLUE).addFields(
      field("Tickets", "`/ticket`, `/mytickets`, `/saved`, `/solve`. In a ticket thread, `/say` replies to the customer (emailed and saved)."),
      field("Incidents", "`/incident start`, `/incident note`, `/incident resolve` run an incident in its own thread. `/runbook` gives the checklist."),
      field("Health", "`/health` (every service), `/mailauth`, `/dns`, `/ssl`, `/changelog`, `/botinfo`."),
      field("Team", "`/shift in`, `/shift out`, `/handoff`, `/onboard`, `/queue`, `/standup`, `/loa`, `/announce`, `/oncall`."),
      field("Everyday", "`/poll`, `/roll`, `/pick`, `/remind`, `/time`, `/policy`, `/wins`, `/deploylog`."),
      field("Admins", "`/setup`, `/permcheck`, `/webhooks`, `/backup-config`, `/maintenance`."),
    ),
  },
  {
    channel: "support-tickets",
    footer: "OnboardOps guide: support-tickets v1",
    embed: () => new EmbedBuilder().setTitle("How tickets work").setColor(BLUE).setDescription("Every new ticket gets its own thread here.").addFields(
      field("1. Claim", "Press **Claim** so the team knows you have it."),
      field("2. Read", "Open the message in the admin panel. Customer messages are never posted in Discord."),
      field("3. Reply", "Use `/say` in the thread, or the **Reply to customer** button. It is emailed and saved on the ticket."),
      field("4. Solve", "Press **Mark solved** when it is done. The thread is archived."),
    ),
  },
  {
    channel: "onboarding",
    footer: "OnboardOps guide: onboarding v1",
    embed: () => new EmbedBuilder().setTitle("New staff").setColor(BLUE).setDescription("Use `/onboard name:` to open a thread with the checklist for a new person.").addFields(
      field("First week", "Accounts, two-factor and a passkey, the handbooks, the required courses, and a walk-through of a past incident and a support case."),
    ),
  },
  {
    channel: "handoff",
    footer: "OnboardOps guide: handoff v1",
    embed: () => new EmbedBuilder().setTitle("Handoff notes").setColor(BLUE).setDescription("Use `/handoff` to leave a note for the next person: what you did, what is open, and what needs attention."),
  },
  {
    channel: "shift-log",
    footer: "OnboardOps guide: shift-log v1",
    embed: () => new EmbedBuilder().setTitle("Shift log").setColor(BLUE).setDescription("Use `/shift in` and `/shift out` to record when you are on. Times show in UTC and in your own time zone."),
  },
  {
    channel: "faq",
    footer: "OnboardOps guide: faq v1",
    embed: () => new EmbedBuilder().setTitle("Questions the team asks").setColor(BLUE).addFields(
      field("Where do I find a customer's message?", "In the admin panel, under Inbox. Open the ticket from the thread's link."),
      field("The status page shows a problem. What now?", "Run `/health`, then `/runbook` for the matching checklist."),
      field("How do I get a staff account?", "Ask an owner. Then run `/link` and enter the code on the website."),
    ),
  },
  {
    channel: "general",
    footer: "OnboardOps guide: general v1",
    embed: () => new EmbedBuilder().setTitle("Welcome to the OnboardOps staff server").setColor(BLUE).setDescription("Start in #handoff and #shift-log. Check #status-incidents before you start a shift. The full command list is in #bot-commands."),
  },
];

/** Posts each guide once and edits it on later runs, so re-running setup never duplicates them. */
export async function runGuides(guild: Guild, botId: string): Promise<string[]> {
  const out: string[] = [];
  for (const g of GUIDES) {
    const ch = guild.channels.cache.find((c): c is TextChannel => c.type === ChannelType.GuildText && c.name === g.channel);
    if (!ch) { out.push(`# no #${g.channel}`); continue; }
    const recent = await ch.messages.fetch({ limit: 25 }).catch(() => null);
    const payload: MessageCreateOptions = { embeds: [g.embed().setFooter({ text: g.footer }).setTimestamp(new Date())], components: g.buttons ? [g.buttons] : [] };
    const mine = recent?.find((m) => m.author.id === botId && m.embeds[0]?.footer?.text === g.footer);
    if (mine) { await mine.edit({ embeds: payload.embeds, components: payload.components }); out.push(`~ guide #${g.channel}`); }
    else { await ch.send(payload); out.push(`+ guide #${g.channel}`); }
  }
  return out;
}
