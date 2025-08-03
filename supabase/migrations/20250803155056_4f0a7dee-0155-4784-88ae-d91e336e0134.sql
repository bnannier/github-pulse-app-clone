-- Create table to track repository clone relationships
CREATE TABLE public.repository_clones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  original_repo_full_name TEXT NOT NULL,
  cloned_repo_full_name TEXT NOT NULL,
  original_repo_url TEXT NOT NULL,
  cloned_repo_url TEXT NOT NULL,
  webhook_id TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.repository_clones ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own clone relationships" 
ON public.repository_clones 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own clone relationships" 
ON public.repository_clones 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clone relationships" 
ON public.repository_clones 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own clone relationships" 
ON public.repository_clones 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_repository_clones_updated_at
BEFORE UPDATE ON public.repository_clones
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for efficient lookups
CREATE INDEX idx_repository_clones_user_id ON public.repository_clones(user_id);
CREATE INDEX idx_repository_clones_original_repo ON public.repository_clones(original_repo_full_name);
CREATE INDEX idx_repository_clones_sync_enabled ON public.repository_clones(sync_enabled) WHERE sync_enabled = true;