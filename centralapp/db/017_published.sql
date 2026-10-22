-- events are drafts until published; the live board 404s for everyone but a signed-in admin
-- the backfill is inside the guard because migrate.ps1 re-applies every file, and a bare
-- update would re-publish an event the organiser had deliberately taken down
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='events' and column_name='published') then
    alter table events add column published boolean not null default false;
    update events set published = true; -- events from before this feature stay visible
  end if;
end $$;
