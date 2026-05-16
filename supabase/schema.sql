create table if not exists public.wallet_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.wallet_state enable row level security;

grant select on public.wallet_state to anon, authenticated;
grant insert, update on public.wallet_state to authenticated;

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
end $$;
