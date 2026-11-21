-- One tag, one runner (or one team: its members may share the team's tag). Two runners with the same tag would both get
-- every read of it, so both would be timed. Checked at commit, so a file that swaps two runners' tags still imports.
-- Existing rows are not re-checked; this guards every write from now on, whatever path it comes through.
create or replace function tag_unique_check() returns trigger language plpgsql as $$
declare
  cur text;
  owner text;
  self int;
begin
  if tg_table_name = 'participants' then
    select tag into cur from participants where id = new.id;
    self := new.id;
  else
    select tag into cur from team_members where id = new.id;
    self := new.participant_id;
  end if;
  -- unchanged tag: nothing to check or move (a re-import touches every row)
  if tg_op = 'UPDATE' and upper(coalesce(old.tag, '')) = upper(coalesce(cur, '')) then return null; end if;
  -- a read keeps the bib its tag had when it arrived, so a corrected tag must take its reads along:
  -- reads of the tag given up stop pointing here (they follow that tag's new owner, if any)
  if tg_op = 'UPDATE' and coalesce(old.tag, '') <> '' then
    update reads r set bib = coalesce(
        (select p.bib from participants p where p.event_id = new.event_id and p.tag <> '' and upper(p.tag) = upper(old.tag) limit 1),
        (select p.bib from team_members m join participants p on p.id = m.participant_id where m.event_id = new.event_id and m.tag <> '' and upper(m.tag) = upper(old.tag) limit 1))
     where r.event_id = new.event_id and upper(r.tag) = upper(old.tag) and r.bib = (select bib from participants where id = self);
  end if;
  if cur is null or cur = '' then return null; end if;
  -- one check at a time per event, so two imports at once cannot both take the same tag
  perform pg_advisory_xact_lock(hashtext('tag_unique:' || new.event_id));
  select p.bib into owner from participants p
   where p.event_id = new.event_id and p.id <> self and p.tag <> '' and upper(p.tag) = upper(cur) limit 1;
  if owner is null then
    select p.bib into owner from team_members m join participants p on p.id = m.participant_id
     where m.event_id = new.event_id and m.participant_id <> self and m.tag <> '' and upper(m.tag) = upper(cur) limit 1;
  end if;
  if owner is not null then
    raise exception 'Tag % is already assigned to bib %', cur, owner using errcode = '23505';
  end if;
  -- ...and reads of the tag now worn here come here
  update reads r set bib = (select bib from participants where id = self)
   where r.event_id = new.event_id and upper(r.tag) = upper(cur) and r.bib is distinct from (select bib from participants where id = self);
  return null;
end $$;

drop trigger if exists tag_unique_trg on participants;
create constraint trigger tag_unique_trg after insert or update of tag on participants
  deferrable initially deferred for each row execute function tag_unique_check();
drop trigger if exists tag_unique_trg on team_members;
create constraint trigger tag_unique_trg after insert or update of tag on team_members
  deferrable initially deferred for each row execute function tag_unique_check();

-- the read matching (stationdata MATCH) looks runners up by tag
create index if not exists participants_tag on participants(event_id, upper(tag)) where tag <> '';
-- tag changes move that tag's reads (tag_unique_check)
create index if not exists reads_tag on reads(event_id, upper(tag));
