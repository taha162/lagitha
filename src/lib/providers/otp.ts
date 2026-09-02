import "server-only";
import { env } from "../env";

/**
 * SMS delivery behind one interface.
 *
 * Four drivers:
 *   twilio   — works internationally, including Iraqi mobile numbers
 *   http     — any gateway with a plain HTTP API (most local Iraqi aggregators)
 *   console  — prints the code to the server log; development only
 *   disabled — refuses login with a clear Arabic message
 *
 * A driver never throws: it returns false and the caller shows the user a
 * human message. A network failure at the SMS vendor must not take down login
 * with a stack trace.
 */
export interface OtpDeliveryProvider {
  readonly name: string;
  /** Returns false when the code could not be delivered. Never throws. */
  send(phone: string, code: string): Promise<boolean>;
  /** True when the UI may tell the user to check the server log. */
  readonly isDevelopmentDriver: boolean;
}

/** The message body. Kept short — long messages are billed as several parts. */
function messageBody(code: string): string {
  return `رمز التحقق في لَگيتها: ${code}\nلا تشاركه مع أحد.`;
}

/** Every driver gets the same ceiling; a slow gateway must not hang the request. */
const SEND_TIMEOUT_MS = 10_000;

class ConsoleOtpProvider implements OtpDeliveryProvider {
  readonly name = "console";
  readonly isDevelopmentDriver = true;

  async send(phone: string, code: string): Promise<boolean> {
    // eslint-disable-next-line no-console -- this driver's entire purpose
    console.info(`\n  [LAGAITHA] رمز التحقق لـ ${phone}: ${code}\n`);
    return true;
  }
}

class DisabledOtpProvider implements OtpDeliveryProvider {
  readonly name = "disabled";
  readonly isDevelopmentDriver = false;

  async send(): Promise<boolean> {
    return false;
  }
}

/**
 * Twilio, called over its REST API with fetch rather than the SDK — this is one
 * form-encoded POST, and the SDK is several megabytes of serverless cold start.
 *
 * Set either TWILIO_MESSAGING_SERVICE_SID (preferred: Twilio picks the sender)
 * or TWILIO_FROM (a number you own).
 */
class TwilioOtpProvider implements OtpDeliveryProvider {
  readonly name = "twilio";
  readonly isDevelopmentDriver = false;

  constructor(
    private readonly config: {
      accountSid: string;
      authToken: string;
      from?: string;
      messagingServiceSid?: string;
    },
  ) {}

  async send(phone: string, code: string): Promise<boolean> {
    const body = new URLSearchParams({ To: phone, Body: messageBody(code) });
    if (this.config.messagingServiceSid) {
      body.set("MessagingServiceSid", this.config.messagingServiceSid);
    } else if (this.config.from) {
      body.set("From", this.config.from);
    }

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: "POST",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(
              `${this.config.accountSid}:${this.config.authToken}`,
            ).toString("base64")}`,
          },
          body,
        },
      );

      if (response.ok) return true;

      // Twilio's error body explains what is wrong (unverified number, no
      // Iraq permissions, bad sender). Log it — never show it to the user.
      const detail = await response.text().catch(() => "");
      console.error(
        `[LAGAITHA] Twilio refused the message (${response.status}): ${detail.slice(0, 400)}`,
      );
      return false;
    } catch (error) {
      console.error("[LAGAITHA] Twilio request failed", error);
      return false;
    }
  }
}

/**
 * Generic HTTP gateway — for the local Iraqi aggregators that resell Zain /
 * Asiacell / Korek traffic. Almost all of them expose a single endpoint taking
 * a destination and a message.
 *
 * Configured entirely from environment variables so a new vendor needs no code:
 *
 *   SMS_HTTP_URL      https://gateway.example.iq/api/send
 *   SMS_HTTP_METHOD   POST (default) | GET
 *   SMS_HTTP_BODY     {"to":"{phone}","text":"{message}","sender":"LAGAITHA"}
 *   SMS_HTTP_HEADERS  {"Authorization":"Bearer xxx"}
 *
 * `{phone}`, `{message}` and `{code}` are substituted. For a GET gateway, put
 * the placeholders in the query string of SMS_HTTP_URL instead.
 */
class HttpOtpProvider implements OtpDeliveryProvider {
  readonly name = "http";
  readonly isDevelopmentDriver = false;

  constructor(
    private readonly config: {
      url: string;
      method: string;
      bodyTemplate?: string;
      headers: Record<string, string>;
    },
  ) {}

  async send(phone: string, code: string): Promise<boolean> {
    const fill = (template: string, encode: boolean) =>
      template
        .replaceAll("{phone}", encode ? encodeURIComponent(phone) : phone)
        .replaceAll("{code}", code)
        .replaceAll(
          "{message}",
          encode ? encodeURIComponent(messageBody(code)) : jsonSafe(messageBody(code)),
        );

    const isGet = this.config.method.toUpperCase() === "GET";
    const url = fill(this.config.url, isGet);

    try {
      const response = await fetch(url, {
        method: this.config.method,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        headers: isGet
          ? this.config.headers
          : { "Content-Type": "application/json", ...this.config.headers },
        body:
          isGet || !this.config.bodyTemplate
            ? undefined
            : fill(this.config.bodyTemplate, false),
      });

      if (response.ok) return true;

      const detail = await response.text().catch(() => "");
      console.error(
        `[LAGAITHA] SMS gateway refused the message (${response.status}): ${detail.slice(0, 400)}`,
      );
      return false;
    } catch (error) {
      console.error("[LAGAITHA] SMS gateway request failed", error);
      return false;
    }
  }
}

/** Escapes a value being interpolated into a JSON body template. */
function jsonSafe(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

let cached: OtpDeliveryProvider | undefined;

export function otp(): OtpDeliveryProvider {
  if (cached) return cached;

  switch (env.otpProvider) {
    case "twilio": {
      const { accountSid, authToken, from, messagingServiceSid } = env.twilio;
      if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
        console.error(
          "[LAGAITHA] OTP_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN " +
            "and one of TWILIO_MESSAGING_SERVICE_SID / TWILIO_FROM. Falling back to disabled.",
        );
        cached = new DisabledOtpProvider();
        break;
      }
      cached = new TwilioOtpProvider({ accountSid, authToken, from, messagingServiceSid });
      break;
    }

    case "http": {
      const { url, method, bodyTemplate, headers } = env.smsHttp;
      if (!url) {
        console.error(
          "[LAGAITHA] OTP_PROVIDER=http needs SMS_HTTP_URL. Falling back to disabled.",
        );
        cached = new DisabledOtpProvider();
        break;
      }
      cached = new HttpOtpProvider({ url, method, bodyTemplate, headers });
      break;
    }

    case "console":
      cached = new ConsoleOtpProvider();
      break;

    default:
      cached = new DisabledOtpProvider();
  }

  return cached;
}
