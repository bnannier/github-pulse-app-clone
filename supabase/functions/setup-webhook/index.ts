import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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

    console.log(`Setting up webhook for repository: ${repoFullName}`);

    // Create webhook on the original repository
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/github-webhook`;
    
    const webhookPayload = {
      name: 'web',
      active: true,
      events: ['push', 'pull_request'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        insecure_ssl: '0'
      }
    };

    const webhookResponse = await fetch(`https://api.github.com/repos/${repoFullName}/hooks`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload)
    });

    if (!webhookResponse.ok) {
      const errorData = await webhookResponse.json();
      
      // Check if webhook already exists
      if (webhookResponse.status === 422 && errorData.errors?.some((e: any) => e.message?.includes('Hook already exists'))) {
        console.log('Webhook already exists, fetching existing webhook...');
        
        // Get existing webhooks
        const hooksResponse = await fetch(`https://api.github.com/repos/${repoFullName}/hooks`, {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          }
        });

        if (hooksResponse.ok) {
          const hooks = await hooksResponse.json();
          const existingWebhook = hooks.find((hook: any) => hook.config?.url === webhookUrl);
          
          if (existingWebhook) {
            return new Response(
              JSON.stringify({ 
                success: true, 
                webhookId: existingWebhook.id.toString(),
                message: 'Using existing webhook'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      throw new Error(`Failed to create webhook: ${errorData.message || webhookResponse.statusText}`);
    }

    const webhook = await webhookResponse.json();
    console.log(`Webhook created successfully with ID: ${webhook.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        webhookId: webhook.id.toString(),
        webhookUrl: webhook.config.url
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Setup webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});