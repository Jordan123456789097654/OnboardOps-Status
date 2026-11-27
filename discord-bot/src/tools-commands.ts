import { ChannelType, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type TextChannel, type ThreadChannel } from "discord.js";
import { CERT_HOSTS, HOSTNAME, RECORD_TYPES, certInfo, fetchHealth, lookup, mailAuth, type RecordType } from "./checks";
import { ONCALL_ROLE } from "./layout";
import { confirm } from "./util";
import type { Command } from "./commands";

/**
 * Operations tools: live health, email authentication, DNS, certificates, release notes, runbooks, incident threads and bot info.
 * Everything here is read-only except the incident commands, which only create and write to threads. No customer data is touched.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const RED = 0xdc2626, ORANGE = 0xea580c, GREEN = 0x16a34a, BLUE = 0x2563eb;

/* ---------------- /health ---------------- */

const health: Command = {
  json: new SlashCommandBuilder().setName("health").setDescription("Live health of every OnboardOps service").setDMPermission(false).toJSON(),
  access: "staff",
  async run(i) {
    await i.deferReply({ ephemeral: true });
    const rows = await fetchHealth();
    const bad = rows.filter((r) => r.status === "down" || r.status === "unreachable");
    const slow = rows.filter((r) => r.status === "degraded");
    const embed = new EmbedBuilder()
      .setTitle(bad.length ? "Something is down" : slow.length ? "Some services are degraded" : "All services are healthy")
      .setColor(bad.length ? RED : slow.length ? ORANGE : GREEN)
      .setDescription(`${rows.length - bad.length - slow.length} of ${rows.length} healthy. Source: api.onboardops.org/status.`)
      .setTimestamp(new Date());
    for (const r of rows) embed.addFields({ name: r.label, value: `**${r.status.toUpperCase()}** · ${r.ms} ms\n${clip(r.message, 110)}`, inline: true });
    await i.editReply({ embeds: [embed] });
  },
};

/* ---------------- /mailauth ---------------- */

const mailauthCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("mailauth")
    .setDescription("Check SPF, DKIM, DMARC and MX for our email domain")
    .addStringOption((o) => o.setName("domain").setDescription("Defaults to onboardops.org").setMaxLength(100))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const host = (i.options.getString("domain") ?? "onboardops.org").trim().toLowerCase();
    if (!HOSTNAME.test(host)) { await i.reply({ content: "That does not look like a domain name.", ephemeral: true }); return; }
    await i.deferReply({ ephemeral: true });
    const m = await mailAuth(host);
    const serious = m.problems.filter((p) => !p.startsWith("DMARC is set to p=none"));
    const embed = new EmbedBuilder()
      .setTitle(`Email authentication for ${host}`)
      .setColor(serious.length ? RED : m.problems.length ? ORANGE : GREEN)
      .addFields(
        { name: "SPF", value: m.spf ? `\`${clip(m.spf, 200)}\`` : "**Missing**" },
        { name: "DKIM keys found", value: m.dkim.length ? m.dkim.join(", ") : "**None**", inline: true },
        { name: "DMARC", value: m.dmarc ? `\`${clip(m.dmarc, 120)}\`` : "**Missing**", inline: true },
        { name: "MX", value: m.mx.length ? m.mx.join("\n") : "**None**" },
      )
      .setTimestamp(new Date());
    embed.addFields({ name: m.problems.length ? "Needs attention" : "Verdict", value: m.problems.length ? m.problems.map((p) => `• ${p}`).join("\n") : "SPF, DKIM, DMARC and MX are all in place." });
    await i.editReply({ embeds: [embed] });
  },
};

/* ---------------- /dns ---------------- */

const dnsCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("dns")
    .setDescription("Look up a DNS record")
    .addStringOption((o) => o.setName("host").setDescription("For example onboardops.org").setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("type").setDescription("Record type (default A)").addChoices(...RECORD_TYPES.map((t) => ({ name: t, value: t }))))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const host = i.options.getString("host", true).trim().toLowerCase();
    const type = (i.options.getString("type") ?? "A") as RecordType;
    if (!HOSTNAME.test(host)) { await i.reply({ content: "That does not look like a valid host name.", ephemeral: true }); return; }
    await i.deferReply({ ephemeral: true });
    try {
      const rows = await lookup(host, type);
      await i.editReply({ embeds: [new EmbedBuilder().setTitle(`${type} for ${host}`).setColor(rows.length ? BLUE : ORANGE).setDescription(rows.length ? "```\n" + clip(rows.join("\n"), 1800) + "\n```" : "No records.").setFooter({ text: "As seen from the bot's host" }).setTimestamp(new Date())] });
    } catch (e) {
      const code = (e as { code?: string }).code;
      await i.editReply(code === "ENODATA" || code === "ENOTFOUND" ? `No ${type} record found for ${host}.` : `The lookup failed (${code ?? "error"}).`);
    }
  },
};

/* ---------------- /ssl ---------------- */

const sslCmd: Command = {
  json: new SlashCommandBuilder()
    .setName("ssl")
    .setDescription("Certificate expiry for our sites (or any host)")
    .addStringOption((o) => o.setName("host").setDescription("Optional. Defaults to all OnboardOps hosts").setMaxLength(100))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const one = i.options.getString("host")?.trim().toLowerCase();
    if (one && !HOSTNAME.test(one)) { await i.reply({ content: "That does not look like a valid host name.", ephemeral: true }); return; }
    await i.deferReply({ ephemeral: true });
    const certs = await Promise.all((one ? [one] : CERT_HOSTS).map(certInfo));
    const worst = Math.min(...certs.map((c) => (c.ok && c.daysLeft !== undefined ? c.daysLeft : -1)));
    const embed = new EmbedBuilder().setTitle("Certificates").setColor(worst < 14 ? RED : worst < 30 ? ORANGE : GREEN).setTimestamp(new Date());
    for (const c of certs) {
      embed.addFields({
        name: c.host,
        value: c.daysLeft !== undefined ? `${c.ok ? "Valid" : "**Problem: " + clip(c.error ?? "not trusted", 60) + "**"} · **${c.daysLeft} days left**\nExpires <t:${Math.floor((c.validTo as Date).getTime() / 1000)}:D> · ${c.issuer}` : `**${clip(c.error ?? "Could not read the certificate", 100)}**`,
      });
    }
    await i.editReply({ embeds: [embed] });
  },
};

/* ---------------- /changelog ---------------- */

const changelog: Command = {
  json: new SlashCommandBuilder().setName("changelog").setDescription("What is in the latest OnboardOps release").setDMPermission(false).toJSON(),
  access: "staff",
  async run(i) {
    await i.deferReply({ ephemeral: true });
    try {
      const r = await fetch("https://www.onboardops.org/api/version", { signal: AbortSignal.timeout(8000) });
      const v = (await r.json()) as { version?: string; whatsNew?: string; bullets?: string[] };
      const embed = new EmbedBuilder().setColor(BLUE).setTitle(`OnboardOps ${v.version ?? "?"}`).setURL("https://www.onboardops.org/changelog").setDescription(clip(v.whatsNew ?? "No summary.", 300));
      if (v.bullets?.length) embed.addFields({ name: "Highlights", value: clip(v.bullets.map((b) => `• ${b}`).join("\n"), 1000) });
      await i.editReply({ embeds: [embed] });
    } catch {
      await i.editReply("Could not read the release notes right now.");
    }
  },
};

/* ---------------- /runbook ---------------- */

const RUNBOOKS: Record<string, { title: string; steps: string[] }> = {
  first15: { title: "Any incident: the first 15 minutes", steps: ["Acknowledge the alert and tell the other person you have it.", "Open the incident log and note the time.", "Rate the severity, 1 to 4. When unsure, rate higher.", "Assign lead, technical, communications and scribe.", "If data may be exposed or an attacker is active, contain first.", "Post the holding message for SEV 1 or 2.", "Set the next update time and keep to it.", "Check what changed: deploys, keys, DNS, schema. If a deploy is likely, roll back first."] },
  "site-down": { title: "Site or sign-in is down", steps: ["Check the hosting provider's status and the last deployment.", "If the last deploy is suspect, promote the previous good deployment.", "If the error comes from the database, use the database runbook.", "If it is DNS or certificates, check recent record changes and certificate status (`/dns`, `/ssl`).", "If it will take more than 15 minutes, turn on maintenance mode (`/maintenance on`).", "When restored, verify home, sign-in, a workspace, creating a record and a test email.", "Post the resolution message and book the review."] },
  database: { title: "Database problem", steps: ["Check the database provider's status and dashboard (connections, storage, compute).", "Too many connections: restart the serving instances and look for a runaway query.", "Data looks wrong or missing: stop writes (maintenance mode). Do not fix rows by hand.", "Restore to a separate branch and compare before any restore.", "Record exactly what window of data a restore would lose.", "Do not run schema changes during an incident unless they are the fix."] },
  "email-delivery": { title: "Email is not arriving", steps: ["Run `/mailauth`. SPF, DKIM and DMARC must all be in place.", "Check the email provider's status and the email log.", "Gmail rejects mail that fails SPF or DKIM (error 4.7.26).", "Confirm the right sender is in the SPF record and the DKIM key is published.", "If throttled, stop bulk sending and send only essential mail.", "Tell customers they can sign in directly instead of waiting for an email."] },
  breach: { title: "Suspected security breach or data exposure", steps: ["Contain: revoke sessions, rotate exposed keys, disable the feature, suspend the source.", "Preserve evidence: export logs and audit entries. Do not delete anything. Note times in UTC.", "Assess: what data, whose, how many, how long, is it still happening, how did they get in.", "Fix the way in before declaring it over.", "Contact a lawyer promptly about who must be told and by when. Some deadlines are 72 hours.", "Tell affected customers factually: what happened, what data, what we did, what they should do."] },
  "leaked-key": { title: "A key or secret leaked", steps: ["Rotate first, investigate second.", "Issue a new key at the provider, update it in the hosting settings, redeploy, then revoke the old key.", "Cover the database URL, session secret, master key, email and AI keys, OAuth secrets, the staff bot key and monitoring tokens.", "Check the provider's logs for use of the old key by someone else.", "If the master encryption key may be involved, treat it as a breach."] },
  takeover: { title: "Account takeover or suspicious sign-ins", steps: ["Revoke sessions, force a password reset, and ask for two-factor or a passkey.", "Check the audit log for what the intruder did, and reverse it with the customer's agreement.", "If many accounts are hit, tighten rate limits and consider requiring two-factor.", "Never reset two-factor without verifying the person through a second channel."] },
  "vendor-outage": { title: "An outside provider is down", steps: ["Confirm on the provider's status page and note any ticket.", "Check the Dependencies page on the status site.", "Switch on any fallback. Otherwise tell customers which feature is affected and that the cause is outside our control.", "Afterwards, reprocess anything that failed (emails, AI jobs)."] },
  abuse: { title: "Abuse or a malicious workspace", steps: ["Suspend the workspace or ban the account with the moderation tools and log the reason.", "Preserve evidence.", "Report threats to safety or illegal content to the right authority. Get advice before sharing customer data.", "Offer the appeals route."] },
};

const runbook: Command = {
  json: new SlashCommandBuilder()
    .setName("runbook")
    .setDescription("Step-by-step incident checklists")
    .addStringOption((o) => o.setName("topic").setDescription("Which runbook").setRequired(true).addChoices(...Object.entries(RUNBOOKS).map(([k, v]) => ({ name: v.title.slice(0, 100), value: k }))))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const r = RUNBOOKS[i.options.getString("topic", true)];
    if (!r) { await i.reply({ content: "Unknown runbook.", ephemeral: true }); return; }
    await i.reply({ ephemeral: true, embeds: [new EmbedBuilder().setTitle(r.title).setColor(BLUE).setDescription(r.steps.map((s, n) => `**${n + 1}.** ${s}`).join("\n")).setFooter({ text: "From the OnboardOps Incident Response Handbook" })] });
  },
};

/* ---------------- /incident ---------------- */

const SEVERITIES: Record<string, { label: string; color: number; reply: string }> = {
  "1": { label: "SEV 1 Critical", color: RED, reply: "Customer update within 30 minutes, then every 30 to 60." },
  "2": { label: "SEV 2 Major", color: ORANGE, reply: "Customer update within 1 hour, then every 2 hours." },
  "3": { label: "SEV 3 Minor", color: BLUE, reply: "Reply to affected customers the same day." },
  "4": { label: "SEV 4 Low", color: 0x6b7280, reply: "No customer update needed." },
};

const utc = (d = new Date()) => d.toISOString().slice(11, 16) + " UTC";
const isIncidentThread = (i: ChatInputCommandInteraction): i is ChatInputCommandInteraction & { channel: ThreadChannel } => !!i.channel?.isThread() && i.channel.name.replace(/^\[Resolved\]\s*/, "").startsWith("INC-");

function duration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} hours`;
}

const incident: Command = {
  json: new SlashCommandBuilder()
    .setName("incident")
    .setDescription("Run an incident in its own thread")
    .addSubcommand((s) => s.setName("start").setDescription("Open an incident thread with the checklist").addStringOption((o) => o.setName("title").setDescription("Short name, for example Sign-in is failing").setRequired(true).setMaxLength(60)).addStringOption((o) => o.setName("severity").setDescription("How bad is it").setRequired(true).addChoices(...Object.entries(SEVERITIES).map(([k, v]) => ({ name: v.label, value: k })))).addStringOption((o) => o.setName("summary").setDescription("What you know so far (as long as you need)").setMaxLength(3500)))
    .addSubcommand((s) => s.setName("note").setDescription("Add a timestamped entry to this incident's log").addStringOption((o) => o.setName("text").setDescription("What happened or what was done").setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName("resolve").setDescription("Close this incident and post the summary").addStringOption((o) => o.setName("summary").setDescription("What fixed it and what happened (as long as you need)").setMaxLength(3500)))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const sub = i.options.getSubcommand();
    if (sub === "start") {
      const ch = i.channel;
      if (!ch || ch.type !== ChannelType.GuildText) { await i.reply({ content: "Run this in a normal text channel, for example #status-incidents.", ephemeral: true }); return; }
      const sev = SEVERITIES[i.options.getString("severity", true)];
      const title = i.options.getString("title", true).trim();
      const sevNum = i.options.getString("severity", true);
      const number = `INC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
      await i.deferReply({ ephemeral: true });
      const thread = await (ch as TextChannel).threads.create({ name: clip(`${number} SEV${sevNum} ${title}`, 100), autoArchiveDuration: 10080, reason: `Incident started by ${i.user.tag}` }).catch(() => null);
      if (!thread) { await i.editReply("I could not create a thread here. I need permission to create threads in this channel."); return; }
      const oncall = sevNum <= "2" ? i.guild!.roles.cache.find((r) => r.name === ONCALL_ROLE) : undefined;
      const summary = i.options.getString("summary");
      await thread.send({
        content: oncall ? `<@&${oncall.id}> a ${sev.label} incident has started.` : undefined,
        allowedMentions: { roles: oncall ? [oncall.id] : [], users: [] },
        embeds: [
          new EmbedBuilder().setColor(sev.color).setTitle(`${number}: ${title}`).setDescription(summary ?? "No summary yet. Add what you know with `/incident note`.").addFields(
            { name: "Severity", value: sev.label, inline: true },
            { name: "Lead", value: `<@${i.user.id}>`, inline: true },
            { name: "Started", value: `<t:${Math.floor(Date.now() / 1000)}:T> (${utc()})`, inline: true },
            { name: "Customer updates", value: sev.reply },
          ),
          new EmbedBuilder().setColor(BLUE).setTitle("First 15 minutes").setDescription(RUNBOOKS.first15.steps.map((s, n) => `**${n + 1}.** ${s}`).join("\n")).setFooter({ text: "Log everything with /incident note. Use /runbook for the specific playbook." }),
        ],
      });
      await i.editReply(`Incident thread created: <#${thread.id}>`);
      return;
    }
    if (!isIncidentThread(i)) { await i.reply({ content: "Use this inside an incident thread (its name starts with INC-).", ephemeral: true }); return; }
    const thread = i.channel;
    if (sub === "note") {
      const text = i.options.getString("text", true);
      await thread.send({ content: `**${utc()}** · ${text}\n-# logged by <@${i.user.id}>`, allowedMentions: { parse: [] } });
      await i.reply({ content: "Added to the log.", ephemeral: true });
      return;
    }
    if (sub === "resolve") {
      if (thread.name.startsWith("[Resolved]")) { await i.reply({ content: "This incident is already resolved.", ephemeral: true }); return; }
      if (!(await confirm(i, "Mark this incident as resolved? Make sure service is verified and customers have been told."))) return;
      const summary = i.options.getString("summary");
      const took = duration(Date.now() - (thread.createdTimestamp ?? Date.now()));
      await thread.send({
        allowedMentions: { parse: [] },
        embeds: [new EmbedBuilder().setColor(GREEN).setTitle("Incident resolved").setDescription(summary ?? "No summary given.").addFields({ name: "Duration", value: took, inline: true }, { name: "Resolved by", value: `<@${i.user.id}>`, inline: true }, { name: "Next", value: "Send the resolution message, then hold the blameless review within 3 working days (SEV 1 and 2)." })],
      });
      await thread.setName(clip(`[Resolved] ${thread.name}`, 100)).catch(() => undefined);
      return;
    }
  },
};

/* ---------------- /botinfo ---------------- */

const botinfo: Command = {
  json: new SlashCommandBuilder().setName("botinfo").setDescription("How the bot is doing").setDMPermission(false).toJSON(),
  access: "staff",
  async run(i) {
    const c = i.client;
    const up = Math.floor(process.uptime());
    const mem = Math.round(process.memoryUsage().rss / 1048576);
    await i.reply({
      ephemeral: true,
      embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Bot status").addFields(
        { name: "Uptime", value: `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`, inline: true },
        { name: "Discord latency", value: `${Math.round(c.ws.ping)} ms`, inline: true },
        { name: "Memory", value: `${mem} MB`, inline: true },
        { name: "Commands", value: String(c.application?.commands.cache.size ?? "?"), inline: true },
        { name: "Heartbeat to status page", value: process.env.KENER_HEARTBEAT_URL ? "On" : "Off (KENER_HEARTBEAT_URL not set)", inline: true },
        { name: "Node", value: process.version, inline: true },
      )],
    });
  },
};

/* ---------------- /time ---------------- */

const ZONES: [string, string][] = [["UTC", "UTC"], ["New York", "America/New_York"], ["Chicago", "America/Chicago"], ["Denver", "America/Denver"], ["Los Angeles", "America/Los_Angeles"], ["London", "Europe/London"]];
const time: Command = {
  json: new SlashCommandBuilder().setName("time").setDescription("The time now in the zones the team uses").setDMPermission(false).toJSON(),
  access: "any",
  async run(i) {
    const now = new Date();
    const fmt = (z: string) => new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
    await i.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Time now").addFields(...ZONES.map(([n, z]) => ({ name: n, value: fmt(z), inline: true })))] });
  },
};

export const toolsCommands: Command[] = [health, mailauthCmd, dnsCmd, sslCmd, changelog, runbook, incident, botinfo, time];
