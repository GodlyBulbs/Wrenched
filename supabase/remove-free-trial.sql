-- Remove the 7-day free trial (Wrenched is now free with ads).
-- Run in Supabase → SQL Editor.

-- 1) See which trigger on auth.users grants the trial (copy its name):
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- 2) Drop it — replace TRIGGER_NAME with the name from step 1.
--    (Only drop the one that inserts a 'trialing' row into subscriptions.)
-- drop trigger if exists TRIGGER_NAME on auth.users;

-- 3) Optional cleanup: old trial rows don't matter (the app only treats
--    status = 'active' as ad-free), but this clears them out.
-- delete from public.subscriptions where status = 'trialing';
