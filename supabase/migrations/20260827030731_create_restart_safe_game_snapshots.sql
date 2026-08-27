create table if not exists public.game_snapshots (
  snapshot_key text primary key,
  snapshot_version integer not null,
  round_id text not null,
  phase text not null,
  saved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  payload jsonb not null,
  constraint game_snapshots_singleton_key check (snapshot_key = 'active'),
  constraint game_snapshots_version_positive check (snapshot_version > 0),
  constraint game_snapshots_round_id_length check (char_length(round_id) between 1 and 120),
  constraint game_snapshots_phase_check check (phase in ('lobby','countdown','running','paused','ended')),
  constraint game_snapshots_expiry_check check (expires_at > saved_at),
  constraint game_snapshots_payload_size check (pg_column_size(payload) <= 262144)
);

create index if not exists game_snapshots_expires_at_idx on public.game_snapshots (expires_at);

alter table public.game_snapshots enable row level security;
revoke all on table public.game_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.game_snapshots to service_role;

comment on table public.game_snapshots is 'Single bounded restart-safe Neon Royale engine snapshot. Server-only via service role; expires by TTL.';
