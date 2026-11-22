import { describe, expect, it } from "vitest";
import { MAX_CURRENT_RADIUS_METERS } from "./enums";
import {
  DEFAULT_APP_ORIGIN,
  DEFAULT_DISCOVERY_FILTERS,
  DISCOVERY_RADIUS_OPTIONS_MILES,
  DiscoveryFiltersSchema,
  HouseholdIdSchema,
  InviteCodeSchema,
  PersistedFlowSnapshotSchema,
  PersonalizationDraftSchema,
  buildHouseholdInviteUrl,
  buildOriginDeepLinkUrl,
  parseHouseholdIdParam,
  parseInviteCodeParam,
  parseOriginDeepLinkParam,
} from "./navigation";

describe("deep-link parsers", () => {
  it("resolves valid origin_id strings and first elements of arrays", () => {
    expect(parseOriginDeepLinkParam("ahmedabad-navrangpura")?.id).toBe("ahmedabad-navrangpura");
    expect(parseOriginDeepLinkParam(["vadodara-alkapuri", "surat-vesu"])?.id).toBe(
      "vadodara-alkapuri",
    );
    expect(parseOriginDeepLinkParam("  surat-vesu  ")?.id).toBe("surat-vesu");
  });

  it("rejects unknown, empty, or malformed origin_id values", () => {
    expect(parseOriginDeepLinkParam(undefined)).toBeNull();
    expect(parseOriginDeepLinkParam("")).toBeNull();
    expect(parseOriginDeepLinkParam("unknown-city")).toBeNull();
    expect(parseOriginDeepLinkParam("https://evil.test/phish")).toBeNull();
    expect(parseOriginDeepLinkParam(123)).toBeNull();
  });

  it("validates household invite codes (12-char hex and mock codes)", () => {
    expect(parseInviteCodeParam("a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6");
    expect(parseInviteCodeParam("  mockinv0001  ")).toBe("mockinv0001");
    expect(parseInviteCodeParam(["mock_code-1"])).toBe("mock_code-1");

    expect(parseInviteCodeParam("short")).toBeNull();
    expect(parseInviteCodeParam("has space")).toBeNull();
    expect(parseInviteCodeParam("https://wa.me/123456")).toBeNull();
    expect(parseInviteCodeParam(null)).toBeNull();
  });

  it("validates household route IDs", () => {
    const uuid = "20000000-0000-4000-8000-000000000001";
    expect(parseHouseholdIdParam(uuid)).toBe(uuid);
    expect(parseHouseholdIdParam("mock_hh_1")).toBe("mock_hh_1");
    expect(parseHouseholdIdParam("")).toBeNull();
    expect(parseHouseholdIdParam("../etc/passwd")).toBeNull();
    expect(HouseholdIdSchema.safeParse("hh?foo=bar").success).toBe(false);
    expect(InviteCodeSchema.safeParse("abc123").success).toBe(true);
  });
});

describe("canonical deep-link URL builders", () => {
  it("builds Flow A origin deep-link URLs and strips trailing slashes", () => {
    expect(buildOriginDeepLinkUrl("ahmedabad-navrangpura")).toBe(
      `${DEFAULT_APP_ORIGIN}/?origin_id=ahmedabad-navrangpura`,
    );
    expect(buildOriginDeepLinkUrl("surat-vesu", "https://preview.secondhome.app/")).toBe(
      "https://preview.secondhome.app/?origin_id=surat-vesu",
    );
    expect(() => buildOriginDeepLinkUrl("not-a-place")).toThrow();
    expect(() => buildOriginDeepLinkUrl("surat-vesu", "javascript:alert(1)")).toThrow();
    expect(() => buildOriginDeepLinkUrl("surat-vesu", "not a url")).toThrow();
  });

  it("builds Flow B household invite URLs", () => {
    expect(buildHouseholdInviteUrl("mockinv0001")).toBe(
      `${DEFAULT_APP_ORIGIN}/join-household?code=mockinv0001`,
    );
    expect(() => buildHouseholdInviteUrl("bad code!")).toThrow();
    expect(() => buildHouseholdInviteUrl("mockinv0001", "ftp://secondhome.app")).toThrow();
  });
});

describe("discovery filter and persisted flow schemas", () => {
  it("keeps discovery radius options within the 25-mile privacy clamp", () => {
    const maxMeters = Math.max(...DISCOVERY_RADIUS_OPTIONS_MILES) * 1609.344;
    expect(Math.round(maxMeters)).toBeLessThanOrEqual(MAX_CURRENT_RADIUS_METERS + 1);
  });

  it("applies safe defaults and rejects out-of-range radii", () => {
    expect(DiscoveryFiltersSchema.parse({})).toEqual(DEFAULT_DISCOVERY_FILTERS);
    expect(
      DiscoveryFiltersSchema.parse({
        originMode: "all_gujarat",
        radiusMiles: 25,
        ageBrackets: ["30s"],
        lifeStages: ["family_young_kids"],
      }),
    ).toEqual({
      originMode: "all_gujarat",
      radiusMiles: 25,
      ageBrackets: ["30s"],
      lifeStages: ["family_young_kids"],
    });
    expect(DiscoveryFiltersSchema.safeParse({ radiusMiles: 50 }).success).toBe(false);
  });

  it("rejects duplicate interests and enforces max 3 items", () => {
    expect(
      PersonalizationDraftSchema.safeParse({
        ageBracket: "30s",
        lifeStage: "couple",
        interests: ["Cricket", "Cricket"],
      }).success,
    ).toBe(false);
    expect(
      PersonalizationDraftSchema.safeParse({
        ageBracket: "30s",
        lifeStage: "couple",
        interests: ["Cricket", "Food & Chai", "Parenting"],
      }).success,
    ).toBe(true);
  });

  it("validates persisted non-sensitive mobile flow snapshots", () => {
    const valid = {
      phase: "blurred_preview",
      confirmedNeighborhood: {
        label: "Medical Center",
        fuzzedCenter: { lat: 29.5215, lng: -98.5647 },
      },
      selectedOriginId: "ahmedabad-navrangpura",
      pendingInviteCode: "mockinv0001",
      isAuthenticated: false,
      hasCompletedPersonalization: false,
      personalization: {
        ageBracket: "30s",
        lifeStage: "family_young_kids",
        interests: ["Cricket", "Food & Chai"],
      },
      filters: DEFAULT_DISCOVERY_FILTERS,
    };

    expect(PersistedFlowSnapshotSchema.safeParse(valid).success).toBe(true);
    expect(
      PersistedFlowSnapshotSchema.safeParse({
        ...valid,
        personalization: {
          ...valid.personalization,
          interests: ["Cricket", "Food & Chai", "Parenting", "Tech / Healthcare"],
        },
      }).success,
    ).toBe(false);
  });
});
