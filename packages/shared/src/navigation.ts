import { z } from "zod";
import {
  AgeBracketSchema,
  ConnectionRecordSchema,
  EntityIdSchema,
  LifeStageSchema,
  type AgeBracket,
  type LifeStage,
} from "./enums";
import { getGujaratLocationById, type GujaratLocation } from "./locations";

export const DEFAULT_APP_ORIGIN = "https://secondhome.app";
export const APP_URL_SCHEME = "secondhome";

export const SAN_ANTONIO_DEFAULT_CENTER = {
  lat: 29.5124,
  lng: -98.5742,
} as const;
export const SAN_ANTONIO_DEFAULT_ZOOM = 10.5;

export const GUJARAT_DEFAULT_CENTER = {
  lat: 22.45,
  lng: 71.75,
} as const;
export const GUJARAT_ALL_ZOOM = 6.5;
export const GUJARAT_DISTRICT_ZOOM = 9.0;
export const GUJARAT_TOWN_ZOOM = 10.8;

export const MAP_REGIONS = ["san_antonio", "gujarat"] as const;
export const MapRegionSchema = z.enum(MAP_REGIONS);
export type MapRegion = z.infer<typeof MapRegionSchema>;

export const FUZZ_RADIUS_MIN_MILES = 0.5;
export const FUZZ_RADIUS_MAX_MILES = 1.5;
export const DYNAMIC_ZOOM_MIN_MATCHES = 3;

export const DISCOVERY_RADIUS_OPTIONS_MILES = [2, 5, 10, 25] as const;
export type DiscoveryRadiusMiles = (typeof DISCOVERY_RADIUS_OPTIONS_MILES)[number];

export const ORIGIN_MATCH_MODES = ["exact_town", "all_gujarat"] as const;
export const OriginMatchModeSchema = z.enum(ORIGIN_MATCH_MODES);
export type OriginMatchMode = z.infer<typeof OriginMatchModeSchema>;

export const ONBOARDING_INTERESTS = [
  "Cricket",
  "Garba / Cultural Events",
  "Food & Chai",
  "Tech / Healthcare",
  "Parenting",
] as const;
export const OnboardingInterestSchema = z.enum(ONBOARDING_INTERESTS);
export type OnboardingInterest = z.infer<typeof OnboardingInterestSchema>;

export const APP_FLOW_PHASES = [
  "confirm_neighborhood",
  "select_hometown",
  "blurred_preview",
  "personalize",
  "discovery",
] as const;
export const AppFlowPhaseSchema = z.enum(APP_FLOW_PHASES);
export type AppFlowPhase = z.infer<typeof AppFlowPhaseSchema>;

export const DiscoveryRadiusMilesSchema = z.union([
  z.literal(2),
  z.literal(5),
  z.literal(10),
  z.literal(25),
]);

export const DiscoveryFiltersSchema = z.object({
  originMode: OriginMatchModeSchema.default("exact_town"),
  radiusMiles: DiscoveryRadiusMilesSchema.default(10),
  ageBrackets: z.array(AgeBracketSchema).default([]),
  lifeStages: z.array(LifeStageSchema).default([]),
});

export type DiscoveryFilters = {
  originMode: OriginMatchMode;
  radiusMiles: DiscoveryRadiusMiles;
  ageBrackets: AgeBracket[];
  lifeStages: LifeStage[];
};

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  originMode: "exact_town",
  radiusMiles: 10,
  ageBrackets: [],
  lifeStages: [],
};

export const InviteCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_-]{6,32}$/,
    "Invite code must be 6-32 alphanumeric, hyphen, or underscore characters",
  );

export const HouseholdIdSchema = EntityIdSchema;

/**
 * Only non-sensitive fuzzed display neighborhood metadata may be stored in client state.
 */
export const ConfirmedNeighborhoodSchema = z.object({
  label: z.string().trim().min(1).max(80),
  fuzzedCenter: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});
export type ConfirmedNeighborhood = z.infer<typeof ConfirmedNeighborhoodSchema>;

export const PersonalizationDraftSchema = z.object({
  ageBracket: AgeBracketSchema.nullable(),
  lifeStage: LifeStageSchema.nullable(),
  interests: z
    .array(OnboardingInterestSchema)
    .max(3)
    .refine((items) => new Set(items).size === items.length, {
      message: "Interests must be unique",
    }),
});
export type PersonalizationDraft = z.infer<typeof PersonalizationDraftSchema>;

export const PersistedFlowSnapshotSchema = z.object({
  phase: AppFlowPhaseSchema,
  confirmedNeighborhood: ConfirmedNeighborhoodSchema.nullable(),
  selectedOriginId: z.string().nullable(),
  pendingInviteCode: InviteCodeSchema.nullable(),
  isAuthenticated: z.boolean(),
  hasCompletedPersonalization: z.boolean(),
  personalization: PersonalizationDraftSchema,
  filters: DiscoveryFiltersSchema,
  isGhostMode: z.boolean().default(false),
  blockedHouseholdIds: z.array(HouseholdIdSchema).default([]),
  vouchedUserIds: z.array(EntityIdSchema).default([]),
  reportedUserIds: z.array(EntityIdSchema).default([]),
  connectionsByUserId: z.record(EntityIdSchema, ConnectionRecordSchema).optional(),
});
export type PersistedFlowSnapshot = z.infer<typeof PersistedFlowSnapshotSchema>;

const OriginIdParamSchema = z.string().trim().min(1).max(128);
const BaseOriginUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => url.startsWith("https://") || url.startsWith("http://"), {
    message: "Base URL must use http:// or https://",
  })
  .refine((url) => !url.includes("?") && !url.includes("#"), {
    message: "Base URL must not include query strings or fragments",
  });

function extractFirstParam(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    return raw[0];
  }
  return null;
}

/**
 * Validates an incoming `?origin_id=` deep-link parameter against the bundled Gujarat gazetteer.
 */
export function parseOriginDeepLinkParam(raw: unknown): GujaratLocation | null {
  const candidate = extractFirstParam(raw);
  if (candidate === null) {
    return null;
  }
  const parsed = OriginIdParamSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }
  return getGujaratLocationById(parsed.data) ?? null;
}

/**
 * Validates an incoming `/join-household?code=` invite parameter.
 */
export function parseInviteCodeParam(raw: unknown): string | null {
  const candidate = extractFirstParam(raw);
  if (candidate === null) {
    return null;
  }
  const parsed = InviteCodeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Validates a `/household/[id]` route parameter.
 */
export function parseHouseholdIdParam(raw: unknown): string | null {
  const candidate = extractFirstParam(raw);
  if (candidate === null) {
    return null;
  }
  const parsed = HouseholdIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function normalizeBaseOrigin(baseUrl: string): string {
  return BaseOriginUrlSchema.parse(baseUrl).replace(/\/+$/, "");
}

/**
 * Builds the canonical Universal Link URL for Flow A QR / mobile web handoff.
 */
export function buildOriginDeepLinkUrl(
  originId: string,
  baseUrl: string = DEFAULT_APP_ORIGIN,
): string {
  const location = getGujaratLocationById(originId.trim());
  if (!location) {
    throw new Error(`Unknown Gujarat location id: ${originId}`);
  }
  return `${normalizeBaseOrigin(baseUrl)}/?origin_id=${encodeURIComponent(location.id)}`;
}

/**
 * Builds the canonical Universal Link URL for Flow B spouse/family household invites.
 */
export function buildHouseholdInviteUrl(
  inviteCode: string,
  baseUrl: string = DEFAULT_APP_ORIGIN,
): string {
  const parsedCode = InviteCodeSchema.parse(inviteCode);
  return `${normalizeBaseOrigin(baseUrl)}/join-household?code=${encodeURIComponent(parsedCode)}`;
}
