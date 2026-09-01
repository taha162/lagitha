import { describe, expect, it } from "vitest";
import {
  clusterPoints,
  coarsenPoint,
  distanceMeters,
  formatAreaLabel,
  formatDistance,
  isWithinServiceArea,
  MOSUL_CENTER,
  nearestArea,
} from "@/lib/geo";

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(MOSUL_CENTER, MOSUL_CENTER)).toBe(0);
  });

  it("measures a known separation", () => {
    // 0.01° of latitude ≈ 1.11 km anywhere on Earth.
    const distance = distanceMeters(
      { lat: 36.33, lng: 43.12 },
      { lat: 36.34, lng: 43.12 },
    );
    expect(distance).toBeGreaterThan(1050);
    expect(distance).toBeLessThan(1160);
  });

  it("is symmetric", () => {
    const a = { lat: 36.376, lng: 43.158 };
    const b = { lat: 36.343, lng: 43.125 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

describe("coarsenPoint", () => {
  it("moves the published point off the real one", () => {
    const precise = { lat: 36.376123, lng: 43.158456 };
    const coarse = coarsenPoint(precise);
    expect(coarse).not.toEqual(precise);
  });

  it("keeps the error inside roughly the grid size", () => {
    const precise = { lat: 36.376123, lng: 43.158456 };
    const coarse = coarsenPoint(precise, 300);
    // Snapping to a 300 m grid can move a point by at most half a diagonal.
    expect(distanceMeters(precise, coarse)).toBeLessThan(300);
  });

  it("is deterministic, so repeated reads cannot be averaged back", () => {
    const precise = { lat: 36.376123, lng: 43.158456 };
    const first = coarsenPoint(precise);
    for (let i = 0; i < 20; i += 1) {
      expect(coarsenPoint(precise)).toEqual(first);
    }
  });

  it("maps nearby precise points onto the same published cell", () => {
    // Two doors on the same street must not be distinguishable.
    const a = coarsenPoint({ lat: 36.37600, lng: 43.15800 });
    const b = coarsenPoint({ lat: 36.37605, lng: 43.15805 });
    expect(a).toEqual(b);
  });
});

describe("isWithinServiceArea", () => {
  it("accepts points in Mosul", () => {
    expect(isWithinServiceArea(MOSUL_CENTER)).toBe(true);
    expect(isWithinServiceArea({ lat: 36.376, lng: 43.158 })).toBe(true);
  });

  it("rejects points elsewhere", () => {
    expect(isWithinServiceArea({ lat: 33.315, lng: 44.366 })).toBe(false); // Baghdad
    expect(isWithinServiceArea({ lat: 0, lng: 0 })).toBe(false);
  });
});

describe("nearestArea", () => {
  const areas = [
    { id: "1", slug: "al-jamia", nameAr: "حي الجامعة", lat: 36.376, lng: 43.158, radiusM: 1200 },
    { id: "2", slug: "bab-al-tob", nameAr: "باب الطوب", lat: 36.3428, lng: 43.1252, radiusM: 1200 },
  ];

  it("picks the closest neighbourhood", () => {
    const result = nearestArea({ lat: 36.377, lng: 43.159 }, areas);
    expect(result?.area.slug).toBe("al-jamia");
    expect(result?.distanceM).toBeLessThan(200);
  });

  it("returns null when there are no areas to choose from", () => {
    expect(nearestArea(MOSUL_CENTER, [])).toBeNull();
  });
});

describe("formatAreaLabel", () => {
  it("combines the area and a landmark", () => {
    expect(formatAreaLabel("حي الجامعة", "قرب الجامعة")).toBe("حي الجامعة — قرب الجامعة");
  });

  it("falls back gracefully when either part is missing", () => {
    expect(formatAreaLabel("حي الجامعة", null)).toBe("حي الجامعة");
    expect(formatAreaLabel(null, "قرب الجسر")).toBe("قرب الجسر");
    expect(formatAreaLabel(null, null)).toBe("الموصل");
    expect(formatAreaLabel("حي الجامعة", "   ")).toBe("حي الجامعة");
  });
});

describe("formatDistance", () => {
  it("never implies more precision than the data has", () => {
    expect(formatDistance(40)).toBe("أقل من ١٠٠ متر");
    expect(formatDistance(620)).toBe("600 متر");
    expect(formatDistance(2400)).toBe("2.4 كم");
    expect(formatDistance(14_000)).toBe("14 كم");
  });
});

describe("clusterPoints", () => {
  const points = [
    { id: "a", lat: 36.376, lng: 43.158 },
    { id: "b", lat: 36.3761, lng: 43.1581 },
    { id: "c", lat: 36.3428, lng: 43.1252 },
  ];

  it("groups neighbours at low zoom", () => {
    const clusters = clusterPoints(points, 10);
    expect(clusters.length).toBeLessThan(points.length);
  });

  it("separates points that are genuinely apart as the operator zooms in", () => {
    const spread = [
      { id: "a", lat: 36.376, lng: 43.158 },
      { id: "b", lat: 36.379, lng: 43.161 },
      { id: "c", lat: 36.3428, lng: 43.1252 },
    ];
    expect(clusterPoints(spread, 10).length).toBeLessThan(3);
    expect(clusterPoints(spread, 17)).toHaveLength(3);
  });

  it("never loses a point, at any zoom level", () => {
    // The invariant that matters on an operations map: a report must always be
    // on it somewhere. (Grid clustering makes no promise about *which* cell a
    // point near a boundary lands in, so that is not asserted.)
    const many = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      lat: 36.3 + (index % 20) * 0.005,
      lng: 43.05 + Math.floor(index / 20) * 0.02,
    }));

    for (const zoom of [8, 10, 12, 14, 16, 18]) {
      const clusters = clusterPoints(many, zoom);
      const total = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0);
      expect(total, `zoom ${zoom}`).toBe(many.length);
      expect(new Set(clusters.flatMap((c) => c.items.map((i) => i.id))).size).toBe(many.length);
    }
  });

  it("draws fewer markers the further out the operator zooms", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      lat: 36.3 + (index % 20) * 0.005,
      lng: 43.05 + Math.floor(index / 20) * 0.02,
    }));

    expect(clusterPoints(many, 9).length).toBeLessThan(clusterPoints(many, 16).length);
  });

  it("centres each cluster on its members", () => {
    const [cluster] = clusterPoints(
      [
        { id: "a", lat: 36.0, lng: 43.0 },
        { id: "b", lat: 36.002, lng: 43.002 },
      ],
      10,
    );
    expect(cluster!.lat).toBeCloseTo(36.001, 5);
    expect(cluster!.lng).toBeCloseTo(43.001, 5);
  });

  it("handles an empty input", () => {
    expect(clusterPoints([], 12)).toEqual([]);
  });
});
