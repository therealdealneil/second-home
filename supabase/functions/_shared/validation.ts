import { z } from "zod";

export const AUTH_NONCE_TTL_SECONDS = 60;
export const PIN_UPDATE_LOCK_SECONDS = 86_400;
export const CONNECTION_RATE_LIMIT_WINDOW_SECONDS = 86_400;
export const CONNECTION_RATE_LIMIT_NEW_ACCOUNT = 10;
export const CONNECTION_RATE_LIMIT_VERIFIED_LOCAL = 25;

export const AGE_BRACKETS = ["20s", "30s", "40s", "50s", "60_plus"] as const;
export const LIFE_STAGES = [
  "solo_student",
  "couple",
  "family_young_kids",
  "family_teens",
  "empty_nester_senior",
] as const;

export const AgeBracketSchema = z.enum(AGE_BRACKETS);
export const LifeStageSchema = z.enum(LIFE_STAGES);

export const InviteCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_-]{6,32}$/,
    "Invite code must be 6-32 alphanumeric, hyphen, or underscore characters",
  );

export const PhoneE164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, "Phone number must be valid E.164 format");

export const ICEBREAKER_MAX_LENGTH = 140;
export const ICEBREAKER_URL_REGEX = /(https?:\/\/|(^|[^a-z0-9])(wa|t)\.me)/i;
export const ICEBREAKER_PHONE_REGEX = /(\+?[0-9][ ().-]{0,2}){10,}/;

export const IcebreakerSchema = z
  .string()
  .trim()
  .min(1, "Write or pick a short greeting first.")
  .max(ICEBREAKER_MAX_LENGTH, `Keep greetings under ${ICEBREAKER_MAX_LENGTH} characters.`)
  .refine((text) => !ICEBREAKER_URL_REGEX.test(text), {
    message: "Links (http, wa.me, t.me) are blocked before mutual acceptance.",
  })
  .refine((text) => !ICEBREAKER_PHONE_REGEX.test(text), {
    message: "Phone numbers are blocked before mutual acceptance.",
  });

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

export function canonicalizeAttestationPayload(payload: unknown): string {
  return JSON.stringify(canonicalizeValue(payload));
}
