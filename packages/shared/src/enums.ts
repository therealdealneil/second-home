import { z } from "zod";

// Mirrors the Postgres enums in docs/03_data_privacy_schema.md.
// Keep these in sync with supabase/migrations.
export const AGE_BRACKETS = ["20s", "30s", "40s", "50s", "60_plus"] as const;
export const LIFE_STAGES = [
  "solo_student",
  "couple",
  "family_young_kids",
  "family_teens",
  "empty_nester_senior",
] as const;
export const ACCOUNT_STATUSES = ["quarantined", "active", "paused", "suspended"] as const;
export const CONNECTION_STATUSES = ["pending", "accepted", "declined", "blocked"] as const;

export const AgeBracketSchema = z.enum(AGE_BRACKETS);
export const LifeStageSchema = z.enum(LIFE_STAGES);
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES);
export const ConnectionStatusSchema = z.enum(CONNECTION_STATUSES);

export type AgeBracket = z.infer<typeof AgeBracketSchema>;
export type LifeStage = z.infer<typeof LifeStageSchema>;
export type AccountStatus = z.infer<typeof AccountStatusSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

// Privacy / anti-abuse constants (docs/03, docs/04)
export const H3_RESOLUTION = 7;
export const MIN_HOUSEHOLDS_PER_HEX = 2;
export const MAX_CURRENT_RADIUS_METERS = 40_233; // 25 mi
export const MAX_HOMETOWN_RADIUS_METERS = 80_467; // 50 mi
export const ICEBREAKER_MAX_LENGTH = 140;

export const EntityIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "ID must be 1-64 alphanumeric, hyphen, or underscore characters");

export const ConnectionRecordSchema = z.object({
  status: ConnectionStatusSchema,
  icebreakerText: z.string().max(ICEBREAKER_MAX_LENGTH),
  updatedAt: z.string(),
});
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;

const E164_PHONE_SCHEMA = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, "Phone number must be in E.164 format (e.g. +12105550199)");

export const OtpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, "Verification code must be 6 digits");

export const ActivationStatusSchema = z.union([
  AccountStatusSchema,
  z.literal("pending_household"),
]);
export type ActivationStatus = z.infer<typeof ActivationStatusSchema>;

export const ActivateAccountResponseSchema = z.object({
  status: ActivationStatusSchema,
  phoneVerified: z.literal(true),
});
export type ActivateAccountResponse = z.infer<typeof ActivateAccountResponseSchema>;

export const UserStatusRowSchema = z.object({
  id: z.string().uuid(),
  status: AccountStatusSchema,
});
export type UserStatusRow = z.infer<typeof UserStatusRowSchema>;

/**
 * Normalizes a user-entered phone number into strict E.164 format.
 * 10-digit numbers without a leading `+` default to US (+1) for the San Antonio launch corridor.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }

  let candidate: string;
  if (trimmed.startsWith("+")) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+1${digits}`;
  } else {
    candidate = `+${digits}`;
  }

  const parsed = E164_PHONE_SCHEMA.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
