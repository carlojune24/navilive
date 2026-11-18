-- the Hidden release level is gone: anything still hidden shows as Results pending
update categories set release='checkpoints' where release='hidden';
update batches set release='checkpoints' where release='hidden';
update participants set release='checkpoints' where release='hidden';
-- the proof photo of a finish override is optional
alter table finish_overrides alter column mime drop not null;
alter table finish_overrides alter column data drop not null;
