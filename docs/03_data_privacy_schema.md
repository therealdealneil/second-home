# 03 — Data & Privacy Schema (PostgreSQL + PostGIS)

## 1. Core Privacy & Security Guarantees
1. **Zero Raw Coordinate Exposure:** `exact_current_geog` is stored on the `households` table and locked via Postgres Row-Level Security (RLS). Client JWTs never have `SELECT` access to this column.
2. **Single-Pin Household Fuzzing:** All members of a household share one `public_current_geog` (computed once at household creation via a random 0.5–1.5 mile offset) so overlapping family pins cannot be used to triangulate a home address.
3. **Dual-Origin Spatial Joins:** Every `users` record stores its own `hometown_geog`, allowing a single household pin to match neighbors from *either* spouse's hometown.
4. **K-Anonymity Web Aggregation:** Public web heatmaps aggregate counts into Uber H3 hexagons and suppress cells with fewer than 2 households so isolated homes are never pinpointed.

---

## 2. Database Schema (Supabase / PostgreSQL 16 + PostGIS)

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum types for low-friction filtering
CREATE TYPE age_bracket_enum AS ENUM ('20s', '30s', '40s', '50s', '60_plus');
CREATE TYPE life_stage_enum AS ENUM (
  'solo_student',
  'couple',
  'family_young_kids',
  'family_teens',
  'empty_nester_senior'
);
CREATE TYPE account_status_enum AS ENUM ('quarantined', 'active', 'paused', 'suspended');
CREATE TYPE connection_status_enum AS ENUM ('pending', 'accepted', 'declined', 'blocked');

-- 1. HOUSEHOLDS: Anchors the San Antonio location (1 pin per physical home)
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_label TEXT, -- Optional, e.g., "Patel Family"
  life_stage life_stage_enum,
  -- SENSITIVE: Exact GPS coordinate (never exposed to client queries)
  exact_current_geog GEOGRAPHY(Point, 4326) NOT NULL,
  -- PUBLIC: Pre-fuzzed coordinate (0.5 - 1.5 mi random offset) for mobile map pins
  public_current_geog GEOGRAPHY(Point, 4326) NOT NULL,
  -- PUBLIC AGGREGATION: Uber H3 resolution-7 hex index for read-only web heatmaps
  h3_index_res7 TEXT NOT NULL,
  neighborhood_name TEXT, -- e.g., "Stone Oak", "Medical Center"
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  is_verified_local BOOLEAN DEFAULT FALSE, -- True after 7+ days consistent GPS presence
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_households_public_geog ON households USING GIST (public_current_geog);
CREATE INDEX idx_households_h3 ON households (h3_index_res7);

-- 2. USERS / HOUSEHOLD MEMBERS: Individual profiles & Gujarat hometown origins
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  is_household_admin BOOLEAN DEFAULT TRUE,
  first_name TEXT NOT NULL,
  avatar_url TEXT,
  phone_e164 TEXT UNIQUE NOT NULL, -- Verified via OTP; shared only on accepted connection
  age_bracket age_bracket_enum,
  -- Gujarat Hometown / Origin Data
  hometown_name TEXT NOT NULL, -- e.g., "Alkapuri, Vadodara, Gujarat"
  hometown_district TEXT NOT NULL, -- e.g., "Vadodara"
  hometown_geog GEOGRAPHY(Point, 4326) NOT NULL,
  interests TEXT[] DEFAULT '{}', -- Max 5 pills
  status account_status_enum DEFAULT 'quarantined',
  vouch_count INT DEFAULT 0,
  whatsapp_alerts_opt_in BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_hometown_geog ON users USING GIST (hometown_geog);
CREATE INDEX idx_users_household_id ON users (household_id);
CREATE INDEX idx_users_status_age ON users (status, age_bracket);

-- 3. CONNECTIONS: Member-to-member introductions & WhatsApp unlock state
CREATE TABLE connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icebreaker_text TEXT,
  status connection_status_enum DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (requester_id, recipient_id)
);

CREATE INDEX idx_connections_requester ON connections (requester_id, status);
CREATE INDEX idx_connections_recipient ON connections (recipient_id, status);

-- 4. HOMETOWN VOUCHES: Peer-to-peer authenticity verification
CREATE TABLE hometown_vouches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vouched_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (voucher_id, vouched_user_id),
  CHECK (voucher_id <> vouched_user_id)
);

-- 5. USER REPORTS: Abuse moderation & auto-quarantine tracking
CREATE TABLE user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reporter_id, reported_user_id)
);
```

---

## 3. Core Dual-Radius Spatial Query (RPC Function)
This Postgres function powers the mobile map, returning **grouped household pins** where *any* member of the household matches the searcher's Gujarat radius and optional age/life-stage filters:

```sql
CREATE OR REPLACE FUNCTION find_matching_households(
  p_current_lng DOUBLE PRECISION,
  p_current_lat DOUBLE PRECISION,
  p_current_radius_meters DOUBLE PRECISION, -- e.g., 16093 for 10 miles
  p_hometown_lng DOUBLE PRECISION,
  p_hometown_lat DOUBLE PRECISION,
  p_hometown_radius_meters DOUBLE PRECISION, -- e.g., 24140 for 15 miles
  p_age_brackets age_bracket_enum[] DEFAULT NULL,
  p_life_stages life_stage_enum[] DEFAULT NULL
)
RETURNS TABLE (
  household_id UUID,
  display_label TEXT,
  life_stage life_stage_enum,
  neighborhood_name TEXT,
  is_verified_local BOOLEAN,
  public_lng DOUBLE PRECISION,
  public_lat DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  members JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH origin_point AS (
    SELECT ST_SetSRID(ST_MakePoint(p_hometown_lng, p_hometown_lat), 4326)::geography AS geog
  ),
  dest_point AS (
    SELECT ST_SetSRID(ST_MakePoint(p_current_lng, p_current_lat), 4326)::geography AS geog
  )
  SELECT
    h.id AS household_id,
    h.display_label,
    h.life_stage,
    h.neighborhood_name,
    h.is_verified_local,
    ST_X(h.public_current_geog::geometry) AS public_lng,
    ST_Y(h.public_current_geog::geometry) AS public_lat,
    ST_Distance(h.public_current_geog, d.geog) AS distance_meters,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'user_id', u.id,
        'first_name', u.first_name,
        'avatar_url', u.avatar_url,
        'age_bracket', u.age_bracket,
        'hometown_name', u.hometown_name,
        'vouch_count', u.vouch_count,
        'interests', u.interests
      )
    ) AS members
  FROM households h
  JOIN users u ON u.household_id = h.id
  CROSS JOIN dest_point d
  CROSS JOIN origin_point o
  WHERE
    u.status = 'active'
    AND ST_DWithin(h.public_current_geog, d.geog, LEAST(p_current_radius_meters, 40233))
    AND ST_DWithin(u.hometown_geog, o.geog, LEAST(p_hometown_radius_meters, 80467))
    AND (p_age_brackets IS NULL OR u.age_bracket = ANY(p_age_brackets))
    AND (p_life_stages IS NULL OR h.life_stage = ANY(p_life_stages))
  GROUP BY h.id, d.geog
  ORDER BY distance_meters ASC
  LIMIT 100;
$$;
```

---

## 4. Row-Level Security (RLS) & Phone Number Protection

```sql
-- Enable RLS on all core tables
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE hometown_vouches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

-- 1. Column-level lock on exact GPS coordinates
REVOKE SELECT (exact_current_geog) ON households FROM anon, authenticated;

-- 2. Column-level lock on phone numbers (only revealed via accepted connection RPC)
REVOKE SELECT (phone_e164) ON users FROM anon, authenticated;

-- 3. Authenticated users can read active user profiles (excluding revoked columns)
CREATE POLICY "Active users are viewable by authenticated users"
  ON users FOR SELECT
  TO authenticated
  USING (status = 'active' OR auth.uid() = id);

-- 4. Users can only update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- 5. Connections are visible only to the requester or recipient
CREATE POLICY "Participants can view their connections"
  ON connections FOR SELECT
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

-- 6. Public Web H3 Density View (K-Anonymity >= 2 households per hex)
CREATE OR REPLACE VIEW web_h3_density_view AS
SELECT
  h.h3_index_res7,
  u.hometown_district,
  COUNT(DISTINCT h.id) AS household_count
FROM households h
JOIN users u ON u.household_id = h.id
WHERE u.status = 'active'
GROUP BY h.h3_index_res7, u.hometown_district
HAVING COUNT(DISTINCT h.id) >= 2;

GRANT SELECT ON web_h3_density_view TO anon, authenticated;
```

### Dedicated WhatsApp Handoff RPC (`get_whatsapp_handoff_link`)
Phone numbers (`phone_e164`) are never exposed in general queries. A user can only retrieve a neighbor's WhatsApp link after mutual connection acceptance:

```sql
CREATE OR REPLACE FUNCTION get_whatsapp_handoff_link(p_connection_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_other_phone TEXT;
  v_other_name TEXT;
  v_hometown TEXT;
BEGIN
  SELECT
    CASE WHEN c.requester_id = auth.uid() THEN u_rec.phone_e164 ELSE u_req.phone_e164 END,
    CASE WHEN c.requester_id = auth.uid() THEN u_rec.first_name ELSE u_req.first_name END,
    u_req.hometown_district
  INTO v_other_phone, v_other_name, v_hometown
  FROM connections c
  JOIN users u_req ON u_req.id = c.requester_id
  JOIN users u_rec ON u_rec.id = c.recipient_id
  WHERE c.id = p_connection_id
    AND c.status = 'accepted'
    AND (c.requester_id = auth.uid() OR c.recipient_id = auth.uid());

  IF v_other_phone IS NULL THEN
    RAISE EXCEPTION 'Connection not found or not mutually accepted';
  END IF;

  RETURN 'https://wa.me/' || LTRIM(v_other_phone, '+') ||
         '?text=' || REPLACE('Kem cho ' || v_other_name || '! Connected via our ' || v_hometown || ' neighborhood map in San Antonio.', ' ', '%20');
END;
$$;
```