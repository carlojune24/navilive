-- a team may wear one tag: every member of the bib carries it, so the tag is no longer unique across members
drop index if exists team_members_tag_key;
create index if not exists team_members_tag on team_members(event_id, upper(tag)) where tag <> '';
