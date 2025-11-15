create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text,
  source text,
  created_at timestamptz default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  chunk_index int,
  text text,
  summary text,
  created_at timestamptz default now()
);

create table if not exists document_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid references document_chunks(id) on delete cascade,
  embedding vector(1536)
);
