import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Github, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@supabase/supabase-js';

interface AuthPageProps {
  onAuthSuccess: (user: User) => void;
}

const AuthPage = ({ onAuthSuccess }: AuthPageProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        onAuthSuccess(user);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        onAuthSuccess(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [onAuthSuccess]);

  const handleGitHubLogin = async () => {
    setLoading(true);
    try {
      // Force a full page redirect to avoid CSP issues
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/`,
          scopes: 'read:user repo'
        }
      });

      if (error) {
        toast({
          title: "Authentication Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to initiate GitHub login",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-card/80 backdrop-blur-sm border-border/50">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center">
            <Github className="w-8 h-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">GitHub Stats</CardTitle>
            <CardDescription>
              Connect your GitHub account to view your repository statistics
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleGitHubLogin}
            disabled={loading}
            className="w-full bg-gradient-primary hover:opacity-90 text-white"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Github className="w-4 h-4 mr-2" />
                Continue with GitHub
              </>
            )}
          </Button>
          
          <p className="text-sm text-muted-foreground text-center mt-4">
            We'll access your public repository data to show your GitHub statistics.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;