CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  telegram_chat_id bigint,
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'sigma',
  ref_id text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.gmail_watch_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  telegram_chat_id bigint,
  enabled boolean NOT NULL DEFAULT true,
  auto_draft boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_seen_internal_ms bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_watch_state TO authenticated;
GRANT ALL ON public.gmail_watch_state TO service_role;
ALTER TABLE public.gmail_watch_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own gmail watch" ON public.gmail_watch_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  telegram_chat_id bigint,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_actions TO authenticated;
GRANT ALL ON public.pending_actions TO service_role;
ALTER TABLE public.pending_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own pending actions" ON public.pending_actions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);