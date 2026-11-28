import { describe, expect, it } from "vitest";
import {
  AUTH_NONCE_TTL_SECONDS,
  CONNECTION_RATE_LIMIT_NEW_ACCOUNT,
  CONNECTION_RATE_LIMIT_VERIFIED_LOCAL,
  CreateHouseholdRequestSchema,
  HOUSEHOLD_JOIN_MAX_DISTANCE_METERS,
  JoinHouseholdRequestSchema,
  SendConnectionRequestSchema,
  canonicalizeAttestationPayload,
  countDecimalPlaces,
  detectCoordinatePrecisionAnomaly,
  evaluateImpossibleTravel,
  getOutboundConnectionLimit,
  isWithinHouseholdJoinProximity,
} from "./edgeSecurity";

const VALID_ATTESTATION = {
  platform: "ios" as const,
  nonce: "0123456789abcdef0123456789abcdef",
  token: "base64-attestation-token",
  keyId: "key-1",
  payloadHash: "a".repeat(64),
};

describe("edgeSecurity schemas", () => {
  it("validates create-household payloads and applies defaults", () => {
    const parsed = CreateHouseholdRequestSchema.parse({
      attestation: VALID_ATTESTATION,
      gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 12, mocked: false },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
      lifeStage: "family_young_kids",
    });
    expect(parsed.interests).toEqual([]);
    expect(parsed.whatsappAlertsOptIn).toBe(false);
  });

  it("rejects non-https avatarUrl in create-household and join-household", () => {
    expect(
      CreateHouseholdRequestSchema.safeParse({
        attestation: VALID_ATTESTATION,
        gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 10 },
        hometownLocationId: "vadodara-alkapuri",
        firstName: "Aarav",
        avatarUrl: "http://example.com/avatar.png",
      }).success,
    ).toBe(false);

    expect(
      JoinHouseholdRequestSchema.safeParse({
        attestation: VALID_ATTESTATION,
        gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 10 },
        inviteCode: "abc123def456",
        hometownLocationId: "surat-vesu",
        firstName: "Diya",
      }).success,
    ).toBe(true);
  });

  it("enforces icebreaker URL/phone guardrails in SendConnectionRequestSchema", () => {
    expect(
      SendConnectionRequestSchema.safeParse({
        attestation: VALID_ATTESTATION,
        recipientId: "550e8400-e29b-41d4-a716-446655440000",
        icebreakerText: "Kem cho! Live near Medical Center too.",
      }).success,
    ).toBe(true);

    expect(
      SendConnectionRequestSchema.safeParse({
        attestation: VALID_ATTESTATION,
        recipientId: "550e8400-e29b-41d4-a716-446655440000",
        icebreakerText: "Ping me at https://evil.example/phish",
      }).success,
    ).toBe(false);

    expect(
      SendConnectionRequestSchema.safeParse({
        attestation: VALID_ATTESTATION,
        recipientId: "550e8400-e29b-41d4-a716-446655440000",
        icebreakerText: "Call me on +1 (210) 555-1234",
      }).success,
    ).toBe(false);
  });
});

describe("anti-spoofing & rate-limit helpers", () => {
  it("counts decimal places accurately", () => {
    expect(countDecimalPlaces(29)).toBe(0);
    expect(countDecimalPlaces(29.51)).toBe(2);
    expect(countDecimalPlaces(29.5124)).toBe(4);
    expect(countDecimalPlaces(1e-5)).toBe(5);
  });

  it("flags integer/coarse coordinates and missing or huge accuracyMeters", () => {
    expect(
      detectCoordinatePrecisionAnomaly({ lat: 29.5124, lng: -98.5742, accuracyMeters: 15 }),
    ).toEqual({ anomalous: false, reasons: [] });

    expect(
      detectCoordinatePrecisionAnomaly({ lat: 29, lng: -98.5742, accuracyMeters: 15 }),
    ).toEqual({ anomalous: true, reasons: ["low_lat_precision"] });

    expect(detectCoordinatePrecisionAnomaly({ lat: 29.5124, lng: -98.5742 })).toEqual({
      anomalous: true,
      reasons: ["invalid_or_missing_accuracy"],
    });

    expect(
      detectCoordinatePrecisionAnomaly({ lat: 29.5124, lng: -98.5742, accuracyMeters: 8_000 }),
    ).toEqual({ anomalous: true, reasons: ["invalid_or_missing_accuracy"] });
  });

  it("detects impossible travel (> 600 mph) and allows normal driving speed", () => {
    const baseMs = 1_700_000_000_000;
    // San Antonio to Austin (~75 miles) in 90 minutes = ~50 mph (ok)
    const normal = evaluateImpossibleTravel(
      { lat: 29.5124, lng: -98.5742, timestampMs: baseMs },
      { lat: 30.2672, lng: -97.7431, timestampMs: baseMs + 90 * 60_000 },
    );
    expect(normal.impossible).toBe(false);

    // Ahmedabad to San Antonio (~8,500 miles) in 5 minutes (impossible)
    const teleport = evaluateImpossibleTravel(
      { lat: 23.0225, lng: 72.5714, timestampMs: baseMs },
      { lat: 29.5124, lng: -98.5742, timestampMs: baseMs + 5 * 60_000 },
    );
    expect(teleport.impossible).toBe(true);
    expect(teleport.speedMph).toBeGreaterThan(600);
  });

  it("checks 25-mile household join proximity", () => {
    const householdExact = { lat: 29.5124, lng: -98.5742 };
    const nearby = isWithinHouseholdJoinProximity({ lat: 29.6472, lng: -98.4864 }, householdExact);
    expect(nearby.withinProximity).toBe(true);
    expect(nearby.distanceMeters).toBeLessThan(HOUSEHOLD_JOIN_MAX_DISTANCE_METERS);

    const austin = isWithinHouseholdJoinProximity({ lat: 30.2672, lng: -97.7431 }, householdExact);
    expect(austin.withinProximity).toBe(false);
    expect(austin.distanceMeters).toBeGreaterThan(HOUSEHOLD_JOIN_MAX_DISTANCE_METERS);
  });

  it("returns 10/24h for new accounts and 25/24h for Verified Local", () => {
    expect(AUTH_NONCE_TTL_SECONDS).toBe(60);
    expect(getOutboundConnectionLimit({ isVerifiedLocal: false })).toBe(
      CONNECTION_RATE_LIMIT_NEW_ACCOUNT,
    );
    expect(getOutboundConnectionLimit({ isVerifiedLocal: true })).toBe(
      CONNECTION_RATE_LIMIT_VERIFIED_LOCAL,
    );
  });

  it("canonicalizes nested payloads deterministically regardless of key order", () => {
    const a = canonicalizeAttestationPayload({
      b: 2,
      a: { d: 4, c: 3, omitted: undefined },
      arr: [{ y: 1, x: 2 }],
    });
    const b = canonicalizeAttestationPayload({
      arr: [{ x: 2, y: 1 }],
      a: { c: 3, d: 4 },
      b: 2,
    });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"arr":[{"x":2,"y":1}],"b":2}');
  });
});
