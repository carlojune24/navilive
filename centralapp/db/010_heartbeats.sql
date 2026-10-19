-- one row per station laptop: its latest heartbeat, so the admin can see who is connected right now
create table if not exists station_heartbeats(
  event_id int not null references events on delete cascade,
  laptop_id text not null,
  laptop_name text not null default '',
  app_version text not null default '',
  payload jsonb not null default '{}'::jsonb,
  clock_skew_ms bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(event_id, laptop_id));
