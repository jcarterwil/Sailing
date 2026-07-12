-- Private buckets for raw uploads and processed tracks. Deliberately no
-- storage.objects policies: default-deny, so every read/write goes through
-- server-minted signed URLs after an application-level membership check.

insert into storage.buckets (id, name, public, file_size_limit)
values ('race-tracks-raw', 'race-tracks-raw', false, 10485760)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('race-tracks-processed', 'race-tracks-processed', false, 20971520)
on conflict (id) do nothing;
