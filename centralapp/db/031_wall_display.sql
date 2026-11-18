-- finish wall display screen: the runner the organizer put on it (null = nothing shown)
alter table events add column if not exists wall_bib text;
alter table events add column if not exists wall_category int;
-- the name shown instead of the team or runner name (null = their own name)
alter table events add column if not exists wall_name text;
