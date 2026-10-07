-- WhatsApp & Slack channel integration ------------------------------------------------------
-- Per-channel on/off switch, sender → portal-user links, a log of every inbound message and
-- the reply sent back (with delivery status), and webhook receipts so platform retries are
-- de-duplicated across server instances. Written by the server with the service role; platform
-- admins can read everything through RLS.

create table public.channel_settings (
  channel    text primary key check (channel in ('whatsapp', 'slack')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.channel_settings (channel) values ('whatsapp'), ('slack')
  on conflict (channel) do nothing;

create table public.channel_sender_links (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('whatsapp', 'slack')),
  -- WhatsApp wa_id (digits with country code) or Slack member ID (U…/W…).
  sender_id  text not null check (char_length(sender_id) between 6 and 32),
  user_id    uuid not null references public.platform_users (user_id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Denormalised for display in the Settings list and activity log.
  user_name  text not null,
  created_at timestamptz not null default now(),
  unique (channel, sender_id)
);

create table public.channel_messages (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null check (channel in ('whatsapp', 'slack')),
  sender_id       text not null,
  sender_name     text,
  inbound_text    text not null check (char_length(inbound_text) <= 4000),
  reply_text      text,
  status          text not null default 'running'
                  check (status in ('running', 'replied', 'booked', 'failed', 'ignored')),
  -- Outbound leg: whether the reply reached WhatsApp/Slack. Test-console runs are 'skipped'.
  delivery_status text not null default 'pending'
                  check (delivery_status in ('pending', 'sent', 'failed', 'skipped')),
  booking_id      uuid references public.bookings (id) on delete set null,
  tools           text[] not null default '{}',
  steps           integer not null default 0 check (steps >= 0),
  tokens          integer not null default 0 check (tokens >= 0),
  duration_ms     integer check (duration_ms >= 0),
  is_test         boolean not null default false,
  error           text,
  created_at      timestamptz not null default now()
);

create index channel_messages_created_at_idx on public.channel_messages (created_at desc);
-- Multi-turn context: a sender's recent messages on one channel.
create index channel_messages_conversation_idx on public.channel_messages (channel, sender_id, created_at desc);

create table public.channel_webhook_receipts (
  key         text primary key, -- e.g. 'wa:<message id>', 'slack:<event id>'
  received_at timestamptz not null default now()
);

create index channel_webhook_receipts_received_at_idx on public.channel_webhook_receipts (received_at);

-- Row Level Security -----------------------------------------------------------------------
-- The webhooks and Settings use the service-role client (bypasses RLS). Signed-in platform
-- admins can read the configuration and logs; nobody else can see sender numbers.
alter table public.channel_settings         enable row level security;
alter table public.channel_sender_links     enable row level security;
alter table public.channel_messages         enable row level security;
alter table public.channel_webhook_receipts enable row level security;

create policy "admins manage channel settings"
  on public.channel_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "admins manage sender links"
  on public.channel_sender_links for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "admins read channel messages"
  on public.channel_messages for select to authenticated
  using (public.is_platform_admin());
