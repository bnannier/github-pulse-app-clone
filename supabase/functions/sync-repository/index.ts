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

    const { cloneId, triggerSource = 'manual' } = await req.json();
    
    if (!cloneId) {
      return new Response(
        JSON.stringify({ error: 'Clone ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting sync for clone ${cloneId} (triggered by: ${triggerSource})`);

    // Get clone relationship details using service role for cron access
    const { data: clone, error: cloneError } = await supabase
      .from('repository_clones')
      .select('*')
      .eq('id', cloneId)
      .maybeSingle();

    if (cloneError || !clone) {
      console.error('Clone not found:', cloneError);
      return new Response(
        JSON.stringify({ error: 'Clone relationship not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!clone.sync_enabled) {
      return new Response(
        JSON.stringify({ error: 'Sync is disabled for this clone' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the stored GitHub access token
    const accessToken = clone.github_access_token;

    if (!accessToken) {
      console.error('GitHub access token not found in clone relationship');
      return new Response(
        JSON.stringify({ error: 'GitHub access token not found. Repository may need to be re-cloned.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    console.log(`Syncing from ${clone.original_repo_full_name} to ${clone.cloned_repo_full_name}`);

    // Get the latest commit from original repository
    const originalCommitsResponse = await fetch(`https://api.github.com/repos/${clone.original_repo_full_name}/commits?per_page=1`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!originalCommitsResponse.ok) {
      throw new Error(`Failed to fetch commits from original repository: ${originalCommitsResponse.statusText}`);
    }

    const originalCommits = await originalCommitsResponse.json();
    
    if (originalCommits.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No commits found in original repository' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const latestCommit = originalCommits[0];

    // Get the tree from the latest commit
    const treeResponse = await fetch(`https://api.github.com/repos/${clone.original_repo_full_name}/git/trees/${latestCommit.sha}?recursive=1`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!treeResponse.ok) {
      throw new Error(`Failed to fetch tree: ${treeResponse.statusText}`);
    }

    const tree = await treeResponse.json();

    // Get current files in cloned repository
    const clonedContentsResponse = await fetch(`https://api.github.com/repos/${clone.cloned_repo_full_name}/contents`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    let existingFiles: any[] = [];
    if (clonedContentsResponse.ok) {
      existingFiles = await clonedContentsResponse.json();
    }

    let filesUpdated = 0;
    let filesCreated = 0;

    // Sync files from original to clone
    for (const item of tree.tree) {
      if (item.type === 'blob' && item.path !== 'README.md') {
        try {
          // Get file content from original repository
          const fileResponse = await fetch(`https://api.github.com/repos/${clone.original_repo_full_name}/contents/${item.path}`, {
            headers: {
              'Authorization': `token ${accessToken}`,
              'Accept': 'application/vnd.github.v3+json',
            }
          });

          if (!fileResponse.ok) {
            console.log(`Skipping file ${item.path}: ${fileResponse.statusText}`);
            continue;
          }

          const fileData = await fileResponse.json();
          
          // Check if file exists in cloned repository
          const existingFile = existingFiles.find(f => f.name === item.path);
          
          const updateData: any = {
            message: `Sync: Update ${item.path} from ${clone.original_repo_full_name}`,
            content: fileData.content,
          };

          if (existingFile) {
            updateData.sha = existingFile.sha;
          }

          // Create or update file in cloned repository
          const updateResponse = await fetch(`https://api.github.com/repos/${clone.cloned_repo_full_name}/contents/${item.path}`, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${accessToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData)
          });

          if (updateResponse.ok) {
            if (existingFile) {
              filesUpdated++;
              console.log(`Updated: ${item.path}`);
            } else {
              filesCreated++;
              console.log(`Created: ${item.path}`);
            }
          } else {
            const errorData = await updateResponse.json();
            console.error(`Failed to sync ${item.path}:`, errorData.message);
          }

          // Rate limiting - small delay between requests
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error syncing file ${item.path}:`, error);
        }
      }
    }

    // Update sync timestamp
    const { error: updateError } = await supabase
      .from('repository_clones')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', cloneId);

    if (updateError) {
      console.error('Failed to update sync timestamp:', updateError);
    }

    console.log(`Sync completed: ${filesCreated} files created, ${filesUpdated} files updated`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        filesCreated,
        filesUpdated,
        syncedAt: new Date().toISOString(),
        triggerSource
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});