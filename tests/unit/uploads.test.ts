import { describe, expect, it } from "vitest";
import { couldBeAnImage } from "@/lib/uploads";

/**
 * The gate in front of the image decoder.
 *
 * These cases are not hypothetical: the strict allow-list this replaced turned
 * away photographs taken on ordinary phones, and told the person their file
 * type was unsupported — a message they could do nothing about, on a report
 * they were trying to file about something they had lost.
 */
describe("couldBeAnImage", () => {
  it("accepts the types a camera roll actually produces", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "image/avif",
      "image/jpg", // not a real type; Android sends it anyway
    ]) {
      expect(couldBeAnImage(type), type).toBe(true);
    }
  });

  it("accepts a file whose type the browser did not state", () => {
    // A share sheet, or a picker that hands over bytes and no label. The
    // decoder still has to agree, so nothing unsafe gets through by saying
    // nothing.
    expect(couldBeAnImage("")).toBe(true);
    expect(couldBeAnImage(undefined)).toBe(true);
    expect(couldBeAnImage(null)).toBe(true);
    expect(couldBeAnImage("application/octet-stream")).toBe(true);
  });

  it("ignores parameters and casing the way a header may carry them", () => {
    expect(couldBeAnImage("IMAGE/JPEG")).toBe(true);
    expect(couldBeAnImage("image/jpeg; charset=binary")).toBe(true);
    expect(couldBeAnImage("  image/png  ")).toBe(true);
  });

  it("turns away something announcing itself as another kind of file", () => {
    for (const type of [
      "application/pdf",
      "video/mp4",
      "text/html",
      "application/x-msdownload",
      "application/zip",
    ]) {
      expect(couldBeAnImage(type), type).toBe(false);
    }
  });
});
