-- shown again in the admin "Connect" tab for easy station setup (DB is on the director's own laptop). Auth still uses api_key_hash.
alter table events add column if not exists api_key text;
