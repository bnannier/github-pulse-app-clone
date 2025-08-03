-- Remove the automatic cron job for repository syncing
-- Syncing should only happen via webhook triggers, not on a schedule
SELECT cron.unschedule('sync-repositories-every-30min');