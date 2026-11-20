-- How a read got here, so a hand tap and an RFID read can be told apart without guessing from device_id:
-- rfid | station_manual (tapped on the station laptop) | admin_manual (typed in the admin) | marshal (phone tap).
-- Set by the server in insertReads; rows from before this column are backfilled from the markers they carry.
alter table reads add column if not exists source text not null default 'rfid';
-- only rows that are not a plain reader read are touched, so re-running the migration does not rewrite every read
update reads set source = case
  when device_id = 'MANUAL-CENTRAL' then 'admin_manual'
  when device_id = 'MANUAL' or src like 'manual-%' then 'station_manual'
  else 'marshal' end
  where source = 'rfid' and (device_id in ('MANUAL-CENTRAL', 'MANUAL') or src like 'manual-%' or client_ms is not null);
