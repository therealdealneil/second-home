import { describe, expect, it } from "vitest";
import {
  buildHouseholdInviteWhatsappUrl,
  buildIcebreakerPresets,
  buildWhatsappHandoffUrl,
  evaluateDiscoveryMatches,
  validateIcebreaker,
  validateWaitlistSubmission,
} from "./discovery";
import { ICEBREAKER_MAX_LENGTH } from "./enums";
import { getGujaratLocationById } from "./locations";
import { DEFAULT_DISCOVERY_FILTERS } from "./navigation";
import { MAX_MATCH_RESULTS, type PublicHouseholdPin } from "./spatial";

const MED_CENTER = { lat: 29.5124, lng: -98.5742 };
const AHMEDABAD_CITY = getGujaratLocationById("ahmedabad-city")!;

describe("icebreaker anti-abuse validation", () => {
  it("accepts clean greetings and dates/years under 140 chars", () => {
    expect(
      validateIcebreaker("Kem cho! Lived in Ahmedabad 2015-2020, now near Med Center."),
    ).toEqual({
      ok: true,
      text: "Kem cho! Lived in Ahmedabad 2015-2020, now near Med Center.",
    });
  });

  it("rejects empty, overly long, link-containing, or phone-containing notes", () => {
    expect(validateIcebreaker("   ").ok).toBe(false);
    expect(validateIcebreaker("a".repeat(ICEBREAKER_MAX_LENGTH + 1)).ok).toBe(false);

    expect(validateIcebreaker("Check https://example.com").ok).toBe(false);
    expect(validateIcebreaker("Hit me up at http://evil.test").ok).toBe(false);
    expect(validateIcebreaker("Ping wa.me/12105550199").ok).toBe(false);
    expect(validateIcebreaker("Join t.me/mygroup").ok).toBe(false);

    expect(validateIcebreaker("Call +1 (210) 555-0199").ok).toBe(false);
    expect(validateIcebreaker("Call (210) 555-0199").ok).toBe(false);
    expect(validateIcebreaker("Text me 210 555 0199").ok).toBe(false);
    expect(validateIcebreaker("My number is 2105550199").ok).toBe(false);
    expect(validateIcebreaker("CHECK HTTPS://EXAMPLE.COM").ok).toBe(false);
    expect(validateIcebreaker("PING WA.ME/12105550199").ok).toBe(false);

    const exact140 = `  ${"a".repeat(ICEBREAKER_MAX_LENGTH)}  `;
    expect(validateIcebreaker(exact140)).toEqual({
      ok: true,
      text: "a".repeat(ICEBREAKER_MAX_LENGTH),
    });
  });

  it("clamps emoji-containing presets without splitting surrogate pairs", () => {
    const emojiName = `Raj${"🙏".repeat(60)}`;
    const presets = buildIcebreakerPresets({
      firstName: emojiName,
      hometownName: "Navrangpura, Ahmedabad",
      neighborhoodName: "Medical Center",
      sharedInterests: ["Cricket"],
    });
    for (const preset of presets) {
      expect(preset.length).toBeLessThanOrEqual(ICEBREAKER_MAX_LENGTH);
      expect(validateIcebreaker(preset).ok).toBe(true);
      // Well-formed UTF-16 has no lone surrogates
      expect(/[\uD800-\uDFFF]/.test(preset.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))).toBe(
        false,
      );
    }
  });

  it("builds 3 valid 1-tap presets clamped within 140 characters", () => {
    const presets = buildIcebreakerPresets({
      firstName: "Rohan",
      hometownName: "Navrangpura, Ahmedabad, Gujarat",
      neighborhoodName: "Medical Center",
      sharedInterests: ["Cricket", "Food & Chai"],
    });
    expect(presets).toHaveLength(3);
    for (const preset of presets) {
      expect(preset.length).toBeLessThanOrEqual(ICEBREAKER_MAX_LENGTH);
      expect(validateIcebreaker(preset).ok).toBe(true);
    }

    const longPresets = buildIcebreakerPresets({
      firstName: "A".repeat(60),
      hometownName: "B".repeat(60),
      neighborhoodName: "C".repeat(60),
      sharedInterests: [],
    });
    for (const preset of longPresets) {
      expect(preset.length).toBeLessThanOrEqual(ICEBREAKER_MAX_LENGTH);
      expect(validateIcebreaker(preset).ok).toBe(true);
    }
  });
});

describe("WhatsApp handoff and spouse invite builders", () => {
  it("builds wa.me deep link with E.164 phone and encoded greeting", () => {
    const url = buildWhatsappHandoffUrl({
      phoneE164: "+12105550103",
      recipientFirstName: "Kunal",
      hometownDistrict: "Ahmedabad",
    });
    expect(url.startsWith("https://wa.me/12105550103?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Kem cho Kunal!");
    expect(decodeURIComponent(url)).toContain("Ahmedabad");
    expect(() =>
      buildWhatsappHandoffUrl({
        phoneE164: "2105550103",
        recipientFirstName: "Kunal",
        hometownDistrict: "Ahmedabad",
      }),
    ).toThrow();

    const encoded = buildWhatsappHandoffUrl({
      phoneE164: "+12105550103",
      recipientFirstName: "Raj?foo=bar&baz=1",
      hometownDistrict: "  ",
    });
    expect(encoded.startsWith("https://wa.me/12105550103?text=")).toBe(true);
    expect(encoded.split("?")).toHaveLength(2);
    expect(decodeURIComponent(encoded)).toContain("Raj?foo=bar&baz=1");
    expect(decodeURIComponent(encoded)).toContain("Gujarat neighborhood map");

    const blankName = buildWhatsappHandoffUrl({
      phoneE164: "+12105550103",
      recipientFirstName: "   ",
      hometownDistrict: "Surat",
    });
    expect(decodeURIComponent(blankName)).toContain("Kem cho neighbor!");
  });

  it("builds spouse invite WhatsApp share URL", () => {
    const url = buildHouseholdInviteWhatsappUrl("mockinv0001");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain(
      "https://secondhome.app/join-household?code=mockinv0001",
    );
  });
});

describe("evaluateDiscoveryMatches multi-origin and filter rules", () => {
  const samplePins: PublicHouseholdPin[] = [
    // Mixed Ahmedabad / Vadodara household in 30s
    {
      householdId: "hh-mixed",
      displayLabel: "Patel Family",
      lifeStage: "family_young_kids",
      neighborhoodName: "Medical Center",
      isVerifiedLocal: true,
      publicLat: 29.5215,
      publicLng: -98.5647,
      members: [
        {
          userId: "u-rohan",
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
        {
          userId: "u-priya",
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
      ],
    },
    // Surat household in 40s within 10 mi
    {
      householdId: "hh-surat",
      displayLabel: "Bhatt Family",
      lifeStage: "family_teens",
      neighborhoodName: "Stone Oak",
      isVerifiedLocal: true,
      publicLat: 29.6434,
      publicLng: -98.5001,
      members: [
        {
          userId: "u-viral",
          firstName: "Viral",
          avatarUrl: null,
          ageBracket: "40s",
          hometownName: "Piplod, Surat",
          hometownDistrict: "Surat",
          hometownLat: 21.1591,
          hometownLng: 72.7758,
          vouchCount: 5,
          interests: ["Cricket"],
        },
      ],
    },
  ];

  it("matches multi-origin household on exact_town and preserves ALL linked members", () => {
    const res = evaluateDiscoveryMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "exact_town", radiusMiles: 10 },
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.householdId).toBe("hh-mixed");
    expect(res[0]?.members).toHaveLength(2);
    expect(res[0]?.members.map((m) => m.firstName)).toEqual(["Rohan", "Priya"]);
  });

  it("filters by originMode=all_gujarat, ageBrackets, lifeStages, radiusMiles, and blockedHouseholdIds", () => {
    const all25 = evaluateDiscoveryMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "all_gujarat", radiusMiles: 25 },
    });
    expect(all25).toHaveLength(2);

    const teensOnly = evaluateDiscoveryMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: {
        originMode: "all_gujarat",
        radiusMiles: 25,
        ageBrackets: ["40s"],
        lifeStages: ["family_teens"],
      },
    });
    expect(teensOnly.map((h) => h.householdId)).toEqual(["hh-surat"]);

    const blockedExcluded = evaluateDiscoveryMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "all_gujarat", radiusMiles: 25 },
      blockedHouseholdIds: new Set(["hh-mixed"]),
    });
    expect(blockedExcluded.map((h) => h.householdId)).toEqual(["hh-surat"]);
  });

  it("enforces same-member EXISTS intersection across origin and age bracket", () => {
    const splitAgePin: PublicHouseholdPin = {
      householdId: "hh-split-age",
      displayLabel: "Desai Family",
      lifeStage: "couple",
      neighborhoodName: "Medical Center",
      isVerifiedLocal: true,
      publicLat: 29.52,
      publicLng: -98.57,
      members: [
        {
          userId: "u-ahm-30s",
          firstName: "Aarav",
          avatarUrl: null,
          ageBracket: "30s",
          hometownName: "Navrangpura, Ahmedabad",
          hometownDistrict: "Ahmedabad",
          hometownLat: 23.0365,
          hometownLng: 72.5611,
          vouchCount: 2,
          interests: [],
        },
        {
          userId: "u-vad-20s",
          firstName: "Diya",
          avatarUrl: null,
          ageBracket: "20s",
          hometownName: "Alkapuri, Vadodara",
          hometownDistrict: "Vadodara",
          hometownLat: 22.3119,
          hometownLng: 73.1723,
          vouchCount: 1,
          interests: [],
        },
      ],
    };

    // Ahmedabad is only linked to Aarav (30s), not Diya (20s), so exact_town + 20s must not match
    const noCrossMatch = evaluateDiscoveryMatches({
      households: [splitAgePin],
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: {
        originMode: "exact_town",
        radiusMiles: 10,
        ageBrackets: ["20s"],
        lifeStages: [],
      },
    });
    expect(noCrossMatch).toHaveLength(0);

    // Matching the Ahmedabad spouse's own age bracket matches AND returns both spouses
    const sameMemberMatch = evaluateDiscoveryMatches({
      households: [splitAgePin],
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: {
        originMode: "exact_town",
        radiusMiles: 10,
        ageBrackets: ["30s"],
        lifeStages: [],
      },
    });
    expect(sameMemberMatch).toHaveLength(1);
    expect(sameMemberMatch[0]?.members).toHaveLength(2);
  });

  it("enforces radiusMiles filtering, ascending distance order, and LIMIT 100 clamp", () => {
    const within2Miles = evaluateDiscoveryMatches({
      households: samplePins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "all_gujarat", radiusMiles: 2 },
    });
    expect(within2Miles.map((h) => h.householdId)).toEqual(["hh-mixed"]);

    const reversedPins = [samplePins[1]!, samplePins[0]!];
    const sorted25Miles = evaluateDiscoveryMatches({
      households: reversedPins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "all_gujarat", radiusMiles: 25 },
    });
    expect(sorted25Miles.map((h) => h.householdId)).toEqual(["hh-mixed", "hh-surat"]);
    expect(sorted25Miles[0]!.distanceMeters).toBeLessThan(sorted25Miles[1]!.distanceMeters);

    const manyPins: PublicHouseholdPin[] = Array.from(
      { length: MAX_MATCH_RESULTS + 15 },
      (_, idx) => ({
        ...samplePins[0]!,
        householdId: `hh-bulk-${idx}`,
        members: [
          {
            ...samplePins[0]!.members[0]!,
            userId: `u-bulk-${idx}`,
          },
        ],
      }),
    );
    const clamped = evaluateDiscoveryMatches({
      households: manyPins,
      neighborhoodCenter: MED_CENTER,
      selectedOrigin: AHMEDABAD_CITY,
      filters: { ...DEFAULT_DISCOVERY_FILTERS, originMode: "all_gujarat", radiusMiles: 25 },
    });
    expect(clamped).toHaveLength(MAX_MATCH_RESULTS);
  });
});

describe("metro expansion waitlist validation", () => {
  it("accepts valid email or 10-15 digit phone for preset metros and custom cities", () => {
    expect(
      validateWaitlistSubmission({
        metro: "Austin, TX",
        contact: "neighbor@example.com",
      }),
    ).toEqual({
      ok: true,
      data: {
        metro: "Austin, TX",
        contact: "neighbor@example.com",
        resolvedCity: "Austin, TX",
      },
    });

    const phoneRes = validateWaitlistSubmission({
      metro: "Other",
      customCity: "Sugar Land, TX",
      contact: "+1 (512) 555-0144",
    });
    expect(phoneRes.ok).toBe(true);
    if (phoneRes.ok) {
      expect(phoneRes.data.resolvedCity).toBe("Sugar Land, TX");
    }
  });

  it("rejects missing custom city when Other is selected or invalid contact strings", () => {
    expect(
      validateWaitlistSubmission({
        metro: "Other",
        customCity: " ",
        contact: "neighbor@example.com",
      }).ok,
    ).toBe(false);

    expect(
      validateWaitlistSubmission({
        metro: "Houston, TX",
        contact: "not-an-email-or-phone",
      }).ok,
    ).toBe(false);

    expect(
      validateWaitlistSubmission({
        metro: "Dallas-Fort Worth, TX",
        contact: "12345",
      }).ok,
    ).toBe(false);
  });
});
