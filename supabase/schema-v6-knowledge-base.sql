-- Migration v6 — Base de connaissances (pgvector + sources fichiers/URL)
-- Exécuter dans Supabase SQL Editor après schema.sql … schema-v5

alter table public.tenants add column if not exists website_url text;

create extension if not exists vector;

-- ─── Sources (PDF, Word, site web) ───────────────────────────────────────────
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_type text not null check (source_type in ('file', 'url')),
  title text not null,
  source_url text,
  storage_path text,
  file_name text,
  mime_type text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_sources_tenant_idx
  on public.knowledge_sources(tenant_id);

-- ─── Chunks + embeddings ─────────────────────────────────────────────────────
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  chunk_index int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_tenant_idx
  on public.knowledge_chunks(tenant_id);

create index if not exists knowledge_chunks_source_idx
  on public.knowledge_chunks(source_id);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- ─── Recherche sémantique (appelée via Supabase RPC) ─────────────────────────
create or replace function public.match_knowledge_chunks(
  p_tenant_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 5,
  p_match_threshold float default 0.45
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  similarity float,
  metadata jsonb
)
language sql
stable
as $$
  select
    kc.id,
    kc.source_id,
    kc.content,
    1 - (kc.embedding <=> p_query_embedding) as similarity,
    kc.metadata
  from public.knowledge_chunks kc
  where kc.tenant_id = p_tenant_id
    and kc.embedding is not null
    and 1 - (kc.embedding <=> p_query_embedding) >= p_match_threshold
  order by kc.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;

drop policy if exists "knowledge_sources_select_own" on public.knowledge_sources;
create policy "knowledge_sources_select_own" on public.knowledge_sources
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

drop policy if exists "knowledge_chunks_select_own" on public.knowledge_chunks;
create policy "knowledge_chunks_select_own" on public.knowledge_chunks
  for select using (
    tenant_id in (select id from public.tenants where user_id = auth.uid())
  );

-- Écritures via service role (Netlify Functions) uniquement

-- ─── Storage bucket (fichiers originaux) ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-files',
  'knowledge-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[]
)
on conflict (id) do nothing;
