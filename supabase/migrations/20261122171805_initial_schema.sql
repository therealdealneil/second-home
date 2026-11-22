-- 20261122171805_initial_schema.sql
-- Source of truth: docs/03_data_privacy_schema.md (+ docs/04 for clamps).
--
-- Deliberate deviations from the doc's SQL (each protects an AGENTS.md guardrail
-- or hardens it). Anything not listed here should match the doc:
--   1. A column-level REVOKE does nothing while a table-level SELECT grant exists
--      (Supabase grants ALL on public tables to anon/authenticated by default). We
--      revoke table-level privileges, then GRANT SELECT on an explicit column list
--      that omits exact_current_geog / invite_code / phone_e164.
--   2. Clients get no INSERT/DELETE, and UPDATE only on self-editable columns, so a
--      user cannot flip their own status / vouch_count / household_id. All other
--      writes go through Edge Functions (service_role) with attestation.
--   3. SECURITY DEFINER functions set an explicit search_path and EXECUTE is
--      restricted to `authenticated` (Postgres grants EXECUTE to PUBLIC by default).
--   4. user_reports + auto-quarantine trigger are Step 3 and intentionally omitted.
--   5. Both RPCs require auth.uid() IS NOT NULL; find_matching_households also
--      requires the caller to have a users row that is quarantined/active (docs/04
--      lets quarantined users browse) so a bare OTP/anonymous session cannot sweep
--      the metro through PostgREST.
--   6. get_whatsapp_handoff_link also requires both parties to be active or paused
--      (paused = Ghost Mode keeps existing connections; suspended/quarantined do
--      not), and percent-encodes every byte of the greeting instead of replacing
--      only spaces, so a first_name cannot inject query parameters.
--   7. Extra NOT NULLs/defaults, CHECKs (phone E.164 format, <= 5 interests,
--      140-char icebreaker, no self-connection/self-vouch, no links/phone numbers
--      in icebreakers per docs/04), and WITH CHECK on the users update policy.
--   8. SECURITY DEFINER functions use search_path = '' with fully qualified names.
--   9. find_matching_households treats NULL/negative radii as 0 (clamps otherwise
--      unchanged: 25 mi / 50 mi / LIMIT 100).
--
-- Reminder for client code: with column-level grants, PostgREST `select=*` on
-- households/users fails with "permission denied". Always list columns. New columns
-- are private by default; add them to the GRANT lists below only deliberately.

-- ---------------------------------------------------------------------------
-- Extensions (kept out of `public`)
-- ---------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (keep in sync with packages/shared/src/enums.ts)
-- ---------------------------------------------------------------------------
create type public.age_bracket_enum as enum ('20s', '30s', '40s', '50s', '60_plus');
create type public.life_stage_enum as enum (
  'solo_student',
  'couple',
  'family_young_kids',
  'family_teens',
  'empty_nester_senior'
);
create type public.account_status_enum as enum ('quarantined', 'active', 'paused', 'suspended');
create type public.connection_status_enum as enum ('pending', 'accepted', 'declined', 'blocked');

-- ---------------------------------------------------------------------------
-- 1. households: one pin per physical home
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  display_label text,
  life_stage public.life_stage_enum,
  -- SENSITIVE: never exposed to clients
  exact_current_geog extensions.geography(Point, 4326) not null,
  -- Fuzzed once at creation (0.5-1.5 mi) by the create-household Edge Function; never recomputed on read
  public_current_geog extensions.geography(Point, 4326) not null,
  h3_index_res7 text not null,
  neighborhood_name text,
  -- SENSITIVE: join secret, never exposed to clients
  invite_code text unique not null default encode(extensions.gen_random_bytes(6), 'hex'),
  is_verified_local boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_households_public_geog on public.households using gist (public_current_geog);
create index idx_households_h3 on public.households (h3_index_res7);

-- ---------------------------------------------------------------------------
-- 2. users: household members + Gujarat hometown
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  is_household_admin boolean not null default true,
  first_name text not null,
  avatar_url text,
  -- SENSITIVE: released only via get_whatsapp_handoff_link
  phone_e164 text unique not null,
  age_bracket public.age_bracket_enum,
  hometown_name text not null,
  hometown_district text not null,
  hometown_geog extensions.geography(Point, 4326) not null,
  interests text[] not null default '{}',
  status public.account_status_enum not null default 'quarantined',
  vouch_count int not null default 0,
  whatsapp_alerts_opt_in boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint users_interests_max_5 check (cardinality(interests) <= 5),
  constraint users_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

create index idx_users_hometown_geog on public.users using gist (hometown_geog);
create index idx_users_household_id on public.users (household_id);
create index idx_users_status_age on public.users (status, age_bracket);

-- ---------------------------------------------------------------------------
-- 3. connections
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,
  icebreaker_text text,
  status public.connection_status_enum not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id),
  -- docs/04: no URLs or phone numbers in icebreakers; docs/01: 140-char note
  constraint connections_icebreaker_len check (icebreaker_text is null or char_length(icebreaker_text) <= 140),
  constraint connections_icebreaker_no_links check (
    icebreaker_text is null
    or icebreaker_text !~* '(https?://|(^|[^a-z0-9])(wa|t)\.me)'
  ),
  -- 10+ digits (optional single separators) = phone number; years/dates stay allowed
  constraint connections_icebreaker_no_phone check (
    icebreaker_text is null
    or icebreaker_text !~ '(\+?[0-9][ ().-]?){10,}'
  )
);

create index idx_connections_requester on public.connections (requester_id, status);
create index idx_connections_recipient on public.connections (recipient_id, status);

-- ---------------------------------------------------------------------------
-- 4. hometown_vouches
-- ---------------------------------------------------------------------------
create table public.hometown_vouches (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.users (id) on delete cascade,
  vouched_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (voucher_id, vouched_user_id),
  check (voucher_id <> vouched_user_id)
);

create index idx_hometown_vouches_vouched on public.hometown_vouches (vouched_user_id);

-- ---------------------------------------------------------------------------
-- RLS (enabled in the same migration that creates the tables)
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.users enable row level security;
alter table public.connections enable row level security;
alter table public.hometown_vouches enable row level security;

-- ---------------------------------------------------------------------------
-- Privilege lockdown: revoke everything, then grant back the minimum
-- ---------------------------------------------------------------------------
revoke all on public.households from anon, authenticated;
revoke all on public.users from anon, authenticated;
revoke all on public.connections from anon, authenticated;
revoke all on public.hometown_vouches from anon, authenticated;

-- Column-level SELECT lists deliberately omit exact_current_geog, invite_code, phone_e164.
grant select (
  id, display_label, life_stage, public_current_geog, h3_index_res7,
  neighborhood_name, is_verified_local, created_at, updated_at
) on public.households to authenticated;

grant select (
  id, household_id, is_household_admin, first_name, avatar_url, age_bracket,
  hometown_name, hometown_district, hometown_geog, interests, status,
  vouch_count, whatsapp_alerts_opt_in, last_verified_at, created_at
) on public.users to authenticated;

-- Self-editable columns only (never status, vouch_count, household_id, phone_e164)
grant update (first_name, avatar_url, age_bracket, interests, whatsapp_alerts_opt_in)
  on public.users to authenticated;

grant select on public.connections to authenticated;

-- Policies
create policy "Active users are viewable by authenticated users"
  on public.users for select
  to authenticated
  using (status = 'active' or (select auth.uid()) = id);

create policy "Users can update own profile"
  on public.users for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Participants can view their connections"
  on public.connections for select
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = recipient_id);

-- households / hometown_vouches: RLS on with no client policies => no direct client
-- access. Clients read households through find_matching_households only.

-- ---------------------------------------------------------------------------
-- find_matching_households (dual-radius spatial RPC, docs/03 section 3)
-- ---------------------------------------------------------------------------
create or replace function public.find_matching_households(
  p_current_lng double precision,
  p_current_lat double precision,
  p_current_radius_meters double precision,
  p_hometown_lng double precision,
  p_hometown_lat double precision,
  p_hometown_radius_meters double precision,
  p_age_brackets public.age_bracket_enum[] default null,
  p_life_stages public.life_stage_enum[] default null
)
returns table (
  household_id uuid,
  display_label text,
  life_stage public.life_stage_enum,
  neighborhood_name text,
  is_verified_local boolean,
  public_lng double precision,
  public_lat double precision,
  distance_meters double precision,
  members jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with origin_point as (
    select extensions.st_setsrid(extensions.st_makepoint(p_hometown_lng, p_hometown_lat), 4326)::extensions.geography as geog
  ),
  dest_point as (
    select extensions.st_setsrid(extensions.st_makepoint(p_current_lng, p_current_lat), 4326)::extensions.geography as geog
  )
  select
    h.id as household_id,
    h.display_label,
    h.life_stage,
    h.neighborhood_name,
    h.is_verified_local,
    extensions.st_x(h.public_current_geog::extensions.geometry) as public_lng,
    extensions.st_y(h.public_current_geog::extensions.geometry) as public_lat,
    extensions.st_distance(h.public_current_geog, d.geog) as distance_meters,
    jsonb_agg(
      jsonb_build_object(
        'user_id', u.id,
        'first_name', u.first_name,
        'avatar_url', u.avatar_url,
        'age_bracket', u.age_bracket,
        'hometown_name', u.hometown_name,
        'vouch_count', u.vouch_count,
        'interests', u.interests
      )
    ) as members
  from public.households h
  join public.users u on u.household_id = h.id
  cross join dest_point d
  cross join origin_point o
  where
    exists (
      select 1 from public.users me
      where me.id = (select auth.uid())
        and me.status in ('quarantined', 'active')
    )
    and u.status = 'active'
    -- docs/04 clamps: 25 mi current, 50 mi hometown, LIMIT 100
    and extensions.st_dwithin(
      h.public_current_geog, d.geog,
      least(greatest(coalesce(p_current_radius_meters, 0), 0), 40233)
    )
    and extensions.st_dwithin(
      u.hometown_geog, o.geog,
      least(greatest(coalesce(p_hometown_radius_meters, 0), 0), 80467)
    )
    and (p_age_brackets is null or u.age_bracket = any (p_age_brackets))
    and (p_life_stages is null or h.life_stage = any (p_life_stages))
  group by h.id, d.geog
  order by distance_meters asc
  limit 100;
$$;

revoke execute on function public.find_matching_households(
  double precision, double precision, double precision,
  double precision, double precision, double precision,
  public.age_bracket_enum[], public.life_stage_enum[]
) from public, anon;
grant execute on function public.find_matching_households(
  double precision, double precision, double precision,
  double precision, double precision, double precision,
  public.age_bracket_enum[], public.life_stage_enum[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- get_whatsapp_handoff_link: the ONLY path that releases a phone number
-- ---------------------------------------------------------------------------
create or replace function public.get_whatsapp_handoff_link(p_connection_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_other_phone text;
  v_other_name text;
  v_hometown text;
  v_text text;
begin
  if v_uid is null then
    raise exception 'Connection not found or not mutually accepted';
  end if;

  select
    case when c.requester_id = v_uid then u_rec.phone_e164 else u_req.phone_e164 end,
    case when c.requester_id = v_uid then u_rec.first_name else u_req.first_name end,
    u_req.hometown_district
  into v_other_phone, v_other_name, v_hometown
  from public.connections c
  join public.users u_req on u_req.id = c.requester_id
  join public.users u_rec on u_rec.id = c.recipient_id
  where c.id = p_connection_id
    and c.status = 'accepted'
    and u_req.status in ('active', 'paused')
    and u_rec.status in ('active', 'paused')
    and (c.requester_id = v_uid or c.recipient_id = v_uid);

  if v_other_phone is null then
    raise exception 'Connection not found or not mutually accepted';
  end if;

  v_text := 'Kem cho ' || v_other_name || '! Connected via our ' || v_hometown
            || ' neighborhood map in San Antonio.';

  -- Percent-encode every UTF-8 byte so user-supplied names cannot inject query params.
  return 'https://wa.me/' || ltrim(v_other_phone, '+') || '?text='
         || regexp_replace(encode(convert_to(v_text, 'UTF8'), 'hex'), '(..)', '%\1', 'g');
end;
$$;

revoke execute on function public.get_whatsapp_handoff_link(uuid) from public, anon;
grant execute on function public.get_whatsapp_handoff_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- web_h3_density_view: public, k-anonymous (>= 2 households per H3 res-7 cell)
-- Intentionally NOT security_invoker: anon has no table access, so the view runs
-- with owner rights. It exposes only h3 index, district and an aggregate count.
-- ---------------------------------------------------------------------------
create or replace view public.web_h3_density_view as
select
  h.h3_index_res7,
  u.hometown_district,
  count(distinct h.id) as household_count
from public.households h
join public.users u on u.household_id = h.id
where u.status = 'active'
group by h.h3_index_res7, u.hometown_district
having count(distinct h.id) >= 2;

revoke all on public.web_h3_density_view from public, anon, authenticated;
grant select on public.web_h3_density_view to anon, authenticated;
