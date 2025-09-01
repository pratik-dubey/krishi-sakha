import { supabase } from '@/integrations/supabase/client';

export const DEMO_ACCOUNTS = [
  {
    email: 'farmer@demo.com',
    password: 'farmer123',
    name: 'Demo Farmer',
    description: 'Sample farmer account'
  },
  {
    email: 'expert@demo.com', 
    password: 'expert123',
    name: 'Agricultural Expert',
    description: 'Agricultural expert account'
  },
  {
    email: 'admin@demo.com',
    password: 'admin123', 
    name: 'Admin User',
    description: 'Administrator account'
  }
];

export class DemoAccountService {
  private static initialized = false;

  static async initializeDemoAccounts(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('🎭 Initializing demo accounts...');
    
    for (const account of DEMO_ACCOUNTS) {
      try {
        const { error } = await supabase.auth.signUp({
          email: account.email,
          password: account.password,
          options: {
            data: {
              full_name: account.name
            },
            emailRedirectTo: undefined, // Skip email confirmation for demo accounts
            skipConfirmation: true // This may not work with current setup
          }
        });

        if (error && !error.message?.includes('User already registered')) {
          console.warn(`Failed to create demo account ${account.email}:`, error.message);
        } else {
          console.log(`✅ Demo account ready: ${account.email}`);
        }
      } catch (err) {
        console.warn(`Error creating demo account ${account.email}:`, err);
      }
    }

    this.initialized = true;
    console.log('🎭 Demo accounts initialization completed');
  }

  static async ensureDemoAccountExists(email: string, password: string, name: string): Promise<boolean> {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name
          },
          emailRedirectTo: undefined,
          skipConfirmation: true
        }
      });

      if (error && !error.message?.includes('User already registered')) {
        console.warn('Failed to ensure demo account exists:', error);
        return false;
      }
      
      return true;
    } catch (err) {
      console.warn('Error ensuring demo account exists:', err);
      return false;
    }
  }

  static isDemoAccount(email: string): boolean {
    return DEMO_ACCOUNTS.some(account => account.email === email);
  }

  static getDemoAccount(email: string) {
    return DEMO_ACCOUNTS.find(account => account.email === email);
  }
}

// Auto-initialize when the service is imported (non-blocking)
DemoAccountService.initializeDemoAccounts().catch(console.warn);

export const demoAccountService = DemoAccountService;
