-- what the public live board shows: hidden | checkpoints (finishes held back until reconciled) | released
-- a batch with a null release follows its category
alter table categories add column if not exists release text not null default 'checkpoints';
alter table batches add column if not exists release text;
