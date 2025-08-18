import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { checkDatabaseHealth, getHealthStatusMessage, DatabaseHealth } from '@/utils/databaseHealthCheck';

interface DatabaseStatusIndicatorProps {
  className?: string;
  showRefreshButton?: boolean;
}

export const DatabaseStatusIndicator = ({ 
  className = "", 
  showRefreshButton = false 
}: DatabaseStatusIndicatorProps) => {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkHealth = async () => {
    setIsChecking(true);
    try {
      const healthResult = await checkDatabaseHealth();
      setHealth(healthResult);
    } catch (error) {
      console.error('Health check failed:', error);
      setHealth({
        isConnected: false,
        isAuthenticated: false,
        canWrite: false,
        error: 'Health check failed'
      });
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkHealth();
    
    // Check health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = () => {
    if (isChecking) {
      return <RefreshCw className="h-3 w-3 animate-spin" />;
    }
    
    if (!health) {
      return <AlertCircle className="h-3 w-3" />;
    }

    if (health.isConnected && health.isAuthenticated && health.canWrite) {
      return <CheckCircle className="h-3 w-3" />;
    }
    
    if (health.isConnected && health.isAuthenticated) {
      return <AlertCircle className="h-3 w-3" />;
    }
    
    return <XCircle className="h-3 w-3" />;
  };

  const getStatusVariant = (): "default" | "secondary" | "destructive" | "outline" => {
    if (isChecking || !health) {
      return "outline";
    }

    if (health.isConnected && health.isAuthenticated && health.canWrite) {
      return "default";
    }
    
    if (health.isConnected && health.isAuthenticated) {
      return "secondary";
    }
    
    return "destructive";
  };

  const getStatusText = () => {
    if (isChecking) {
      return "Checking...";
    }
    
    if (!health) {
      return "Unknown";
    }

    if (health.isConnected && health.isAuthenticated && health.canWrite) {
      return "Ready";
    }
    
    if (health.isConnected && health.isAuthenticated) {
      return "Limited";
    }
    
    if (health.isConnected) {
      return "Sign In";
    }
    
    return "Offline";
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={getStatusVariant()} className="flex items-center gap-1 cursor-help">
            {getStatusIcon()}
            <span className="text-xs">{getStatusText()}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">
            {health ? getHealthStatusMessage(health) : "Checking database status..."}
            {health?.error && (
              <span className="block text-xs text-muted-foreground mt-1">
                {health.error}
              </span>
            )}
          </p>
        </TooltipContent>
      </Tooltip>
      
      {showRefreshButton && (
        <Button
          variant="ghost"
          size="sm"
          onClick={checkHealth}
          disabled={isChecking}
          className="h-6 w-6 p-0"
        >
          <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </div>
  );
};
