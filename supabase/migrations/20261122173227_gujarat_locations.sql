-- 20261122173227_gujarat_locations.sql
-- Reference gazetteer table for all 33 Gujarat districts, major cities, talukas,
-- and prominent urban neighborhoods. Read-only for clients; mirrors
-- packages/shared/src/data/gujarat-locations.json.

create type public.gujarat_location_type_enum as enum (
  'district',
  'city',
  'taluka',
  'neighborhood'
);

create table public.gujarat_locations (
  id text primary key,
  name text not null,
  display_name text not null,
  district text not null,
  location_type public.gujarat_location_type_enum not null,
  lat double precision not null check (lat between 20.0 and 24.8),
  lng double precision not null check (lng between 68.0 and 74.6),
  geog extensions.geography(Point, 4326) not null,
  aliases text[] not null default '{}'
);

create index idx_gujarat_locations_geog on public.gujarat_locations using gist (geog);
create index idx_gujarat_locations_district on public.gujarat_locations (district);
create index idx_gujarat_locations_name_lower on public.gujarat_locations (lower(name));

alter table public.gujarat_locations enable row level security;

revoke all on public.gujarat_locations from anon, authenticated;
grant select on public.gujarat_locations to anon, authenticated;

create policy "Gujarat locations are publicly readable"
  on public.gujarat_locations for select
  to anon, authenticated
  using (true);
