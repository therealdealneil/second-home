import { z } from "zod";
import {
  MAX_CURRENT_RADIUS_METERS,
  MAX_HOMETOWN_RADIUS_METERS,
  type AgeBracket,
  type LifeStage,
} from "./enums";
import type { GujaratDistrict, GujaratLocation } from "./locations";
import {
  DYNAMIC_ZOOM_MIN_MATCHES,
  FUZZ_RADIUS_MAX_MILES,
  FUZZ_RADIUS_MIN_MILES,
  SAN_ANTONIO_DEFAULT_CENTER,
  type ConfirmedNeighborhood,
} from "./navigation";

export const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6_371_000;

export const EXACT_HOMETOWN_RADIUS_METERS = Math.min(24_140, MAX_HOMETOWN_RADIUS_METERS); // 15 mi
export const PREVIEW_EXACT_CURRENT_RADIUS_MILES = 10;
export const PREVIEW_FALLBACK_CURRENT_RADIUS_MILES = 15;
export const PREVIEW_NEARBY_HIGHLIGHT_MILES = 2;
export const PRIVACY_RING_DISPLAY_RADIUS_MILES = 1.0;
export const MAX_NEIGHBORHOOD_DRAG_ADJUST_MILES = 2.0;
export const MAX_MATCH_RESULTS = 100;

export const LatLngSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export type PublicHouseholdMember = {
  userId: string;
  firstName: string;
  avatarUrl: string | null;
  ageBracket: AgeBracket | null;
  hometownName: string;
  hometownDistrict: GujaratDistrict;
  hometownLat: number;
  hometownLng: number;
  vouchCount: number;
  interests: readonly string[];
};

export type PublicHouseholdPin = {
  householdId: string;
  displayLabel: string;
  lifeStage: LifeStage;
  neighborhoodName: string;
  isVerifiedLocal: boolean;
  publicLng: number;
  publicLat: number;
  members: readonly PublicHouseholdMember[];
};

export type MatchedHouseholdPin = PublicHouseholdPin & {
  distanceMeters: number;
  distanceMiles: number;
  matchesExactHometown: boolean;
};

export type BlurredPreviewScope = "exact_hometown" | "all_gujarat_fallback";

export type BlurredPreviewResult = {
  scope: BlurredPreviewScope;
  fallbackTriggered: boolean;
  activeRadiusMiles: number;
  recommendedZoom: number;
  households: MatchedHouseholdPin[];
  exactMatchCount: number;
  withinTwoMilesCount: number;
};

export type GeoJsonPolygonFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: {
    type: "Polygon";
    coordinates: [Array<[number, number]>];
  };
};

/**
 * Greater San Antonio metro bounding polygon ([lng, lat] closed ring).
 * Covers Bexar County and immediate commuter corridors (Boerne, Schertz/Cibolo,
 * New Braunfels, Alamo Ranch, Helotes) while excluding Austin/Houston/DFW/overseas.
 */
export const SAN_ANTONIO_METRO_POLYGON: readonly (readonly [number, number])[] = [
  [-98.82, 29.86],
  [-98.48, 29.84],
  [-98.02, 29.78],
  [-98.04, 29.52],
  [-98.12, 29.36],
  [-98.35, 29.18],
  [-98.78, 29.22],
  [-98.88, 29.52],
  [-98.82, 29.86],
] as const;

export const SAN_ANTONIO_NEIGHBORHOODS: readonly {
  name: string;
  lat: number;
  lng: number;
}[] = [
  { name: "Medical Center", lat: 29.5124, lng: -98.5742 },
  { name: "Stone Oak", lat: 29.6472, lng: -98.4864 },
  { name: "Northwest San Antonio", lat: 29.5562, lng: -98.6684 },
  { name: "Alamo Ranch", lat: 29.4928, lng: -98.7115 },
  { name: "Leon Valley", lat: 29.4955, lng: -98.6186 },
  { name: "Downtown / Pearl", lat: 29.4428, lng: -98.4796 },
  { name: "Boerne", lat: 29.7947, lng: -98.732 },
  { name: "Schertz / Cibolo", lat: 29.5522, lng: -98.2697 },
  { name: "New Braunfels", lat: 29.703, lng: -98.1245 },
] as const;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng - a.lng);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingRadians(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

export function offsetCoordinate(
  origin: LatLng,
  distanceMeters: number,
  bearingRad: number,
): LatLng {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lng: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

/**
 * Ray-casting point-in-polygon check against the Greater San Antonio Metro Polygon.
 */
export function isPointInGreaterSanAntonio(point: LatLng): boolean {
  if (!LatLngSchema.safeParse(point).success) {
    return false;
  }

  let inside = false;
  const ring = SAN_ANTONIO_METRO_POLYGON;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const vi = ring[i];
    const vj = ring[j];
    if (!vi || !vj) {
      continue;
    }
    const xi = vi[0];
    const yi = vi[1];
    const xj = vj[0];
    const yj = vj[1];

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function inferSanAntonioNeighborhood(point: LatLng): string {
  let closestName = "Greater San Antonio";
  let closestMeters = Infinity;

  for (const area of SAN_ANTONIO_NEIGHBORHOODS) {
    const dist = haversineDistanceMeters(point, { lat: area.lat, lng: area.lng });
    if (dist < closestMeters) {
      closestMeters = dist;
      closestName = area.name;
    }
  }

  return closestMeters <= 8 * METERS_PER_MILE ? closestName : "Greater San Antonio";
}

/**
 * Generates a one-time static privacy offset (0.5–1.5 mi) around a captured GPS fix.
 * Never recomputed on read so pins stay stationary inside their privacy ring.
 */
export function computeStaticFuzzedPoint(
  rawPoint: LatLng,
  rng: () => number = Math.random,
): { fuzzedCenter: LatLng; offsetMiles: number } {
  const rawInsideMetro = isPointInGreaterSanAntonio(rawPoint);

  for (let attempt = 0; attempt < 8; attempt++) {
    const distanceRand = Math.max(0, Math.min(1, rng()));
    const angleRand = Math.max(0, Math.min(1, rng()));
    const offsetMiles =
      FUZZ_RADIUS_MIN_MILES + distanceRand * (FUZZ_RADIUS_MAX_MILES - FUZZ_RADIUS_MIN_MILES);
    const bearing = angleRand * 2 * Math.PI;
    const candidate = offsetCoordinate(rawPoint, offsetMiles * METERS_PER_MILE, bearing);

    if (!rawInsideMetro || isPointInGreaterSanAntonio(candidate)) {
      return { fuzzedCenter: candidate, offsetMiles };
    }
  }

  const fallbackMiles =
    FUZZ_RADIUS_MIN_MILES +
    Math.max(0, Math.min(1, rng())) * (FUZZ_RADIUS_MAX_MILES - FUZZ_RADIUS_MIN_MILES);
  const inwardBearing = bearingRadians(rawPoint, SAN_ANTONIO_DEFAULT_CENTER);
  return {
    fuzzedCenter: offsetCoordinate(rawPoint, fallbackMiles * METERS_PER_MILE, inwardBearing),
    offsetMiles: fallbackMiles,
  };
}

/**
 * Clamps manual map pan adjustment during Pin 1 confirmation to a local radius
 * around the snapped privacy anchor and keeps it inside Greater San Antonio.
 */
export function clampLocalAdjustment(
  anchor: LatLng,
  candidate: LatLng,
  maxMiles: number = MAX_NEIGHBORHOOD_DRAG_ADJUST_MILES,
): LatLng {
  if (!LatLngSchema.safeParse(candidate).success) {
    return anchor;
  }

  const maxMeters = Math.max(0, maxMiles) * METERS_PER_MILE;
  const dist = haversineDistanceMeters(anchor, candidate);
  const bounded =
    dist <= maxMeters
      ? candidate
      : offsetCoordinate(anchor, maxMeters, bearingRadians(anchor, candidate));

  return isPointInGreaterSanAntonio(bounded) ? bounded : anchor;
}

/**
 * Builds a closed GeoJSON Polygon circle around `center` for Mapbox ShapeSource layers.
 */
export function createCirclePolygonGeoJSON(
  center: LatLng,
  radiusMiles: number,
  steps = 64,
): GeoJsonPolygonFeature {
  const safeSteps = Math.max(12, Math.min(128, Math.round(steps)));
  const radiusMeters = Math.max(0.05, radiusMiles) * METERS_PER_MILE;
  const ring: Array<[number, number]> = [];

  for (let i = 0; i < safeSteps; i++) {
    const angle = (i / safeSteps) * 2 * Math.PI;
    const vertex = offsetCoordinate(center, radiusMeters, angle);
    ring.push([vertex.lng, vertex.lat]);
  }
  if (ring[0]) {
    ring.push(ring[0]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

export type GpsCaptureInput = {
  lat: number;
  lng: number;
  mocked?: boolean;
};

export type GpsCaptureValidationResult =
  | {
      ok: true;
      neighborhood: ConfirmedNeighborhood;
      offsetMiles: number;
    }
  | {
      ok: false;
      reason: "invalid_coords" | "mock_gps" | "outside_san_antonio";
    };

/**
 * Validates a hardware GPS fix against anti-spoofing and San Antonio corridor rules,
 * immediately returning a static fuzzed neighborhood without exposing raw coordinates.
 */
export function validateCapturedGpsFix(
  input: GpsCaptureInput,
  rng: () => number = Math.random,
): GpsCaptureValidationResult {
  const parsed = LatLngSchema.safeParse({ lat: input.lat, lng: input.lng });
  if (!parsed.success) {
    return { ok: false, reason: "invalid_coords" };
  }

  if (input.mocked === true) {
    return { ok: false, reason: "mock_gps" };
  }

  if (!isPointInGreaterSanAntonio(parsed.data)) {
    return { ok: false, reason: "outside_san_antonio" };
  }

  const { fuzzedCenter, offsetMiles } = computeStaticFuzzedPoint(parsed.data, rng);
  return {
    ok: true,
    neighborhood: {
      label: inferSanAntonioNeighborhood(fuzzedCenter),
      fuzzedCenter,
    },
    offsetMiles,
  };
}

function householdMatchesOrigin(
  household: PublicHouseholdPin,
  selectedOrigin: GujaratLocation,
): boolean {
  const originCoord: LatLng = { lat: selectedOrigin.lat, lng: selectedOrigin.lng };
  return household.members.some(
    (member) =>
      (selectedOrigin.type === "district" && member.hometownDistrict === selectedOrigin.district) ||
      haversineDistanceMeters({ lat: member.hometownLat, lng: member.hometownLng }, originCoord) <=
        EXACT_HOMETOWN_RADIUS_METERS,
  );
}

/**
 * Computes blurred match preview pins with Dynamic Zoom Fallback (F-12):
 * starts at exact hometown within 10 miles; if fewer than 3 matches exist,
 * expands to All of Gujarat within 15 miles.
 */
export function evaluateBlurredPreviewMatches(params: {
  households: readonly PublicHouseholdPin[];
  neighborhoodCenter: LatLng;
  selectedOrigin: GujaratLocation;
}): BlurredPreviewResult {
  const { households, neighborhoodCenter, selectedOrigin } = params;
  const exactRadiusMeters = Math.min(
    PREVIEW_EXACT_CURRENT_RADIUS_MILES * METERS_PER_MILE,
    MAX_CURRENT_RADIUS_METERS,
  );
  const fallbackRadiusMeters = Math.min(
    PREVIEW_FALLBACK_CURRENT_RADIUS_MILES * METERS_PER_MILE,
    MAX_CURRENT_RADIUS_METERS,
  );

  const enriched: MatchedHouseholdPin[] = households
    .map((household) => {
      const distanceMeters = haversineDistanceMeters(neighborhoodCenter, {
        lat: household.publicLat,
        lng: household.publicLng,
      });
      return {
        ...household,
        distanceMeters,
        distanceMiles: distanceMeters / METERS_PER_MILE,
        matchesExactHometown: householdMatchesOrigin(household, selectedOrigin),
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const exactMatches = enriched
    .filter((item) => item.matchesExactHometown && item.distanceMeters <= exactRadiusMeters)
    .slice(0, MAX_MATCH_RESULTS);

  if (exactMatches.length >= DYNAMIC_ZOOM_MIN_MATCHES) {
    return {
      scope: "exact_hometown",
      fallbackTriggered: false,
      activeRadiusMiles: PREVIEW_EXACT_CURRENT_RADIUS_MILES,
      recommendedZoom: 11.1,
      households: exactMatches,
      exactMatchCount: exactMatches.length,
      withinTwoMilesCount: exactMatches.filter(
        (item) => item.distanceMiles <= PREVIEW_NEARBY_HIGHLIGHT_MILES,
      ).length,
    };
  }

  const fallbackMatches = enriched
    .filter((item) => item.distanceMeters <= fallbackRadiusMeters)
    .slice(0, MAX_MATCH_RESULTS);

  return {
    scope: "all_gujarat_fallback",
    fallbackTriggered: true,
    activeRadiusMiles: PREVIEW_FALLBACK_CURRENT_RADIUS_MILES,
    recommendedZoom: 10.3,
    households: fallbackMatches,
    exactMatchCount: exactMatches.length,
    withinTwoMilesCount: fallbackMatches.filter(
      (item) => item.distanceMiles <= PREVIEW_NEARBY_HIGHLIGHT_MILES,
    ).length,
  };
}
