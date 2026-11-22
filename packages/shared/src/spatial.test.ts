import { describe, expect, it } from "vitest";
import { getGujaratLocationById } from "./locations";
import {
  MAX_NEIGHBORHOOD_DRAG_ADJUST_MILES,
  METERS_PER_MILE,
  clampLocalAdjustment,
  computeStaticFuzzedPoint,
  createCirclePolygonGeoJSON,
  evaluateBlurredPreviewMatches,
  haversineDistanceMeters,
  inferSanAntonioNeighborhood,
  isPointInGreaterSanAntonio,
  validateCapturedGpsFix,
  type PublicHouseholdPin,
} from "./spatial";

const MED_CENTER = { lat: 29.5124, lng: -98.5742 };
const STONE_OAK = { lat: 29.6472, lng: -98.4864 };
const ALAMO_RANCH = { lat: 29.4928, lng: -98.7115 };
const BOERNE = { lat: 29.7947, lng: -98.732 };
const NEW_BRAUNFELS = { lat: 29.703, lng: -98.1245 };
const AUSTIN = { lat: 30.2672, lng: -97.7431 };
const HOUSTON = { lat: 29.7604, lng: -95.3698 };
const AHMEDABAD_CITY = { lat: 23.0225, lng: 72.5714 };

const AHMEDABAD_ORIGIN = getGujaratLocationById("ahmedabad-navrangpura")!;
const AHMEDABAD_DISTRICT = getGujaratLocationById("ahmedabad-district")!;
const VIRAMGAM_ORIGIN = getGujaratLocationById("ahmedabad-viramgam")!;
const BHUJ_ORIGIN = getGujaratLocationById("kutch-bhuj")!;

describe("San Antonio geofence and neighborhood inference", () => {
  it("accepts Greater San Antonio corridors and rejects outside metros", () => {
    expect(isPointInGreaterSanAntonio(MED_CENTER)).toBe(true);
    expect(isPointInGreaterSanAntonio(STONE_OAK)).toBe(true);
    expect(isPointInGreaterSanAntonio(ALAMO_RANCH)).toBe(true);
    expect(isPointInGreaterSanAntonio(BOERNE)).toBe(true);
    expect(isPointInGreaterSanAntonio(NEW_BRAUNFELS)).toBe(true);

    expect(isPointInGreaterSanAntonio(AUSTIN)).toBe(false);
    expect(isPointInGreaterSanAntonio(HOUSTON)).toBe(false);
    expect(isPointInGreaterSanAntonio(AHMEDABAD_CITY)).toBe(false);
    expect(isPointInGreaterSanAntonio({ lat: Number.NaN, lng: -98.5 })).toBe(false);
  });

  it("infers nearest neighborhood label", () => {
    expect(inferSanAntonioNeighborhood(MED_CENTER)).toBe("Medical Center");
    expect(inferSanAntonioNeighborhood(STONE_OAK)).toBe("Stone Oak");
    expect(inferSanAntonioNeighborhood(AUSTIN)).toBe("Greater San Antonio");
  });
});

describe("static privacy fuzzing and GPS validation", () => {
  it("computes a static offset strictly between 0.5 and 1.5 miles inside the metro", () => {
    const samples = [0, 0.25, 0.5, 0.75, 0.99];
    for (const sample of samples) {
      let idx = 0;
      const values = [sample, (sample + 0.37) % 1];
      const result = computeStaticFuzzedPoint(MED_CENTER, () => {
        const val = values[idx % values.length] ?? 0.5;
        idx += 1;
        return val;
      });
      const distMiles = haversineDistanceMeters(MED_CENTER, result.fuzzedCenter) / METERS_PER_MILE;
      expect(distMiles).toBeGreaterThanOrEqual(0.49);
      expect(distMiles).toBeLessThanOrEqual(1.51);
      expect(isPointInGreaterSanAntonio(result.fuzzedCenter)).toBe(true);
    }
  });

  it("falls back inward when all outward attempts on the metro boundary exit the polygon", () => {
    // Point ~0.34 mi inside the northern edge (~29.850 at lng -98.65); bearing=0 points due north outside
    const borderPoint = { lat: 29.845, lng: -98.65 };
    expect(isPointInGreaterSanAntonio(borderPoint)).toBe(true);

    let call = 0;
    const result = computeStaticFuzzedPoint(borderPoint, () => {
      const val = call % 2 === 0 ? 0.9 : 0.0;
      call += 1;
      return val;
    });

    expect(isPointInGreaterSanAntonio(result.fuzzedCenter)).toBe(true);
    const distMiles = haversineDistanceMeters(borderPoint, result.fuzzedCenter) / METERS_PER_MILE;
    expect(distMiles).toBeGreaterThanOrEqual(0.5);
    expect(distMiles).toBeLessThanOrEqual(1.5);
  });

  it("clamps manual local drag adjustment to MAX_NEIGHBORHOOD_DRAG_ADJUST_MILES and metro bounds", () => {
    const near = { lat: 29.52, lng: -98.57 };
    expect(clampLocalAdjustment(MED_CENTER, near)).toEqual(near);

    const clamped = clampLocalAdjustment(MED_CENTER, STONE_OAK);
    const clampedMiles = haversineDistanceMeters(MED_CENTER, clamped) / METERS_PER_MILE;
    expect(clampedMiles).toBeLessThanOrEqual(MAX_NEIGHBORHOOD_DRAG_ADJUST_MILES + 0.01);
    expect(isPointInGreaterSanAntonio(clamped)).toBe(true);

    // Dragging an edge anchor northward past the metro polygon falls back to anchor
    const northEdgeAnchor = { lat: 29.845, lng: -98.65 };
    expect(clampLocalAdjustment(northEdgeAnchor, { lat: 29.95, lng: -98.65 })).toEqual(
      northEdgeAnchor,
    );
  });

  it("builds an exactly closed GeoJSON Polygon circle", () => {
    const circle = createCirclePolygonGeoJSON(MED_CENTER, 1.0, 32);
    expect(circle.geometry.type).toBe("Polygon");
    const ring = circle.geometry.coordinates[0];
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
  });

  it("rejects mock GPS and out-of-corridor fixes, and fuzzes valid fixes", () => {
    expect(validateCapturedGpsFix({ ...MED_CENTER, mocked: true })).toEqual({
      ok: false,
      reason: "mock_gps",
    });
    expect(validateCapturedGpsFix({ ...AUSTIN, mocked: false })).toEqual({
      ok: false,
      reason: "outside_san_antonio",
    });
    expect(validateCapturedGpsFix({ lat: 95, lng: -98.5 })).toEqual({
      ok: false,
      reason: "invalid_coords",
    });

    const valid = validateCapturedGpsFix({ ...MED_CENTER, mocked: false }, () => 0.5);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.offsetMiles).toBe(1.0);
      expect(valid.neighborhood.label).toBe("Medical Center");
      expect(valid.neighborhood.fuzzedCenter).not.toEqual(MED_CENTER);
    }
  });
});

function makePin(
  id: string,
  lat: number,
  lng: number,
  members: PublicHouseholdPin["members"],
): PublicHouseholdPin {
  return {
    householdId: id,
    displayLabel: `Family ${id}`,
    lifeStage: "family_young_kids",
    neighborhoodName: "Medical Center",
    isVerifiedLocal: true,
    publicLat: lat,
    publicLng: lng,
    members,
  };
}

describe("evaluateBlurredPreviewMatches with Dynamic Zoom Fallback", () => {
  const samplePins: PublicHouseholdPin[] = [
    // Exact Ahmedabad matches near Med Center
    makePin("1", 29.521, -98.565, [
      {
        userId: "u1",
        firstName: "Rohan",
        avatarUrl: null,
        ageBracket: "30s",
        hometownName: "Navrangpura, Ahmedabad",
        hometownDistrict: "Ahmedabad",
        hometownLat: 23.0365,
        hometownLng: 72.5611,
        vouchCount: 4,
        interests: ["Cricket"],
      },
    ]),
    // Multi-origin household: second member is Ahmedabad
    makePin("2", 29.505, -98.58, [
      {
        userId: "u2",
        firstName: "Priya",
        avatarUrl: null,
        ageBracket: "30s",
        hometownName: "Alkapuri, Vadodara",
        hometownDistrict: "Vadodara",
        hometownLat: 22.3119,
        hometownLng: 73.1723,
        vouchCount: 3,
        interests: ["Parenting"],
      },
      {
        userId: "u3",
        firstName: "Kunal",
        avatarUrl: null,
        ageBracket: "30s",
        hometownName: "Bopal, Ahmedabad",
        hometownDistrict: "Ahmedabad",
        hometownLat: 23.0338,
        hometownLng: 72.4634,
        vouchCount: 5,
        interests: ["Tech / Healthcare"],
      },
    ]),
    makePin("3", 29.55, -98.54, [
      {
        userId: "u4",
        firstName: "Aarav",
        avatarUrl: null,
        ageBracket: "20s",
        hometownName: "Satellite, Ahmedabad",
        hometownDistrict: "Ahmedabad",
        hometownLat: 23.03,
        hometownLng: 72.5178,
        vouchCount: 1,
        interests: ["Cricket"],
      },
    ]),
    // Bhuj household (only 1 match for Bhuj -> triggers fallback)
    makePin("4", 29.575, -98.624, [
      {
        userId: "u5",
        firstName: "Yash",
        avatarUrl: null,
        ageBracket: "20s",
        hometownName: "Bhuj, Kutch",
        hometownDistrict: "Kutch",
        hometownLat: 23.242,
        hometownLng: 69.6669,
        vouchCount: 1,
        interests: ["Cricket"],
      },
    ]),
  ];

  it("stays in exact_hometown scope when >= 3 exact matches exist within 10 miles", () => {
    const res = evaluateBlurredPreviewMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_ORIGIN,
    });
    expect(res.scope).toBe("exact_hometown");
    expect(res.fallbackTriggered).toBe(false);
    expect(res.activeRadiusMiles).toBe(10);
    expect(res.exactMatchCount).toBe(3);
    expect(res.households).toHaveLength(3);
    expect(res.withinTwoMilesCount).toBe(2);
  });

  it("matches district-wide only when selected origin type is district, not distant talukas", () => {
    const districtRes = evaluateBlurredPreviewMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_DISTRICT,
    });
    expect(districtRes.scope).toBe("exact_hometown");
    expect(districtRes.exactMatchCount).toBe(3);

    // Viramgam (~38 mi from Ahmedabad City) should NOT claim Ahmedabad City pins as exact matches
    const viramgamRes = evaluateBlurredPreviewMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: VIRAMGAM_ORIGIN,
    });
    expect(viramgamRes.scope).toBe("all_gujarat_fallback");
    expect(viramgamRes.exactMatchCount).toBe(0);
    expect(viramgamRes.withinTwoMilesCount).toBe(2);
  });

  it("expands to All Gujarat (15 mi) when exact hometown matches < 3", () => {
    const res = evaluateBlurredPreviewMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: BHUJ_ORIGIN,
    });
    expect(res.scope).toBe("all_gujarat_fallback");
    expect(res.fallbackTriggered).toBe(true);
    expect(res.activeRadiusMiles).toBe(15);
    expect(res.exactMatchCount).toBe(1);
    expect(res.households).toHaveLength(4);
    expect(res.withinTwoMilesCount).toBe(2);
    expect(res.recommendedZoom).toBeLessThan(11.1);
  });

  it("returns 0 households gracefully when none fall within 15 miles", () => {
    const res = evaluateBlurredPreviewMatches({
      households: samplePins,
      neighborhoodCenter: NEW_BRAUNFELS,
      selectedOrigin: BHUJ_ORIGIN,
    });
    expect(res.scope).toBe("all_gujarat_fallback");
    expect(res.fallbackTriggered).toBe(true);
    expect(res.exactMatchCount).toBe(0);
    expect(res.withinTwoMilesCount).toBe(0);
    expect(res.households).toHaveLength(0);
  });
});
