-- a category's gun start typed by the organizer (epoch ms). Null = use the first Start read.
alter table categories add column if not exists gun_ms bigint;
