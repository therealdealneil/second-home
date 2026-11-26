import { z } from "zod";
import {
  ICEBREAKER_MAX_LENGTH,
  MAX_CURRENT_RADIUS_METERS,
  type AgeBracket,
  type LifeStage,
} from "./enums";
import type { GujaratLocation } from "./locations";
import { buildHouseholdInviteUrl, type DiscoveryFilters } from "./navigation";
import {
  MAX_MATCH_RESULTS,
  METERS_PER_MILE,
  haversineDistanceMeters,
  memberMatchesOrigin,
  type LatLng,
  type MatchedHouseholdPin,
  type PublicHouseholdPin,
} from "./spatial";

export const AGE_BRACKET_LABELS: Record<AgeBracket, string> = {
  "20s": "20s",
  "30s": "30s",
  "40s": "40s",
  "50s": "50s",
  "60_plus": "60+",
};

export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  solo_student: "Solo",
  couple: "Couple",
  family_young_kids: "Young Kids",
  family_teens: "Teens",
  empty_nester_senior: "Seniors",
};

export const REPORT_REASON_OPTIONS = [
  { code: "fake_location", label: "Suspicious / fake location" },
  { code: "spam", label: "Spam or unsolicited links" },
  { code: "harassment", label: "Inappropriate behavior" },
  { code: "impersonation", label: "Impersonation / fake profile" },
] as const;

export const ReportReasonCodeSchema = z.enum([
  "fake_location",
  "spam",
  "harassment",
  "impersonation",
]);
export type ReportReasonCode = z.infer<typeof ReportReasonCodeSchema>;

// Mirrors supabase/migrations/20261122171805_initial_schema.sql & 20261122171843_fix_icebreaker_phone_check.sql
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

export function validateIcebreaker(
  raw: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = IcebreakerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid greeting message.",
    };
  }
  return { ok: true, text: parsed.data };
}

function clampPresetText(candidate: string): string {
  const trimmed = candidate.trim();
  if (trimmed.length <= ICEBREAKER_MAX_LENGTH) {
    return trimmed;
  }
  let out = "";
  for (const ch of trimmed) {
    if (out.length + ch.length > ICEBREAKER_MAX_LENGTH - 1) {
      break;
    }
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Generates 3 1-tap Gujarati/English icebreakers guaranteed to satisfy the 140-char
 * and anti-link/phone guardrails.
 */
export function buildIcebreakerPresets(params: {
  firstName: string;
  hometownName: string;
  neighborhoodName: string;
  sharedInterests: readonly string[];
}): string[] {
  const cityLabel = params.hometownName.split(",")[0]?.trim() || params.hometownName;
  const firstInterest = params.sharedInterests[0];

  const candidates = [
    `Kem cho ${params.firstName}! Saw you're from ${cityLabel} and near ${params.neighborhoodName} — would love to connect!`,
    firstInterest
      ? `Namaste ${params.firstName}! Fellow Gujarati near ${params.neighborhoodName} into ${firstInterest} — let's say hello!`
      : `Namaste ${params.firstName}! We live near ${params.neighborhoodName} and would love to meet neighbors from Gujarat.`,
    `Hi ${params.firstName}! Always great finding families from ${cityLabel} here in San Antonio. Would love to connect!`,
  ];

  return candidates
    .map((line) => clampPresetText(line))
    .filter((line) => validateIcebreaker(line).ok);
}

export const PhoneE164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, "Phone number must be valid E.164 format");

/**
 * Builds the `wa.me` handoff deep link matching `get_whatsapp_handoff_link` in SQL.
 */
export function buildWhatsappHandoffUrl(params: {
  phoneE164: string;
  recipientFirstName: string;
  hometownDistrict: string;
}): string {
  const validPhone = PhoneE164Schema.parse(params.phoneE164);
  const digits = validPhone.slice(1);
  const safeName = params.recipientFirstName.trim() || "neighbor";
  const safeDistrict = params.hometownDistrict.trim() || "Gujarat";
  const greeting = `Kem cho ${safeName}! Connected via our ${safeDistrict} neighborhood map in San Antonio.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(greeting)}`;
}

/**
 * Builds the 1-tap WhatsApp share link for Flow B Step 5 ("Add Spouse / Family in Your Home").
 */
export function buildHouseholdInviteWhatsappUrl(inviteCode: string, baseUrl?: string): string {
  const inviteUrl = buildHouseholdInviteUrl(inviteCode, baseUrl);
  const text = `Join our household pin on Second Home so neighbors from both our Gujarat hometowns can find us in San Antonio: ${inviteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Client-side mirror of `find_matching_households` (including Step 2 EXISTS multi-origin
 * semantics, Guardrail #7 clamps, and blocked-household exclusion).
 */
export function evaluateDiscoveryMatches(params: {
  households: readonly PublicHouseholdPin[];
  neighborhoodCenter: LatLng;
  selectedOrigin: GujaratLocation | null;
  filters: DiscoveryFilters;
  blockedHouseholdIds?: ReadonlySet<string>;
}): MatchedHouseholdPin[] {
  const { households, neighborhoodCenter, selectedOrigin, filters, blockedHouseholdIds } = params;
  const clampedRadiusMeters = Math.min(
    Math.max(0, filters.radiusMiles * METERS_PER_MILE),
    MAX_CURRENT_RADIUS_METERS,
  );

  const matched: MatchedHouseholdPin[] = [];

  for (const household of households) {
    if (blockedHouseholdIds?.has(household.householdId)) {
      continue;
    }

    if (filters.lifeStages.length > 0 && !filters.lifeStages.includes(household.lifeStage)) {
      continue;
    }

    const distanceMeters = haversineDistanceMeters(neighborhoodCenter, {
      lat: household.publicLat,
      lng: household.publicLng,
    });
    if (distanceMeters > clampedRadiusMeters) {
      continue;
    }

    const matchesExactHometown =
      selectedOrigin !== null &&
      household.members.some((member) => memberMatchesOrigin(member, selectedOrigin));

    // EXISTS semantics: if any member satisfies both origin mode and age filter,
    // keep the household and preserve ALL linked members.
    const hasQualifyingMember = household.members.some((member) => {
      const originOk =
        filters.originMode === "all_gujarat" ||
        selectedOrigin === null ||
        memberMatchesOrigin(member, selectedOrigin);
      const ageOk =
        filters.ageBrackets.length === 0 ||
        (member.ageBracket !== null && filters.ageBrackets.includes(member.ageBracket));
      return originOk && ageOk;
    });

    if (!hasQualifyingMember) {
      continue;
    }

    matched.push({
      ...household,
      distanceMeters,
      distanceMiles: distanceMeters / METERS_PER_MILE,
      matchesExactHometown,
    });
  }

  matched.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return matched.slice(0, MAX_MATCH_RESULTS);
}

export const WAITLIST_TARGET_METROS = [
  "Austin, TX",
  "Dallas-Fort Worth, TX",
  "Houston, TX",
  "Other",
] as const;
export const WaitlistMetroSchema = z.enum(WAITLIST_TARGET_METROS);
export type WaitlistMetro = z.infer<typeof WaitlistMetroSchema>;

const WaitlistEmailSchema = z.string().email();

function isValidWaitlistContact(value: string): boolean {
  if (WaitlistEmailSchema.safeParse(value).success) {
    return true;
  }
  const digits = value.replace(/\D/g, "");
  return /^[0-9+\-().\s]+$/.test(value) && digits.length >= 10 && digits.length <= 15;
}

export const WaitlistSubmissionSchema = z
  .object({
    metro: WaitlistMetroSchema,
    customCity: z.string().trim().max(80).optional(),
    contact: z
      .string()
      .trim()
      .min(1, "Enter an email address or 10-15 digit phone number.")
      .max(120, "Contact info is too long.")
      .refine(isValidWaitlistContact, {
        message: "Enter a valid email address or 10-15 digit phone number.",
      }),
  })
  .superRefine((data, ctx) => {
    if (data.metro === "Other" && (!data.customCity || data.customCity.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customCity"],
        message: "Enter your city name.",
      });
    }
  });
export type WaitlistSubmission = z.infer<typeof WaitlistSubmissionSchema>;

export function validateWaitlistSubmission(
  raw: unknown,
):
  { ok: true; data: WaitlistSubmission & { resolvedCity: string } } | { ok: false; error: string } {
  const parsed = WaitlistSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check your waitlist details.",
    };
  }
  const resolvedCity =
    parsed.data.metro === "Other" ? (parsed.data.customCity ?? "your city") : parsed.data.metro;
  return {
    ok: true,
    data: {
      ...parsed.data,
      resolvedCity,
    },
  };
}
