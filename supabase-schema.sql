-- Run this in your Supabase SQL Editor

create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  account_type text not null,  -- 'tos' or 'webull'
  symbol text not null,
  pnl decimal not null,
  close_time timestamptz not null,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table trades enable row level security;

-- Each user can only see and edit their own trades
create policy "Users can manage their own trades"
  on trades for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
