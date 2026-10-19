-- a route (GPX) belongs to a category (a distance), and so does each station's km on it; services stay on the station.
-- events.gpx / events.gpx_name / stations.km (012) are no longer read.
alter table categories add column if not exists gpx jsonb;
alter table categories add column if not exists gpx_name text;
create table if not exists category_station_km(
  category_id int not null references categories on delete cascade,
  station_id int not null references stations on delete cascade,
  km numeric not null,
  primary key(category_id, station_id));
-- carry an event-wide route over: every category of that event gets it, with the stations' km
update categories c set gpx=e.gpx, gpx_name=e.gpx_name from events e where e.id=c.event_id and e.gpx is not null and c.gpx is null;
insert into category_station_km select c.id, s.id, s.km from categories c join stations s on s.event_id=c.event_id where s.km is not null on conflict do nothing;
