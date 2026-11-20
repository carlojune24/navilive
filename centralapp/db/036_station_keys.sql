-- One API key per station laptop, so a read can be traced to the laptop that sent it (the event key is shared by everyone).
-- Only the hash is stored: the key is shown once when made. revoked_at stops that laptop alone, without rotating the event key.
create table if not exists station_keys(
  id serial primary key,
  event_id int not null references events on delete cascade,
  label text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz);
create index if not exists station_keys_event on station_keys(event_id);
-- which key sent a read; null = the shared event key (or a marshal phone, a file upload, the admin)
alter table reads add column if not exists key_id int references station_keys on delete set null;
-- when on, reader and station-tap reads are accepted only with a station key; marshal phones keep using the event link
alter table events add column if not exists require_station_keys boolean not null default false;
