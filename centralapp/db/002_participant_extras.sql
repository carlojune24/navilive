-- bibs-only imports leave name blank; extra CSV columns (gender, age, team...) are kept as-is
alter table participants alter column name set default '';
alter table participants add column if not exists extra jsonb not null default '{}'::jsonb;
