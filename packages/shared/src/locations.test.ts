import { describe, expect, it } from "vitest";
import {
  GUJARAT_DISTRICTS,
  GUJARAT_LOCATIONS,
  getGujaratLocationById,
  searchGujaratLocations,
} from "./locations";

describe("Gujarat gazetteer", () => {
  it("contains all 33 districts of Gujarat", () => {
    expect(GUJARAT_DISTRICTS).toHaveLength(33);
    const districtEntries = GUJARAT_LOCATIONS.filter((loc) => loc.type === "district");
    expect(districtEntries).toHaveLength(33);

    const covered = new Set(districtEntries.map((loc) => loc.district));
    for (const d of GUJARAT_DISTRICTS) {
      expect(covered.has(d)).toBe(true);
    }
  });

  it("has unique IDs and coordinates within Gujarat bounds", () => {
    const ids = new Set<string>();
    for (const loc of GUJARAT_LOCATIONS) {
      expect(ids.has(loc.id)).toBe(false);
      ids.add(loc.id);
      expect(loc.lat).toBeGreaterThanOrEqual(20.0);
      expect(loc.lat).toBeLessThanOrEqual(24.8);
      expect(loc.lng).toBeGreaterThanOrEqual(68.0);
      expect(loc.lng).toBeLessThanOrEqual(74.6);
    }
  });

  it("includes major diaspora urban neighborhoods", () => {
    expect(getGujaratLocationById("ahmedabad-navrangpura")?.district).toBe("Ahmedabad");
    expect(getGujaratLocationById("vadodara-alkapuri")?.district).toBe("Vadodara");
    expect(getGujaratLocationById("surat-vesu")?.district).toBe("Surat");
    expect(getGujaratLocationById("anand-vallabh-vidyanagar")?.district).toBe("Anand");
    expect(getGujaratLocationById("rajkot-kalawad-road")?.district).toBe("Rajkot");
  });

  it("supports instant offline autocomplete including aliases", () => {
    const baroda = searchGujaratLocations("Baroda");
    expect(baroda[0]?.id).toBe("vadodara-city");

    const vvn = searchGujaratLocations("VVN");
    expect(vvn[0]?.id).toBe("anand-vallabh-vidyanagar");

    const charotar = searchGujaratLocations("Charotar");
    expect(charotar.some((l) => l.district === "Anand")).toBe(true);
    expect(charotar.some((l) => l.district === "Kheda")).toBe(true);

    const navrangpura = searchGujaratLocations("navrang");
    expect(navrangpura[0]?.id).toBe("ahmedabad-navrangpura");
  });

  it("returns cities by default for empty query and respects limit", () => {
    const defaults = searchGujaratLocations("", 5);
    expect(defaults).toHaveLength(5);
    expect(defaults.every((l) => l.type === "city")).toBe(true);
  });
});
