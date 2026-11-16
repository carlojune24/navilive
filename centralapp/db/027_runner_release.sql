-- one runner (or team) can be released on its own as soon as they finish; null = follows their batch, then category
alter table participants add column if not exists release text;
