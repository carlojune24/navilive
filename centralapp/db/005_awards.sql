-- winners within a category: by overall, gender, and age bracket
alter table participants add column if not exists gender text not null default '';
alter table participants add column if not exists age int;
alter table events add column if not exists award_places int not null default 3;
alter table events add column if not exists age_brackets text not null default '18-29,30-39,40-49,50-59,60+';
alter table events add column if not exists award_exclusive boolean not null default false;
