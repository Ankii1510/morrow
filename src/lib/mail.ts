import { config, mailEnabled } from "./config";
import { AppError } from "./http";

/**
 * Outbound email for password reset and address verification.
 *
 * Transports (MORROW_MAIL_TRANSPORT):
 *   none    default. Reset and verification are switched off and the UI says so.
 *   log     development only: prints the message, including its one-time link, to the server log.
 *   resend  HTTPS call to the Resend API (needs RESEND_API_KEY and a verified MORROW_MAIL_FROM).
 *   memory  tests only (refused unless NODE_ENV=test): keeps messages in an in-process outbox.
 *
 * Links are always built from MORROW_PUBLIC_URL, never from the request, so a forged Host header
 * cannot make Morrow email a link that points at an attacker's site.
 */
export type Mail = { to: string; subject: string; text: string };

type G = typeof globalThis & { __morrowOutbox?: Mail[] };
export function testOutbox(): Mail[] {
  return ((globalThis as G).__morrowOutbox ??= []);
}

export async function sendMail(mail: Mail): Promise<void> {
  const transport = config.mail.transport;
  if (transport === "none") throw new AppError(503, "mail_not_configured", "This Morrow server cannot send email.");
  if (transport === "memory") {
    testOutbox().push(mail);
    return;
  }
  if (transport === "log") {
    console.log(`[morrow mail:log] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }
  const key = config.mail.resendApiKey;
  if (!key || !config.mail.from) throw new AppError(503, "mail_not_configured", "Email delivery is selected but RESEND_API_KEY or MORROW_MAIL_FROM is missing.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new AppError(502, "mail_failed", `The email provider returned HTTP ${res.status}.`);
  }
}

/** Send without making the caller wait or learn the outcome: response time must not reveal whether an account exists. */
export function sendMailQuietly(mail: Mail): void {
  if (!mailEnabled()) return;
  sendMail(mail).catch((e) => console.error("[morrow] email delivery failed:", (e as Error)?.message));
}

export function link(pathname: string, token: string): string {
  return `${config.mail.publicUrl}${pathname}?token=${encodeURIComponent(token)}`;
}
