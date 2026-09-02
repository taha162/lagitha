/**
 * Seed script.
 *
 *   npm run db:seed            reference data only (categories + Mosul areas)
 *   npm run db:seed -- --demo  reference data + demo accounts and reports
 *
 * Reference data is safe to run in production — it is idempotent and contains
 * no invented content. Demo data is not: every demo account is labelled
 * "(حساب تجريبي)" so a demo report is never mistaken for a real one, and the
 * script refuses to create it when NODE_ENV=production.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildSearchText } from "../src/lib/arabic";
import { coarsenPoint, formatAreaLabel } from "../src/lib/geo";
import { generateReference } from "../src/lib/utils";
import { hashPassword } from "../src/lib/password";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// --------------------------------------------------------------------------
// Categories — the things people actually lose, in the order they lose them.
// --------------------------------------------------------------------------

const CATEGORIES = [
  { slug: "phone", nameAr: "هواتف", icon: "Smartphone", hintAr: "هاتف، شاحن، سماعات" },
  { slug: "wallet", nameAr: "محافظ ونقود", icon: "Wallet", hintAr: "محفظة، جزدان، بطاقات" },
  { slug: "keys", nameAr: "مفاتيح", icon: "KeyRound", hintAr: "مفاتيح بيت أو سيارة" },
  {
    slug: "documents",
    nameAr: "وثائق وهويات",
    icon: "IdCard",
    sensitive: true,
    publicLabelAr: "وثيقة شخصية",
    hintAr: "هوية، جواز، إجازة سوق — تُنشر بمعلومات محدودة",
  },
  { slug: "bags", nameAr: "حقائب", icon: "Backpack", hintAr: "حقيبة ظهر، جنطة، كيس" },
  { slug: "electronics", nameAr: "إلكترونيات", icon: "Laptop", hintAr: "لابتوب، تابلت، كاميرا" },
  { slug: "jewelry", nameAr: "مجوهرات وساعات", icon: "Watch", hintAr: "خاتم، سلسلة، ساعة" },
  { slug: "eyewear", nameAr: "نظارات", icon: "Glasses", hintAr: "نظارة طبية أو شمسية" },
  { slug: "clothing", nameAr: "ملابس", icon: "Shirt", hintAr: "جاكيت، معطف، شال" },
  { slug: "kids", nameAr: "أغراض أطفال", icon: "Baby", hintAr: "لعبة، حقيبة مدرسة، عربة" },
  { slug: "pets", nameAr: "حيوانات أليفة", icon: "PawPrint", hintAr: "قطة، كلب، طير" },
  { slug: "vehicles", nameAr: "دراجات ومركبات", icon: "Bike", hintAr: "دراجة هوائية أو نارية" },
  {
    slug: "medical",
    nameAr: "أدوية ومستلزمات طبية",
    icon: "Stethoscope",
    hintAr: "سماعة طبية، دواء، جهاز",
  },
  { slug: "other", nameAr: "أشياء أخرى", icon: "Package", hintAr: "أي شيء غير مذكور" },
] as const;

// --------------------------------------------------------------------------
// Mosul neighbourhoods. This list *is* the geocoder: a pin is resolved to the
// nearest entry here, and that name is what the public sees. Coordinates are
// neighbourhood centroids, deliberately not street-level.
// --------------------------------------------------------------------------

const AREAS = [
  // الساحل الأيمن — west bank
  { slug: "bab-al-tob", nameAr: "باب الطوب", side: "RIGHT_BANK", lat: 36.3428, lng: 43.1252 },
  { slug: "bab-al-saray", nameAr: "باب السراي", side: "RIGHT_BANK", lat: 36.3402, lng: 43.1247 },
  { slug: "al-maidan", nameAr: "الميدان", side: "RIGHT_BANK", lat: 36.3395, lng: 43.1218 },
  { slug: "al-nabi-jirjis", nameAr: "النبي جرجيس", side: "RIGHT_BANK", lat: 36.3385, lng: 43.1265 },
  { slug: "ras-al-jadda", nameAr: "رأس الجادة", side: "RIGHT_BANK", lat: 36.3455, lng: 43.1290 },
  { slug: "al-dawasa", nameAr: "حي الدواسة", side: "RIGHT_BANK", lat: 36.3474, lng: 43.1214 },
  { slug: "al-shifa", nameAr: "حي الشفاء", side: "RIGHT_BANK", lat: 36.3536, lng: 43.1178 },
  { slug: "al-zanjili", nameAr: "حي الزنجيلي", side: "RIGHT_BANK", lat: 36.3486, lng: 43.1141 },
  { slug: "al-najjar", nameAr: "حي النجار", side: "RIGHT_BANK", lat: 36.3440, lng: 43.1180 },
  { slug: "17-tammuz", nameAr: "حي ١٧ تموز", side: "RIGHT_BANK", lat: 36.3620, lng: 43.1120 },
  { slug: "al-rifai", nameAr: "حي الرفاعي", side: "RIGHT_BANK", lat: 36.3690, lng: 43.1180 },
  { slug: "al-thawra", nameAr: "حي الثورة", side: "RIGHT_BANK", lat: 36.3600, lng: 43.1050 },
  { slug: "al-tanak", nameAr: "حي التنك", side: "RIGHT_BANK", lat: 36.3550, lng: 43.0960 },
  { slug: "al-islah-al-zirai", nameAr: "حي الإصلاح الزراعي", side: "RIGHT_BANK", lat: 36.3300, lng: 43.1050 },
  { slug: "al-mansour", nameAr: "حي المنصور", side: "RIGHT_BANK", lat: 36.3252, lng: 43.1150 },
  { slug: "al-risala", nameAr: "حي الرسالة", side: "RIGHT_BANK", lat: 36.3180, lng: 43.1090 },
  { slug: "al-jazair", nameAr: "حي الجزائر", side: "RIGHT_BANK", lat: 36.3230, lng: 43.0990 },
  { slug: "al-mamoun", nameAr: "حي المأمون", side: "RIGHT_BANK", lat: 36.3350, lng: 43.0900 },
  { slug: "al-yarmouk", nameAr: "حي اليرموك", side: "RIGHT_BANK", lat: 36.3300, lng: 43.0870 },
  { slug: "al-shuhada", nameAr: "حي الشهداء", side: "RIGHT_BANK", lat: 36.3150, lng: 43.1180 },
  { slug: "wadi-hajar", nameAr: "حي وادي حجر", side: "RIGHT_BANK", lat: 36.3120, lng: 43.1230 },
  { slug: "hawi-al-kanisa", nameAr: "حاوي الكنيسة", side: "RIGHT_BANK", lat: 36.3080, lng: 43.1300 },

  // الساحل الأيسر — east bank
  { slug: "al-jamia", nameAr: "حي الجامعة", side: "LEFT_BANK", lat: 36.3760, lng: 43.1580 },
  { slug: "al-zuhour", nameAr: "حي الزهور", side: "LEFT_BANK", lat: 36.3820, lng: 43.1720 },
  { slug: "al-hadba", nameAr: "حي الحدباء", side: "LEFT_BANK", lat: 36.3900, lng: 43.1650 },
  { slug: "al-muthanna", nameAr: "حي المثنى", side: "LEFT_BANK", lat: 36.3700, lng: 43.1450 },
  { slug: "al-bakr", nameAr: "حي البكر", side: "LEFT_BANK", lat: 36.3620, lng: 43.1620 },
  { slug: "al-karama", nameAr: "حي الكرامة", side: "LEFT_BANK", lat: 36.3550, lng: 43.1650 },
  { slug: "al-salam", nameAr: "حي السلام", side: "LEFT_BANK", lat: 36.3480, lng: 43.1780 },
  { slug: "al-falah", nameAr: "حي الفلاح", side: "LEFT_BANK", lat: 36.3600, lng: 43.1900 },
  { slug: "al-noor", nameAr: "حي النور", side: "LEFT_BANK", lat: 36.3660, lng: 43.1850 },
  { slug: "al-wahda", nameAr: "حي الوحدة", side: "LEFT_BANK", lat: 36.3450, lng: 43.1620 },
  { slug: "al-mithaq", nameAr: "حي الميثاق", side: "LEFT_BANK", lat: 36.3530, lng: 43.1550 },
  { slug: "al-qadisiya", nameAr: "حي القادسية", side: "LEFT_BANK", lat: 36.3400, lng: 43.1560 },
  { slug: "al-andalus", nameAr: "حي الأندلس", side: "LEFT_BANK", lat: 36.3520, lng: 43.1450 },
  { slug: "al-masarif", nameAr: "حي المصارف", side: "LEFT_BANK", lat: 36.3460, lng: 43.1400 },
  { slug: "al-maliya", nameAr: "حي المالية", side: "LEFT_BANK", lat: 36.3440, lng: 43.1450 },
  { slug: "al-sihha", nameAr: "حي الصحة", side: "LEFT_BANK", lat: 36.3540, lng: 43.1500 },
  { slug: "al-muhandiseen", nameAr: "حي المهندسين", side: "LEFT_BANK", lat: 36.3670, lng: 43.1550 },
  { slug: "al-baladiyat", nameAr: "حي البلديات", side: "LEFT_BANK", lat: 36.3620, lng: 43.1720 },
  { slug: "sumer", nameAr: "حي سومر", side: "LEFT_BANK", lat: 36.3700, lng: 43.1680 },
  { slug: "al-ikhaa", nameAr: "حي الإخاء", side: "LEFT_BANK", lat: 36.3790, lng: 43.1900 },
  { slug: "al-tahrir", nameAr: "حي التحرير", side: "LEFT_BANK", lat: 36.3750, lng: 43.1780 },
  { slug: "al-qahira", nameAr: "حي القاهرة", side: "LEFT_BANK", lat: 36.3860, lng: 43.1560 },
  { slug: "al-shurta", nameAr: "حي الشرطة", side: "LEFT_BANK", lat: 36.3350, lng: 43.1500 },
  { slug: "al-intisar", nameAr: "حي الانتصار", side: "LEFT_BANK", lat: 36.3300, lng: 43.1450 },
  { slug: "al-siddiq", nameAr: "حي الصديق", side: "LEFT_BANK", lat: 36.3480, lng: 43.1900 },
  { slug: "domiz", nameAr: "حي دوميز", side: "LEFT_BANK", lat: 36.3250, lng: 43.1650 },

  // الأطراف — outskirts
  { slug: "al-rashidiya", nameAr: "الرشيدية", side: "OUTSKIRTS", lat: 36.4400, lng: 43.2000, radiusM: 2500 },
  { slug: "kokjali", nameAr: "كوكجلي", side: "OUTSKIRTS", lat: 36.3300, lng: 43.2000, radiusM: 2500 },
  { slug: "hamam-al-alil-road", nameAr: "طريق حمام العليل", side: "OUTSKIRTS", lat: 36.2200, lng: 43.1600, radiusM: 4000 },
] as const;

async function seedReferenceData() {
  for (const [index, category] of CATEGORIES.entries()) {
    const sensitive = "sensitive" in category ? category.sensitive : false;
    const publicLabelAr = "publicLabelAr" in category ? category.publicLabelAr : null;

    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        nameAr: category.nameAr,
        icon: category.icon,
        sensitive,
        publicLabelAr,
        hintAr: category.hintAr,
        sortOrder: index,
        active: true,
      },
      create: {
        slug: category.slug,
        nameAr: category.nameAr,
        icon: category.icon,
        sensitive,
        publicLabelAr,
        hintAr: category.hintAr,
        sortOrder: index,
      },
    });
  }
  console.info(`  ✓ ${CATEGORIES.length} فئة`);

  for (const area of AREAS) {
    const radiusM = "radiusM" in area ? area.radiusM : 1200;
    await prisma.area.upsert({
      where: { slug: area.slug },
      update: { nameAr: area.nameAr, side: area.side, lat: area.lat, lng: area.lng, radiusM },
      create: {
        slug: area.slug,
        nameAr: area.nameAr,
        side: area.side,
        lat: area.lat,
        lng: area.lng,
        radiusM,
      },
    });
  }
  console.info(`  ✓ ${AREAS.length} منطقة`);
}

// --------------------------------------------------------------------------
// Demo content
// --------------------------------------------------------------------------

/** Login is by email, so demo accounts are keyed on an address. */
const DEMO_PASSWORD = "lagaitha-demo-2026";

const DEMO_USERS = [
  { email: "admin@lagaitha.local", displayName: "فريق لَگيتها", role: "ADMIN" as const },
  { email: "mod@lagaitha.local", displayName: "مشرف المحتوى", role: "MODERATOR" as const },
  { email: "abu.ahmed@lagaitha.local", displayName: "أبو أحمد (حساب تجريبي)", role: "MEMBER" as const },
  { email: "sara@lagaitha.local", displayName: "سارة (حساب تجريبي)", role: "MEMBER" as const },
  { email: "omar@lagaitha.local", displayName: "عمر (حساب تجريبي)", role: "MEMBER" as const },
  { email: "um.yousif@lagaitha.local", displayName: "أم يوسف (حساب تجريبي)", role: "MEMBER" as const },
  { email: "haidar@lagaitha.local", displayName: "حيدر (حساب تجريبي)", role: "MEMBER" as const },
];

interface DemoReport {
  type: "LOST" | "FOUND";
  category: string;
  title: string;
  description?: string;
  color?: string;
  brand?: string;
  area: string;
  landmark?: string;
  hoursAgo: number;
  userIndex: number;
  secret?: string;
}

/**
 * Written to exercise the matcher, not to look impressive: pairs 1/2 and 3/4
 * are near-matches, 5 is a lone sensitive document, and the rest are noise of
 * the kind a real feed carries.
 */
const DEMO_REPORTS: DemoReport[] = [
  {
    type: "LOST",
    category: "phone",
    title: "آيفون ١٣ أسود",
    description: "كفر شفاف، وفيه خدش صغير بالزاوية اليمين. الشاشة سليمة.",
    color: "black",
    brand: "iPhone",
    area: "al-jamia",
    landmark: "قرب باب الجامعة الرئيسي",
    hoursAgo: 30,
    userIndex: 2,
  },
  {
    type: "FOUND",
    category: "phone",
    title: "هاتف أسود لگيته بالشارع",
    description: "لگيته على الرصيف. مطفي وما أعرف رقم أحد.",
    color: "black",
    brand: "ايفون",
    area: "al-jamia",
    landmark: "شارع الجامعة",
    hoursAgo: 26,
    userIndex: 3,
    secret: "خلفية الشاشة صورة ولد صغير، وبالكفر ورقة صغيرة.",
  },
  {
    type: "LOST",
    category: "keys",
    title: "مفاتيح سيارة مع ميدالية جلد",
    description: "ثلاث مفاتيح وريموت، والميدالية جلد بني مكتوب عليها حرف (ع).",
    color: "brown",
    area: "al-masarif",
    landmark: "قرب سوق المصارف",
    hoursAgo: 74,
    userIndex: 4,
  },
  {
    type: "FOUND",
    category: "keys",
    title: "مجموعة مفاتيح بميدالية بنية",
    description: "لگيتها جنب المحل. محتفظ بيها لحد ما يجي صاحبها.",
    color: "brown",
    area: "al-masarif",
    hoursAgo: 70,
    userIndex: 5,
    secret: "الحرف المحفور على الميدالية.",
  },
  {
    type: "LOST",
    category: "documents",
    title: "هوية أحوال مدنية باسم صاحبها",
    description: "ضاعت مع مجموعة أوراق داخل ملف بلاستيكي.",
    area: "bab-al-tob",
    hoursAgo: 10,
    userIndex: 2,
  },
  {
    type: "FOUND",
    category: "wallet",
    title: "محفظة جلد بني",
    description: "بيها بطاقات وما بيها نقود. أسلّمها لصاحبها بعد التأكد.",
    color: "brown",
    area: "al-dawasa",
    landmark: "قرب موقف الباصات",
    hoursAgo: 5,
    userIndex: 6,
    secret: "عدد البطاقات وشنو مكتوب على أول وحدة.",
  },
  {
    type: "LOST",
    category: "bags",
    title: "حقيبة ظهر زرقاء فيها كتب",
    description: "بيها كتب جامعية ودفتر أزرق. مهمة لي كثير.",
    color: "blue",
    area: "al-muthanna",
    hoursAgo: 52,
    userIndex: 3,
  },
  {
    type: "FOUND",
    category: "pets",
    title: "قطة بيضاء أليفة",
    description: "قطة هادئة وواضح إنها أليفة ومو شاردة من زمان. عندي بالبيت مؤقتاً.",
    color: "white",
    area: "al-zuhour",
    hoursAgo: 18,
    userIndex: 5,
    secret: "علامة مميزة بلون الأذن.",
  },
  {
    type: "LOST",
    category: "eyewear",
    title: "نظارة طبية إطار أسود",
    description: "الإطار أسود رفيع، وبالعلبة اسم المحل.",
    color: "black",
    area: "al-andalus",
    hoursAgo: 96,
    userIndex: 4,
  },
  {
    type: "FOUND",
    category: "jewelry",
    title: "ساعة يد فضية",
    description: "لگيتها بالحديقة. محفوظة عندي.",
    color: "silver",
    area: "al-hadba",
    landmark: "قرب الحديقة",
    hoursAgo: 8,
    userIndex: 6,
    secret: "شكل الحزام ووين مكان الخدش.",
  },
  {
    type: "LOST",
    category: "kids",
    title: "حقيبة مدرسة وردية",
    description: "بيها دفاتر وقلم رصاص بشكل أرنب.",
    color: "pink",
    area: "al-salam",
    hoursAgo: 40,
    userIndex: 5,
  },
  {
    type: "LOST",
    category: "vehicles",
    title: "دراجة هوائية حمراء",
    description: "دراجة عادية لون أحمر، الكفر الخلفي جديد.",
    color: "red",
    area: "al-karama",
    hoursAgo: 120,
    userIndex: 6,
  },
  {
    type: "FOUND",
    category: "electronics",
    title: "شاحن لابتوب أسود",
    description: "منسي بالمقهى من يومين.",
    color: "black",
    area: "al-muhandiseen",
    hoursAgo: 44,
    userIndex: 4,
    secret: "ماركة الشاحن والعلامة اللي عليه.",
  },
  {
    type: "LOST",
    category: "wallet",
    title: "جزدان أسود صغير",
    description: "بيه بطاقة صراف وصورة عائلية.",
    color: "black",
    area: "al-maidan",
    hoursAgo: 160,
    userIndex: 3,
  },
];

async function seedDemoData() {
  if (process.env.NODE_ENV === "production") {
    console.warn("  ⚠ تخطّي البيانات التجريبية: NODE_ENV=production");
    return;
  }

  // Every demo account shares one password, printed at the end of the run.
  // Hashed through the same function the application uses, so the sign-in path
  // exercised in development is the real one.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users = [];
  for (const demoUser of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: { displayName: demoUser.displayName, role: demoUser.role, passwordHash },
      create: {
        email: demoUser.email,
        displayName: demoUser.displayName,
        role: demoUser.role,
        passwordHash,
        verifiedAt: new Date(),
      },
    });

    // Demo accounts publish reports, and publishing needs a verified identity.
    // The record carries no image: it is created already decided and already
    // purged, which is exactly the shape a real approved verification has once
    // the reviewer is done with it.
    await prisma.identityVerification.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        status: "APPROVED",
        cardName: demoUser.displayName,
        reviewedAt: new Date(),
        purgedAt: new Date(),
      },
    });

    users.push(user);
  }
  console.info(`  ✓ ${users.length} حساب تجريبي (كلمة المرور: ${DEMO_PASSWORD})`);

  const categories = new Map(
    (await prisma.category.findMany()).map((category) => [category.slug, category]),
  );
  const areas = new Map((await prisma.area.findMany()).map((area) => [area.slug, area]));

  let created = 0;
  for (const demo of DEMO_REPORTS) {
    const category = categories.get(demo.category);
    const area = areas.get(demo.area);
    const user = users[demo.userIndex];
    if (!category || !area || !user) continue;

    // Skip if an equivalent demo report is already present, so re-running the
    // seed does not pile up duplicates.
    const existing = await prisma.report.findFirst({
      where: { title: demo.title, userId: user.id },
      select: { id: true },
    });
    if (existing) continue;

    // Scatter the pin a little inside the neighbourhood so the demo data does
    // not stack every marker on one centroid.
    const precise = {
      lat: area.lat + (Math.random() - 0.5) * 0.006,
      lng: area.lng + (Math.random() - 0.5) * 0.006,
    };
    const approx = coarsenPoint(precise);
    const occurredAt = new Date(Date.now() - demo.hoursAgo * 3_600_000);

    await prisma.report.create({
      data: {
        reference: generateReference(),
        type: demo.type,
        categoryId: category.id,
        title: demo.title,
        description: demo.description ?? null,
        color: demo.color ?? null,
        brand: demo.brand ?? null,
        occurredAt,
        occurredPrecision: "DAY",
        areaId: area.id,
        areaLabel: formatAreaLabel(area.nameAr, demo.landmark),
        landmark: demo.landmark ?? null,
        preciseLat: precise.lat,
        preciseLng: precise.lng,
        approxLat: approx.lat,
        approxLng: approx.lng,
        userId: user.id,
        sensitivity: category.sensitive ? "SENSITIVE" : "NORMAL",
        verificationSecret: demo.secret ?? null,
        publishedAt: occurredAt,
        searchText: buildSearchText([
          demo.title,
          demo.description,
          demo.brand,
          category.nameAr,
          area.nameAr,
          demo.landmark,
        ]),
      },
    });
    created += 1;
  }

  console.info(`  ✓ ${created} بلاغ تجريبي`);
  if (created > 0) {
    console.info("\n  البيانات التجريبية موسومة بـ (حساب تجريبي) في اسم صاحب البلاغ.");
    console.info("  للدخول: أي بريد من العناوين أعلاه + الرمز في OTP_DEV_FIXED_CODE.\n");
  }
}

async function main() {
  const withDemo = process.argv.includes("--demo") || process.env.SEED_DEMO === "1";

  console.info("\nلَگيتها — تهيئة البيانات\n");
  await seedReferenceData();

  if (withDemo) {
    await seedDemoData();
  } else {
    console.info("  (شغّل مع --demo لإضافة بيانات تجريبية)");
  }

  console.info("\nتمت التهيئة.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
