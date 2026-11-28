import { createClient } from "@supabase/supabase-js";
import { formatWktPoint, parsePostgisPoint, type LatLng } from "./geo.ts";
import { PhoneE164Schema } from "./validation.ts";

export type AuthUser = {
  id: string;
  phone: string | null;
};

export type GujaratLocationRow = {
  id: string;
  display_name: string;
  district: string;
  lat: number;
  lng: number;
};

export type HouseholdRow = {
  id: string;
  display_label: string | null;
  life_stage: string | null;
  exact_current_geog: unknown;
  public_current_geog: unknown;
  h3_index_res7: string;
  neighborhood_name: string | null;
  invite_code: string;
  is_verified_local: boolean;
};

export type UserProfileRow = {
  id: string;
  household_id: string;
  status: "quarantined" | "active" | "paused" | "suspended";
  last_verified_at: string | null;
};

export interface EdgeDbAdapter {
  getAuthUser(jwt: string): Promise<AuthUser | null>;
  getUserProfile(userId: string): Promise<UserProfileRow | null>;
  getGujaratLocation(locationId: string): Promise<GujaratLocationRow | null>;
  createHousehold(input: {
    displayLabel: string | null;
    lifeStage: string | null;
    exactPoint: LatLng;
    publicPoint: LatLng;
    h3IndexRes7: string;
    neighborhoodName: string;
  }): Promise<HouseholdRow>;
  deleteHousehold(householdId: string): Promise<void>;
  createUserProfile(input: {
    id: string;
    householdId: string;
    isHouseholdAdmin: boolean;
    firstName: string;
    avatarUrl: string | null;
    phoneE164: string;
    ageBracket: string | null;
    hometownName: string;
    hometownDistrict: string;
    hometownPoint: LatLng;
    interests: string[];
    status: "quarantined" | "active";
    whatsappAlertsOptIn: boolean;
    lastVerifiedAt: string;
  }): Promise<void>;
  getHouseholdByInviteCode(inviteCode: string): Promise<HouseholdRow | null>;
  getHouseholdExactPoint(householdId: string): Promise<LatLng | null>;
  isHouseholdVerifiedLocal(householdId: string): Promise<boolean>;
  hasBlockedConnectionWithHousehold(userId: string, targetHouseholdId: string): Promise<boolean>;
  hasExistingActiveOrPendingConnection(userA: string, userB: string): Promise<boolean>;
  createConnectionRequest(input: {
    requesterId: string;
    recipientId: string;
    icebreakerText: string;
  }): Promise<{ id: string; createdAt: string }>;
}

export function normalizeE164Phone(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  const parsed = PhoneE164Schema.safeParse(withPlus);
  return parsed.success ? parsed.data : null;
}

export function createEdgeDbAdapter(supabaseUrl: string, serviceRoleKey: string): EdgeDbAdapter {
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return {
    async getAuthUser(jwt: string): Promise<AuthUser | null> {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user) {
        return null;
      }
      return {
        id: data.user.id,
        phone: normalizeE164Phone(data.user.phone),
      };
    },

    async getUserProfile(userId: string): Promise<UserProfileRow | null> {
      const { data, error } = await client
        .from("users")
        .select("id, household_id, status, last_verified_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(`getUserProfile failed: ${error.code ?? "unknown"}`);
      }
      return (data as UserProfileRow | null) ?? null;
    },

    async getGujaratLocation(locationId: string): Promise<GujaratLocationRow | null> {
      const { data, error } = await client
        .from("gujarat_locations")
        .select("id, display_name, district, lat, lng")
        .eq("id", locationId)
        .maybeSingle();
      if (error) {
        throw new Error(`getGujaratLocation failed: ${error.code ?? "unknown"}`);
      }
      return (data as GujaratLocationRow | null) ?? null;
    },

    async createHousehold(input): Promise<HouseholdRow> {
      const { data, error } = await client
        .from("households")
        .insert({
          display_label: input.displayLabel,
          life_stage: input.lifeStage,
          exact_current_geog: formatWktPoint(input.exactPoint),
          public_current_geog: formatWktPoint(input.publicPoint),
          h3_index_res7: input.h3IndexRes7,
          neighborhood_name: input.neighborhoodName,
        })
        .select(
          "id, display_label, life_stage, exact_current_geog, public_current_geog, h3_index_res7, neighborhood_name, invite_code, is_verified_local",
        )
        .single();
      if (error || !data) {
        throw new Error(`createHousehold failed: ${error?.code ?? "unknown"}`);
      }
      return data as HouseholdRow;
    },

    async deleteHousehold(householdId: string): Promise<void> {
      await client.from("households").delete().eq("id", householdId);
    },

    async createUserProfile(input): Promise<void> {
      const { error } = await client.from("users").insert({
        id: input.id,
        household_id: input.householdId,
        is_household_admin: input.isHouseholdAdmin,
        first_name: input.firstName,
        avatar_url: input.avatarUrl,
        phone_e164: input.phoneE164,
        age_bracket: input.ageBracket,
        hometown_name: input.hometownName,
        hometown_district: input.hometownDistrict,
        hometown_geog: formatWktPoint(input.hometownPoint),
        interests: input.interests,
        status: input.status,
        whatsapp_alerts_opt_in: input.whatsappAlertsOptIn,
        last_verified_at: input.lastVerifiedAt,
      });
      if (error) {
        const err = new Error(`createUserProfile failed: ${error.code ?? "unknown"}`) as Error & {
          code?: string;
        };
        err.code = error.code;
        throw err;
      }
    },

    async getHouseholdByInviteCode(inviteCode: string): Promise<HouseholdRow | null> {
      const { data, error } = await client
        .from("households")
        .select(
          "id, display_label, life_stage, exact_current_geog, public_current_geog, h3_index_res7, neighborhood_name, invite_code, is_verified_local",
        )
        .eq("invite_code", inviteCode)
        .maybeSingle();
      if (error) {
        throw new Error(`getHouseholdByInviteCode failed: ${error.code ?? "unknown"}`);
      }
      return (data as HouseholdRow | null) ?? null;
    },

    async getHouseholdExactPoint(householdId: string): Promise<LatLng | null> {
      const { data, error } = await client
        .from("households")
        .select("exact_current_geog")
        .eq("id", householdId)
        .maybeSingle();
      if (error || !data) {
        return null;
      }
      return parsePostgisPoint((data as { exact_current_geog?: unknown }).exact_current_geog);
    },

    async isHouseholdVerifiedLocal(householdId: string): Promise<boolean> {
      const { data, error } = await client
        .from("households")
        .select("is_verified_local")
        .eq("id", householdId)
        .maybeSingle();
      if (error || !data) {
        return false;
      }
      return Boolean((data as { is_verified_local?: boolean }).is_verified_local);
    },

    async hasBlockedConnectionWithHousehold(
      userId: string,
      targetHouseholdId: string,
    ): Promise<boolean> {
      const { data: members, error: membersErr } = await client
        .from("users")
        .select("id")
        .eq("household_id", targetHouseholdId);
      if (membersErr || !members || members.length === 0) {
        return false;
      }
      const memberIds = (members as Array<{ id: string }>).map((m) => m.id);
      const idList = memberIds.join(",");
      const { data: blocked, error: blockErr } = await client
        .from("connections")
        .select("id")
        .eq("status", "blocked")
        .or(
          `and(requester_id.eq.${userId},recipient_id.in.(${idList})),and(recipient_id.eq.${userId},requester_id.in.(${idList}))`,
        )
        .limit(1);
      if (blockErr) {
        throw new Error(`hasBlockedConnectionWithHousehold failed: ${blockErr.code ?? "unknown"}`);
      }
      return Array.isArray(blocked) && blocked.length > 0;
    },

    async hasExistingActiveOrPendingConnection(userA: string, userB: string): Promise<boolean> {
      const { data, error } = await client
        .from("connections")
        .select("id")
        .in("status", ["pending", "accepted"])
        .or(
          `and(requester_id.eq.${userA},recipient_id.eq.${userB}),and(requester_id.eq.${userB},recipient_id.eq.${userA})`,
        )
        .limit(1);
      if (error) {
        throw new Error(`hasExistingActiveOrPendingConnection failed: ${error.code ?? "unknown"}`);
      }
      return Array.isArray(data) && data.length > 0;
    },

    async createConnectionRequest(input): Promise<{ id: string; createdAt: string }> {
      const { data, error } = await client
        .from("connections")
        .insert({
          requester_id: input.requesterId,
          recipient_id: input.recipientId,
          icebreaker_text: input.icebreakerText,
          status: "pending",
        })
        .select("id, created_at")
        .single();
      if (error || !data) {
        const err = new Error(
          `createConnectionRequest failed: ${error?.code ?? "unknown"}`,
        ) as Error & { code?: string };
        err.code = error?.code;
        throw err;
      }
      const row = data as { id: string; created_at: string };
      return { id: row.id, createdAt: row.created_at };
    },
  };
}
