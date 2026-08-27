create policy gift_power_mappings_clients_denied
on public.gift_power_mappings
for all
to anon, authenticated
using (false)
with check (false);
