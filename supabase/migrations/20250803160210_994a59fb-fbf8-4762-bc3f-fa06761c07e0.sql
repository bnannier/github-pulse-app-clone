-- Fix the cron function to handle database operations properly
CREATE OR REPLACE FUNCTION public.sync_all_repositories()
RETURNS void AS $$
DECLARE
  clone_record RECORD;
  response_id bigint;
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
        headers := jsonb_build_object(
          'Content-Type', 'application/json', 
          'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweHVzZHZwenFkdHR0Zm1ieWFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjU1MzQ1MCwiZXhwIjoyMDY4MTI5NDUwfQ.hUAJQjrJo6g4KL2g-ZvCfY6rL4Gf5pEF4u1u2lLCrZg'
        ),
        body := jsonb_build_object(
          'cloneId', clone_record.id::text,
          'triggerSource', 'cron'
        )
      ) INTO response_id;
      
      RAISE LOG 'Triggered sync for clone % (response ID: %)', clone_record.id, response_id;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Failed to sync clone %: %', clone_record.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE LOG 'Completed scheduled repository sync';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';