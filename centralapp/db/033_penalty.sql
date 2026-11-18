-- a time penalty per runner or team, set by the organizer on the Progress page; added to the total time
alter table participants add column if not exists penalty_ms bigint not null default 0;
alter table participants add column if not exists penalty_note text not null default '';
