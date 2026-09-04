import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Driver selection.
 *
 * The bug these pin: `STORAGE_DRIVER=local` on a serverless host, whose
 * filesystem is a read-only bundle. Every upload died with
 * `ENOENT: mkdir '/var/task/storage'` from inside a request, which named the
 * symptom and nothing else. Refusing at the boundary, with the two ways out in
 * the message, is the difference between a five-minute fix and an afternoon.
 */
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function loadStorage(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  const { storage } = await import("@/lib/providers/storage");
  return storage();
}

describe("driver selection", () => {
  it("uses the filesystem on an ordinary host", async () => {
    const provider = await loadStorage({ STORAGE_DRIVER: "local", VERCEL: "" });
    expect(provider.name).toBe("local");
  });

  it("refuses the local driver on a read-only host, and says what to do instead", async () => {
    await expect(loadStorage({ STORAGE_DRIVER: "local", VERCEL: "1" })).rejects.toThrow(
      /read-only.*STORAGE_DRIVER=blob.*STORAGE_DRIVER=s3/s,
    );
  });

  it("refuses local on Lambda too, not just Vercel", async () => {
    await expect(
      loadStorage({ STORAGE_DRIVER: "local", AWS_LAMBDA_FUNCTION_NAME: "lagaitha" }),
    ).rejects.toThrow(/read-only/);
  });

  it("selects the blob driver when a store is connected", async () => {
    const provider = await loadStorage({
      STORAGE_DRIVER: "blob",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
    });
    expect(provider.name).toBe("blob");
  });

  it("names the missing token rather than failing on the first upload", async () => {
    await expect(
      loadStorage({ STORAGE_DRIVER: "blob", BLOB_READ_WRITE_TOKEN: "" }),
    ).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("still selects s3 when its five variables are present", async () => {
    const provider = await loadStorage({
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "auto",
      S3_BUCKET: "lagaitha",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(provider.name).toBe("s3");
  });
});

describe("public URLs", () => {
  it("routes local files through the media handler", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    const { mediaUrl } = await import("@/lib/providers/storage");
    expect(mediaUrl("reports/202609/abc.webp")).toBe("/api/media/reports/202609/abc.webp");
  });

  it("serves an S3 bucket directly when it has a public base URL", async () => {
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("S3_PUBLIC_BASE_URL", "https://cdn.example.com/");
    const { mediaUrl } = await import("@/lib/providers/storage");
    expect(mediaUrl("reports/202609/abc.webp")).toBe(
      "https://cdn.example.com/reports/202609/abc.webp",
    );
  });
});
