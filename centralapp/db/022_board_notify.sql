-- Open boards refetch on pg_notify('reads', <event id>). Until now only a new read sent it, so a batch move, bib edit,
-- category change, station change or a station's void left the boards stale until the next read arrived.
-- Postgres sends one notification per transaction for repeated identical payloads, so a 1000-row import is one refresh.
create or replace function board_notify() returns trigger language plpgsql as $$
declare r record := coalesce(new, old);
begin
  if tg_table_name in ('batches', 'category_courses', 'category_station_km') then
    perform pg_notify('reads', (select event_id::text from categories where id = r.category_id));
  else
    perform pg_notify('reads', r.event_id::text);
  end if;
  return null;
end $$;

drop trigger if exists reads_notify_trg on reads;
drop trigger if exists board_notify_trg on reads;
create trigger board_notify_trg after insert or update or delete on reads for each row execute function board_notify();
drop trigger if exists board_notify_trg on participants;
create trigger board_notify_trg after insert or update or delete on participants for each row execute function board_notify();
drop trigger if exists board_notify_trg on categories;
create trigger board_notify_trg after insert or update or delete on categories for each row execute function board_notify();
drop trigger if exists board_notify_trg on stations;
create trigger board_notify_trg after insert or update or delete on stations for each row execute function board_notify();
drop trigger if exists board_notify_trg on batches;
create trigger board_notify_trg after insert or update or delete on batches for each row execute function board_notify();
drop trigger if exists board_notify_trg on category_courses;
create trigger board_notify_trg after insert or update or delete on category_courses for each row execute function board_notify();
drop trigger if exists board_notify_trg on category_station_km;
create trigger board_notify_trg after insert or update or delete on category_station_km for each row execute function board_notify();
