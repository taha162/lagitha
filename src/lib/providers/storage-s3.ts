import "server-only";
import { createHash, createHmac } from "node:crypto";
import { assertSafeKey, type StorageProvider } from "./storage";

/**
 * S3-compatible driver.
 *
 * Signs requests with SigV4 over `fetch` rather than pulling in the AWS SDK for
 * three operations — the signing is about forty lines and the dependency is
 * several megabytes.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  constructor(
    private readonly config: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    const response = await this.signedFetch("PUT", key, body, contentType);
    if (!response.ok) throw new Error(`S3 put failed with ${response.status}`);
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const response = await this.signedFetch("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 get failed with ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.signedFetch("DELETE", key);
  }

  private async signedFetch(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = new URL(`${this.config.endpoint.replace(/\/$/, "")}/${this.config.bucket}/${key}`);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;

    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join("");
    const signedHeaderList = signedHeaders.join(";");

    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaderList,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const hmac = (key: Buffer | string, data: string) =>
      createHmac("sha256", key).update(data).digest();

    const signingKey = hmac(
      hmac(
        hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region),
        "s3",
      ),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body) : undefined,
    });
  }
}
