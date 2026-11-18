-- event sponsors: logos in the live board's footer, in the organizer's order
create table if not exists event_sponsors(
  id serial primary key,
  event_id int not null references events on delete cascade,
  name text not null,
  url text not null default '',
  mime text not null,
  data bytea not null,
  ord int not null default 0,
  updated_at timestamptz not null default now());
create index if not exists event_sponsors_event on event_sponsors(event_id, ord);
