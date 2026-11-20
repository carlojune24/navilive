-- Who/when/why for every admin change to a read (void, restore, typed-in read). The admin has one shared password, so the actor is "admin".
-- read_id has no foreign key on purpose: the log must outlive the read it describes.
create table if not exists read_audit(
  id bigserial primary key,
  event_id int not null references events on delete cascade,
  read_id bigint not null,
  action text not null,
  reason text not null default '',
  at timestamptz not null default now());
create index if not exists read_audit_read on read_audit(event_id, read_id);
