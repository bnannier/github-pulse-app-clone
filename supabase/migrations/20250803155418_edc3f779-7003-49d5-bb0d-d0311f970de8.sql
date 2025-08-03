-- Fix function search path by setting it explicitly
CREATE OR REPLACE FUNCTION public.sync_all_repositories()
RETURNS void AS $$
DECLARE
  clone_record RECORD;
  response_id uuid;
BEGIN
  -- Log the start of the sync process
  RAISE LOG 'Starting scheduled repository sync';
  
  -- Loop through all enabled clone relationships
  FOR clone_record IN 
    SELECT id, original_repo_full_name, cloned_repo_full_name, user_id, last_synced_at
    FROM public.repository_clones 
    WHERE sync_enabled = true
  LOOP
    BEGIN
      -- Make HTTP request to sync function
      SELECT net.http_post(
        url := 'https://bpxusdvpzqdtttfmbyai.supabase.co/functions/v1/sync-repository',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweHVzZHZwenFkdHR0Zm1ieWFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1NTM0NTAsImV4cCI6MjA2ODEyOTQ1MH0.X7ycYcF3evEtYiZKlgmzXax8BFEksSLf0Fti6XQ4-Xs"}'::jsonb,
        body := format('{"cloneId": "%s", "triggerSource": "cron"}', clone_record.id)::jsonb
      ) INTO response_id;
      
      RAISE LOG 'Triggered sync for clone % (response ID: %)', clone_record.id, response_id;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Failed to sync clone %: %', clone_record.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE LOG 'Completed scheduled repository sync';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';