import { z } from "zod";
import { IcebreakerSchema } from "./discovery";
import { AgeBracketSchema, LifeStageSchema, MAX_CURRENT_RADIUS_METERS } from "./enums";
import { InviteCodeSchema } from "./navigation";
import { haversineDistanceMeters, METERS_PER_MILE, type LatLng } from "./spatial";

export const AUTH_NONCE_TTL_SECONDS = 60;
export const IMPOSSIBLE_TRAVEL_MAX_MPH = 600;
export const PIN_UPDATE_LOCK_SECONDS = 86_400; // 24 hours
export const HOUSEHOLD_JOIN_MAX_DISTANCE_METERS = MAX_CURRENT_RADIUS_METERS; // 25 mi (40,233 m)
export const CONNECTION_RATE_LIMIT_WINDOW_SECONDS = 86_400; // 24 hours
export const CONNECTION_RATE_LIMIT_NEW_ACCOUNT = 10;
export const CONNECTION_RATE_LIMIT_VERIFIED_LOCAL = 25;
export const GPS_MIN_DECIMAL_PLACES = 4;
export const GPS_MAX_ACCURACY_METERS = 5_000;

export const AttestationPlatformSchema = z.enum(["ios", "android"]);
export type AttestationPlatform = z.infer<typeof AttestationPlatformSchema>;

export const AttestationPayloadSchema = z.object({
  platform: AttestationPlatformSchema,
  nonce: z.string().trim().min(16).max(128),
  token: z.string().trim().min(1).max(16_384),
  keyId: z.string().trim().min(1).max(256).optional(),
  payloadHash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "payloadHash must be a 64-character hex SHA-256 digest"),
});
export type AttestationPayload = z.infer<typeof AttestationPayloadSchema>;

export const GpsFixInputSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().positive().max(100_000).optional(),
  mocked: z.boolean().optional(),
});
export type GpsFixInput = z.infer<typeof GpsFixInputSchema>;

const HttpsAvatarUrlSchema = z
  .string()
  .trim()
  .url()
  .max(512)
  .refine((url) => url.startsWith("https://"), {
    message: "avatarUrl must use https://",
  });

export const CreateHouseholdRequestSchema = z.object({
  attestation: AttestationPayloadSchema,
  gps: GpsFixInputSchema,
  hometownLocationId: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(60),
  avatarUrl: HttpsAvatarUrlSchema.nullable().optional(),
  displayLabel: z.string().trim().min(1).max(80).nullable().optional(),
  ageBracket: AgeBracketSchema.nullable().optional(),
  lifeStage: LifeStageSchema.nullable().optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  whatsappAlertsOptIn: z.boolean().default(false),
});
export type CreateHouseholdRequest = z.infer<typeof CreateHouseholdRequestSchema>;

export const JoinHouseholdRequestSchema = z.object({
  attestation: AttestationPayloadSchema,
  gps: GpsFixInputSchema,
  inviteCode: InviteCodeSchema,
  hometownLocationId: z.string().trim().min(1).max(128),
  firstName: z.string().trim().min(1).max(60),
  avatarUrl: HttpsAvatarUrlSchema.nullable().optional(),
  ageBracket: AgeBracketSchema.nullable().optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
  whatsappAlertsOptIn: z.boolean().default(false),
});
export type JoinHouseholdRequest = z.infer<typeof JoinHouseholdRequestSchema>;

export const SendConnectionRequestSchema = z.object({
  attestation: AttestationPayloadSchema,
  recipientId: z.string().uuid(),
  icebreakerText: IcebreakerSchema,
});
export type SendConnectionRequest = z.infer<typeof SendConnectionRequestSchema>;

/**
 * Counts significant decimal places in a finite number (handles scientific notation).
 */
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

/**
 * Flags synthetic or coarse coordinates (< 4 decimal places) or missing/implausible
 * horizontal GPS accuracy metadata (docs/04 Layer 2).
 */
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

/**
 * Evaluates consecutive GPS pings for Impossible Travel (> 600 mph) per docs/04 Layer 2.
 */
export function evaluateImpossibleTravel(
  previous: { lat: number; lng: number; timestampMs: number },
  current: { lat: number; lng: number; timestampMs: number },
): {
  impossible: boolean;
  speedMph: number;
  distanceMiles: number;
  elapsedSeconds: number;
} {
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

/**
 * Enforces the 25-mile proximity check when joining an existing household via invite_code.
 */
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

/**
 * Outbound connection request rate limit per 24h window (docs/04 Layer 3).
 */
export function getOutboundConnectionLimit(params: { isVerifiedLocal: boolean }): number {
  return params.isVerifiedLocal
    ? CONNECTION_RATE_LIMIT_VERIFIED_LOCAL
    : CONNECTION_RATE_LIMIT_NEW_ACCOUNT;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      sorted[key] = canonicalizeValue(entry);
    }
  }
  return sorted;
}

/**
 * Produces a deterministic JSON representation with sorted object keys so mobile
 * clients and Edge Functions compute identical SHA-256 payload hashes.
 */
export function canonicalizeAttestationPayload(payload: unknown): string {
  return JSON.stringify(canonicalizeValue(payload));
}
