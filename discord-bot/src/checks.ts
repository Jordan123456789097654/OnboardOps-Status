import dns from "node:dns/promises";
import tls from "node:tls";

/**
 * Read-only checks the bot can run on its own, with no website login and no secrets:
 * the public health endpoints, DNS records, and TLS certificates. Used by commands and by the daily check in the scheduler.
 */

const API_HOST = "https://api.onboardops.org";

export type Health = { name: string; label: string; status: "up" | "degraded" | "down" | "maintenance" | "unreachable"; ms: number; message: string };

export const SERVICES: { name: string; label: string }[] = [
  { name: "frontend", label: "Website" },
  { name: "auth", label: "Sign-in" },
  { name: "api", label: "Core API" },
  { name: "database", label: "Database" },
  { name: "storage", label: "File storage" },
  { name: "email", label: "Email" },
  { name: "domains", label: "Domains" },
  { name: "ai", label: "AI features" },
  { name: "oauth", label: "Social sign-in" },
  { name: "discord", label: "Discord notices" },
  { name: "mailauth", label: "Email authentication" },
];

async function one(s: { name: string; label: string }): Promise<Health> {
  const t = Date.now();
  try {
    const r = await fetch(`${API_HOST}/status/${s.name}`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "OnboardOps-staff-bot" } });
    if (r.status === 404) return { ...s, status: "unreachable", ms: Date.now() - t, message: "Not available yet (the check has not been deployed)" };
    const j = (await r.json().catch(() => ({}))) as { status?: string; message?: string; latencyMs?: number };
    const status = r.status >= 500 && j.status !== "down" && j.status !== "degraded" ? "down" : ((j.status as Health["status"]) ?? (r.ok ? "up" : "down"));
    return { ...s, status, ms: Date.now() - t, message: j.message ?? `HTTP ${r.status}` };
  } catch {
    return { ...s, status: "unreachable", ms: Date.now() - t, message: "No answer within 8 seconds" };
  }
}

/** All service checks at once. */
export const fetchHealth = (): Promise<Health[]> => Promise.all(SERVICES.map(one));

/* ---------------- Email authentication ---------------- */

export type MailAuth = { host: string; spf: string | null; dkim: string[]; dmarc: string | null; mx: string[]; problems: string[] };

const txt = async (name: string): Promise<string[]> => (await dns.resolveTxt(name).catch(() => [] as string[][])).map((a) => a.join(""));

export async function mailAuth(host = "onboardops.org"): Promise<MailAuth> {
  const [root, dmarcRecs, mxRecs] = await Promise.all([txt(host), txt(`_dmarc.${host}`), dns.resolveMx(host).catch(() => [])]);
  const spf = root.find((r) => r.toLowerCase().startsWith("v=spf1")) ?? null;
  const selectors = ["zmail", "zoho", "resend", "default", "google", "selector1", "selector2", "s1", "s2", "k1"];
  const dkim = (await Promise.all(selectors.map(async (s) => ((await txt(`${s}._domainkey.${host}`)).length ? s : null)))).filter((x): x is string => !!x);
  const dmarc = dmarcRecs.find((r) => r.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const mx = mxRecs.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  const problems: string[] = [];
  if (!spf) problems.push("No SPF record. Gmail and others may reject or spam your mail.");
  else if (!/zoho/i.test(spf)) problems.push("The SPF record does not include Zoho, so mail sent through Zoho fails SPF.");
  if (!dkim.length) problems.push("No DKIM key found, so mail cannot be signed.");
  else if (!dkim.some((s) => s === "zmail" || s === "zoho")) problems.push("There is a DKIM key, but none for Zoho (looked for zmail and zoho).");
  if (!dmarc) problems.push("No DMARC record.");
  else if (/p=none/i.test(dmarc)) problems.push("DMARC is set to p=none (monitoring only). Fine at first; tighten later.");
  if (!mx.length) problems.push("No MX records, so you cannot receive mail.");
  return { host, spf, dkim, dmarc, mx, problems };
}

/** Problems that matter (not just the p=none note). */
export const seriousProblems = (m: MailAuth): string[] => m.problems.filter((p) => !p.startsWith("DMARC is set to p=none"));

/* ---------------- DNS ---------------- */

export const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/i;
export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export async function lookup(host: string, type: RecordType): Promise<string[]> {
  switch (type) {
    case "A": return dns.resolve4(host);
    case "AAAA": return dns.resolve6(host);
    case "CNAME": return dns.resolveCname(host);
    case "NS": return dns.resolveNs(host);
    case "MX": return (await dns.resolveMx(host)).sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`);
    case "TXT": return (await dns.resolveTxt(host)).map((a) => a.join(""));
  }
}

/* ---------------- TLS certificates ---------------- */

export type Cert = { host: string; ok: boolean; issuer?: string; validTo?: Date; daysLeft?: number; error?: string };

export const CERT_HOSTS = ["onboardops.org", "www.onboardops.org", "api.onboardops.org", "status2.onboardops.org"];

export function certInfo(host: string): Promise<Cert> {
  return new Promise((resolve) => {
    const done = (c: Cert) => { try { sock.destroy(); } catch { /* ignore */ } resolve(c); };
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
      const c = sock.getPeerCertificate();
      if (!c || !c.valid_to) return done({ host, ok: false, error: "No certificate presented" });
      const validTo = new Date(c.valid_to);
      const issuer = typeof c.issuer === "object" ? (c.issuer.O ?? c.issuer.CN ?? "unknown") : "unknown";
      done({ host, ok: sock.authorized, issuer: String(issuer), validTo, daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000), error: sock.authorized ? undefined : String(sock.authorizationError) });
    });
    sock.on("error", (e) => done({ host, ok: false, error: e.message }));
    sock.on("timeout", () => done({ host, ok: false, error: "Timed out" }));
  });
}
