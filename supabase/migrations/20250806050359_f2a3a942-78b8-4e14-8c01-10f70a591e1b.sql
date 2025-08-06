-- Create a cron job to check for repository updates every 5 minutes
SELECT cron.schedule(
  'check-repository-updates',
  '*/5 * * * *', -- every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://bpxusdvpzqdtttfmbyai.supabase.co/functions/v1/check-repository-updates',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweHVzZHZwenFkdHR0Zm1ieWFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjU1MzQ1MCwiZXhwIjoyMDY4MTI5NDUwfQ.hUAJQjrJo6g4KL2g-ZvCfY6rL4Gf5pEF4u1u2lLCrZg"}'::jsonb,
        body:='{"source": "cron"}'::jsonb
    ) as request_id;
  $$
);