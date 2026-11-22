import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUSES,
  AGE_BRACKETS,
  AccountStatusSchema,
  AgeBracketSchema,
  CONNECTION_STATUSES,
  ConnectionStatusSchema,
  H3_RESOLUTION,
  LIFE_STAGES,
  LifeStageSchema,
  MAX_CURRENT_RADIUS_METERS,
  MAX_HOMETOWN_RADIUS_METERS,
  MIN_HOUSEHOLDS_PER_HEX,
} from "./enums";

// Expected values come from docs/03_data_privacy_schema.md (enum types).
describe("enum values match docs/03", () => {
  it("age brackets", () => {
    expect([...AGE_BRACKETS]).toEqual(["20s", "30s", "40s", "50s", "60_plus"]);
  });
  it("life stages", () => {
    expect([...LIFE_STAGES]).toEqual([
      "solo_student",
      "couple",
      "family_young_kids",
      "family_teens",
      "empty_nester_senior",
    ]);
  });
  it("account statuses", () => {
    expect([...ACCOUNT_STATUSES]).toEqual(["quarantined", "active", "paused", "suspended"]);
  });
  it("connection statuses", () => {
    expect([...CONNECTION_STATUSES]).toEqual(["pending", "accepted", "declined", "blocked"]);
  });
});

describe("schemas", () => {
  it.each([
    ["AgeBracketSchema", AgeBracketSchema, AGE_BRACKETS, "70s"],
    ["LifeStageSchema", LifeStageSchema, LIFE_STAGES, "unknown"],
    ["AccountStatusSchema", AccountStatusSchema, ACCOUNT_STATUSES, "banned"],
    ["ConnectionStatusSchema", ConnectionStatusSchema, CONNECTION_STATUSES, "ghosted"],
  ])("%s accepts every valid value and rejects invalid ones", (_name, schema, values, bad) => {
    for (const v of values) expect(schema.safeParse(v).success).toBe(true);
    expect(schema.safeParse(bad).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});

describe("privacy constants match docs/03 & docs/04", () => {
  it("has the expected values", () => {
    expect(H3_RESOLUTION).toBe(7);
    expect(MIN_HOUSEHOLDS_PER_HEX).toBe(2);
    expect(MAX_CURRENT_RADIUS_METERS).toBe(40_233);
    expect(MAX_HOMETOWN_RADIUS_METERS).toBe(80_467);
  });
});
