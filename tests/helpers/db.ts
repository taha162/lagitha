import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { buildSearchText } from "@/lib/arabic";
import { coarsenPoint, formatAreaLabel } from "@/lib/geo";
import { generateReference } from "@/lib/utils";
import { PUBLIC_AUTHOR_SELECT } from "@/lib/privacy";

/**
 * Test database helpers. Uses its own client so a test can inspect state that
 * the application client wrote, and truncates between suites.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgresql://lagaitha:lagaitha@127.0.0.1:5432/lagaitha_test";

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Wipes all mutable data. Categories and areas are reference data, so they are
 * (re)seeded rather than deleted — every test needs them.
 */
export async function resetDatabase(): Promise<void> {
  await testDb.$executeRawUnsafe(`
    TRUNCATE TABLE
      "admin_actions", "flags", "recoveries", "notifications", "messages",
      "conversations", "verification_requests", "matches", "report_images",
      "reports", "identity_verifications", "otp_challenges", "sessions",
      "rate_limits", "users"
    RESTART IDENTITY CASCADE
  `);
  await ensureReferenceData();
}

let referenceSeeded = false;

export async function ensureReferenceData(): Promise<void> {
  if (referenceSeeded) {
    const count = await testDb.category.count();
    if (count > 0) return;
  }

  await testDb.category.createMany({
    data: [
      { slug: "phone", nameAr: "هواتف", icon: "Smartphone", sortOrder: 0 },
      { slug: "wallet", nameAr: "محافظ ونقود", icon: "Wallet", sortOrder: 1 },
      { slug: "keys", nameAr: "مفاتيح", icon: "KeyRound", sortOrder: 2 },
      {
        slug: "documents",
        nameAr: "وثائق وهويات",
        icon: "IdCard",
        sensitive: true,
        publicLabelAr: "وثيقة شخصية",
        sortOrder: 3,
      },
    ],
    skipDuplicates: true,
  });

  await testDb.area.createMany({
    data: [
      { slug: "al-jamia", nameAr: "حي الجامعة", side: "LEFT_BANK", lat: 36.376, lng: 43.158 },
      { slug: "al-zuhour", nameAr: "حي الزهور", side: "LEFT_BANK", lat: 36.382, lng: 43.172 },
      { slug: "bab-al-tob", nameAr: "باب الطوب", side: "RIGHT_BANK", lat: 36.3428, lng: 43.1252 },
    ],
    skipDuplicates: true,
  });

  referenceSeeded = true;
}

let userCounter = 0;

export async function createUser(
  overrides: Partial<{
    displayName: string;
    role: "MEMBER" | "MODERATOR" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED" | "BANNED";
  }> = {},
) {
  userCounter += 1;
  return testDb.user.create({
    data: {
      email: `user${userCounter}@test.local`,
      displayName: overrides.displayName ?? `مستخدم ${userCounter}`,
      role: overrides.role ?? "MEMBER",
      status: overrides.status ?? "ACTIVE",
      verifiedAt: new Date(),
    },
  });
}

interface ReportSeed {
  userId: string;
  type?: "LOST" | "FOUND";
  categorySlug?: string;
  areaSlug?: string;
  title?: string;
  description?: string | null;
  color?: string | null;
  brand?: string | null;
  occurredAt?: Date;
  lat?: number;
  lng?: number;
  moderation?: "VISIBLE" | "UNDER_REVIEW" | "HIDDEN" | "REJECTED";
  status?: "ACTIVE" | "RECOVERED" | "CLOSED";
  verificationSecret?: string | null;
}

/** Creates a report directly, bypassing the service, for arranging fixtures. */
export async function createReportFixture(seed: ReportSeed) {
  const category = await testDb.category.findUniqueOrThrow({
    where: { slug: seed.categorySlug ?? "phone" },
  });
  const area = await testDb.area.findUniqueOrThrow({
    where: { slug: seed.areaSlug ?? "al-jamia" },
  });

  const precise = { lat: seed.lat ?? area.lat, lng: seed.lng ?? area.lng };
  const approx = coarsenPoint(precise);
  const title = seed.title ?? "آيفون أسود";

  return testDb.report.create({
    data: {
      reference: generateReference(),
      type: seed.type ?? "LOST",
      categoryId: category.id,
      title,
      description: seed.description ?? null,
      color: seed.color ?? null,
      brand: seed.brand ?? null,
      occurredAt: seed.occurredAt ?? new Date(),
      occurredPrecision: "DAY",
      areaId: area.id,
      areaLabel: formatAreaLabel(area.nameAr),
      preciseLat: precise.lat,
      preciseLng: precise.lng,
      approxLat: approx.lat,
      approxLng: approx.lng,
      userId: seed.userId,
      moderation: seed.moderation ?? "VISIBLE",
      status: seed.status ?? "ACTIVE",
      sensitivity: category.sensitive ? "SENSITIVE" : "NORMAL",
      verificationSecret: seed.verificationSecret ?? null,
      searchText: buildSearchText([title, seed.description, seed.brand, category.nameAr, area.nameAr]),
    },
    include: {
      category: true,
      area: true,
      images: true,
      user: { select: PUBLIC_AUTHOR_SELECT },
    },
  });
}

/**
 * Gives a user an identity record. Publishing is gated on one, so a test that
 * creates a report through the service needs this unless it is testing the gate
 * itself.
 */
export async function verifyIdentity(
  userId: string,
  status: "PENDING" | "APPROVED" | "REJECTED" = "APPROVED",
) {
  return testDb.identityVerification.upsert({
    where: { userId },
    update: { status },
    create: {
      userId,
      status,
      cardName: "اسم على البطاقة",
      // An approved or rejected record never keeps its images.
      ...(status === "PENDING"
        ? { frontKey: "identity/cards/test-front.webp", backKey: "identity/cards/test-back.webp" }
        : { reviewedAt: new Date(), purgedAt: new Date() }),
    },
  });
}
