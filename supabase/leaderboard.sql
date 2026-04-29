create table if not exists public.leaderboard (
  player_key text primary key,
  name text not null,
  flag text not null default '🏳️',
  score integer not null default 0,
  wins integer not null default 0,
  games integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists leaderboard_score_idx
  on public.leaderboard (score desc, wins desc, games asc);
