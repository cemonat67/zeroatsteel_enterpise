alter table furnaces enable row level security;
create policy read_furnaces on furnaces for select to anon using (true);

alter table furnace_realtime_metrics enable row level security;
create policy read_realtime on furnace_realtime_metrics for select to anon using (true);

alter table steel_alerts enable row level security;
create policy write_alerts on steel_alerts for insert to service_role with check (true);
create policy read_alerts on steel_alerts for select to anon using (true);
