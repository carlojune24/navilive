-- per-category award choices, custom awards and the reveal switch, edited on the Awards page (JSON, validated by the app)
alter table events add column if not exists award_config jsonb not null default '{}'::jsonb;
