import "server-only";
import type { OtpDeliveryProvider } from "./otp";

/**
 * Email delivery of the login code.
 *
 * Two drivers, because the right one depends on whether the operator owns a
 * domain yet:
 *
 *   resend — HTTP API, best deliverability, but requires a verified domain
 *   smtp   — works with Gmail, Brevo, or any host; no domain needed
 *
 * The SMTP driver is what makes a genuinely free launch possible: a Gmail
 * account with an app password sends a few hundred a day at no cost.
 */

const SEND_TIMEOUT_MS = 12_000;

/** The mail body. One purpose, no marketing, no links to click. */
export function renderOtpEmail(code: string): { subject: string; text: string; html: string } {
  const subject = `رمز الدخول إلى لَگيتها: ${code}`;

  const text = [
    "لَگيتها — ضاع منك؟ خلي نلگيه.",
    "",
    `رمز الدخول: ${code}`,
    "",
    "الرمز صالح لعشر دقائق.",
    "لا تشارك هذا الرمز مع أحد. إذا ما طلبت الدخول، تجاهل هذه الرسالة.",
  ].join("\n");

  // Inline styles and a table layout: mail clients strip <style> blocks and
  // have no flexbox. `dir="rtl"` on the root is what makes Arabic lay out
  // correctly in Gmail and Outlook.
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;padding:24px;background:#f7f5ef;font-family:'Segoe UI',system-ui,sans-serif;color:#17221f;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:460px;margin:0 auto;background:#fffdf8;border:1px solid #dcddd7;border-radius:12px;">
      <tr>
        <td style="padding:24px;text-align:right;">
          <div style="font-size:20px;font-weight:600;color:#176b63;">لَگيتها</div>
          <div style="font-size:13px;color:#747a76;margin-top:2px;">ضاع منك؟ خلي نلگيه.</div>

          <div style="margin:24px 0 8px;font-size:15px;">رمز الدخول:</div>
          <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:8px;color:#17221f;background:#f1eee5;border-radius:8px;padding:14px;text-align:center;">${code}</div>

          <div style="margin-top:20px;font-size:13px;color:#747a76;line-height:1.7;">
            الرمز صالح لعشر دقائق.<br />
            لا تشارك هذا الرمز مع أحد. إذا ما طلبت الدخول، تجاهل هذه الرسالة.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Resend. One HTTP POST, so no SDK — the same reasoning as the Twilio driver.
 * Needs a domain verified in the Resend dashboard before it will deliver to
 * arbitrary recipients.
 */
export class ResendOtpProvider implements OtpDeliveryProvider {
  readonly name = "resend";
  readonly channel = "email" as const;
  readonly isDevelopmentDriver = false;

  constructor(private readonly config: { apiKey: string; from: string }) {}

  async send(email: string, code: string): Promise<boolean> {
    const { subject, text, html } = renderOtpEmail(code);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ from: this.config.from, to: [email], subject, text, html }),
      });

      if (response.ok) return true;

      // Resend explains the refusal (unverified domain, bad key, suppressed
      // recipient). Log it; never show it to the user.
      const detail = await response.text().catch(() => "");
      console.error(
        `[LAGAITHA] Resend refused the message (${response.status}): ${detail.slice(0, 400)}`,
      );
      return false;
    } catch (error) {
      console.error("[LAGAITHA] Resend request failed", error);
      return false;
    }
  }
}

/**
 * SMTP, via nodemailer. Works with anything that speaks SMTP — Gmail, Brevo,
 * a university mail server — which is what makes it the no-cost path for an
 * operator who does not own a domain yet.
 */
export class SmtpOtpProvider implements OtpDeliveryProvider {
  readonly name = "smtp";
  readonly channel = "email" as const;
  readonly isDevelopmentDriver = false;

  constructor(
    private readonly config: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
    },
  ) {}

  async send(email: string, code: string): Promise<boolean> {
    const { subject, text, html } = renderOtpEmail(code);

    try {
      // Imported lazily so the dependency is only loaded by deployments that
      // actually use SMTP.
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined,
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      });

      await transport.sendMail({ from: this.config.from, to: email, subject, text, html });
      transport.close();
      return true;
    } catch (error) {
      console.error("[LAGAITHA] SMTP send failed", error);
      return false;
    }
  }
}
