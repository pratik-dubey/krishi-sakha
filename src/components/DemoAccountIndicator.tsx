import { Badge } from '@/components/ui/badge';
import { mockAuthService } from '@/services/mockAuthService';
import { useAuth } from '@/hooks/useAuth';

export const DemoAccountIndicator = () => {
  const { user } = useAuth();

  // Check if current session is a demo session
  const isDemoSession = mockAuthService.isDemoSession();
  
  if (!isDemoSession || !user) {
    return null;
  }

  return (
    <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">
      🎭 Demo Mode - {user.user_metadata?.full_name || 'Demo User'}
    </Badge>
  );
};
