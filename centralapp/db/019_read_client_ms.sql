-- a marshal tap is stamped with the server's clock; the phone's own stamp stays as the key that makes resends and Undo idempotent
alter table reads add column if not exists client_ms bigint;
create unique index if not exists reads_client_key on reads(event_id, device_id, tag, client_ms) where client_ms is not null;
