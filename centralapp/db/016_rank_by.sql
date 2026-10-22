-- how a category's winner is decided: elapsed = shortest time from the category/batch start,
-- chip = shortest time from the runner's own start read, finish = first across the line by clock time
alter table categories add column if not exists rank_by text not null default 'elapsed' check (rank_by in ('elapsed','chip','finish'));
