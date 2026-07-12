-- Keep crew role demotions authoritative for destructive entry operations.
-- Boat editors may edit metadata and tracks, but deleting an entry remains
-- limited to race organizers, boat managers, and legacy creators who have no
-- current membership on the boat.
drop policy "Organizer or entry owner delete entries" on public.race_entries;

create policy "Organizer, boat manager, or legacy owner delete entries"
on public.race_entries
for delete
to authenticated
using (
  public.is_race_organizer(race_id)
  or public.can_manage_boat(boat_id)
  or (
    added_by = (select auth.uid())
    and not public.can_view_boat(boat_id)
  )
);
