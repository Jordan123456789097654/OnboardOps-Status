import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, type Client, type Guild, type TextChannel, type ThreadChannel } from "discord.js";
import { api } from "./api";

/**
 * Every new support ticket gets its own thread in #support-tickets. Inside it:
 *  - Claim, Mark solved and Reply buttons work on that ticket.
 *  - `/say` (or the Reply button) sends a message to the customer. It is saved on the ticket in the admin panel and emailed.
 * The thread shows the reference, topic, priority and a link. It never shows the customer's message or email, which stay on the website.
 */

type Open = { id: string; ref: string; status: string; priority: string; assignee: string | null; topic: string; source: string; createdAt: string; url: string; security?: boolean };
type Linked = { id: string; ref: string; status: string; threadId: string; assignee: string | null };

/** The support role is pinged on every new ticket. Override with SUPPORT_ROLE_ID if the role ever changes. */
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID?.trim() || "1575312616409137423";
const PARENT = "support-tickets";
const URGENT = "support-urgent";
const MAX_PER_RUN = 10;

const ticketEmbed = (t: Open) =>
  new EmbedBuilder()
    .setTitle(`Ticket ${t.ref}`)
    .setURL(t.url)
    .setColor(t.security ? 0xdc2626 : t.priority === "URGENT" || t.priority === "HIGH" ? 0xea580c : 0x2563eb)
    .setDescription(`**${t.topic}**`)
    .addFields(
      { name: "Priority", value: t.priority, inline: true },
      { name: "Source", value: t.source, inline: true },
      { name: "Status", value: t.status, inline: true },
      { name: "Assigned to", value: t.assignee ?? "nobody", inline: true },
      { name: "Opened", value: `<t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`, inline: true },
      { name: "Read the message", value: `[Open in the admin panel](${t.url})` },
    )
    .setFooter({ text: "Reply here with /say. The customer gets it by email and it's saved on the ticket." });

const controls = (t: { id: string; threadId?: string }) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${t.id}`).setLabel("Claim").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:reply:${t.threadId ?? "x"}`).setLabel("Reply to customer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:solve:${t.id}`).setLabel("Mark solved").setStyle(ButtonStyle.Success),
  );

const find = (g: Guild, name: string) => g.channels.cache.find((c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name);

/** Opens threads for tickets that do not have one yet. Runs every minute. */
export async function openTicketThreads(client: Client, guildId: string): Promise<void> {
  const g = client.guilds.cache.get(guildId);
  if (!g) return;
  const parent = find(g, PARENT);
  if (!parent) return;
  const r = await api<{ tickets: Open[] }>("ops/tickets/unthreaded", "");
  if (r.status !== 200 || !r.data) {
    console.error(`Ticket threads: the website answered ${r.status} for ops/tickets/unthreaded. Check STAFF_BOT_KEY matches Vercel.`);
    return;
  }
  if (r.data.tickets.length) console.log(`Ticket threads: opening ${r.data.tickets.length} thread(s).`);
  for (const t of r.data.tickets.slice(0, MAX_PER_RUN)) {
    const isSecurity = !!t.security;
    const channel = isSecurity ? find(g, URGENT) ?? parent : parent;
    const thread = await channel.threads
      .create({ name: `${t.ref} ${t.topic}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Support ticket" })
      .catch(() => null);
    if (!thread) continue;
    await thread.send({
      content: `<@&${SUPPORT_ROLE_ID}>${isSecurity ? " **Security report.** Treat as urgent." : " New ticket."}`,
      allowedMentions: { roles: [SUPPORT_ROLE_ID], users: [] },
      embeds: [ticketEmbed(t)],
      components: [controls({ id: t.id, threadId: thread.id })],
    });
    void refreshSummary(thread, t.id);
    const saved = await api<{ ok: boolean }>("ops/tickets/thread", "", { method: "POST", body: { id: t.id, threadId: thread.id } });
    if (saved.status !== 200) {
      // Could not link it, so do not leave an orphan thread behind.
      await thread.setArchived(true).catch(() => undefined);
      console.error(`Could not link ticket ${t.ref} to its thread (${saved.status}).`);
    }
  }
}

/** Shown after a button or command in a ticket thread, so everyone sees the latest state. */
export async function stampThread(thread: ThreadChannel, text: string): Promise<void> {
  await thread.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function markThreadSolved(thread: ThreadChannel, by: string): Promise<void> {
  await thread.setName(`[Solved] ${thread.name}`.slice(0, 100)).catch(() => undefined);
  await stampThread(thread, `Marked solved by <@${by}>.`);
  await thread.setArchived(true).catch(() => undefined);
}

/** Send a reply to the customer from a ticket thread. */
export async function sendFromThread(
  thread: ThreadChannel,
  userId: string,
  body: string,
  markSolved = false,
): Promise<{ ok: boolean; message: string }> {
  const r = await api<{ ref: string; emailed: boolean; error?: string }>("support/reply", userId, { method: "POST", body: { threadId: thread.id, body, markSolved } });
  if (r.status !== 200 || !r.data) {
    const e = r.data?.error ?? null;
    return { ok: false, message: e ?? "The reply could not be sent. Check that you are linked with `/link`." };
  }
  await stampThread(thread, `<@${userId}> replied to the customer${r.data.emailed ? " (emailed)" : " (saved, but the email could not be sent)"}.`);
  if (markSolved) await markThreadSolved(thread, userId);
  return { ok: true, message: r.data.emailed ? "Sent. The customer was emailed and it's saved on the ticket." : "Saved on the ticket, but the email could not be sent. Check it in the admin panel." };
}


/* ---------------- Chat relay: customer and staff messages appear in the ticket thread ---------------- */

type FeedMessage = { ticketId: string; threadId: string; kind: "VISITOR" | "REPLY"; author: string; body: string; at: string };
let feedSince = new Date().toISOString();

/** Posts new customer and staff messages from linked tickets into their threads. Runs every 15 seconds. */
export async function relayTicketChats(client: Client): Promise<void> {
  const r = await api<{ messages: FeedMessage[] }>(`ops/tickets/feed?since=${encodeURIComponent(feedSince)}`, "");
  if (r.status !== 200 || !r.data) {
    console.error(`Chat relay: the website answered ${r.status} for ops/tickets/feed.`);
    return;
  }
  for (const m of r.data.messages) {
    feedSince = m.at > feedSince ? m.at : feedSince;
    const thread = (await client.channels.fetch(m.threadId).catch(() => null)) as ThreadChannel | null;
    if (!thread?.isThread()) continue;
    const who = m.kind === "VISITOR" ? `Customer (${m.author})` : `Staff (${m.author})`;
    const body = m.body.length > 1800 ? `${m.body.slice(0, 1799)}…` : m.body;
    await thread.send({ content: `**${who}:** ${body}`, allowedMentions: { parse: [] } }).catch(() => undefined);
    if (m.kind === "VISITOR") await reviewCustomerMessage(thread, m.ticketId, m.body);
  }
}

/* ---------------- Maya: sentiment flag, draft replies, summaries ---------------- */

const MAYA_SUMMARY_TITLE = "Maya's summary";
const DRAFT_TITLE = "Maya's suggested reply";

/** Flags upset or crisis messages for the team right away. For a crisis, no draft is offered: a person should write it. */
async function reviewCustomerMessage(thread: ThreadChannel, ticketId: string, text: string): Promise<void> {
  const s = await api<{ angry: boolean; crisis: boolean; why: string }>("ops/tickets/sentiment", "", { method: "POST", body: { text } });
  const flagged = s.status === 200 && s.data && (s.data.angry || s.data.crisis);
  if (flagged && s.data) {
    const crisis = s.data.crisis;
    const embed = new EmbedBuilder()
      .setColor(crisis ? 0xdc2626 : 0xea580c)
      .setTitle(crisis ? "Possible crisis: read this now" : "Customer sounds upset")
      .setDescription(s.data.why || "Maya flagged this message for a person.");
    await thread.send({ content: `<@&${SUPPORT_ROLE_ID}>`, embeds: [embed], allowedMentions: { roles: [SUPPORT_ROLE_ID] } }).catch(() => undefined);
  }
  if (flagged && s.data?.crisis) return;

  const d = await api<{ draft: string }>("ops/tickets/draft", "", { method: "POST", body: { id: ticketId } });
  if (d.status !== 200 || !d.data?.draft) return;
  const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle(DRAFT_TITLE).setDescription(d.data.draft).setFooter({ text: "Maya wrote this for a person to check. Nothing is sent until someone presses Send." });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:senddraft:${ticketId}`).setLabel("Send to customer").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket:discard:${ticketId}`).setLabel("Discard").setStyle(ButtonStyle.Secondary),
  );
  await thread.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => undefined);
}

/** Keeps one pinned summary at the top of the thread. Called when the thread opens and when the ticket is claimed. */
export async function refreshSummary(thread: ThreadChannel, ticketId: string): Promise<void> {
  const r = await api<{ summary: string; status: string; assignee: string | null; ref: string }>("ops/tickets/summary", "", { method: "POST", body: { id: ticketId } });
  if (r.status !== 200 || !r.data) return;
  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle(MAYA_SUMMARY_TITLE)
    .setDescription(r.data.summary)
    .addFields(
      { name: "Status", value: r.data.status, inline: true },
      { name: "Assigned to", value: r.data.assignee ?? "nobody", inline: true },
    )
    .setFooter({ text: "Updated when the ticket changes hands." })
    .setTimestamp(new Date());
  const pinned = await thread.messages.fetchPins({ limit: 50 }).catch(() => null);
  const mine = pinned?.items.map((p) => p.message).find((m) => m.author.id === thread.client.user?.id && m.embeds[0]?.title === MAYA_SUMMARY_TITLE);
  if (mine) {
    await mine.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
    return;
  }
  const m = await thread.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  if (m) await m.pin().catch(() => undefined);
}
