-- Enforce ownership on agent tasks/runs without breaking Telegram-only tasks
CREATE OR REPLACE FUNCTION public.enforce_agent_task_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  IF NEW.user_id IS NULL AND NEW.telegram_chat_id IS NULL THEN
    RAISE EXCEPTION 'agent_tasks requires an owner (user_id or telegram_chat_id)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_agent_task_owner_trg ON public.agent_tasks;
CREATE TRIGGER enforce_agent_task_owner_trg
BEFORE INSERT OR UPDATE ON public.agent_tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_task_owner();

CREATE OR REPLACE FUNCTION public.enforce_agent_run_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_user uuid;
  t_chat bigint;
BEGIN
  SELECT user_id, telegram_chat_id INTO t_user, t_chat
  FROM public.agent_tasks WHERE id = NEW.task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_runs.task_id must reference an existing task';
  END IF;

  -- Ownership always derives from the parent task, never from the client payload
  NEW.user_id := t_user;

  IF NEW.user_id IS NULL AND t_chat IS NULL THEN
    RAISE EXCEPTION 'agent_runs requires an owner inherited from its task';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_agent_run_owner_trg ON public.agent_runs;
CREATE TRIGGER enforce_agent_run_owner_trg
BEFORE INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_run_owner();