-- finish-time photo wall: one designed backdrop per category, and where its finish time is drawn
create table if not exists category_backdrops(
  category_id int primary key references categories on delete cascade,
  mime text not null,
  data bytea not null,
  x real not null default 50,       -- center of the time text, % of the image width
  y real not null default 30,       -- center of the time text, % of the image height
  size real not null default 12,    -- font size, % of the image width
  color text not null default '#ffffff',
  updated_at timestamptz not null default now());
