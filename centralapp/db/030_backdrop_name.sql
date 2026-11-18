-- finish wall: the runner's or team's name is drawn on the backdrop too, placed like the time
alter table category_backdrops add column if not exists name_x real not null default 50;
alter table category_backdrops add column if not exists name_y real not null default 60;
alter table category_backdrops add column if not exists name_size real not null default 5;
alter table category_backdrops add column if not exists name_color text not null default '#ffffff';
