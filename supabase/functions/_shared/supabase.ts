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
  createHouseholdWithAdmin(input: {
    displayLabel: string | null;
    lifeStage: string | null;
    exactPoint: LatLng;
    publicPoint: LatLng;
    h3IndexRes7: string;
    neighborhoodName: string;
    userId: string;
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
  }): Promise<{
    id: string;
    display_label: string | null;
    life_stage: string | null;
    h3_index_res7: string;
    neighborhood_name: string | null;
    invite_code: string;
    is_verified_local: boolean;
  }>;
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
      if (error) {
        const status = (error as { status?: number }).status;
        const name = (error as { name?: string }).name ?? "";
        const isInfrastructureError =
          name === "AuthRetryableFetchError" ||
          status === undefined ||
          status === 0 ||
          status >= 500;
        if (isInfrastructureError) {
          throw new Error(`getAuthUser unavailable: ${status ?? name}`);
        }
        return null;
      }
      if (!data.user) {
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

    async createHouseholdWithAdmin(input) {
      const { data, error } = await client.rpc("create_household_with_admin", {
        p_display_label: input.displayLabel,
        p_life_stage: input.lifeStage,
        p_exact_lng: input.exactPoint.lng,
        p_exact_lat: input.exactPoint.lat,
        p_public_lng: input.publicPoint.lng,
        p_public_lat: input.publicPoint.lat,
        p_h3_index_res7: input.h3IndexRes7,
        p_neighborhood_name: input.neighborhoodName,
        p_user_id: input.userId,
        p_first_name: input.firstName,
        p_avatar_url: input.avatarUrl,
        p_phone_e164: input.phoneE164,
        p_age_bracket: input.ageBracket,
        p_hometown_name: input.hometownName,
        p_hometown_district: input.hometownDistrict,
        p_hometown_lng: input.hometownPoint.lng,
        p_hometown_lat: input.hometownPoint.lat,
        p_interests: input.interests,
        p_status: input.status,
        p_whatsapp_alerts_opt_in: input.whatsappAlertsOptIn,
        p_last_verified_at: input.lastVerifiedAt,
      });
      if (error) {
        const err = new Error(
          `createHouseholdWithAdmin failed: ${error.code ?? "unknown"}`,
        ) as Error & {
          code?: string;
        };
        err.code = error.code;
        throw err;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("createHouseholdWithAdmin returned no row");
      }
      return row as {
        id: string;
        display_label: string | null;
        life_stage: string | null;
        h3_index_res7: string;
        neighborhood_name: string | null;
        invite_code: string;
        is_verified_local: boolean;
      };
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
      if (membersErr) {
        throw new Error(
          `hasBlockedConnectionWithHousehold failed: ${membersErr.code ?? "unknown"}`,
        );
      }
      if (!members || members.length === 0) {
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
