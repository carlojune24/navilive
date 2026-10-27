-- admin-corrected finish time for one runner, with the reason and a proof photo; the reads stay untouched
create table if not exists finish_overrides(
  participant_id int primary key references participants on delete cascade,
  finish_ms bigint not null,
  reason text not null,
  by text not null default '',
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now());
