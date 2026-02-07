alter table public.registrations
  add column if not exists discord_username text,
  add column if not exists discord_user_id text,
  add column if not exists discord_verified_at timestamptz;

create unique index if not exists registrations_discord_user_id_unique_not_null
  on public.registrations (discord_user_id)
  where discord_user_id is not null;
