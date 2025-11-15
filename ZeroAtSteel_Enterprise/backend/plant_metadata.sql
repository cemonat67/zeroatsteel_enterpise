create table if not exists plant_metadata (
  plant_id text primary key,
  name text,
  location text,
  timezone text,
  parameters jsonb,
  created_at timestamptz default now()
);
