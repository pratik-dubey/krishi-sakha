import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { mockAuthService, MockSession } from '@/services/mockAuthService';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for mock session first
    const checkSessions = async () => {
      const mockSession = mockAuthService.getCurrentSession();

      if (mockSession) {
        // Use mock session for demo accounts
        setSession(mockSession as any); // Type casting for compatibility
        setUser(mockSession.user as any); // Type casting for compatibility
        setLoading(false);
        return;
      }

      // If no mock session, check Supabase session
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      } catch (err) {
        console.error('Error getting session:', err);
        setLoading(false);
      }
    };

    checkSessions();

    // Set up auth state listener for Supabase
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Only update if we don't have a mock session
        if (!mockAuthService.getCurrentSession()) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      }
    );

    // Set up mock auth state listener
    const unsubscribeMock = mockAuthService.onAuthStateChange((mockSession) => {
      if (mockSession) {
        setSession(mockSession as any);
        setUser(mockSession.user as any);
      } else {
        // If mock session is cleared, check Supabase session
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
        });
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      unsubscribeMock();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      console.log('Attempting to sign in with email:', email);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Supabase sign in error:', error);
      } else {
        console.log('Sign in successful:', data);
      }

      return { error };
    } catch (err) {
      console.error('Unexpected sign in error:', err);
      return { error: err };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      console.log('Attempting to sign up with email:', email, 'redirectUrl:', redirectUrl);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName
          }
        }
      });

      if (error) {
        console.error('Supabase sign up error:', error);
      } else {
        console.log('Sign up successful:', data);
      }

      return { error };
    } catch (err) {
      console.error('Unexpected sign up error:', err);
      return { error: err };
    }
  };

  const signOut = async () => {
    // Check if we have a mock session and clear it
    if (mockAuthService.getCurrentSession()) {
      mockAuthService.signOut();
    } else {
      await supabase.auth.signOut();
    }
  };

  const signInWithGoogle = async () => {
    try {
      console.log('Starting Google OAuth flow...');

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
          skipBrowserRedirect: false
        }
      });

      if (error) {
        console.error('Google OAuth error:', error);
        let errorMessage = error.message;

        if (error.message?.includes('popup_blocked')) {
          errorMessage = 'Popup was blocked. Please allow popups for this site.';
        } else if (error.message?.includes('unauthorized_client')) {
          errorMessage = 'OAuth client not properly configured. Please check your Google OAuth settings.';
        } else if (error.message?.includes('redirect_uri_mismatch')) {
          errorMessage = 'Redirect URI mismatch. Please check your Google OAuth configuration.';
        }

        return { error: { ...error, message: errorMessage } };
      }

      // OAuth flow initiated successfully
      console.log('Google OAuth flow started successfully', data);
      return { error: null };
    } catch (err: any) {
      console.error('Google OAuth failed:', err);
      return { error: err };
    }
  };

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
