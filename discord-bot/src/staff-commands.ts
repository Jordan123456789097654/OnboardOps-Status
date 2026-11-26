import { ChannelType, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type Guild, type TextChannel } from "discord.js";
import { api } from "./api";
import type { Command } from "./commands";

/** Everyday staff tools: handoffs, shift clock, onboarding threads, policy lookups, queue numbers, wins and deploy notes. */

const BLUE = 0x2563eb, GREEN = 0x16a34a, ORANGE = 0xea580c;
const text = (g: Guild, name: string) => g.channels.cache.find((c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name);
const now = (d = new Date()) => `<t:${Math.floor(d.getTime() / 1000)}:f> (${d.toISOString().slice(11, 16)} UTC)`;

async function needChannel(i: ChatInputCommandInteraction, name: string): Promise<TextChannel | null> {
  const ch = text(i.guild!, name);
  if (!ch) await i.reply({ content: `#${name} is missing. An admin needs to run /setup.`, ephemeral: true });
  return ch ?? null;
}

const handoff: Command = {
  json: new SlashCommandBuilder()
    .setName("handoff")
    .setDescription("Leave a handoff note for the next person")
    .addStringOption((o) => o.setName("note").setDescription("What you did, what is open, what needs attention").setRequired(true).setMaxLength(1500))
    .addStringOption((o) => o.setName("priority").setDescription("How urgent").addChoices({ name: "Normal", value: "normal" }, { name: "Needs attention", value: "attention" }, { name: "Urgent", value: "urgent" }))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const ch = await needChannel(i, "handoff");
    if (!ch) return;
    const p = i.options.getString("priority") ?? "normal";
    const color = p === "urgent" ? 0xdc2626 : p === "attention" ? ORANGE : BLUE;
    await ch.send({ embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() }).setTitle(p === "urgent" ? "URGENT handoff" : p === "attention" ? "Handoff: needs attention" : "Handoff").setDescription(i.options.getString("note", true)).setFooter({ text: `Left ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC` })], allowedMentions: { parse: [] } });
    await i.reply({ content: `Handoff posted in <#${ch.id}>.`, ephemeral: true });
  },
};

const shift: Command = {
  json: new SlashCommandBuilder()
    .setName("shift")
    .setDescription("Clock in or out, so the team knows who is on")
    .addSubcommand((s) => s.setName("in").setDescription("I am on shift").addStringOption((o) => o.setName("note").setDescription("Optional: what you are covering").setMaxLength(200)))
    .addSubcommand((s) => s.setName("out").setDescription("I am off shift").addStringOption((o) => o.setName("note").setDescription("Optional: how the shift went").setMaxLength(300)))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const ch = await needChannel(i, "shift-log");
    if (!ch) return;
    const on = i.options.getSubcommand() === "in";
    const note = i.options.getString("note");
    await ch.send({ embeds: [new EmbedBuilder().setColor(on ? GREEN : 0x6b7280).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() }).setTitle(on ? "Clocked in" : "Clocked out").setDescription(note ?? "").addFields({ name: "When", value: now(), inline: true })], allowedMentions: { parse: [] } });
    await i.reply({ content: on ? "You are on shift. Thanks." : "You are off shift. Thanks for today.", ephemeral: true });
  },
};

const ONBOARD_STEPS = [
  "Create named accounts on our domain; turn on two-factor and add a passkey.",
  "Set up the password manager and store recovery codes safely.",
  "Read the handbooks in the staff workspace and acknowledge each one.",
  "Complete the required courses (Security and Access, Data Protection, Phishing, Incident Response).",
  "Walk through a past incident and a support case with a buddy.",
  "Shadow for a week, then work with review, then work alone.",
  "Get added to alerts and the on-call plan.",
];

const onboard: Command = {
  json: new SlashCommandBuilder()
    .setName("onboard")
    .setDescription("Open an onboarding thread with the first-week checklist")
    .addStringOption((o) => o.setName("name").setDescription("The new person").setRequired(true).setMaxLength(60))
    .setDMPermission(false)
    .toJSON(),
  access: "manage",
  async run(i) {
    const ch = await needChannel(i, "onboarding");
    if (!ch) return;
    const name = i.options.getString("name", true);
    const thread = await ch.threads.create({ name: `Onboarding: ${name}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Onboarding" }).catch(() => null);
    if (!thread) { await i.reply({ content: "I could not create a thread in #onboarding.", ephemeral: true }); return; }
    await thread.send({ embeds: [new EmbedBuilder().setColor(BLUE).setTitle(`First week: ${name}`).setDescription(ONBOARD_STEPS.map((s, n) => `☐ **${n + 1}.** ${s}`).join("\n")).setFooter({ text: `Opened by ${i.user.username}` })] });
    await i.reply({ content: `Onboarding thread opened: <#${thread.id}>`, ephemeral: true });
  },
};

const POLICIES: Record<string, { title: string; where: string; summary: string }> = {
  incident: { title: "Incident response", where: "Staff workspace: Incident Response Handbook", summary: "Severity 1 to 4, the first 15 minutes, playbooks, customer messages, and the blameless review. Use `/incident` and `/runbook`." },
  support: { title: "Support", where: "Staff workspace: Support Handbook", summary: "Response targets, verifying identity before any sensitive change, reply style, and when to escalate." },
  security: { title: "Security and access", where: "Staff workspace: Security and Access Handbook", summary: "Two-factor and passkeys, secrets, who has access to what, devices, phishing, and offboarding." },
  privacy: { title: "Data protection", where: "Staff workspace: Data Protection and Privacy Handbook", summary: "Customer data belongs to the customer. Requests from people, AI tools, subprocessors, retention and outreach rules." },
  conduct: { title: "Code of conduct", where: "Staff workspace: Code of Conduct", summary: "Respect, honesty, privacy, integrity and safety. How to speak up and what happens if the rules are broken." },
  devices: { title: "Acceptable use", where: "Staff workspace: Acceptable Use policy", summary: "Company devices and accounts: encryption, screen locks, no shared logins, no customer data on personal devices." },
};

const policy: Command = {
  json: new SlashCommandBuilder()
    .setName("policy")
    .setDescription("Find the right handbook or policy")
    .addStringOption((o) => o.setName("topic").setDescription("Which one").addChoices(...Object.entries(POLICIES).map(([k, v]) => ({ name: v.title, value: k }))))
    .setDMPermission(false)
    .toJSON(),
  access: "any",
  async run(i) {
    const k = i.options.getString("topic");
    if (!k) {
      await i.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Policies and handbooks").setDescription(Object.entries(POLICIES).map(([key, v]) => `**${v.title}** (\`${key}\`): ${v.summary}`).join("\n\n"))] });
      return;
    }
    const p = POLICIES[k];
    await i.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(BLUE).setTitle(p.title).setDescription(p.summary).addFields({ name: "Where", value: p.where })] });
  },
};

const queue: Command = {
  json: new SlashCommandBuilder().setName("queue").setDescription("How the support queue looks right now").setDMPermission(false).toJSON(),
  access: "staff",
  async run(i) {
    await i.deferReply({ ephemeral: true });
    const r = await api<{ openTickets: number; newLast24h: number; solvedLast24h: number; failedEmailsLastHour: number; stale: { ref: string; ageHours: number; priority: string }[] }>("ops/signals?staleHours=24", "");
    if (r.status !== 200 || !r.data) { await i.editReply("Could not read the queue right now."); return; }
    const s = r.data;
    const embed = new EmbedBuilder().setColor(s.stale.length ? ORANGE : GREEN).setTitle("Support queue").addFields(
      { name: "Open now", value: String(s.openTickets), inline: true },
      { name: "New (24h)", value: String(s.newLast24h), inline: true },
      { name: "Solved (24h)", value: String(s.solvedLast24h), inline: true },
      { name: "Waiting over 24h", value: s.stale.length ? s.stale.slice(0, 8).map((t) => `${t.ref} · ${t.priority} · ${t.ageHours}h`).join("\n") : "None", inline: false },
    ).setTimestamp(new Date());
    await i.editReply({ embeds: [embed] });
  },
};

const wins: Command = {
  json: new SlashCommandBuilder()
    .setName("wins")
    .setDescription("Share a win with the team")
    .addStringOption((o) => o.setName("text").setDescription("What went well").setRequired(true).setMaxLength(500))
    .setDMPermission(false)
    .toJSON(),
  access: "any",
  async run(i) {
    const ch = await needChannel(i, "wins");
    if (!ch) return;
    await ch.send({ embeds: [new EmbedBuilder().setColor(GREEN).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() }).setTitle("🎉 Win").setDescription(i.options.getString("text", true))], allowedMentions: { parse: [] } });
    await i.reply({ content: "Posted in #wins. Nice work.", ephemeral: true });
  },
};

const deploylog: Command = {
  json: new SlashCommandBuilder()
    .setName("deploylog")
    .setDescription("Note a deploy or rollback in the deploy log")
    .addStringOption((o) => o.setName("what").setDescription("What was deployed or rolled back").setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName("result").setDescription("How it went").addChoices({ name: "Success", value: "ok" }, { name: "Rolled back", value: "rollback" }, { name: "Problem", value: "problem" }))
    .setDMPermission(false)
    .toJSON(),
  access: "manage",
  async run(i) {
    const ch = await needChannel(i, "deploy-log");
    if (!ch) return;
    const r = i.options.getString("result") ?? "ok";
    const color = r === "ok" ? GREEN : r === "rollback" ? ORANGE : 0xdc2626;
    await ch.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(`Deploy: ${r === "ok" ? "success" : r === "rollback" ? "rolled back" : "problem"}`).setDescription(i.options.getString("what", true)).addFields({ name: "By", value: `<@${i.user.id}>`, inline: true }, { name: "When", value: now(), inline: true })], allowedMentions: { parse: [] } });
    await i.reply({ content: "Logged.", ephemeral: true });
  },
};

/** Ask Maya a question about how OnboardOps works. Answered from the help docs, and logged if the docs don't cover it. */
const askMaya: Command = {
  json: new SlashCommandBuilder()
    .setName("ask-maya")
    .setDescription("Ask Maya how something in OnboardOps works (answered from the help docs)")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true).setMaxLength(500))
    .toJSON(),
  access: "staff",
  async run(i) {
    await i.deferReply({ ephemeral: true });
    const r = await api<{ answer: string; found: boolean }>("ops/maya/ask", i.user.id, { method: "POST", body: { question: i.options.getString("question", true) } });
    if (r.status !== 200 || !r.data) { await i.editReply("Maya couldn't answer just now. Try again in a moment."); return; }
    const body = r.data.answer.length > 3800 ? `${r.data.answer.slice(0, 3799)}…` : r.data.answer;
    await i.editReply({ embeds: [new EmbedBuilder().setColor(r.data.found ? BLUE : ORANGE).setTitle("Maya").setDescription(body).setFooter({ text: r.data.found ? "From the help docs" : "Not in the help docs. It's on this week's list." })] });
  },
};

export const staffCommands: Command[] = [handoff, shift, onboard, policy, queue, wins, deploylog, askMaya];
