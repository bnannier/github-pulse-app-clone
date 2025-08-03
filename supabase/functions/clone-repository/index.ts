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
    const { repoFullName, accessToken } = await req.json();
    
    if (!repoFullName || !accessToken) {
      return new Response(
        JSON.stringify({ error: 'Repository name and access token are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting clone process for: ${repoFullName}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')!,
        },
      },
    });

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get the original repository data
    const repoResponse = await fetch(`https://api.github.com/repos/${repoFullName}`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!repoResponse.ok) {
      throw new Error(`Failed to fetch repository: ${repoResponse.statusText}`);
    }

    const originalRepo = await repoResponse.json();
    const cloneName = `${originalRepo.name}-clone`;

    // Create a new repository
    const createRepoResponse = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cloneName,
        description: `Clone of ${originalRepo.full_name}. ${originalRepo.description || ''}`,
        private: false,
        auto_init: true,
      })
    });

    if (!createRepoResponse.ok) {
      const errorData = await createRepoResponse.json();
      throw new Error(`Failed to create repository: ${errorData.message}`);
    }

    const newRepo = await createRepoResponse.json();
    console.log(`Created new repository: ${newRepo.full_name}`);

    // Set up webhook for the original repository
    let webhookId = null;
    try {
      const { data: webhookData, error: webhookError } = await supabase.functions.invoke('setup-webhook', {
        body: {
          repoFullName: originalRepo.full_name,
          accessToken: accessToken
        }
      });

      if (webhookError) {
        console.error('Failed to set up webhook:', webhookError);
      } else if (webhookData?.success) {
        webhookId = webhookData.webhookId;
        console.log(`Webhook set up with ID: ${webhookId}`);
      }
    } catch (error) {
      console.error('Error setting up webhook:', error);
    }

    // Save clone relationship to database with GitHub token
    const { data: cloneRelation, error: cloneError } = await supabase
      .from('repository_clones')
      .insert({
        user_id: user.id,
        original_repo_full_name: originalRepo.full_name,
        cloned_repo_full_name: newRepo.full_name,
        original_repo_url: originalRepo.html_url,
        cloned_repo_url: newRepo.html_url,
        webhook_id: webhookId,
        github_access_token: accessToken, // Store the token for sync operations
        sync_enabled: true
      })
      .select()
      .single();

    if (cloneError) {
      console.error('Failed to save clone relationship:', cloneError);
      // Continue with cloning even if database save fails
    } else {
      console.log(`Saved clone relationship with ID: ${cloneRelation.id}`);
    }

    // Get the default branch contents
    const contentsResponse = await fetch(`https://api.github.com/repos/${repoFullName}/contents`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (contentsResponse.ok) {
      const contents = await contentsResponse.json();
      
      // Copy files from the original repository
      for (const item of contents) {
        if (item.type === 'file' && item.name !== 'README.md') {
          try {
            const fileResponse = await fetch(item.download_url);
            const fileContent = await fileResponse.text();
            
            // Create the file in the new repository
            await fetch(`https://api.github.com/repos/${newRepo.full_name}/contents/${item.name}`, {
              method: 'PUT',
              headers: {
                'Authorization': `token ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: `Add ${item.name} from ${repoFullName}`,
                content: btoa(fileContent),
              })
            });
            
            console.log(`Copied file: ${item.name}`);
          } catch (error) {
            console.error(`Failed to copy file ${item.name}:`, error);
          }
        }
      }
    }

    // Create a custom README for the cloned repository
    const readmeContent = `# ${cloneName}

This repository is a clone of [${originalRepo.full_name}](${originalRepo.html_url}) with automatic sync enabled.

## Original Repository
- **Name**: ${originalRepo.name}
- **Description**: ${originalRepo.description || 'No description available'}
- **Language**: ${originalRepo.language || 'Not specified'}
- **Stars**: ${originalRepo.stargazers_count}
- **Forks**: ${originalRepo.forks_count}

## Clone Information
- **Cloned on**: ${new Date().toISOString().split('T')[0]}
- **Original URL**: ${originalRepo.html_url}
- **Auto-sync**: ${webhookId ? 'Enabled (via webhook)' : 'Disabled'}

## Sync Status
This clone will automatically sync with the original repository when changes are pushed. You can also manually trigger syncs through the GitHub Stats dashboard.

---

*This is a clone created for learning and development purposes.*
`;

    await fetch(`https://api.github.com/repos/${newRepo.full_name}/contents/README.md`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Add custom README for cloned repository',
        content: btoa(readmeContent),
      })
    });

    console.log(`Clone process completed successfully: ${newRepo.html_url}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        clonedRepo: {
          name: newRepo.name,
          full_name: newRepo.full_name,
          html_url: newRepo.html_url,
          description: newRepo.description
        },
        webhook: webhookId ? { id: webhookId, enabled: true } : { enabled: false },
        cloneRelationId: cloneRelation?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Clone repository error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});