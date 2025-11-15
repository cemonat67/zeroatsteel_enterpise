create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text,
  rule jsonb,
  enabled boolean default true,
  created_at timestamptz default now()
);
