-- the live board's Start view: the organizer rolls random runners of a category into the next batch and starts it there
alter table events add column if not exists live_start boolean not null default false;
alter table events add column if not exists roll_size int not null default 5;
