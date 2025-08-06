import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-github-event, x-github-delivery, x-hub-signature-256',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify this is a GitHub webhook
    const githubEvent = req.headers.get('x-github-event');
    const githubDelivery = req.headers.get('x-github-delivery');
    
    if (!githubEvent || !githubDelivery) {
      return new Response(
        JSON.stringify({ error: 'Missing GitHub webhook headers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Received GitHub webhook: ${githubEvent} (${githubDelivery})`);

    const payload = await req.json();
    
    // Handle push events (when code is pushed to the original repo)
    if (githubEvent === 'push') {
      const repoFullName = payload.repository?.full_name;
      
      if (!repoFullName) {
        return new Response(
          JSON.stringify({ error: 'Repository not found in payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Push event for repository: ${repoFullName}`);

      // Find all clones of this repository
      const { data: clones, error } = await supabase
        .from('repository_clones')
        .select('*')
        .eq('original_repo_full_name', repoFullName)
        .eq('sync_enabled', true);

      if (error) {
        console.error('Error fetching clones:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch clone relationships' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Found ${clones?.length || 0} clones to sync`);

      // Trigger sync for each clone (don't await - let them run in background)
      if (clones && clones.length > 0) {
        for (const clone of clones) {
          // Start sync in background without waiting
          supabase.functions.invoke('sync-repository', {
            body: {
              cloneId: clone.id,
              triggerSource: 'webhook'
            }
          }).then(({ error }) => {
            if (error) {
              console.error(`Failed to sync clone ${clone.id}:`, error);
            } else {
              console.log(`Successfully triggered sync for clone: ${clone.cloned_repo_full_name}`);
            }
          }).catch(error => {
            console.error(`Error triggering sync for clone ${clone.id}:`, error);
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, event: githubEvent, processed: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});