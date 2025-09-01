// Simple bootstrap for real-time data functionality
import { realTimeDataIntegration } from './realTimeDataIntegration';

export class RealTimeDataBootstrap {
  private static isInitialized = false;

  static async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('🌾 Bootstrapping real-time agricultural data...');
      
      // Test basic functionality
      const status = await realTimeDataIntegration.getSystemStatus();
      console.log('📊 System status checked:', status?.status || 'unknown');
      
      this.isInitialized = true;
      console.log('✅ Real-time data system ready');
      
    } catch (error) {
      console.warn('⚠️ Real-time system using fallback mode:', error);
      // Mark as initialized anyway to prevent repeated attempts
      this.isInitialized = true;
    }
  }

  static isReady(): boolean {
    return this.isInitialized;
  }

  static async getQuickStatus(): Promise<string> {
    try {
      await this.ensureInitialized();
      return 'ready';
    } catch (error) {
      return 'limited';
    }
  }
}

// Auto-initialize when module loads
RealTimeDataBootstrap.ensureInitialized().catch(console.warn);

export const realTimeBootstrap = RealTimeDataBootstrap;
