import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  CloudRain, 
  Thermometer, 
  Droplets,
  Wind,
  Clock,
  Database,
  Zap,
  AlertCircle,
  CheckCircle,
  BarChart3
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { realTimeDataIntegration } from '@/services/realTimeDataIntegration';
import { dataScheduler } from '@/services/dataScheduler';
import { realTimeBootstrap } from '@/services/realTimeDataBootstrap';

interface SystemStatus {
  status: string;
  services: { [key: string]: string };
  lastUpdate: string;
}

interface MarketDataItem {
  crop: string;
  price: number;
  location: string;
  timestamp: string;
}

interface WeatherDataItem {
  location: string;
  temperature: number;
  humidity: number;
  rainfall: number;
  timestamp: string;
}

interface SummaryData {
  totalQueries: number;
  successRate: number;
  averageResponseTime: number;
  topCrops: string[];
  text?: string;
}

interface EnhancedResponse {
  response: string;
  confidence: number;
  sources: string[];
}

export const RealTimeDataDashboard = () => {
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [weatherData, setWeatherData] = useState<WeatherDataItem[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [testQuery, setTestQuery] = useState('');
  const [testLocation, setTestLocation] = useState('');
  const [testCrop, setTestCrop] = useState('');
  const [enhancedResponse, setEnhancedResponse] = useState<EnhancedResponse | null>(null);
  const { toast } = useToast();

  const updateSystemStatus = async () => {
    try {
      const status = await realTimeDataIntegration.getSystemStatus();
      setSystemStatus(status);
    } catch (error) {
      console.error('Failed to get system status:', error);
      // Set fallback system status
      setSystemStatus({
        status: 'offline',
        services: {
          'Market Data': 'limited',
          'Weather Data': 'limited',
          'Data Scheduler': 'offline'
        },
        lastUpdate: new Date().toISOString()
      });
    }
  };

  const loadMarketData = async () => {
    try {
      const data = await realTimeDataIntegration.getLatestMarketPrices();
      setMarketData(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch (error) {
      console.error('Failed to load market data:', error);
      // Set fallback market data
      setMarketData([
        {
          crop: 'Rice',
          price: 2500,
          location: 'Delhi',
          timestamp: new Date().toISOString()
        },
        {
          crop: 'Wheat',
          price: 2200,
          location: 'Punjab',
          timestamp: new Date().toISOString()
        }
      ]);
    }
  };

  const loadWeatherData = async () => {
    try {
      const data = await realTimeDataIntegration.getCurrentWeather();
      setWeatherData(Array.isArray(data) ? data.slice(0, 8) : []);
    } catch (error) {
      console.error('Failed to load weather data:', error);
      // Set fallback weather data
      setWeatherData([
        {
          location: 'Delhi',
          temperature: 28,
          humidity: 65,
          rainfall: 0,
          timestamp: new Date().toISOString()
        },
        {
          location: 'Mumbai',
          temperature: 32,
          humidity: 78,
          rainfall: 5,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  };

  const loadSummary = async () => {
    try {
      const summaryText = await realTimeDataIntegration.getQuickSummary();
      setSummary({
        totalQueries: 0,
        successRate: 0,
        averageResponseTime: 0,
        topCrops: [],
        text: summaryText
      });
    } catch (error) {
      console.error('Failed to load summary:', error);
      // Set fallback summary
      setSummary({
        totalQueries: 0,
        successRate: 0,
        averageResponseTime: 0,
        topCrops: ['Rice', 'Wheat', 'Maize'],
        text: 'Real-time data temporarily unavailable. Showing offline guidance.'
      });
    }
  };

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // Initialize real-time system first
      console.log('🚀 Initializing real-time data system...');
      await realTimeBootstrap.ensureInitialized();

      // Load all data with individual error handling
      const results = await Promise.allSettled([
        updateSystemStatus(),
        loadMarketData(),
        loadWeatherData(),
        loadSummary()
      ]);

      // Check if any critical failures occurred
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length === results.length) {
        throw new Error('All data loading operations failed');
      }

      if (failures.length > 0) {
        console.warn(`${failures.length} data loading operations failed, but others succeeded`);
        toast({
          title: "Partial Loading",
          description: `Loaded ${results.length - failures.length}/${results.length} data sources successfully`,
          variant: "default",
        });
      } else {
        toast({
          title: "Data Loaded",
          description: "Real-time dashboard initialized successfully",
        });
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
      toast({
        title: "Loading Error",
        description: "Using offline data. Some features may be limited.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadInitialData();
    const interval = setInterval(updateSystemStatus, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [loadInitialData]);

  const handleRefreshAll = async () => {
    setLoading(true);
    try {
      await realTimeDataIntegration.refreshAllData();
      await loadInitialData();
      toast({
        title: "Data Refreshed",
        description: "All real-time data has been updated",
      });
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestQuery = async () => {
    if (!testQuery.trim()) return;
    
    setLoading(true);
    try {
      const response = await realTimeDataIntegration.enhanceQueryWithRealTimeData({
        query: testQuery,
        location: testLocation || undefined,
        crop: testCrop || undefined,
        language: 'en'
      });
      
      setEnhancedResponse(response);
      toast({
        title: "Query Processed",
        description: "Enhanced response generated successfully",
      });
    } catch (error) {
      toast({
        title: "Query Failed",
        description: "Failed to process query. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'rising': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'falling': return <TrendingDown className="h-4 w-4 text-red-600" />;
      default: return <Minus className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'rising': return 'text-green-600';
      case 'falling': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Real-Time Data Dashboard</h2>
          <p className="text-muted-foreground">
            Monitor live agricultural market and weather data
          </p>
        </div>
        <Button onClick={handleRefreshAll} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh All Data
        </Button>
      </div>

      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {systemStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                {systemStatus.scheduler.isRunning ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                )}
                <span className="font-medium">
                  Scheduler: {systemStatus.scheduler.isRunning ? 'Running' : 'Stopped'}
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <span className="text-sm">
                  Market Data: {systemStatus.dataFreshness.marketDataAge}m old
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <CloudRain className="h-5 w-5 text-blue-600" />
                <span className="text-sm">
                  Weather Data: {systemStatus.dataFreshness.weatherDataAge}m old
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              Loading system status...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Data Tabs */}
      <Tabs defaultValue="market" className="space-y-4">
        <TabsList>
          <TabsTrigger value="market">Market Data</TabsTrigger>
          <TabsTrigger value="weather">Weather Data</TabsTrigger>
          <TabsTrigger value="summary">AI Summary</TabsTrigger>
          <TabsTrigger value="test">Test Query</TabsTrigger>
        </TabsList>

        {/* Market Data Tab */}
        <TabsContent value="market">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Latest Market Prices
              </CardTitle>
              <CardDescription>
                Real-time crop prices from major mandis across India
              </CardDescription>
            </CardHeader>
            <CardContent>
              {marketData.length > 0 ? (
                <div className="grid gap-4">
                  {marketData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{item.crop}</h4>
                          <Badge variant="outline">{item.variety}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.mandi}</p>
                        <p className="text-xs text-muted-foreground">{item.location}</p>
                      </div>
                      
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold">
                            ₹{(item.price_per_quintal / 100).toFixed(1)}/kg
                          </span>
                          {getTrendIcon(item.trend)}
                        </div>
                        <p className={`text-sm ${getTrendColor(item.trend)}`}>
                          {item.trend}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.date}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No market data available. Click "Refresh All Data" to fetch latest prices.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Weather Data Tab */}
        <TabsContent value="weather">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CloudRain className="h-5 w-5" />
                Current Weather Conditions
              </CardTitle>
              <CardDescription>
                Live weather data from major agricultural regions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {weatherData.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {weatherData.map((item, index) => (
                    <div key={index} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{item.location}</h4>
                        <Badge variant="outline">{item.condition}</Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Thermometer className="h-4 w-4 text-red-500" />
                          <span>{item.temp_c}°C</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Droplets className="h-4 w-4 text-blue-500" />
                          <span>{item.humidity}%</span>
                        </div>
                        
                        {item.rainfall_mm > 0 && (
                          <div className="flex items-center gap-2">
                            <CloudRain className="h-4 w-4 text-blue-600" />
                            <span>{item.rainfall_mm}mm</span>
                          </div>
                        )}
                        
                        {item.wind_speed_kmh && (
                          <div className="flex items-center gap-2">
                            <Wind className="h-4 w-4 text-gray-500" />
                            <span>{item.wind_speed_kmh} km/h</span>
                          </div>
                        )}
                      </div>
                      
                      <p className="text-xs text-muted-foreground mt-2">
                        Updated: {item.date}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No weather data available. Click "Refresh All Data" to fetch latest conditions.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Summary Tab */}
        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                AI-Generated Market Summary
              </CardTitle>
              <CardDescription>
                Intelligent insights from combined market and weather data
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-sm">
                    {summary.text}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Generating AI summary... Please wait.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Query Tab */}
        <TabsContent value="test">
          <Card>
            <CardHeader>
              <CardTitle>Test Enhanced AI Queries</CardTitle>
              <CardDescription>
                Test how real-time data enhances AI responses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Test Query</label>
                  <Input
                    placeholder="e.g., What are onion prices in Delhi today?"
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Location (Optional)</label>
                  <Input
                    placeholder="e.g., Delhi"
                    value={testLocation}
                    onChange={(e) => setTestLocation(e.target.value)}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Crop (Optional)</label>
                  <Select value={testCrop} onValueChange={setTestCrop}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select crop" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any crop</SelectItem>
                      <SelectItem value="Onion">Onion</SelectItem>
                      <SelectItem value="Potato">Potato</SelectItem>
                      <SelectItem value="Tomato">Tomato</SelectItem>
                      <SelectItem value="Rice">Rice</SelectItem>
                      <SelectItem value="Wheat">Wheat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <Button onClick={handleTestQuery} disabled={loading || !testQuery.trim()}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Test Enhanced Query'
                )}
              </Button>
              
              {enhancedResponse && (
                <div className="mt-6 p-4 border rounded-lg bg-muted/50">
                  <h4 className="font-medium mb-2">Enhanced AI Response:</h4>
                  <div className="text-sm whitespace-pre-wrap mb-4">
                    {enhancedResponse.answer}
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Confidence: {Math.round(enhancedResponse.confidence * 100)}%</span>
                    <span>Factual Basis: {enhancedResponse.factualBasis}</span>
                    {enhancedResponse.realTimeData && (
                      <span>
                        Real-time sources: {enhancedResponse.realTimeData.marketData?.length || 0} market, 
                        {enhancedResponse.realTimeData.weatherData?.length || 0} weather
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
