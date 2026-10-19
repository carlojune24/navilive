-- the station name a laptop sent with each read, kept so reads under an unknown name can be diagnosed
alter table reads add column if not exists station_name_sent text not null default '';
update reads r set station_name_sent = s.name from stations s where r.station_id = s.id and r.station_name_sent = '';
