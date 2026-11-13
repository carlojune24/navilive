-- an event is archived first (hidden from the main list), then deleted: a delete only stamps deleted_at,
-- and the event is removed for good 30 days later (see the Events page load), so a wrong click can be undone
alter table events add column if not exists archived_at timestamptz;
alter table events add column if not exists deleted_at timestamptz;
