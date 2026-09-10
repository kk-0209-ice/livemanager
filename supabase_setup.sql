-- Live Manager v3 / Supabase setup
-- 1) Authentication > Providers で Email を有効化し、ユーザーを作成してください。
-- 2) SQL Editor でこのSQLを実行してください。

create table if not exists public.live_manager_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.live_manager_sync enable row level security;

create policy "live_manager_select_own"
on public.live_manager_sync for select
using (auth.uid() = user_id);

create policy "live_manager_insert_own"
on public.live_manager_sync for insert
with check (auth.uid() = user_id);

create policy "live_manager_update_own"
on public.live_manager_sync for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('cheki-images', 'cheki-images', false)
on conflict (id) do nothing;

create policy "cheki_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'cheki-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "cheki_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'cheki-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "cheki_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'cheki-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'cheki-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
