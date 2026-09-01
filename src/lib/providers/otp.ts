import "server-only";
import { env } from "../env";

/**
 * SMS delivery behind one interface.
 *
 * There is no SMS gateway wired up: `console` prints the code to the server log
 * so the whole product is testable, and `disabled` refuses login with a clear
 * Arabic message instead of silently swallowing the request. Adding a real
 * provider means implementing `OtpDeliveryProvider` and one line in `otp()`.
 */
export interface OtpDeliveryProvider {
  readonly name: string;
  /** Returns false when the code could not be delivered. Never throws. */
  send(phone: string, code: string): Promise<boolean>;
  /** True when the UI may tell the user to check the server log. */
  readonly isDevelopmentDriver: boolean;
}

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

let cached: OtpDeliveryProvider | undefined;

export function otp(): OtpDeliveryProvider {
  if (cached) return cached;
  cached = env.otpProvider === "console" ? new ConsoleOtpProvider() : new DisabledOtpProvider();
  return cached;
}
