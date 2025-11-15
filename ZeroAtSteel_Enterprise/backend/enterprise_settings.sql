create table if not exists enterprise_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz default now()
);
