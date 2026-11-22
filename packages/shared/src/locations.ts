import { z } from "zod";
import rawLocations from "./data/gujarat-locations.json";

export const GUJARAT_LOCATION_TYPES = ["district", "city", "taluka", "neighborhood"] as const;

export const GUJARAT_DISTRICTS = [
  "Ahmedabad",
  "Amreli",
  "Anand",
  "Aravalli",
  "Banaskantha",
  "Bharuch",
  "Bhavnagar",
  "Botad",
  "Chhota Udaipur",
  "Dahod",
  "Dang",
  "Devbhumi Dwarka",
  "Gandhinagar",
  "Gir Somnath",
  "Jamnagar",
  "Junagadh",
  "Kheda",
  "Kutch",
  "Mahisagar",
  "Mehsana",
  "Morbi",
  "Narmada",
  "Navsari",
  "Panchmahal",
  "Patan",
  "Porbandar",
  "Rajkot",
  "Sabarkantha",
  "Surat",
  "Surendranagar",
  "Tapi",
  "Vadodara",
  "Valsad",
] as const;

export const GujaratLocationTypeSchema = z.enum(GUJARAT_LOCATION_TYPES);
export const GujaratDistrictSchema = z.enum(GUJARAT_DISTRICTS);

export const GujaratLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  district: GujaratDistrictSchema,
  type: GujaratLocationTypeSchema,
  lat: z.number().min(20.0).max(24.8),
  lng: z.number().min(68.0).max(74.6),
  aliases: z.array(z.string().min(1)).optional(),
});

export type GujaratLocationType = z.infer<typeof GujaratLocationTypeSchema>;
export type GujaratDistrict = z.infer<typeof GujaratDistrictSchema>;
export type GujaratLocation = z.infer<typeof GujaratLocationSchema>;

export const GUJARAT_LOCATIONS: readonly GujaratLocation[] =
  GujaratLocationSchema.array().parse(rawLocations);

const LOCATION_BY_ID = new Map<string, GujaratLocation>(
  GUJARAT_LOCATIONS.map((loc) => [loc.id, loc]),
);

const TYPE_PRIORITY: Record<GujaratLocationType, number> = {
  city: 0,
  neighborhood: 1,
  taluka: 2,
  district: 3,
};

export function getGujaratLocationById(id: string): GujaratLocation | undefined {
  return LOCATION_BY_ID.get(id);
}

/**
 * Instant offline autocomplete over the bundled Gujarat gazetteer.
 * Ranks exact name/alias matches first, then prefix matches, then substring matches.
 */
export function searchGujaratLocations(query: string, limit = 15): GujaratLocation[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return GUJARAT_LOCATIONS.filter((loc) => loc.type === "city").slice(0, limit);
  }

  const scored: Array<{ loc: GujaratLocation; score: number }> = [];

  for (const loc of GUJARAT_LOCATIONS) {
    const name = loc.name.toLowerCase();
    const display = loc.displayName.toLowerCase();
    const district = loc.district.toLowerCase();
    const aliases = loc.aliases?.map((a) => a.toLowerCase()) ?? [];

    let rank = -1;
    if (name === normalized || aliases.includes(normalized)) {
      rank = 0;
    } else if (name.startsWith(normalized) || aliases.some((a) => a.startsWith(normalized))) {
      rank = 1;
    } else if (district.startsWith(normalized)) {
      rank = 2;
    } else if (display.includes(normalized) || aliases.some((a) => a.includes(normalized))) {
      rank = 3;
    }

    if (rank !== -1) {
      scored.push({ loc, score: rank * 10 + TYPE_PRIORITY[loc.type] });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.loc.displayName.localeCompare(b.loc.displayName));
  return scored.slice(0, Math.max(0, limit)).map((item) => item.loc);
}
