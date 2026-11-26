import type { CategorySpec, StaffRole } from "./layout";

/** More channels for the staff server. Each category and channel is created by /setup, and nothing existing is removed unless wipe is chosen. */
const ALL: StaffRole[] = ["Owner", "Admin", "Support", "Moderator", "Developer", "Viewer"];
const SUPPORT: StaffRole[] = ["Owner", "Admin", "Support", "Moderator"];
const DEV: StaffRole[] = ["Owner", "Admin", "Developer"];
const SENIOR: StaffRole[] = ["Owner", "Admin"];
const SALES: StaffRole[] = ["Owner", "Admin", "Support", "Moderator", "Viewer"];

export const EXTRA_CATEGORIES: CategorySpec[] = [
  {
    name: "WELCOME & RESOURCES",
    channels: [
      { name: "resources", topic: "Handbooks, guides and the links you will use every day.", read: ALL, post: [] },
      { name: "bot-commands", topic: "Everything the staff bot can do, with examples.", read: ALL, post: [] },
      { name: "faq", topic: "Questions the team asks most, and the answers.", read: ALL, post: SENIOR },
      { name: "wins", topic: "Good news, shipped work and thank-yous.", read: ALL, post: ALL },
    ],
  },
  {
    name: "SHIFTS & HANDOFF",
    channels: [
      { name: "handoff", topic: "Daily handoff notes between shifts and people. Use /handoff.", read: ALL, post: ALL },
      { name: "shift-log", topic: "Clock in and out with /shift. A record of who was on.", read: ALL, post: ALL },
      { name: "onboarding", topic: "New staff. Each person gets a thread with a checklist (/onboard).", read: ALL, post: SENIOR },
      { name: "time-off", topic: "Leave requests and who is away when.", read: ALL, post: ALL },
    ],
  },
  {
    name: "ENGINEERING",
    channels: [
      { name: "deploy-log", topic: "Every deploy and rollback. Use /deploylog to add a note.", read: DEV, post: DEV },
      { name: "release-notes", topic: "What shipped in each version. Pulled from /changelog.", read: ALL, post: DEV },
      { name: "bugs", topic: "Bugs found by staff or customers, with reproduction steps.", read: DEV, post: DEV },
      { name: "incident-review", topic: "Blameless reviews after SEV 1 and 2 incidents.", read: ALL, post: DEV },
    ],
  },
  {
    name: "SUPPORT EXTRA",
    channels: [
      { name: "support-stats", topic: "Queue numbers and response times. Use /queue.", read: SUPPORT, post: [] },
      { name: "customer-feedback", topic: "Feedback and feature requests from customers, summarised by staff.", read: SUPPORT, post: SUPPORT },
      { name: "macros", topic: "Reply templates for tickets. Add the most used ones here.", read: SUPPORT, post: SUPPORT },
    ],
  },
  {
    name: "SALES & OUTREACH",
    channels: [
      { name: "outreach", topic: "Outreach batches, replies and follow-ups.", read: SALES, post: SALES },
      { name: "leads", topic: "Interested businesses and demos booked.", read: SALES, post: SALES },
    ],
  },
  {
    name: "SOCIAL",
    channels: [
      { name: "general", topic: "General chat for the team.", read: ALL, post: ALL },
      { name: "off-topic", topic: "Anything else.", read: ALL, post: ALL },
      { name: "memes", topic: "Keep it friendly.", read: ALL, post: ALL },
    ],
  },
];

/** Names the layout keeps. Anything else in the server can be removed by /setup wipe. */
export const KEEP_CHANNEL_NAMES = new Set<string>();
