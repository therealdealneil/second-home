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
