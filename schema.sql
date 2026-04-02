create table sources (
  id serial primary key,
  platform varchar(50) not null,
  subreddit varchar(120) not null,
  game_key varchar(80) not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table raw_posts (
  id serial primary key,
  external_id varchar(120) not null unique,
  platform varchar(50) not null,
  subreddit varchar(120) not null,
  post_type varchar(20) not null,
  title text,
  body text,
  author_name varchar(120),
  score integer not null default 0,
  comments_count integer not null default 0,
  post_url text not null,
  created_at_source timestamptz not null,
  ingested_at timestamptz not null default now()
);

create table analyzed_feedback (
  id serial primary key,
  raw_post_id integer not null references raw_posts(id) on delete cascade,
  topic_key varchar(80) not null,
  sentiment varchar(20) not null,
  risk_score integer not null,
  risk_level varchar(20) not null,
  root_cause_summary text not null,
  action_suggestion text not null,
  is_cluster_candidate boolean not null default false,
  model_version varchar(80),
  analyzed_at timestamptz not null default now()
);

create table risk_daily_snapshot (
  id serial primary key,
  snapshot_date date not null,
  topic_key varchar(80) not null,
  negative_volume integer not null,
  negative_growth numeric(8,4) not null,
  discussion_heat integer not null,
  high_impact_count integer not null,
  risk_score integer not null,
  risk_level varchar(20) not null,
  unique (snapshot_date, topic_key)
);

create table alerts (
  id serial primary key,
  snapshot_date date not null,
  topic_key varchar(80) not null,
  risk_level varchar(20) not null,
  trigger_reason text not null,
  representative_post_url text,
  root_cause_summary text not null,
  action_suggestion text not null,
  owner_name varchar(120),
  delivery_channel varchar(120),
  delivered_at timestamptz
);

create table review_labels (
  id serial primary key,
  raw_post_id integer not null references raw_posts(id) on delete cascade,
  corrected_topic_key varchar(80),
  corrected_sentiment varchar(20),
  ignored boolean not null default false,
  note text,
  reviewer_name varchar(120),
  created_at timestamptz not null default now()
);

create table daily_reports (
  id serial primary key,
  report_date date not null unique,
  executive_summary text not null,
  report_payload jsonb not null,
  generated_at timestamptz not null default now()
);
