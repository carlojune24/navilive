-- the event's GPX route (compact points, see src/lib/gpx.ts) and where each station sits on it, by km
alter table events add column if not exists gpx jsonb;
alter table events add column if not exists gpx_name text;
alter table stations add column if not exists km numeric;
alter table stations add column if not exists services text[] not null default '{}';
