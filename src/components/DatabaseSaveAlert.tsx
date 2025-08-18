import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Shield, CheckCircle, AlertCircle, XCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { checkDatabaseHealth, DatabaseHealth } from '@/utils/databaseHealthCheck';

interface DatabaseSaveAlertProps {
  className?: string;
}

export const DatabaseSaveAlert = ({ className = "" }: DatabaseSaveAlertProps) => {
  const { user } = useAuth();
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showAlert, setShowAlert] = useState(true);

  const checkHealth = async () => {
    setIsChecking(true);
    try {
      const healthResult = await checkDatabaseHealth();
      setHealth(healthResult);
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, [user]);

  // Don't show alert if everything is working fine
  if (health?.isConnected && health?.isAuthenticated && health?.canWrite) {
    return null;
  }

  // Don't show alert if user manually dismissed it
  if (!showAlert) {
    return null;
  }

  const getAlertContent = () => {
    if (!health?.isConnected) {
      return {
        icon: <XCircle className="h-4 w-4" />,
        title: "Database Connection Issue",
        description: "Unable to connect to the database. Your queries will work but won't be saved to history. Please check your internet connection.",
        variant: "destructive" as const
      };
    }

    if (!health?.isAuthenticated) {
      return {
        icon: <Shield className="h-4 w-4" />,
        title: "Sign In Required",
        description: "Sign in to save your query history and access personalized features. Your queries will still work without signing in.",
        variant: "default" as const
      };
    }

    if (!health?.canWrite) {
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        title: "Limited Database Access",
        description: "Queries work normally but history may not be saved. This is usually temporary.",
        variant: "default" as const
      };
    }

    return null;
  };

  const alertContent = getAlertContent();
  if (!alertContent) return null;

  return (
    <Alert variant={alertContent.variant} className={`${className}`}>
      <div className="flex items-start gap-2">
        {alertContent.icon}
        <div className="flex-1">
          <div className="font-medium">{alertContent.title}</div>
          <AlertDescription className="mt-1">
            {alertContent.description}
          </AlertDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={checkHealth}
            disabled={isChecking}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAlert(false)}
            className="h-6 w-6 p-0"
          >
            ×
          </Button>
        </div>
      </div>
    </Alert>
  );
};
