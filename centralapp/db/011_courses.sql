-- which stations a category passes, in order. A category with no rows here uses every station of the event.
create table if not exists category_courses(
  category_id int not null references categories on delete cascade,
  station_id int not null references stations on delete cascade,
  ord int not null,
  primary key(category_id, station_id));
