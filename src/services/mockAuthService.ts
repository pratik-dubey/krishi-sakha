import { DEMO_ACCOUNTS } from './demoAccountService';

export interface MockUser {
  id: string;
  email: string;
  user_metadata: {
    full_name: string;
  };
  app_metadata: {
    provider: string;
  };
}

export interface MockSession {
  user: MockUser;
  access_token: string;
  refresh_token: string;
}

class MockAuthService {
  private currentSession: MockSession | null = null;
  private listeners: ((session: MockSession | null) => void)[] = [];

  // Simulate demo account login without requiring email confirmation
  simulateDemoLogin(email: string): MockSession | null {
    const demoAccount = DEMO_ACCOUNTS.find(account => account.email === email);
    
    if (!demoAccount) {
      return null;
    }

    const mockUser: MockUser = {
      id: `demo-${email.replace('@', '-').replace('.', '-')}`,
      email: email,
      user_metadata: {
        full_name: demoAccount.name
      },
      app_metadata: {
        provider: 'demo'
      }
    };

    const mockSession: MockSession = {
      user: mockUser,
      access_token: `demo-token-${Date.now()}`,
      refresh_token: `demo-refresh-${Date.now()}`
    };

    this.currentSession = mockSession;
    this.notifyListeners(mockSession);
    
    // Store in localStorage for persistence
    localStorage.setItem('demo-session', JSON.stringify(mockSession));
    
    console.log('🎭 Demo session created for:', email);
    return mockSession;
  }

  getCurrentSession(): MockSession | null {
    if (this.currentSession) {
      return this.currentSession;
    }

    // Try to restore from localStorage
    try {
      const stored = localStorage.getItem('demo-session');
      if (stored) {
        this.currentSession = JSON.parse(stored);
        return this.currentSession;
      }
    } catch (err) {
      console.warn('Failed to restore demo session:', err);
    }

    return null;
  }

  signOut(): void {
    this.currentSession = null;
    localStorage.removeItem('demo-session');
    this.notifyListeners(null);
    console.log('🎭 Demo session ended');
  }

  onAuthStateChange(callback: (session: MockSession | null) => void): () => void {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(session: MockSession | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(session);
      } catch (err) {
        console.error('Error in auth state listener:', err);
      }
    });
  }

  isDemoSession(): boolean {
    const session = this.getCurrentSession();
    return session?.user?.app_metadata?.provider === 'demo';
  }
}

export const mockAuthService = new MockAuthService();
