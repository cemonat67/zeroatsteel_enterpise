create view v_system_status as
select
  now() as timestamp,
  (select count(*) from furnaces) as furnace_count,
  (select max(timestamp) from furnace_realtime_metrics) as last_metric,
  (select count(*) from steel_alerts where status='active') as active_alerts;
