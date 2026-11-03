-- Run once in your own Supabase SQL editor. No credentials belong in this file.
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

create table if not exists public.kb_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(title) between 1 and 200),
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  storage_path text not null,
  notes text not null default '',
  analysis_text text not null default '',
  analysis_kind text not null default 'text',
  status text not null default 'pending' check (status in ('pending','ready','needs_index','needs_notes','failed')),
  error text,
  truncated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (storage_path)
);
create table if not exists public.kb_chunks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  page integer,
  at_seconds double precision,
  embedding extensions.vector(1536) not null,
  unique(document_id,chunk_index)
);
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
drop policy if exists kb_docs_owner on public.kb_documents;
create policy kb_docs_owner on public.kb_documents for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and storage_path like auth.uid()::text || '/%');
drop policy if exists kb_chunks_owner on public.kb_chunks;
create policy kb_chunks_owner on public.kb_chunks for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (
  select 1 from public.kb_documents d where d.id = document_id and d.user_id = auth.uid()
));
grant select,insert,update,delete on public.kb_documents,public.kb_chunks to authenticated;
grant usage,select on sequence public.kb_chunks_id_seq to authenticated;

create or replace function public.match_kb_chunks(query_embedding extensions.vector(1536), match_count integer default 6)
returns table(id bigint,document_id uuid,user_id uuid,content text,page integer,at_seconds double precision,title text,mime_type text,similarity double precision)
language sql stable security invoker set search_path = public,extensions as $$
  select c.id,c.document_id,c.user_id,c.content,c.page,c.at_seconds,d.title,d.mime_type,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c join public.kb_documents d on d.id=c.document_id
  where c.user_id=auth.uid() and d.user_id=auth.uid() and d.status='ready'
  order by c.embedding <=> query_embedding limit least(greatest(match_count,1),8);
$$;
revoke all on function public.match_kb_chunks(extensions.vector,integer) from public,anon;
grant execute on function public.match_kb_chunks(extensions.vector,integer) to authenticated;

-- Durable model-operation quotas; clients cannot edit counters directly.
create table if not exists public.kb_daily_usage (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null default current_date,
  chats integer not null default 0,
  indexes integer not null default 0,
  primary key(user_id,day)
);
alter table public.kb_daily_usage enable row level security;
create or replace function public.reserve_kb_operation(operation text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); granted boolean;
begin
  if uid is null or operation not in ('chat','index') then return false; end if;
  insert into public.kb_daily_usage(user_id,day) values(uid,current_date) on conflict do nothing;
  if operation='chat' then
    update public.kb_daily_usage set chats=chats+1 where user_id=uid and day=current_date and chats<30 returning true into granted;
  else
    update public.kb_daily_usage set indexes=indexes+1 where user_id=uid and day=current_date and indexes<10 returning true into granted;
  end if;
  return coalesce(granted,false);
end $$;
revoke all on function public.reserve_kb_operation(text) from public,anon;
grant execute on function public.reserve_kb_operation(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('logihub-knowledge','logihub-knowledge',false,20971520,array[
 'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'text/plain','text/markdown','text/csv','image/jpeg','image/png','image/webp','video/mp4','video/webm'
]) on conflict(id) do nothing;
drop policy if exists kb_storage_owner on storage.objects;
create policy kb_storage_owner on storage.objects for all to authenticated
using (bucket_id='logihub-knowledge' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='logihub-knowledge' and (storage.foldername(name))[1]=auth.uid()::text);
