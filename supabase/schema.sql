create table if not exists public.wallet_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id text not null default 'main',
  type text not null check (type in ('add_member', 'topup', 'meal')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

alter table public.wallet_state enable row level security;
alter table public.wallet_requests enable row level security;

grant select on public.wallet_state to anon, authenticated;
grant insert, update on public.wallet_state to authenticated;
grant insert on public.wallet_requests to anon, authenticated;
grant select, update, delete on public.wallet_requests to authenticated;

drop policy if exists "wallet_state_public_read" on public.wallet_state;
create policy "wallet_state_public_read"
  on public.wallet_state
  for select
  using (true);

drop policy if exists "wallet_state_admin_insert" on public.wallet_state;
create policy "wallet_state_admin_insert"
  on public.wallet_state
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com');

drop policy if exists "wallet_state_admin_update" on public.wallet_state;
create policy "wallet_state_admin_update"
  on public.wallet_state
  for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com');

drop policy if exists "wallet_requests_public_insert" on public.wallet_requests;
create policy "wallet_requests_public_insert"
  on public.wallet_requests
  for insert
  to anon, authenticated
  with check (status = 'pending');

drop policy if exists "wallet_requests_admin_select" on public.wallet_requests;
create policy "wallet_requests_admin_select"
  on public.wallet_requests
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com');

drop policy if exists "wallet_requests_admin_update" on public.wallet_requests;
create policy "wallet_requests_admin_update"
  on public.wallet_requests
  for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com');

drop policy if exists "wallet_requests_admin_delete" on public.wallet_requests;
create policy "wallet_requests_admin_delete"
  on public.wallet_requests
  for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'zhichaoc86@gmail.com');

insert into public.wallet_state (id, data)
values (
  'main',
  '{"settings":{"swipePrice":12.5},"people":[],"transactions":[]}'::jsonb
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wallet_state'
  ) then
    alter publication supabase_realtime add table public.wallet_state;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wallet_requests'
  ) then
    alter publication supabase_realtime add table public.wallet_requests;
  end if;
end $$;
