-- winner photos, kept in the database so they are backed up and deployed with everything else
create table if not exists participant_photos(
  participant_id int primary key references participants on delete cascade,
  mime text not null,
  data bytea not null,
  updated_at timestamptz not null default now());
