create table if not exists memories (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  content text not null,
  emotion text,
  importance integer default 1,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table memories enable row level security;

-- Create policy to allow access to service role (Edge Functions)
create policy "Service role can all memories"
  on memories
  for all
  to service_role
  using (true)
  with check (true);

-- Create index for faster retrieval by conversation
create index memories_conversation_id_idx on memories(conversation_id);
