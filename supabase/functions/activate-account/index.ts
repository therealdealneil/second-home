import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function normalizeE164(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  const normalized = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return E164_REGEX.test(normalized) ? normalized : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!user.phone_confirmed_at || !user.phone) {
    return jsonResponse({ error: "SMS OTP verification required" }, 403);
  }

  const normalizedPhone = normalizeE164(user.phone);
  if (!normalizedPhone) {
    return jsonResponse({ error: "Verified phone number is invalid" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingUser, error: fetchError } = await adminClient
    .from("users")
    .select("id, status, last_verified_at")
    .eq("id", user.id)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse({ error: "Unable to verify account status" }, 500);
  }

  if (!existingUser) {
    return jsonResponse({
      status: "pending_household",
      phoneVerified: true,
    });
  }

  if (existingUser.status === "suspended") {
    return jsonResponse({ error: "Account is suspended" }, 403);
  }

  if (existingUser.status === "quarantined") {
    // Only newly onboarded accounts (never previously verified) may self-activate via OTP.
    // Accounts quarantined after prior verification (e.g. moderation/reports) require review.
    if (existingUser.last_verified_at !== null) {
      return jsonResponse({ error: "Account is under review" }, 403);
    }

    const { data: updatedUser, error: updateError } = await adminClient
      .from("users")
      .update({
        status: "active",
        phone_e164: normalizedPhone,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .eq("status", "quarantined")
      .is("last_verified_at", null)
      .select("status")
      .single();

    if (updateError || !updatedUser) {
      return jsonResponse({ error: "Unable to activate account" }, 500);
    }

    return jsonResponse({
      status: updatedUser.status,
      phoneVerified: true,
    });
  }

  return jsonResponse({
    status: existingUser.status,
    phoneVerified: true,
  });
});
