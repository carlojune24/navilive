create table if not exists events(
  id serial primary key, name text not null, date date, slug text unique not null, api_key_hash text);
create table if not exists categories(
  id serial primary key, event_id int not null references events on delete cascade,
  name text not null, unique(event_id, name));
create table if not exists participants(
  id serial primary key, event_id int not null references events on delete cascade,
  category_id int references categories on delete set null,
  bib text not null, name text not null, tag text not null default '',
  unique(event_id, bib));
create table if not exists stations(
  id serial primary key, event_id int not null references events on delete cascade,
  name text not null, kind text not null default 'checkpoint', ord int not null default 0,
  unique(event_id, name));
create table if not exists reads(
  id bigserial primary key, event_id int not null references events on delete cascade,
  station_id int references stations on delete set null,
  tag text not null, bib text, read_at_ms bigint not null, device_id text not null default '',
  voided boolean not null default false,
  unique(event_id, device_id, read_at_ms, tag));
create index if not exists reads_event_idx on reads(event_id, read_at_ms);
create or replace function reads_notify() returns trigger language plpgsql as $$
begin perform pg_notify('reads', new.event_id::text); return new; end $$;
drop trigger if exists reads_notify_trg on reads;
create trigger reads_notify_trg after insert on reads for each row execute function reads_notify();
