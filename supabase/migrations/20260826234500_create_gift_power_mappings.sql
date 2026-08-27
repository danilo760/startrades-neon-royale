create table if not exists public.gift_power_mappings (
  id uuid primary key default gen_random_uuid(),
  gift_id text not null unique check (char_length(gift_id) between 1 and 80),
  gift_name text not null check (char_length(gift_name) between 1 and 80),
  enabled boolean not null default true,
  power_id text not null check (char_length(power_id) between 1 and 64),
  target_mode text not null check (target_mode in ('SELF','TARGET_PLAYER','RANDOM_PLAYER','ALLY_LOWEST_HP','ENEMY','LEADER','RANDOM_ENEMY','ALL_PLAYERS','GLOBAL','BOSS')),
  magnitude numeric not null default 0 check (magnitude >= 0 and magnitude <= 1000),
  duration_ms integer not null default 0 check (duration_ms >= 0 and duration_ms <= 120000),
  cooldown_ms integer not null default 0 check (cooldown_ms >= 0 and cooldown_ms <= 120000),
  vfx_preset text not null default 'default' check (char_length(vfx_preset) between 1 and 64),
  sound_preset text not null default 'default' check (char_length(sound_preset) between 1 and 64),
  narration_preset text not null default 'fast' check (char_length(narration_preset) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gift_power_mappings enable row level security;
revoke all on table public.gift_power_mappings from anon, authenticated;
grant select, insert, update, delete on table public.gift_power_mappings to service_role;
create index if not exists gift_power_mappings_enabled_idx on public.gift_power_mappings (enabled, gift_id);

insert into public.gift_power_mappings (gift_id, gift_name, enabled, power_id, target_mode, magnitude, duration_ms, cooldown_ms, vfx_preset, sound_preset, narration_preset)
values
  ('5655','Rose',true,'entry-boost','SELF',1.2,5000,5000,'entry-spark','boost','fast'),
  ('neon-shield','Neon Shield',true,'tactical-shield','SELF',10,3000,12000,'shield-burst','shield','hype'),
  ('neon-speed','Neon Speed',true,'speed','SELF',1.35,5000,7000,'speed-trail','boost','fast'),
  ('neon-extra-shot','Finger Gun',true,'extra-projectile','SELF',7,0,7000,'neon-projectile','laser','fast'),
  ('neon-meteor','Meteor',true,'meteor','RANDOM_PLAYER',22,2000,12000,'meteor-warning','meteor','hype'),
  ('neon-star-power','Lion',true,'star-power','SELF',100,60000,30000,'golden-aura','legendary','legendary'),
  ('neon-colossus','Universe',true,'colossus','GLOBAL',1,45000,60000,'colossus-neon','boss','legendary')
on conflict (gift_id) do nothing;
