-- 20261123032500_find_matching_households_all_members.sql
-- Step 2 follow-up migration (docs/00_project_handoff.md):
-- Moves the hometown/age filter into an EXISTS subquery so multi-origin households
-- return ALL linked active members in `members` (e.g., searching Ahmedabad returns
-- both spouses of an Ahmedabad/Vadodara household), and enforces 1-tap block
-- exclusion (`connections.status = 'blocked'` per docs/04 Layer 4B).

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
  ),
  caller as (
    select (select auth.uid()) as uid
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
        'hometown_district', u.hometown_district,
        'vouch_count', u.vouch_count,
        'interests', u.interests
      )
      order by u.is_household_admin desc, u.created_at asc, u.id asc
    ) as members
  from public.households h
  join public.users u on u.household_id = h.id
  cross join dest_point d
  cross join origin_point o
  cross join caller me_ctx
  where
    me_ctx.uid is not null
    and exists (
      select 1
      from public.users me
      where me.id = me_ctx.uid
        and me.status in ('quarantined', 'active', 'paused')
    )
    and not exists (
      select 1
      from public.users me_hh
      where me_hh.id = me_ctx.uid
        and me_hh.household_id = h.id
    )
    and u.status = 'active'
    -- docs/04 clamps: 25 mi current, 50 mi hometown, LIMIT 100
    and extensions.st_dwithin(
      h.public_current_geog,
      d.geog,
      least(greatest(coalesce(p_current_radius_meters, 0), 0), 40233)
    )
    and (
      p_life_stages is null
      or cardinality(p_life_stages) = 0
      or h.life_stage = any (p_life_stages)
    )
    and exists (
      select 1
      from public.users match_u
      where match_u.household_id = h.id
        and match_u.status = 'active'
        and extensions.st_dwithin(
          match_u.hometown_geog,
          o.geog,
          least(greatest(coalesce(p_hometown_radius_meters, 0), 0), 80467)
        )
        and (
          p_age_brackets is null
          or cardinality(p_age_brackets) = 0
          or match_u.age_bracket = any (p_age_brackets)
        )
    )
    -- Exclude households if any member has a blocked connection with the caller
    and not exists (
      select 1
      from public.connections c
      join public.users blocked_u on blocked_u.household_id = h.id
      where c.status = 'blocked'
        and (
          (c.requester_id = me_ctx.uid and c.recipient_id = blocked_u.id)
          or (c.recipient_id = me_ctx.uid and c.requester_id = blocked_u.id)
        )
    )
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
