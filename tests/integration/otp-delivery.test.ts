import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SMS delivery drivers, exercised against a real local HTTP server rather than
 * a mocked `fetch` — the thing worth testing is the request that actually goes
 * over the wire, and a stub would only prove the stub was called.
 */
interface Received {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let nextStatus = 200;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      });
      response.writeHead(nextStatus, { "Content-Type": "application/json" });
      response.end(nextStatus === 200 ? '{"ok":true}' : '{"error":"rejected"}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  received = [];
  nextStatus = 200;
  vi.resetModules();
});

/** Rebuilds the provider module with a fresh environment. */
async function loadOtp(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  const { otp } = await import("@/lib/providers/otp");
  return otp();
}

describe("http gateway driver", () => {
  it("POSTs the phone and message using the configured template", async () => {
    const provider = await loadOtp({
      OTP_PROVIDER: "http",
      SMS_HTTP_URL: `${baseUrl}/send`,
      SMS_HTTP_BODY: '{"to":"{phone}","text":"{message}","sender":"LAGAITHA"}',
      SMS_HTTP_HEADERS: '{"Authorization":"Bearer test-key"}',
    });

    expect(provider.name).toBe("http");
    expect(await provider.send("+9647701234567", "123456")).toBe(true);

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer test-key");
    expect(request.headers["content-type"]).toBe("application/json");

    const payload = JSON.parse(request.body) as Record<string, string>;
    expect(payload.to).toBe("+9647701234567");
    expect(payload.sender).toBe("LAGAITHA");
    expect(payload.text).toContain("123456");
    // The body must survive JSON encoding with Arabic text in it.
    expect(payload.text).toContain("لَگيتها");
  });

  it("supports GET-style gateways with placeholders in the query string", async () => {
    const provider = await loadOtp({
      OTP_PROVIDER: "http",
      SMS_HTTP_METHOD: "GET",
      SMS_HTTP_URL: `${baseUrl}/send?to={phone}&msg={message}&key=abc`,
    });

    expect(await provider.send("+9647701234567", "654321")).toBe(true);

    const request = received[0]!;
    expect(request.method).toBe("GET");
    // The phone number must be percent-encoded: a raw '+' means a space.
    expect(request.url).toContain("to=%2B9647701234567");
    expect(decodeURIComponent(request.url)).toContain("654321");
  });

  it("returns false, and does not throw, when the gateway rejects", async () => {
    nextStatus = 401;
    const provider = await loadOtp({
      OTP_PROVIDER: "http",
      SMS_HTTP_URL: `${baseUrl}/send`,
      SMS_HTTP_BODY: '{"to":"{phone}","text":"{message}"}',
    });

    await expect(provider.send("+9647701234567", "111111")).resolves.toBe(false);
  });

  it("returns false, and does not throw, when the gateway is unreachable", async () => {
    const provider = await loadOtp({
      OTP_PROVIDER: "http",
      // Nothing is listening on this port.
      SMS_HTTP_URL: "http://127.0.0.1:1/send",
      SMS_HTTP_BODY: '{"to":"{phone}"}',
    });

    await expect(provider.send("+9647701234567", "111111")).resolves.toBe(false);
  });

  it("falls back to disabled when SMS_HTTP_URL is missing", async () => {
    const provider = await loadOtp({ OTP_PROVIDER: "http", SMS_HTTP_URL: "" });
    expect(provider.name).toBe("disabled");
    expect(await provider.send("+9647701234567", "111111")).toBe(false);
  });
});

describe("twilio driver", () => {
  it("falls back to disabled when credentials are incomplete", async () => {
    const provider = await loadOtp({
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "",
      TWILIO_FROM: "",
      TWILIO_MESSAGING_SERVICE_SID: "",
    });

    // Refusing to start is better than pretending a code was sent.
    expect(provider.name).toBe("disabled");
  });

  it("is selected once credentials and a sender are present", async () => {
    const provider = await loadOtp({
      OTP_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_MESSAGING_SERVICE_SID: "MG123",
    });

    expect(provider.name).toBe("twilio");
    expect(provider.isDevelopmentDriver).toBe(false);
  });
});

describe("driver selection", () => {
  it("defaults to console outside production, so development needs no gateway", async () => {
    const provider = await loadOtp({ OTP_PROVIDER: "" });
    expect(provider.name).toBe("console");
    expect(provider.isDevelopmentDriver).toBe(true);
  });

  it("defaults to disabled in production, rather than logging codes", async () => {
    // The guard that actually protects a deployment: an unset OTP_PROVIDER in
    // production must never resolve to the driver that prints codes to a log.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "");
    vi.stubEnv("SESSION_SECRET", "a-real-production-secret-of-sufficient-length-xx");

    const { otp } = await import("@/lib/providers/otp");
    expect(otp().name).toBe("disabled");
  });

  it("refuses to boot in production when OTP_PROVIDER=console", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "console");
    vi.stubEnv("SESSION_SECRET", "a-real-production-secret-of-sufficient-length-xx");

    await expect(import("@/lib/env")).rejects.toThrow(/OTP_PROVIDER=console/);
  });
});
