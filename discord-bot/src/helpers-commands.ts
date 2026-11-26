import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type ThreadChannel } from "discord.js";
import { sendFromThread } from "./ticket-threads";
import type { Command } from "./commands";

/** Helpful everyday commands for the team: replies from ticket threads, reminders, polls and quick decisions. */

const BLUE = 0x2563eb;
const isTicketThread = (i: ChatInputCommandInteraction): i is ChatInputCommandInteraction & { channel: ThreadChannel } =>
  !!i.channel?.isThread() && i.channel.parent?.name === "support-tickets";

const say: Command = {
  json: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Reply to the customer from this ticket's thread")
    .addStringOption((o) => o.setName("message").setDescription("What to tell the customer").setRequired(true).setMaxLength(4000))
    .addBooleanOption((o) => o.setName("solve").setDescription("Also mark the ticket solved"))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    if (!isTicketThread(i)) { await i.reply({ content: "Use `/say` inside a ticket's thread in #support-tickets.", ephemeral: true }); return; }
    await i.deferReply({ ephemeral: true });
    const res = await sendFromThread(i.channel, i.user.id, i.options.getString("message", true), i.options.getBoolean("solve") ?? false);
    await i.editReply(res.message);
  },
};

const remind: Command = {
  json: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Get a reminder here in this channel")
    .addIntegerOption((o) => o.setName("minutes").setDescription("In how many minutes (1 to 1440)").setRequired(true).setMinValue(1).setMaxValue(1440))
    .addStringOption((o) => o.setName("text").setDescription("What to remember").setRequired(true).setMaxLength(200))
    .setDMPermission(false)
    .toJSON(),
  access: "staff",
  async run(i) {
    const mins = i.options.getInteger("minutes", true);
    const text = i.options.getString("text", true);
    await i.reply({ content: `Reminder set for ${mins} minute${mins === 1 ? "" : "s"}.`, ephemeral: true });
    // Reminders are kept in memory. If the bot restarts before the time, the reminder is lost.
    setTimeout(() => {
      const ch = i.channel;
      if (ch && "send" in ch) void ch.send({ content: `<@${i.user.id}> reminder: ${text}`, allowedMentions: { users: [i.user.id] } }).catch(() => undefined);
    }, mins * 60_000);
  },
};

const poll: Command = {
  json: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Start a quick yes/no or multiple choice poll")
    .addStringOption((o) => o.setName("question").setDescription("The question").setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName("options").setDescription("Up to 5 options, separated by |. Leave empty for yes/no").setMaxLength(300))
    .setDMPermission(false)
    .toJSON(),
  access: "any",
  async run(i) {
    const q = i.options.getString("question", true);
    const raw = i.options.getString("options");
    const opts = raw ? raw.split("|").map((x) => x.trim()).filter(Boolean).slice(0, 5) : ["Yes", "No"];
    if (opts.length < 2) { await i.reply({ content: "Give at least two options, separated by |.", ephemeral: true }); return; }
    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
    const embed = new EmbedBuilder().setColor(BLUE).setTitle(q).setDescription(opts.map((o, n) => `${emojis[n]} ${o}`).join("\n")).setFooter({ text: `Poll by ${i.user.username}. React to vote.` }).setTimestamp(new Date());
    await i.reply({ embeds: [embed] });
    const msg = await i.fetchReply().catch(() => null);
    if (msg) for (let n = 0; n < opts.length; n++) await msg.react(emojis[n]).catch(() => undefined);
  },
};

const roll: Command = {
  json: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll dice, for example 2d6 or d20")
    .addStringOption((o) => o.setName("dice").setDescription("NdS, for example 2d6 (default 1d6)").setMaxLength(12))
    .setDMPermission(false)
    .toJSON(),
  access: "any",
  async run(i) {
    const m = /^(\d{1,2})?d(\d{1,4})$/i.exec((i.options.getString("dice") ?? "1d6").trim());
    if (!m) { await i.reply({ content: "Use the form NdS, for example `2d6` or `d20`.", ephemeral: true }); return; }
    const n = Math.min(Math.max(Number(m[1] ?? 1), 1), 20), sides = Math.min(Math.max(Number(m[2]), 2), 1000);
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    await i.reply({ content: `🎲 ${n}d${sides}: [${rolls.join(", ")}] = **${total}**` });
  },
};

const pick: Command = {
  json: new SlashCommandBuilder()
    .setName("pick")
    .setDescription("Pick one at random, for example who takes the next ticket")
    .addStringOption((o) => o.setName("options").setDescription("Separated by |").setRequired(true).setMaxLength(400))
    .setDMPermission(false)
    .toJSON(),
  access: "any",
  async run(i) {
    const opts = i.options.getString("options", true).split("|").map((x) => x.trim()).filter(Boolean);
    if (opts.length < 2) { await i.reply({ content: "Give at least two options, separated by |.", ephemeral: true }); return; }
    await i.reply({ content: `Picked: **${opts[Math.floor(Math.random() * opts.length)]}**` });
  },
};

export const helperCommands: Command[] = [say, remind, poll, roll, pick];

