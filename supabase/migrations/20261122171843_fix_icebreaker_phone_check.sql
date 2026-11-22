-- 20261122171843_fix_icebreaker_phone_check.sql
-- The 0001 regex allowed only ONE separator between digits, so "+1 (210) 555 1234"
-- (two-character separators like ") " and " (") slipped through. Allow up to two.
-- Still permits years/dates such as "2015-2020" (< 10 digits).
alter table public.connections drop constraint connections_icebreaker_no_phone;
alter table public.connections add constraint connections_icebreaker_no_phone check (
  icebreaker_text is null
  or icebreaker_text !~ '(\+?[0-9][ ().-]{0,2}){10,}'
);
