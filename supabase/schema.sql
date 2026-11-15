-- Form & Function: private per-user tracker backup
create table if not exists public.tracker_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"days":{},"measurements":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.tracker_data enable row level security;
drop policy if exists "Users can read their own tracker data" on public.tracker_data;
create policy "Users can read their own tracker data"
  on public.tracker_data for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own tracker data" on public.tracker_data;
create policy "Users can insert their own tracker data"
  on public.tracker_data for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own tracker data" on public.tracker_data;
create policy "Users can update their own tracker data"
  on public.tracker_data for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Ensure signed-in users can access the table through the Supabase Data API.
grant select, insert, update on public.tracker_data to authenticated;
revoke all on public.tracker_data from anon;
