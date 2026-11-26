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
  if (r.status !== 200 || !r.data) return;
  for (const t of r.data.tickets.slice(0, MAX_PER_RUN)) {
    const isSecurity = !!t.security;
    const channel = isSecurity ? find(g, URGENT) ?? parent : parent;
    const thread = await channel.threads
      .create({ name: `${t.ref} ${t.topic}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Support ticket" })
      .catch(() => null);
    if (!thread) continue;
    await thread.send({
      content: isSecurity ? "**Security report.** Treat as urgent." : undefined,
      embeds: [ticketEmbed(t)],
      components: [controls({ id: t.id, threadId: thread.id })],
      allowedMentions: { parse: [] },
    });
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

