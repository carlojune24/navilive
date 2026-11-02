-- Relay / duo: the team is one participants row (team bib, team name); each runner is a team_members row with their own tag.
-- A read of a member's tag counts for the team; the team is finished when every member has a finish read.
create table if not exists team_members (
  id bigserial primary key,
  event_id int not null references events(id) on delete cascade,
  participant_id int not null references participants(id) on delete cascade,
  name text not null,
  gender text not null default '',
  age int,
  leg int not null default 0,
  tag text not null default '',
  extra jsonb not null default '{}'::jsonb
);
create unique index if not exists team_members_tag_key on team_members(event_id, upper(tag)) where tag <> '';
create unique index if not exists team_members_name_key on team_members(participant_id, lower(name));
create index if not exists team_members_participant on team_members(participant_id);
