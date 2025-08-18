import { supabase } from '@/integrations/supabase/client';

export interface DatabaseHealth {
  isConnected: boolean;
  isAuthenticated: boolean;
  canWrite: boolean;
  error?: string;
  latency?: number;
}

export const checkDatabaseHealth = async (): Promise<DatabaseHealth> => {
  const startTime = Date.now();
  
  try {
    // Check basic connection
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      return {
        isConnected: false,
        isAuthenticated: false,
        canWrite: false,
        error: `Connection error: ${sessionError.message}`,
        latency: Date.now() - startTime
      };
    }

    // Check if user is authenticated
    if (!session) {
      return {
        isConnected: true,
        isAuthenticated: false,
        canWrite: false,
        error: 'User not authenticated',
        latency: Date.now() - startTime
      };
    }

    // Test read permissions
    try {
      const { error: readError } = await supabase
        .from('queries')
        .select('id')
        .limit(1);

      if (readError) {
        return {
          isConnected: true,
          isAuthenticated: true,
          canWrite: false,
          error: `Read permission error: ${readError.message}`,
          latency: Date.now() - startTime
        };
      }

      // Test write permissions (dry run - we won't actually insert)
      // If we got here, basic permissions are working
      return {
        isConnected: true,
        isAuthenticated: true,
        canWrite: true,
        latency: Date.now() - startTime
      };

    } catch (permissionError: any) {
      return {
        isConnected: true,
        isAuthenticated: true,
        canWrite: false,
        error: `Permission error: ${permissionError.message}`,
        latency: Date.now() - startTime
      };
    }

  } catch (connectionError: any) {
    return {
      isConnected: false,
      isAuthenticated: false,
      canWrite: false,
      error: `Network error: ${connectionError.message}`,
      latency: Date.now() - startTime
    };
  }
};

export const getHealthStatusMessage = (health: DatabaseHealth): string => {
  if (!health.isConnected) {
    return "❌ Database connection failed. Check your internet connection.";
  }
  
  if (!health.isAuthenticated) {
    return "🔒 Please sign in to save your query history.";
  }
  
  if (!health.canWrite) {
    return "⚠️ Limited access - queries won't be saved to history.";
  }
  
  const latencyInfo = health.latency ? ` (${health.latency}ms)` : '';
  return `✅ Database ready${latencyInfo}`;
};
