import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Github, Star, GitFork, AlertCircle, Search, Calendar, Loader2, LogOut, Copy, Lock, RefreshCw } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Footer } from '@/components/Footer';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  language: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
  topics: string[];
  private: boolean;
}

interface GitHubStatsProps {
  user: User;
  onLogout: () => void;
}

const GitHubStats = ({ user, onLogout }: GitHubStatsProps) => {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [githubUsername, setGithubUsername] = useState('');
  const [cloningRepos, setCloningRepos] = useState<Set<number>>(new Set());
  const [syncingRepos, setSyncingRepos] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    // Get GitHub username from user metadata
    const username = user.user_metadata?.user_name || user.user_metadata?.preferred_username;
    if (username) {
      setGithubUsername(username);
      fetchRepos(username);
    }
  }, [user]);

  const fetchRepos = async (username: string) => {
    setLoading(true);
    try {
      // Get the GitHub access token from the session
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.provider_token;

      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
      };

      // Use the access token if available for higher rate limits and private repos
      if (accessToken) {
        headers['Authorization'] = `token ${accessToken}`;
      }

      // Use /user/repos to get both public and private repositories
      const response = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&type=all`, {
        headers
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch repositories');
      }

      const data = await response.json();
      setRepos(data);
      
      toast({
        title: "Success",
        description: `Fetched ${data.length} repositories for ${username}`,
      });
    } catch (error) {
      console.error('Error fetching repos:', error);
      toast({
        title: "Error",
        description: "Failed to fetch repositories. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onLogout();
  };

  const handleCloneRepo = async (repo: Repository, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card click
    
    setCloningRepos(prev => new Set(prev).add(repo.id));
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.provider_token;

      if (!accessToken) {
        throw new Error('GitHub access token not found');
      }

      const { data, error } = await supabase.functions.invoke('clone-repository', {
        body: {
          repoFullName: repo.full_name,
          accessToken: accessToken
        }
      });

      if (error) {
        throw error;
      }

      if (data.success) {
        toast({
          title: "Repository Cloned Successfully!",
          description: `${data.clonedRepo.name} has been created in your account.`,
        });
        
        // Refresh repositories to show the new clone
        fetchRepos(githubUsername);
      } else {
        throw new Error(data.error || 'Failed to clone repository');
      }
    } catch (error) {
      console.error('Error cloning repository:', error);
      toast({
        title: "Clone Failed",
        description: error.message || "Failed to clone repository. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCloningRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repo.id);
        return newSet;
      });
    }
  };

  const handleSyncRepo = async (repo: Repository, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent card click
    
    setSyncingRepos(prev => new Set(prev).add(repo.id));
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.provider_token;

      if (!accessToken) {
        throw new Error('GitHub access token not found. Please logout and login again.');
      }

      // Check if this is a cloned repository (ends with -clone)
      if (repo.name.endsWith('-clone')) {
        // This IS a cloned repo, find its original
        const originalName = repo.name.replace('-clone', '');
        const originalFullName = repo.full_name.replace('-clone', '');
        
        // Find the clone relationship
        const { data: clones, error: cloneError } = await supabase
          .from('repository_clones')
          .select('id')
          .eq('cloned_repo_full_name', repo.full_name)
          .eq('sync_enabled', true);

        if (cloneError || !clones || clones.length === 0) {
          throw new Error('No clone relationship found for this repository');
        }

        const { data, error } = await supabase.functions.invoke('sync-repository', {
          body: {
            cloneId: clones[0].id,
            triggerSource: 'manual'
          }
        });

        if (error) {
          throw error;
        }

        if (data.success) {
          toast({
            title: "Sync Completed!",
            description: `${data.filesCreated} files created, ${data.filesUpdated} files updated.`,
          });
          
          // Refresh repositories to show updates
          fetchRepos(githubUsername);
        } else {
          throw new Error(data.error || 'Failed to sync repository');
        }
      } else {
        // This is an original repo, find its clones and sync them
        const { data: clones, error: cloneError } = await supabase
          .from('repository_clones')
          .select('id, cloned_repo_full_name')
          .eq('original_repo_full_name', repo.full_name)
          .eq('sync_enabled', true);

        if (cloneError || !clones || clones.length === 0) {
          throw new Error('No clones found for this repository');
        }

        let totalCreated = 0;
        let totalUpdated = 0;

        for (const clone of clones) {
          try {
            const { data, error } = await supabase.functions.invoke('sync-repository', {
              body: {
                cloneId: clone.id,
                triggerSource: 'manual'
              }
            });

            if (data?.success) {
              totalCreated += data.filesCreated || 0;
              totalUpdated += data.filesUpdated || 0;
            }
          } catch (error) {
            console.error(`Failed to sync clone ${clone.cloned_repo_full_name}:`, error);
          }
        }

        toast({
          title: "Sync Completed!",
          description: `${clones.length} clone(s) synced: ${totalCreated} files created, ${totalUpdated} files updated.`,
        });
        
        // Refresh repositories to show updates
        fetchRepos(githubUsername);
      }
    } catch (error) {
      console.error('Error syncing repository:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync repository. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSyncingRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repo.id);
        return newSet;
      });
    }
  };

  const filteredRepos = repos.filter(repo =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.language?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalStats = {
    stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    forks: repos.reduce((sum, repo) => sum + repo.forks_count, 0),
    issues: repos.reduce((sum, repo) => sum + repo.open_issues_count, 0),
    repos: repos.length
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="p-3 bg-gradient-primary rounded-xl">
              <Github className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              GitHub Repository Stats
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Welcome back, {githubUsername}! Here are your repository insights.
          </p>
          <div className="flex items-center gap-3">
            <Button 
              onClick={handleLogout}
              variant="outline"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
            <ThemeToggle />
          </div>
        </div>

        {loading && (
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                <p className="text-muted-foreground">Loading your repositories...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Summary */}
        {repos.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-card/80 backdrop-blur-sm border-border/50 hover:bg-card/90 transition-colors">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-primary">{totalStats.repos}</div>
                  <div className="text-sm text-muted-foreground">Repositories</div>
                </CardContent>
              </Card>
              <Card className="bg-card/80 backdrop-blur-sm border-border/50 hover:bg-card/90 transition-colors">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-500">{totalStats.stars}</div>
                  <div className="text-sm text-muted-foreground">Total Stars</div>
                </CardContent>
              </Card>
              <Card className="bg-card/80 backdrop-blur-sm border-border/50 hover:bg-card/90 transition-colors">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-500">{totalStats.forks}</div>
                  <div className="text-sm text-muted-foreground">Total Forks</div>
                </CardContent>
              </Card>
              <Card className="bg-card/80 backdrop-blur-sm border-border/50 hover:bg-card/90 transition-colors">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-red-500">{totalStats.issues}</div>
                  <div className="text-sm text-muted-foreground">Open Issues</div>
                </CardContent>
              </Card>
            </div>

            {/* Search Repositories */}
            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Search Repositories
                </CardTitle>
                <CardDescription>
                  Filter through your {repos.length} repositories
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  placeholder="Search by name, description, or language..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full"
                />
              </CardContent>
            </Card>
          </>
        )}

        {/* Repository Grid */}
        {filteredRepos.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRepos.map((repo) => (
              <Card 
                key={repo.id} 
                className="bg-card/80 backdrop-blur-sm border-border/50 hover:bg-card/90 transition-all duration-300 group cursor-pointer"
                onClick={() => window.open(repo.html_url, '_blank')}
              >
                <CardHeader className="pb-3 relative">
                  <div className="absolute top-4 right-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => handleSyncRepo(repo, e)}
                      disabled={syncingRepos.has(repo.id)}
                      className="h-8 w-8 p-0"
                      title="Sync with original"
                    >
                      {syncingRepos.has(repo.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => handleCloneRepo(repo, e)}
                      disabled={cloningRepos.has(repo.id)}
                      className="h-8 w-8 p-0"
                      title="Clone repository"
                    >
                      {cloningRepos.has(repo.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                  <CardTitle className="text-lg font-semibold truncate pr-20 flex items-center gap-2">
                    {repo.name}
                    {repo.private && (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CardTitle>
                  {repo.description && (
                    <CardDescription className="line-clamp-2">
                      {repo.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Language and Topics */}
                  <div className="flex flex-wrap gap-2">
                    {repo.private && (
                      <Badge variant="secondary" className="bg-orange-500/20 text-orange-600 dark:text-orange-400">
                        Private
                      </Badge>
                    )}
                    {repo.language && (
                      <Badge variant="secondary" className="bg-primary/20 text-primary">
                        {repo.language}
                      </Badge>
                    )}
                    {repo.topics.slice(0, 3).map((topic) => (
                      <Badge key={topic} variant="outline" className="text-xs">
                        {topic}
                      </Badge>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center gap-1 text-yellow-500">
                      <Star className="h-4 w-4" />
                      <span>{repo.stargazers_count}</span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-500">
                      <GitFork className="h-4 w-4" />
                      <span>{repo.forks_count}</span>
                    </div>
                    <div className="flex items-center gap-1 text-red-500">
                      <AlertCircle className="h-4 w-4" />
                      <span>{repo.open_issues_count}</span>
                    </div>
                  </div>

                  {/* Last Updated */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Updated {new Date(repo.updated_at).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {repos.length === 0 && !loading && (
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardContent className="p-12 text-center">
              <div className="text-muted-foreground">
                <Github className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg mb-2">No repositories found</p>
                <p className="text-sm">Your GitHub data will appear here once loaded</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default GitHubStats;