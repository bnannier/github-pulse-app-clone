import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting scheduled repository update check');

    // Get all enabled clone relationships
    const { data: clones, error: clonesError } = await supabase
      .from('repository_clones')
      .select('*')
      .eq('sync_enabled', true);

    if (clonesError) {
      console.error('Error fetching clones:', clonesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch clone relationships' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!clones || clones.length === 0) {
      console.log('No enabled clone relationships found');
      return new Response(
        JSON.stringify({ message: 'No enabled clone relationships found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${clones.length} clone relationships to check`);

    let syncTriggered = 0;
    let upToDate = 0;
    let errors = 0;

    // Check each clone for updates
    for (const clone of clones) {
      try {
        const accessToken = clone.github_access_token;
        
        if (!accessToken) {
          console.log(`Skipping clone ${clone.id} - no access token`);
          errors++;
          continue;
        }

        // Get latest commit from original repository
        const originalResponse = await fetch(`https://api.github.com/repos/${clone.original_repo_full_name}/commits?per_page=1`, {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          }
        });

        if (!originalResponse.ok) {
          console.log(`Failed to fetch original commits for ${clone.original_repo_full_name}: ${originalResponse.statusText}`);
          errors++;
          continue;
        }

        const originalCommits = await originalResponse.json();
        if (originalCommits.length === 0) {
          console.log(`No commits found in original repository ${clone.original_repo_full_name}`);
          continue;
        }

        const latestOriginalSha = originalCommits[0].sha;

        // Get latest commit from cloned repository
        const clonedResponse = await fetch(`https://api.github.com/repos/${clone.cloned_repo_full_name}/commits?per_page=1`, {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          }
        });

        let latestClonedSha = null;
        if (clonedResponse.ok) {
          const clonedCommits = await clonedResponse.json();
          if (clonedCommits.length > 0) {
            latestClonedSha = clonedCommits[0].sha;
          }
        }

        // Check if sync is needed
        const needsSync = !latestClonedSha || latestOriginalSha !== latestClonedSha;
        
        if (needsSync) {
          console.log(`Updates detected for ${clone.cloned_repo_full_name} - triggering sync`);
          
          // Trigger sync in background
          supabase.functions.invoke('sync-repository', {
            body: {
              cloneId: clone.id,
              triggerSource: 'scheduled-check'
            }
          }).then(({ error }) => {
            if (error) {
              console.error(`Failed to trigger sync for clone ${clone.id}:`, error);
            } else {
              console.log(`Successfully triggered sync for ${clone.cloned_repo_full_name}`);
            }
          }).catch(error => {
            console.error(`Error triggering sync for clone ${clone.id}:`, error);
          });
          
          syncTriggered++;
        } else {
          console.log(`No updates needed for ${clone.cloned_repo_full_name}`);
          upToDate++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`Error checking clone ${clone.id}:`, error);
        errors++;
      }
    }

    console.log(`Update check completed: ${syncTriggered} syncs triggered, ${upToDate} up-to-date, ${errors} errors`);

    return new Response(
      JSON.stringify({ 
        success: true,
        checked: clones.length,
        syncTriggered,
        upToDate,
        errors,
        checkedAt: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Update check error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});