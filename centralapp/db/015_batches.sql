-- categories are archived, not deleted; a category can be split into batches that start separately
alter table categories add column if not exists archived_at timestamptz;
create table if not exists batches(
  id serial primary key,
  category_id int not null references categories on delete cascade,
  name text not null,
  gun_ms bigint, -- null = not started
  unique(category_id, name)
);
alter table participants add column if not exists batch_id int references batches on delete set null;
