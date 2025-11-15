create table if not exists scrap_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  country text,
  co2_kg_per_ton numeric(10,2),
  quality_score numeric(4,2),
  contact_email text,
  created_at timestamptz default now()
);

insert into scrap_suppliers (supplier_name, country, co2_kg_per_ton, quality_score)
values
('MetalRecycle_DE', 'Germany', 14.2, 9.2),
('StahlSchrott_NL', 'Netherlands', 18.7, 7.8),
('EuroScrap_BE', 'Belgium', 24.8, 6.4);
