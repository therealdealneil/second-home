-- 20261128140000_step3_edge_atomicity_and_constraints.sql
-- Step 3.1 PR review remediations:
--   1. Atomic household + creator profile creation RPC (service_role only),
--      retrying invite_code collisions internally so 23505 is never misreported.
--   2. Deduplicate reverse-direction active/pending rows, then enforce one
--      pending/accepted connection per unordered user pair.
--   3. Remediate legacy violating icebreakers, then enforce phone filter that
--      blocks nonbreaking spaces while preserving ISO dates (e.g. 2026-11-28).

-- ---------------------------------------------------------------------------
-- 1. Atomic household + admin member creation
-- ---------------------------------------------------------------------------
create or replace function public.create_household_with_admin(
  p_display_label text,
  p_life_stage public.life_stage_enum,
  p_exact_lng double precision,
  p_exact_lat double precision,
  p_public_lng double precision,
  p_public_lat double precision,
  p_h3_index_res7 text,
  p_neighborhood_name text,
  p_user_id uuid,
  p_first_name text,
  p_avatar_url text,
  p_phone_e164 text,
  p_age_bracket public.age_bracket_enum,
  p_hometown_name text,
  p_hometown_district text,
  p_hometown_lng double precision,
  p_hometown_lat double precision,
  p_interests text[],
  p_status public.account_status_enum,
  p_whatsapp_alerts_opt_in boolean,
  p_last_verified_at timestamptz
)
returns table (
  id uuid,
  display_label text,
  life_stage public.life_stage_enum,
  h3_index_res7 text,
  neighborhood_name text,
  invite_code text,
  is_verified_local boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_display_label text;
  v_life_stage public.life_stage_enum;
  v_h3 text;
  v_neighborhood text;
  v_invite_code text;
  v_verified boolean;
  v_attempt int := 0;
  v_constraint text;
begin
  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.households (
        display_label,
        life_stage,
        exact_current_geog,
        public_current_geog,
        h3_index_res7,
        neighborhood_name,
        invite_code
      )
      values (
        p_display_label,
        p_life_stage,
        extensions.st_setsrid(extensions.st_makepoint(p_exact_lng, p_exact_lat), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(p_public_lng, p_public_lat), 4326)::extensions.geography,
        p_h3_index_res7,
        p_neighborhood_name,
        encode(extensions.gen_random_bytes(6), 'hex')
      )
      returning
        households.id,
        households.display_label,
        households.life_stage,
        households.h3_index_res7,
        households.neighborhood_name,
        households.invite_code,
        households.is_verified_local
      into
        v_household_id,
        v_display_label,
        v_life_stage,
        v_h3,
        v_neighborhood,
        v_invite_code,
        v_verified;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'households_invite_code_key' and v_attempt < 5 then
        continue;
      end if;
      raise;
    end;
  end loop;

  insert into public.users (
    id,
    household_id,
    is_household_admin,
    first_name,
    avatar_url,
    phone_e164,
    age_bracket,
    hometown_name,
    hometown_district,
    hometown_geog,
    interests,
    status,
    whatsapp_alerts_opt_in,
    last_verified_at
  )
  values (
    p_user_id,
    v_household_id,
    true,
    p_first_name,
    p_avatar_url,
    p_phone_e164,
    p_age_bracket,
    p_hometown_name,
    p_hometown_district,
    extensions.st_setsrid(extensions.st_makepoint(p_hometown_lng, p_hometown_lat), 4326)::extensions.geography,
    coalesce(p_interests, '{}'),
    p_status,
    coalesce(p_whatsapp_alerts_opt_in, false),
    p_last_verified_at
  );

  return query select
    v_household_id,
    v_display_label,
    v_life_stage,
    v_h3,
    v_neighborhood,
    v_invite_code,
    v_verified;
end;
$$;

revoke execute on function public.create_household_with_admin(
  text, public.life_stage_enum, double precision, double precision,
  double precision, double precision, text, text, uuid, text, text,
  text, public.age_bracket_enum, text, text, double precision,
  double precision, text[], public.account_status_enum, boolean, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_household_with_admin(
  text, public.life_stage_enum, double precision, double precision,
  double precision, double precision, text, text, uuid, text, text,
  text, public.age_bracket_enum, text, text, double precision,
  double precision, text[], public.account_status_enum, boolean, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Resolve reverse-direction active/pending pairs & enforce unordered index
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (
      partition by least(requester_id, recipient_id), greatest(requester_id, recipient_id)
      order by
        case when status = 'accepted' then 0 else 1 end,
        created_at asc,
        id asc
    ) as rn
  from public.connections
  where status in ('pending', 'accepted')
)
update public.connections c
set status = 'declined',
    responded_at = coalesce(c.responded_at, now())
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists connections_unordered_active_pair
  on public.connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status in ('pending', 'accepted');

-- ---------------------------------------------------------------------------
-- 3. Remediate legacy violating icebreakers & enforce stricter phone filter
-- ---------------------------------------------------------------------------
update public.connections
set icebreaker_text = null
where icebreaker_text is not null
  and regexp_replace(
        regexp_replace(icebreaker_text, '(?:^|[^0-9])(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}(?:$|[^0-9])', ' ', 'g'),
        E'[+(). \\t\\u00A0-]',
        '',
        'g'
      ) ~ '[0-9]{10,}';

alter table public.connections drop constraint if exists connections_icebreaker_no_phone;
alter table public.connections add constraint connections_icebreaker_no_phone check (
  icebreaker_text is null
  or regexp_replace(
       regexp_replace(icebreaker_text, '(?:^|[^0-9])(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}(?:$|[^0-9])', ' ', 'g'),
       E'[+(). \\t\\u00A0-]',
       '',
       'g'
     ) !~ '[0-9]{10,}'
);
