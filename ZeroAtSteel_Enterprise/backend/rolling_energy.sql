create table if not exists rolling_energy (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz default now(),
  shift text,
  line_id text,
  kwh numeric(10,2),
  tons numeric(10,2),
  co2_kg numeric(10,2),
  created_at timestamptz default now()
);

create index if not exists idx_rolling_energy_ts on rolling_energy(timestamp desc);
