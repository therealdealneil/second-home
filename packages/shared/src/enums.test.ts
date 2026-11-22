import { describe, expect, it } from "vitest";
import {
  AgeBracketSchema,
  LifeStageSchema,
  MAX_CURRENT_RADIUS_METERS,
  MIN_HOUSEHOLDS_PER_HEX,
} from "./enums";

describe("enums", () => {
  it("accepts valid values", () => {
    expect(AgeBracketSchema.parse("60_plus")).toBe("60_plus");
    expect(LifeStageSchema.parse("family_teens")).toBe("family_teens");
  });

  it("rejects invalid values", () => {
    expect(AgeBracketSchema.safeParse("70s").success).toBe(false);
    expect(LifeStageSchema.safeParse("unknown").success).toBe(false);
  });

  it("exposes privacy constants", () => {
    expect(MIN_HOUSEHOLDS_PER_HEX).toBe(2);
    expect(MAX_CURRENT_RADIUS_METERS).toBe(40_233);
  });
});
