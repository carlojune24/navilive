-- The station's own identity of a read ("<boot_id>:<seq>"), so two different reads with the same device, time and tag
-- (manual Start and Finish typed with the same time, reads recovered after an ESP32 reboot) are no longer merged. '' = not sent
-- (older station apps, file uploads): those are matched by device, time and tag as before.
alter table reads add column if not exists src text not null default '';
alter table reads drop constraint if exists reads_event_id_device_id_read_at_ms_tag_key;
create unique index if not exists reads_identity_key on reads(event_id, device_id, read_at_ms, tag, src);
-- a void or restore made in the admin wins over the station's value when the station uploads that read again
alter table reads add column if not exists voided_by_admin boolean not null default false;
