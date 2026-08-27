create table if not exists public.leaderboard (
  platform_user_id text primary key,
  username text not null,
  total_score bigint not null default 0 check (total_score >= 0),
  wins bigint not null default 0 check (wins >= 0),
  rounds_played bigint not null default 0 check (rounds_played >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.leaderboard_results (
  result_id text primary key,
  platform_user_id text not null,
  recorded_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;
revoke all on table public.leaderboard from anon, authenticated;
grant select on table public.leaderboard to anon, authenticated;

drop policy if exists "leaderboard_public_read" on public.leaderboard;
create policy "leaderboard_public_read" on public.leaderboard for select to anon, authenticated using (true);

create or replace function public.record_leaderboard_result(
  p_result_id text,
  p_platform_user_id text,
  p_username text,
  p_score_increment bigint,
  p_win_increment bigint
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if nullif(btrim(p_result_id), '') is null or nullif(btrim(p_platform_user_id), '') is null then raise exception 'invalid identifier'; end if;
  if p_score_increment < 0 or p_win_increment not between 0 and 1 then raise exception 'invalid increment'; end if;
  insert into private.leaderboard_results(result_id, platform_user_id) values (left(p_result_id, 160), left(p_platform_user_id, 64)) on conflict do nothing;
  if not found then return false; end if;
  insert into public.leaderboard(platform_user_id, username, total_score, wins, rounds_played)
  values (left(p_platform_user_id, 64), left(coalesce(nullif(btrim(p_username), ''), 'fighter'), 40), p_score_increment, p_win_increment, 1)
  on conflict (platform_user_id) do update set
    username = excluded.username,
    total_score = public.leaderboard.total_score + excluded.total_score,
    wins = public.leaderboard.wins + excluded.wins,
    rounds_played = public.leaderboard.rounds_played + 1,
    updated_at = now();
  return true;
end;
$$;

revoke all on function public.record_leaderboard_result(text,text,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.record_leaderboard_result(text,text,text,bigint,bigint) to service_role;

create index if not exists leaderboard_rank_idx on public.leaderboard (total_score desc, wins desc, username asc);
