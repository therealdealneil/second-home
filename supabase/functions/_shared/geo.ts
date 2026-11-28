export type LatLng = {
  lat: number;
  lng: number;
};

export const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6_371_000;
export const FUZZ_RADIUS_MIN_MILES = 0.5;
export const FUZZ_RADIUS_MAX_MILES = 1.5;
export const HOUSEHOLD_JOIN_MAX_DISTANCE_METERS = 40_233; // 25 mi
export const IMPOSSIBLE_TRAVEL_MAX_MPH = 600;
export const GPS_MIN_DECIMAL_PLACES = 4;
export const GPS_MAX_ACCURACY_METERS = 5_000;

export const SAN_ANTONIO_DEFAULT_CENTER: LatLng = {
  lat: 29.5124,
  lng: -98.5742,
};

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

export function isPointInGreaterSanAntonio(point: LatLng): boolean {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
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
    const [xi, yi] = vi;
    const [xj, yj] = vj;
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

export function cryptoRandomUnit(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 0x1_0000_0000;
}

export function computeStaticFuzzedPoint(
  rawPoint: LatLng,
  rng: () => number = cryptoRandomUnit,
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

export function countDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const str = value.toString().toLowerCase();
  const expParts = str.split("e");
  const mantissa = expParts[0] ?? str;
  const exponent = expParts[1] ? Number.parseInt(expParts[1], 10) : 0;
  const dotIndex = mantissa.indexOf(".");
  const fracDigits = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
  return Math.max(0, fracDigits - exponent);
}

export function detectCoordinatePrecisionAnomaly(gps: {
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
}): { anomalous: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) {
    reasons.push("non_finite_coordinates");
    return { anomalous: true, reasons };
  }

  if (countDecimalPlaces(gps.lat) < GPS_MIN_DECIMAL_PLACES) {
    reasons.push("low_lat_precision");
  }
  if (countDecimalPlaces(gps.lng) < GPS_MIN_DECIMAL_PLACES) {
    reasons.push("low_lng_precision");
  }

  if (
    gps.accuracyMeters === undefined ||
    gps.accuracyMeters === null ||
    !Number.isFinite(gps.accuracyMeters) ||
    gps.accuracyMeters <= 0 ||
    gps.accuracyMeters > GPS_MAX_ACCURACY_METERS
  ) {
    reasons.push("invalid_or_missing_accuracy");
  }

  return {
    anomalous: reasons.length > 0,
    reasons,
  };
}

export function evaluateImpossibleTravel(
  previous: { lat: number; lng: number; timestampMs: number },
  current: { lat: number; lng: number; timestampMs: number },
): { impossible: boolean; speedMph: number; distanceMiles: number; elapsedSeconds: number } {
  const distanceMeters = haversineDistanceMeters(
    { lat: previous.lat, lng: previous.lng },
    { lat: current.lat, lng: current.lng },
  );
  const distanceMiles = distanceMeters / METERS_PER_MILE;
  const elapsedSeconds = (current.timestampMs - previous.timestampMs) / 1000;

  if (elapsedSeconds <= 0) {
    const impossible = distanceMiles > 1;
    return {
      impossible,
      speedMph: impossible ? Infinity : 0,
      distanceMiles,
      elapsedSeconds,
    };
  }

  const speedMph = (distanceMiles / elapsedSeconds) * 3600;
  return {
    impossible: speedMph > IMPOSSIBLE_TRAVEL_MAX_MPH,
    speedMph,
    distanceMiles,
    elapsedSeconds,
  };
}

export function isWithinHouseholdJoinProximity(
  joiner: LatLng,
  householdExact: LatLng,
): { withinProximity: boolean; distanceMeters: number } {
  const distanceMeters = haversineDistanceMeters(joiner, householdExact);
  return {
    withinProximity: distanceMeters <= HOUSEHOLD_JOIN_MAX_DISTANCE_METERS,
    distanceMeters,
  };
}

export function formatWktPoint(point: LatLng): string {
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Decodes a PostGIS point returned via PostgREST (EWKB hex, WKT, or GeoJSON).
 */
export function parsePostgisPoint(raw: unknown): LatLng | null {
  if (!raw) {
    return null;
  }

  if (typeof raw === "object") {
    const obj = raw as { type?: unknown; coordinates?: unknown };
    if (
      obj.type === "Point" &&
      Array.isArray(obj.coordinates) &&
      typeof obj.coordinates[0] === "number" &&
      typeof obj.coordinates[1] === "number"
    ) {
      return { lng: obj.coordinates[0], lat: obj.coordinates[1] };
    }
    return null;
  }

  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  const wktMatch =
    /^(?:SRID=\d+;)?POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i.exec(trimmed);
  if (wktMatch?.[1] && wktMatch[2]) {
    const lng = Number.parseFloat(wktMatch[1]);
    const lat = Number.parseFloat(wktMatch[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  const bytes = hexToBytes(trimmed);
  if (!bytes || bytes.length < 21) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[0] === 1;
  const typeWithFlags = view.getUint32(1, littleEndian);
  const baseType = typeWithFlags & 0x00ff_ffff;
  const hasSrid = (typeWithFlags & 0x2000_0000) !== 0;
  if (baseType !== 1) {
    return null;
  }

  const offset = hasSrid ? 9 : 5;
  if (bytes.length < offset + 16) {
    return null;
  }
  const lng = view.getFloat64(offset, littleEndian);
  const lat = view.getFloat64(offset + 8, littleEndian);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}
