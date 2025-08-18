import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/use-toast';
import { ExternalLink, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export const GoogleAuthDebug = () => {
  const [isChecking, setIsChecking] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const { signInWithGoogle } = useAuth();
  const { toast } = useToast();

  const checkGoogleOAuthConfig = async () => {
    setIsChecking(true);
    
    const currentDomain = window.location.origin;
    const supabaseUrl = 'https://vilhreflbavpivsahfgi.supabase.co';
    const redirectUri = `${supabaseUrl}/auth/v1/callback`;
    
    const info = {
      currentDomain,
      supabaseUrl,
      redirectUri,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      env: {
        isDevelopment: import.meta.env.DEV,
        mode: import.meta.env.MODE,
        clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || 'Not set'
      }
    };
    
    setDebugInfo(info);
    setIsChecking(false);
  };

  const testGoogleAuth = async () => {
    try {
      const result = await signInWithGoogle();
      
      if (result.error) {
        toast({
          title: "Google Authentication Failed",
          description: result.error.message || "Unknown error occurred",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Google Authentication Started",
          description: "Redirecting to Google...",
        });
      }
    } catch (error: any) {
      toast({
        title: "Authentication Error",
        description: error.message || "Failed to initiate Google OAuth",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Google OAuth Debug Panel
          <Badge variant="outline">Development</Badge>
        </CardTitle>
        <CardDescription>
          Debug and test Google authentication configuration
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button 
            onClick={checkGoogleOAuthConfig} 
            disabled={isChecking}
            variant="outline"
          >
            {isChecking ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
            Check Configuration
          </Button>
          
          <Button 
            onClick={testGoogleAuth}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Test Google Sign-In
          </Button>
        </div>

        {debugInfo && (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Configuration Check Results</strong>
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Domain Information</h4>
                <div className="bg-gray-50 p-3 rounded text-xs font-mono">
                  <div><strong>Current Domain:</strong> {debugInfo.currentDomain}</div>
                  <div><strong>Supabase URL:</strong> {debugInfo.supabaseUrl}</div>
                  <div><strong>Redirect URI:</strong> {debugInfo.redirectUri}</div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Environment</h4>
                <div className="bg-gray-50 p-3 rounded text-xs font-mono">
                  <div><strong>Mode:</strong> {debugInfo.env.mode}</div>
                  <div><strong>Development:</strong> {debugInfo.env.isDevelopment ? 'Yes' : 'No'}</div>
                  <div><strong>Client ID:</strong> {debugInfo.env.clientId.substring(0, 20)}...</div>
                </div>
              </div>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription>
                <div className="space-y-2">
                  <p><strong>Required Google Cloud Console Settings:</strong></p>
                  <div className="text-xs font-mono bg-white p-2 rounded border">
                    <p><strong>Authorized JavaScript origins:</strong></p>
                    <p>• {debugInfo.currentDomain}</p>
                    <p>• {debugInfo.supabaseUrl}</p>
                    <br />
                    <p><strong>Authorized redirect URIs:</strong></p>
                    <p>• {debugInfo.redirectUri}</p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-2 text-sm">
              <ExternalLink className="h-4 w-4" />
              <a 
                href="https://console.cloud.google.com/apis/credentials" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Open Google Cloud Console
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
