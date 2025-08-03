-- Add GitHub token storage to repository_clones table for sync functionality
ALTER TABLE public.repository_clones 
ADD COLUMN github_access_token TEXT;