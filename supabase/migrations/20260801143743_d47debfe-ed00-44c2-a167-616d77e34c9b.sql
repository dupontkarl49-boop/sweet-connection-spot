CREATE TABLE public.agent_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  telegram_chat_id BIGINT,
  title TEXT NOT NULL DEFAULT 'Tâche',
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  interval_minutes INTEGER NOT NULL DEFAULT 1440,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  user_id UUID,
  status TEXT NOT NULL DEFAULT 'ok',
  output TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_tasks_due ON public.agent_tasks (active, next_run_at);
CREATE INDEX idx_agent_runs_task ON public.agent_runs (task_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tasks TO authenticated;
GRANT ALL ON public.agent_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own tasks" ON public.agent_tasks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage their own runs" ON public.agent_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);