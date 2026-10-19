-- lets the live board show "last read N seconds ago" and detect a dead feed
alter table reads add column if not exists ingested_at timestamptz not null default now();
