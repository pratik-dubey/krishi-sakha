import { supabase } from '@/integrations/supabase/client';
import { dataAgent, RetrievedData } from './dataRetrieval';
import { preprocessQuery } from '@/utils/queryPreprocessor';
import { QueryContext } from './dataSources';
import { offlineCache } from './offlineCache';
import { offlineAIService } from './offlineAIService';
import { geminiValidator, GeminiValidationRequest } from './geminiValidator';
import { processLanguageQuery } from '@/utils/languageProcessor';
import { mandiPriceFetcher, RealTimeMandiPriceFetcher } from './realTimeMandiPrices';
import { demoQuestionHandler } from './demoQuestionHandler';

export interface RAGResponse {
  answer: string;
  sources: SourceReference[];
  confidence: number;
  factualBasis: 'high' | 'medium' | 'low';
  generatedContent: string[];
  disclaimer?: string;
}

export interface SourceReference {
  source: string;
  type: string;
  data: any;
  confidence: number;
  freshness: 'fresh' | 'cached' | 'stale';
  citation: string;
}

export class RetrievalAugmentedGeneration {
  private maxRetries = 3;
  private systemHealth = {
    apiStatus: true,
    cacheStatus: true,
    languageProcessing: true,
    demoMode: true
  };

  async generateAdvice(query: string, language: string): Promise<RAGResponse> {
    // Step 0: Demo Question Check (Priority)
    console.log('🎯 Checking for demo questions...');
    const demoResponse = demoQuestionHandler.getDemoResponse(query);
    if (demoResponse) {
      console.log(`✅ Demo question matched with ${(demoResponse.confidence * 100).toFixed(0)}% confidence`);
      return {
        answer: demoResponse.answer,
        sources: [{
          source: 'Demo Knowledge Base',
          type: 'predefined',
          data: { category: demoResponse.category, language: demoResponse.language },
          confidence: demoResponse.confidence,
          freshness: 'fresh' as const,
          citation: `Demo response for ${demoResponse.category} query`
        }],
        confidence: demoResponse.confidence,
        factualBasis: 'high' as const,
        generatedContent: [demoResponse.answer],
        disclaimer: 'This is a demo response with predefined agricultural information.'
      };
    }

    // Step 1: System Health Check
    await this.checkSystemHealth();

    // Step 2: Enhanced Language Processing
    const languageResult = processLanguageQuery(query);
    console.log(`🗣️ Language processing: ${languageResult.detectedLanguage} (${(languageResult.confidence * 100).toFixed(0)}% confidence)`);

    // Use the translated query for processing, but keep original for display
    const processedQuery = languageResult.translatedQuery || query;
    const detectedLanguage = languageResult.detectedLanguage || language;

    try {
      // Check for cached response first (using translated query for better matching)
      const cached = offlineCache.getCachedResponse(processedQuery, language);
      if (cached) {
        console.log('Using cached response');
        const cacheDate = cached.timestamp instanceof Date ?
          cached.timestamp.toLocaleDateString() :
          new Date(cached.timestamp).toLocaleDateString();

        // Always validate cached responses through Gemini
        return await this.validateWithGemini({
          ...cached.response,
          disclaimer: `📅 Cached response from ${cacheDate}. ${cached.response.disclaimer || ''}`
        }, cached.response.sources, languageResult, processedQuery);
      }

      // Check if online for fresh data
      if (!offlineCache.isOnline()) {
        const offlineResponse = offlineCache.getOfflineFallback(query, language);
        if (offlineResponse) {
          return this.formatFarmerFriendlyResponse(offlineResponse, offlineResponse.sources, language, query);
        }

        // Return basic offline response if no cache available
        return this.getBasicOfflineResponse(query, language);
      }

      // Step 1: Preprocess and extract context
      const processed = preprocessQuery(query);
      if (!processed.isValid) {
        return this.getFallbackAdvisory(query, language, 'Invalid query format');
      }

      // **PRIORITY: Handle Price Queries with Real-Time Data**
      if (RealTimeMandiPriceFetcher.isPriceQuery(processedQuery)) {
        console.log('💰 Detected price query - fetching real-time mandi data...');
        const { crop, location } = RealTimeMandiPriceFetcher.extractCropAndLocation(processedQuery);

        if (crop && location) {
          const priceData = await mandiPriceFetcher.fetchRealTimePrices(crop, location);
          console.log(`💰 Price data result: Found=${priceData.found}, Prices=${priceData.prices.length}`);

          let priceResponse: RAGResponse;

          if (priceData.found) {
            // Real price data found
            priceResponse = {
              answer: this.formatPriceResponse(priceData, languageResult.originalQuery),
              sources: this.createPriceSources(priceData),
              confidence: 0.95,
              factualBasis: 'high',
              generatedContent: [],
              disclaimer: 'Live market data - prices may vary throughout the day'
            };
          } else {
            // No price data found - be honest
            priceResponse = {
              answer: this.formatNoPriceDataResponse(priceData, languageResult.originalQuery),
              sources: [],
              confidence: 0.3,
              factualBasis: 'low',
              generatedContent: [],
              disclaimer: 'No current price data available for requested crop and location'
            };
          }

          // Always validate price responses with Gemini
          return await this.validateWithGemini(
            priceResponse.answer,
            priceResponse.sources,
            languageResult,
            processedQuery
          );
        }
      }

      // **STANDARD APPROACH: LLM-First with Selective Grounding for non-price queries**

      // Step 2: Generate initial LLM response (without grounding)
      console.log('🤖 Generating initial LLM response...');
      const initialPrompt = this.constructInitialPrompt(processed.cleanedText, language, processed.extractedContext);
      const initialAnswer = await this.callLLM(initialPrompt);

      // Step 3: Analyze if grounding data is needed based on query type and LLM response
      const needsGrounding = this.shouldGroundResponse(processed.extractedContext, initialAnswer);

      let response: RAGResponse;

      if (needsGrounding) {
        console.log('🔍 Query needs grounding - retrieving hyperlocal data');

        // Step 4: Retrieve relevant data for grounding
        const retrievedData = await this.retrieveDataWithRetries(processed.extractedContext);

        if (retrievedData.length > 0) {
          // Step 5: Check if retrieved data matches the query context
          const relevantData = this.filterRelevantData(retrievedData, processed.extractedContext);

          if (relevantData.length > 0) {
            console.log('✅ Found relevant data - grounding LLM response');

            // Step 6: Create grounded response
            const sources = this.createSourceReferences(relevantData);
            const factualContext = this.buildFactualContext(relevantData, processed.extractedContext);
            const groundedPrompt = this.constructGroundedPrompt(processed.cleanedText, initialAnswer, factualContext, language);
            const groundedAnswer = await this.callLLM(groundedPrompt);

            response = {
              answer: groundedAnswer,
              sources,
              confidence: this.calculateDynamicConfidence(relevantData, processed.extractedContext),
              factualBasis: this.assessFactualBasis(relevantData),
              generatedContent: this.identifyGeneratedContent(groundedAnswer),
              disclaimer: this.getSystemHealthDisclaimer()
            };
          } else {
            console.log('⚠️ No relevant data found - using direct LLM response');
            // When retrieved data is not relevant, use direct LLM response (don't hallucinate)
            response = {
              answer: this.formatDirectLLMResponse(initialAnswer, processed.cleanedText, language),
              sources: [],
              confidence: 0.7, // Higher confidence for direct LLM on specific queries
              factualBasis: 'medium',
              generatedContent: [],
              disclaimer: 'Response based on general agricultural knowledge - specific data unavailable'
            };
          }
        } else {
          console.log('❌ No data retrieved - using direct LLM response');
          // When no data is available, use direct LLM response instead of suggestions
          response = {
            answer: this.formatDirectLLMResponse(initialAnswer, processed.cleanedText, language),
            sources: [],
            confidence: 0.6,
            factualBasis: 'medium',
            generatedContent: [],
            disclaimer: 'Response based on general agricultural knowledge - no current data available'
          };
        }
      } else {
        console.log('📝 Query does not need grounding - using LLM response');
        response = {
          answer: initialAnswer,
          sources: [],
          confidence: 0.75, // Higher confidence for general queries
          factualBasis: 'medium',
          generatedContent: [],
          disclaimer: 'General agricultural guidance'
        };
      }

      // Step 7: ALWAYS validate and enhance with Gemini LLM
      console.log('🤖 Validating response with Gemini LLM...');
      const finalResponse = await this.validateWithGemini(
        response.answer,
        response.sources,
        languageResult,
        processedQuery
      );

      // Cache the response for offline use
      offlineCache.cacheResponse(
        processedQuery,
        language,
        finalResponse,
        processed.extractedContext.location ? {
          state: processed.extractedContext.location.state,
          district: processed.extractedContext.location.district
        } : undefined
      );

      return finalResponse;
    } catch (error) {
      console.error('RAG generation error:', error);

      // Never fail completely - always provide fallback
      return this.getFallbackAdvisory(query, language, 'System temporarily unavailable');
    }
  }

  private async retrieveDataWithRetries(context: QueryContext): Promise<RetrievedData[]> {
    let retrievedData: RetrievedData[] = [];
    let attempts = 0;

    while (attempts < this.maxRetries && retrievedData.length === 0) {
      try {
        retrievedData = await dataAgent.retrieveAllRelevantData(context);
        if (retrievedData.length > 0) break;
      } catch (error) {
        console.warn(`Data retrieval attempt ${attempts + 1} failed:`, error);
      }
      attempts++;

      // Small delay before retry
      if (attempts < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // If still no data, try cached data
    if (retrievedData.length === 0) {
      retrievedData = this.getCachedFallbackData(context);
    }

    return retrievedData;
  }

  private getCachedFallbackData(context: QueryContext): RetrievedData[] {
    // Return basic fallback data structure
    const fallbackData: RetrievedData[] = [];

    if (context.location) {
      fallbackData.push({
        source: 'Last Known Data',
        type: 'weather',
        data: {
          temperature: 28,
          humidity: 65,
          condition: 'Partly Cloudy',
          advisory: 'Check local conditions'
        },
        confidence: 0.3,
        timestamp: new Date(),
        location: context.location,
        metadata: {
          freshness: 'stale',
          reliability: 'low'
        }
      });
    }

    return fallbackData;
  }

  private async checkSystemHealth(): Promise<void> {
    try {
      // Check API status
      this.systemHealth.apiStatus = offlineCache.isOnline();

      // Check cache status
      const stats = offlineCache.getCacheStats();
      this.systemHealth.cacheStatus = stats.totalResponses >= 0;

      // Check language processing
      this.systemHealth.languageProcessing = true; // Basic check

      // Check demo mode
      this.systemHealth.demoMode = true;
    } catch (error) {
      console.warn('System health check failed:', error);
    }
  }

  private getSystemHealthDisclaimer(): string | undefined {
    const issues = [];
    if (!this.systemHealth.apiStatus) issues.push('Limited connectivity');
    if (!this.systemHealth.cacheStatus) issues.push('Cache unavailable');

    return issues.length > 0 ? `⚠️ ${issues.join(', ')} - Using available data` : undefined;
  }

  private formatFarmerFriendlyResponse(response: RAGResponse, sources: SourceReference[], language: string, originalQuery?: string): RAGResponse {
    const isHindi = language === 'hi';

    // Extract data by type for structured formatting
    const weatherData = sources.find(s => s.type === 'weather')?.data;
    const marketData = sources.find(s => s.type === 'market')?.data;
    const soilData = sources.find(s => s.type === 'soil')?.data;
    const advisoryData = sources.find(s => s.type === 'advisory')?.data;
    const schemeData = sources.find(s => s.type === 'scheme')?.data;

    // Start with the query as bold heading
    let formattedAnswer = '';
    if (originalQuery) {
      formattedAnswer += `**${originalQuery}**\n\n`;
    }
    formattedAnswer += isHindi ? '🌾 कृषि सलाह\n\n' : '🌾 Agricultural Advisory\n\n';

    // Weather Section
    if (weatherData) {
      const weatherSource = sources.find(s => s.type === 'weather');
      formattedAnswer += isHindi ? '🌦 **मौसम जानकारी:**\n' : '🌦 **Weather Information:**\n';
      formattedAnswer += `• ${isHindi ? 'तापमान' : 'Temperature'}: ${weatherData.temperature}°C\n`;
      formattedAnswer += `• ${isHindi ? 'नमी' : 'Humidity'}: ${weatherData.humidity}%\n`;
      if (weatherData.forecast) {
        formattedAnswer += `• ${isHindi ? 'पूर्वानुमान' : 'Forecast'}: ${weatherData.forecast[0]?.condition || 'Variable'}\n`;
      }
      formattedAnswer += `**${isHindi ? 'स्रोत' : 'Source'}: ${weatherSource?.source} (${weatherSource?.freshness || 'fresh'})**\n\n`;
    }

    // Market Section - Enhanced with transparent missing data handling
    // ALWAYS SHOW MARKET SECTION - as per requirements
    const marketSource = sources.find(s => s.type === 'market');
    formattedAnswer += isHindi ? '💰 **बाजार भाव:**\n' : '💰 **Market Prices:**\n';

    if (marketData) {
      // Show available price data
      if (marketData.prices && marketData.prices.length > 0) {
        marketData.prices.slice(0, 3).forEach((price: any) => {
          formattedAnswer += `• ${price.crop}: ₹${price.modalPrice}/${isHindi ? 'क्विंटल' : 'quintal'}\n`;
        });
      }

      // Add transparent note for missing data
      if (marketData.missingDataNote) {
        formattedAnswer += `\n⚠️ ${marketData.missingDataNote}\n`;
      }

      formattedAnswer += `**${isHindi ? 'स्रोत' : 'Source'}: ${marketSource?.source} (${marketSource?.freshness || 'fresh'})**\n\n`;
    } else {
      // Even if no market data retrieved, show section with missing data note
      formattedAnswer += isHindi ?
        '⚠️ बाजार डेटा अभी उपलब्ध नहीं है। कृप�����ा बाद म���ं पुनः प्रयास करें या स्थानीय मंडी स्रोत���ं से संप��्क करें।\n\n' :
        '⚠️ Market data is currently unavailable. Please check back later or consult local mandi sources.\n\n';
    }

    // Soil Section
    if (soilData) {
      const soilSource = sources.find(s => s.type === 'soil');
      formattedAnswer += isHindi ? '🌱 **मिट्टी और उर्वरक:**\n' : '🌱 **Soil & Fertilizer:**\n';
      formattedAnswer += `• ${isHindi ? 'मिट्टी का प्रकार' : 'Soil Type'}: ${soilData.soilType}\n`;
      formattedAnswer += `• pH: ${soilData.pH}\n`;
      if (soilData.recommendations) {
        soilData.recommendations.slice(0, 2).forEach((rec: string) => {
          formattedAnswer += `���� ${rec}\n`;
        });
      }
      formattedAnswer += `**${isHindi ? 'स्रोत' : 'Source'}: ${soilSource?.source} (${soilSource?.freshness || 'fresh'})**\n\n`;
    }

    // Advisory Section
    if (advisoryData && advisoryData.advisories) {
      const advisorySource = sources.find(s => s.type === 'advisory');
      formattedAnswer += isHindi ? '📋 **कृषि सलाह:**\n' : '📋 **Agricultural Advisory:**\n';
      advisoryData.advisories.slice(0, 2).forEach((adv: any) => {
        formattedAnswer += `• **${adv.title}**: ${adv.content}\n`;
      });
      formattedAnswer += `**${isHindi ? 'स्रोत' : 'Source'}: ${advisorySource?.source} (${advisorySource?.freshness || 'fresh'})**\n\n`;
    }

    // Scheme Section
    if (schemeData && schemeData.schemes) {
      const schemeSource = sources.find(s => s.type === 'scheme');
      formattedAnswer += isHindi ? '📜 **सरकारी योजनाएं:**\n' : '��� **Government Schemes:**\n';
      schemeData.schemes.slice(0, 2).forEach((scheme: any) => {
        formattedAnswer += `• **${scheme.name}**: ${scheme.benefit}\n`;
      });
      formattedAnswer += `**${isHindi ? 'स्रोत' : 'Source'}: ${schemeSource?.source} (${schemeSource?.freshness || 'fresh'})**\n\n`;
    }

    // General tips
    formattedAnswer += isHindi ? '💡 **सुझाव:**\n' : '💡 **Tips:**\n';
    formattedAnswer += isHindi ?
      '• स्थानीय कृषि विशेषज्ञ से सला�� लें\n• मौसम के अनुसार फसल की देखभाल करें\n\n' :
      '• Consult local agricultural experts\n• Monitor crop conditions regularly\n\n';

    // How This Answer Was Generated section
    formattedAnswer += this.generateTransparencySection(sources, response, isHindi);

    return {
      ...response,
      answer: formattedAnswer
    };
  }

  private generateTransparencySection(sources: SourceReference[], response: RAGResponse, isHindi: boolean): string {
    let section = isHindi ? '🔍 **यह उत्तर कैसे त��यार किया गया:**\n' : '🔍 **How This Answer Was Generated:**\n';

    const dataSourceCount = sources.length;
    const freshDataCount = sources.filter(s => s.freshness === 'fresh').length;

    if (isHindi) {
      section += `• आपके प्रश्न का विश्लेषण करके विषय और स्थान की पहचान की गई\n`;
      section += `• ${dataSourceCount} विश्वसनीय कृषि स्रोतों से डेटा एकत्र किया गया\n`;
      section += `• ${freshDataCount} स्रोतों से ताज़ा जानकारी प��राप्त ��ुई\n`;
      section += `• AI ने इस डेटा को कृषि विशेषज्ञता के साथ जोड़कर उत्तर तैयार किया\n`;
      section += `• वि������वसनीयता स्कोर: ${(response.confidence * 100).toFixed(0)}% (${response.factualBasis === 'high' ? 'उच्च' : response.factualBasis === 'medium' ? 'मध्यम' : 'निम्न'} तथ्यात्मक आधार)\n`;

      if (sources.some(s => s.data?.missingDataNote)) {
        section += `• कुछ डेटा अनु��लब्ध होने पर पारदर्शी सूचना दी गई\n`;
      }
    } else {
      section += `• Analyzed your query to identify topic, crop, and location\n`;
      section += `• Retrieved data from ${dataSourceCount} trusted agricultural sources\n`;
      section += `• ${freshDataCount} sources provided fresh, current information\n`;
      section += `• AI combined this data with agricultural expertise\n`;
      section += `• Confidence score: ${(response.confidence * 100).toFixed(0)}% (${response.factualBasis} factual basis)\n`;

      if (sources.some(s => s.data?.missingDataNote)) {
        section += `• Transparently noted where specific data was unavailable\n`;
      }
    }

    return section;
  }

  private formatDirectLLMResponse(llmAnswer: string, originalQuery: string, language: string): string {
    // Format LLM response with query heading and simple structure
    let formattedAnswer = `**${originalQuery}**\n\n`;

    // Add the LLM response directly
    formattedAnswer += llmAnswer;

    return formattedAnswer;
  }

  private generateSuggestedQuestionsResponse(query: string, language: string, context: QueryContext): string {
    const isHindi = language === 'hi';
    const location = context.location ? `${context.location.district}, ${context.location.state}` : (isHindi ? 'आपका क्षेत्र' : 'your region');

    // Start with query as bold heading
    let response = `**${query}**\n\n`;

    response += isHindi ?
      '❓ **प्रश्न का प���रा उत्तर नहीं मिल सका**\n\nमुझे खुशी है कि आपने सवाल पूछा, लेकिन मेरे पास इस सवाल का जवाब देन�� के लिए पर्याप्त विश्वसनीय डेटा नहीं है।\n\n' :
      '❓ **Query Could Not Be Fully Answered**\n\nI\'m sorry, I do not have sufficient live data to answer your request.\n\n';

    response += isHindi ? '📝 **आप ये सवाल पूछ सकते हैं:**\n' : '**You can try asking:**\n';

    // Generate location-specific suggestions
    if (isHindi) {
      response += `• 🌦 "${location} में अगले 5 दिन का मौसम कैसा रहेगा?"\n`;
      response += `��� 💰 "${location} में गेहूं और चावल के मंडी भाव दिखाएं"\n`;
      response += `• 🐛 "${location} में कपास के लिए कीट चेताव���ी"\n`;
      response += `• 📜 "${location} के किसानों के लिए सरकारी योजनाएं"\n`;
      response += `• 🌱 "मिट्टी की जांच कैसे कराएं ${location} में?"\n`;
      response += `• 💡 "${location} में इस मौसम में कौन सी फसल लगाएं?"`;
    } else {
      response += `• 🌦 "Weather forecast for ${location} for next 5 days"\n`;
      response += `• 💰 "Wheat and rice mandi prices in ${location}"\n`;
      response += `• 🐛 "Pest alerts for cotton in ${location}"\n`;
      response += `• 📜 "Government schemes for farmers in ${location}"\n`;
      response += `• 🌱 "How to get soil testing done in ${location}?"\n`;
      response += `• 💡 "Which crops to plant this season in ${location}?"`;
    }

    return response;
  }

  private getFallbackAdvisory(query: string, language: string, reason: string): RAGResponse {
    const isHindi = language === 'hi';

    // Start with query as bold heading
    let fallbackAdvice = `**${query}**\n\n`;

    if (reason === 'Invalid query format' || reason === 'System temporarily unavailable') {
      // Case 1: Cannot understand query or system down
      fallbackAdvice += isHindi ?
        '❓ **खुशी है कि आपने पूछा**\n\nमुझे खुशी है कि आपने सवाल पूछा, लेकिन मेरे पास इस सवाल का जवा��� देने के लिए पर्याप्त विश्वसनीय डेटा नहीं है।\n\n📝 **आप ये सवाल पूछ सकते हैं:**\n• "पंजाब में अगले 5 दिन का मौसम कैसा रहेगा?"\n• "पंजाब म��ं चावल/गेहूं/मक्का के भाव दिखाएं"\n• "पं����ाब म���ं कपास के लिए कीट चेतावनी"\n• "पंजाब के किसानों के लिए सरकारी योजनाएं"' :
        '❓ **Query Could Not Be Fully Answered**\n\nI\'m sorry, I do not have sufficient live data to answer your request.\n\n**You can try asking:**\n• 🌦 "Weather forecast for Punjab"\n• 💰 "Wheat and rice mandi prices in Punjab"\n• 🐛 "Pest alerts for cotton in Punjab"\n• 📜 "Government schemes for farmers in Punjab"';
    } else {
      // Case 2: General guidance with suggestions
      fallbackAdvice += isHindi ?
        '🌾 **कृषि सलाह**\n\n💡 **सामान्य सुझाव:**\n• मिट्टी की जांच कराएं\n• मौसम के अनुसार फसल का चयन करें\n• स्थानीय कृषि केंद्र से संपर्क करें\n• उचित सिंचाई और उर्वरक का उपयोग करें\n\n📝 **अधिक मदद के ल��ए पूछें:**\n• "मेरे क्षेत्र का म���सम कैसा रहेगा?"\n• "बाजार के भाव क्या हैं?"\n• "मिट्टी की जांच कैसे कराएं?"' :
        '🌾 **Agricultural Advisory**\n\n💡 **General Guidance:**\n• Test your soil regularly\n• Choose crops suitable for current season\n• Contact local agricultural extension office\n• Use appropriate irrigation and fertilization\n\n📝 **For more specific help, ask:**\n• "What is the weather forecast for my region?"\n• "Show me current market prices"\n• "How to get soil testing done?"';
    }

    return {
      answer: fallbackAdvice,
      sources: [],
      confidence: 0.4,
      factualBasis: 'low',
      generatedContent: ['General agricultural guidance'],
      disclaimer: `Based on general agricultural knowledge - ${reason}`
    };
  }

  private getBasicOfflineResponse(query: string, language: string): RAGResponse {
    return this.getFallbackAdvisory(query, language, 'Offline mode');
  }

  private calculateConfidence(data: RetrievedData[]): number {
    if (data.length === 0) return 0.3;
    const avgConfidence = data.reduce((sum, d) => sum + d.confidence, 0) / data.length;
    return Math.min(0.95, avgConfidence);
  }

  private assessFactualBasis(data: RetrievedData[]): 'high' | 'medium' | 'low' {
    const freshData = data.filter(d => d.metadata.freshness === 'fresh');
    if (freshData.length >= 2) return 'high';
    if (data.length >= 2) return 'medium';
    return 'low';
  }

  private constructFarmerFriendlyPrompt(query: string, factualContext: string, language: string, context: QueryContext): string {
    const isHindi = language === 'hi';
    const location = context.location ? `${context.location.district}, ${context.location.state}` : 'India';
    const crop = context.crop?.name || 'crops';

    const instructions = isHindi ?
      'आप एक कृषि विशेषज्ञ हैं। किसान को सरल और स���पष्ट सलाह दें। इमोजी का उपयोग करें।' :
      'You are an agricultural expert. Provide clear, simple advice to farmers. Use emojis for visual appeal.';

    return `${instructions}

FARMER'S QUESTION: ${query}
LOCATION: ${location}
CROP: ${crop}

${factualContext}

RESPONSE FORMAT:
- Use emojis (🌦 🌱 💰 📋 💡)
- Keep language simple and farmer-friendly
- Structure with clear sections
- Highlight key information with **bold**
- Provide actionable advice
- Maximum 300 words

RESPONSE:`;
  }

  private constructInitialPrompt(query: string, language: string, context: QueryContext): string {
    const isHindi = language === 'hi';
    const location = context.location ? `${context.location.district}, ${context.location.state}` : 'India';
    const crop = context.crop?.name || 'general farming';

    const instructions = isHindi ?
      'आप एक कृषि विशेषज्ञ हैं। केवल सामान्य कृषि ज्ञान के आधार पर सलाह दें����' :
      'You are an agricultural expert. Provide advice based on general agricultural knowledge only.';

    return `${instructions}

FARMER'S QUESTION: ${query}
LOCATION: ${location}
TOPIC: ${crop}

INSTRUCTIONS:
- Provide general agricultural guidance
- Use simple, farmer-friendly language
- Keep response under 200 words
- Be practical and actionable
- DO NOT make up specific prices or market data
- Be honest about data limitations
- For price queries, suggest contacting local mandis/markets
- ${isHindi ? 'हिंदी में जवाब दें' : 'Respond in English'}

RESPONSE:`;
  }

  private constructGroundedPrompt(query: string, initialAnswer: string, factualContext: string, language: string): string {
    const isHindi = language === 'hi';

    const instructions = isHindi ?
      'नीचे दिए गए वर्तमान डे���ा के साथ अपनी सलाह को अपडे��� करें।' :
      'Update your advice with the current data provided below.';

    return `${instructions}

ORIGINAL QUESTION: ${query}
YOUR INITIAL ANSWER: ${initialAnswer}

CURRENT VERIFIED DATA:
${factualContext}

INSTRUCTIONS:
- Combine your general knowledge with the specific data provided
- Update prices, weather, and local information with exact data
- Keep the same helpful tone but be more specific
- Use emojis and farmer-friendly language
- Maximum 300 words

UPDATED RESPONSE:`;
  }

  private shouldGroundResponse(context: QueryContext, initialAnswer: string): boolean {
    // Check if query needs current data
    const needsDataTypes = context.queryType;

    // Always ground if specific location, crop, or data-dependent topics mentioned
    if (context.location || context.crop) return true;
    if (needsDataTypes.some(type => ['weather', 'market', 'price', 'scheme'].includes(type))) return true;

    // Check if LLM response mentions needing current data
    if (initialAnswer.includes('current') || initialAnswer.includes('latest') || initialAnswer.includes('today')) return true;

    return false;
  }

  private filterRelevantData(retrievedData: RetrievedData[], context: QueryContext): RetrievedData[] {
    return retrievedData.filter(data => {
      // If specific crop mentioned, be strict about matching
      if (context.crop && data.type === 'market') {
        const marketData = data.data;

        // If the requested crop data is explicitly unavailable, filter it out
        if (marketData.missingDataNote && marketData.requestedCrop === context.crop.name) {
          console.log(`🚫 Filtering out irrelevant market data - requested ${context.crop.name} but got alternative crops`);
          return false; // Don't use alternative crops when specific crop was requested
        }

        // Only include if we have the actual requested crop data
        if (marketData.requestedCrop && marketData.requestedCrop !== context.crop.name) {
          return false;
        }

        // Check if the prices actually contain the requested crop
        if (marketData.prices && marketData.prices.length > 0) {
          const hasRequestedCrop = marketData.prices.some((price: any) =>
            price.crop.toLowerCase() === context.crop.name.toLowerCase()
          );
          if (!hasRequestedCrop) {
            console.log(`🚫 Filtering out market data - doesn't contain requested crop ${context.crop.name}`);
            return false;
          }
        }
      }

      // If location mentioned, prioritize matching location data
      if (context.location && data.location) {
        if (data.location.state !== context.location.state &&
            data.location.district !== context.location.district) {
          // Allow general data but with lower priority
          return true;
        }
      }

      return true;
    });
  }

  private calculateDynamicConfidence(retrievedData: RetrievedData[], context: QueryContext): number {
    let confidence = 0.5; // Base confidence

    // Boost confidence based on data quality
    const freshData = retrievedData.filter(d => d.metadata.freshness === 'fresh').length;
    const totalData = retrievedData.length;

    if (totalData > 0) {
      confidence += (freshData / totalData) * 0.3; // Up to 30% boost for fresh data
    }

    // Boost for specific context matching
    if (context.crop) {
      const cropData = retrievedData.find(d => d.type === 'market' &&
        d.data.requestedCrop === context.crop?.name);
      if (cropData) confidence += 0.15; // 15% boost for matching crop data
    }

    if (context.location) {
      const locationData = retrievedData.find(d => d.location &&
        (d.location.state === context.location?.state || d.location.district === context.location?.district));
      if (locationData) confidence += 0.1; // 10% boost for matching location
    }

    // Boost for multiple data sources
    const uniqueTypes = new Set(retrievedData.map(d => d.type)).size;
    confidence += Math.min(uniqueTypes * 0.05, 0.2); // 5% per type, max 20%

    return Math.min(confidence, 0.95); // Cap at 95%
  }

  private identifyGeneratedContent(answer: string): string[] {
    const generatedPatterns = [
      /generally\s+speaking/i,
      /in\s+most\s+cases/i,
      /typically/i,
      /usually/i,
      /it\s+is\s+recommended/i,
      /आमतौर\s+पर/i,
      /सामान्यतः/i,
      /अक्सर/i
    ];

    const sentences = answer.split(/[.।!?]+/);
    const generated: string[] = [];

    sentences.forEach(sentence => {
      if (generatedPatterns.some(pattern => pattern.test(sentence))) {
        generated.push(sentence.trim());
      }
    });

    return generated;
  }

  private createSourceReferences(retrievedData: RetrievedData[]): SourceReference[] {
    return retrievedData.map(data => ({
      source: data.source,
      type: data.type,
      data: data.data,
      confidence: data.confidence,
      freshness: data.metadata.freshness,
      citation: this.generateCitation(data)
    }));
  }

  private generateCitation(data: RetrievedData): string {
    const date = data.timestamp.toLocaleDateString();
    const location = data.location ? ` for ${data.location.district}, ${data.location.state}` : '';
    return `${data.source} (${date})${location}`;
  }

  private buildFactualContext(retrievedData: RetrievedData[], context: QueryContext): string {
    let factualContext = "CURRENT VERIFIED DATA:\n\n";

    for (const data of retrievedData) {
      factualContext += `## ${data.type.toUpperCase()} DATA - ${data.source}\n`;
      factualContext += `Confidence: ${(data.confidence * 100).toFixed(0)}%\n`;
      factualContext += `Freshness: ${data.metadata.freshness}\n`;
      
      if (data.location) {
        factualContext += `Location: ${data.location.district}, ${data.location.state}\n`;
      }

      switch (data.type) {
        case 'weather':
          const weather = data.data;
          factualContext += `Temperature: ${weather.temperature}°C\n`;
          factualContext += `Humidity: ${weather.humidity}%\n`;
          factualContext += `Rainfall: ${weather.rainfall}mm\n`;
          factualContext += `Wind Speed: ${weather.windSpeed} km/h\n`;
          if (weather.forecast) {
            factualContext += "3-day forecast:\n";
            weather.forecast.forEach((day: any) => {
              factualContext += `  ${day.day}: ${day.temp}°C, ${day.condition}, Rain: ${day.rain}%\n`;
            });
          }
          break;

        case 'market':
          const market = data.data;
          factualContext += `Market: ${market.location}\n`;
          factualContext += `Date: ${market.date}\n`;
          market.prices.forEach((price: any) => {
            factualContext += `${price.crop}: ₹${price.minPrice}-${price.maxPrice} (Modal: ₹${price.modalPrice}) ${price.unit}\n`;
          });
          factualContext += `Price Trend: ${market.trend}\n`;
          break;

        case 'advisory':
          const advisory = data.data;
          factualContext += `Location: ${advisory.location}\n`;
          advisory.advisories.forEach((adv: any, index: number) => {
            factualContext += `Advisory ${index + 1}: ${adv.title}\n`;
            factualContext += `Content: ${adv.content}\n`;
            factualContext += `Priority: ${adv.priority}\n`;
            factualContext += `Source: ${adv.source}\n`;
          });
          break;

        case 'soil':
          const soil = data.data;
          factualContext += `Soil Type: ${soil.soilType}\n`;
          factualContext += `pH: ${soil.pH}\n`;
          factualContext += `Organic Carbon: ${soil.organicCarbon}%\n`;
          factualContext += `Nitrogen: ${soil.nitrogen}\n`;
          factualContext += `Phosphorus: ${soil.phosphorus}\n`;
          factualContext += `Potassium: ${soil.potassium}\n`;
          factualContext += "Recommendations:\n";
          soil.recommendations.forEach((rec: string) => {
            factualContext += `  - ${rec}\n`;
          });
          break;

        case 'scheme':
          const schemes = data.data;
          factualContext += `State: ${schemes.state}\n`;
          schemes.schemes.forEach((scheme: any) => {
            factualContext += `Scheme: ${scheme.name}\n`;
            factualContext += `Description: ${scheme.description}\n`;
            factualContext += `Eligibility: ${scheme.eligibility}\n`;
            factualContext += `Benefit: ${scheme.benefit}\n`;
            factualContext += `Application: ${scheme.applicationProcess}\n`;
          });
          break;
      }
      factualContext += "\n";
    }

    return factualContext;
  }

  private constructPrompt(query: string, factualContext: string, language: string): string {
    const languageInstruction = language === 'en' ? 
      'Respond in clear, simple English suitable for farmers.' :
      `Respond in ${language} language, using simple terms that farmers can understand.`;

    return `You are Krishi Sakha, an expert agricultural advisor for Indian farmers. Use the verified data provided below to answer the farmer's question accurately and helpfully.

${factualContext}

FARMER'S QUESTION: ${query}

INSTRUCTIONS:
1. Use ONLY the verified data provided above to support your answer
2. ${languageInstruction}
3. Be specific and practical in your recommendations
4. If the data doesn't fully address the question, clearly state what information is verified vs. general knowledge
5. Always mention data sources when citing specific facts
6. Provide actionable advice where possible
7. If location-specific data is available, prioritize it over general information
8. Format your response clearly with bullet points or numbered lists when appropriate

RESPONSE:`;
  }

  private async callLLM(prompt: string): Promise<string> {
    try {
      // Try to call Supabase Edge Function for AI generation
      const { data, error } = await supabase.functions.invoke('generate-advice', {
        body: { prompt }
      });

      if (error) {
        console.warn('⚠️ LLM service unavailable, using offline AI:', error.message || error);

        // Log specific error guidance
        if (error.message?.includes('500')) {
          console.warn('🔑 Configuration needed: GEMINI_API_KEY not set in Edge Functions');
        }

        console.log('🤖 Using offline AI service instead...');
        return this.getOfflineLLMResponse(prompt);
      }

      return data?.advice || this.getOfflineLLMResponse(prompt);
    } catch (error) {
      console.warn('Error calling LLM, falling back to offline AI:', error);
      return this.getOfflineLLMResponse(prompt);
    }
  }

  private async validateWithGemini(
    candidateResponse: string,
    sources: SourceReference[],
    languageResult: any,
    processedQuery: string
  ): Promise<RAGResponse> {
    try {
      const validationRequest: GeminiValidationRequest = {
        originalQuery: languageResult.originalQuery,
        translatedQuery: languageResult.translatedQuery,
        detectedLanguage: languageResult.detectedLanguage,
        candidateResponse: candidateResponse,
        apiDataSources: sources.map(s => ({ source: s.source, type: s.type, confidence: s.confidence })),
        confidence: Math.max(...sources.map(s => s.confidence), 0.5)
      };

      const validation = await geminiValidator.validateAndEnhanceResponse(validationRequest);

      console.log(`✅ Gemini validation complete: ${validation.isAccurate ? 'Accurate' : 'Enhanced'}, ${validation.isComplete ? 'Complete' : 'Improved'}`);

      return {
        answer: validation.enhancedResponse,
        sources: sources,
        confidence: validation.confidence,
        factualBasis: validation.factualBasis,
        generatedContent: validation.corrections || [],
        disclaimer: validation.disclaimer || this.generateDisclaimer(validation.factualBasis, validation.confidence)
      };

    } catch (error) {
      console.error('Gemini validation failed, using original response:', error);

      // Fallback to original response with offline enhancement
      return this.formatFarmerFriendlyResponse(candidateResponse, sources, languageResult.detectedLanguage, processedQuery);
    }
  }

  private formatPriceResponse(priceData: any, originalQuery: string): string {
    const { prices, requestedCrop, requestedLocation, searchTimestamp } = priceData;

    let response = `🔍 **Query:** ${originalQuery}\n\n`;
    response += `💰 **Market Prices for ${requestedCrop.charAt(0).toUpperCase() + requestedCrop.slice(1)} in ${requestedLocation.charAt(0).toUpperCase() + requestedLocation.slice(1)}:**\n\n`;

    prices.forEach((price: any) => {
      const trendEmoji = price.trend === 'rising' ? '📈' : price.trend === 'falling' ? '📉' : '➡️';
      response += `• **${price.mandi}**: ₹${price.pricePerKg}/kg ${trendEmoji}\n`;
      response += `  - Variety: ${price.variety}\n`;
      response += `  - Date: ${price.date}\n`;
      response += `  - Source: ${price.source}\n\n`;
    });

    response += `📊 **Market Summary:**\n`;
    response += `• Total Mandis: ${prices.length}\n`;
    response += `• Price Range: ₹${Math.min(...prices.map((p: any) => p.pricePerKg))}-${Math.max(...prices.map((p: any) => p.pricePerKg))}/kg\n`;
    response += `• Data Updated: ${new Date(searchTimestamp).toLocaleString()}\n\n`;

    response += `⚠️ **Note:** Prices may vary throughout the day. Visit mandis directly for final rates.`;

    return response;
  }

  private formatNoPriceDataResponse(priceData: any, originalQuery: string): string {
    const { requestedCrop, requestedLocation } = priceData;

    let response = `🔍 **Query:** ${originalQuery}\n\n`;
    response += `⚠️ **Price Data Status:**\n\n`;
    response += `• No current price data available for **${requestedCrop}** in **${requestedLocation}** today\n`;
    response += `• AGMARKNET and eNAM APIs currently unavailable\n`;
    response += `• Please check again later or visit local mandi for current rates\n\n`;
    response += `📞 **Alternative Options:**\n`;
    response += `• Visit nearest APMC mandi directly\n`;
    response += `• Check local newspaper market rates\n`;
    response += `• Contact local agricultural extension officer\n\n`;
    response += `⏰ **Last Checked:** ${new Date().toLocaleString()}`;

    return response;
  }

  private createPriceSources(priceData: any): SourceReference[] {
    return priceData.prices.map((price: any) => ({
      source: price.source,
      type: 'mandi_price',
      data: price,
      confidence: price.confidence,
      freshness: 'fresh' as const,
      citation: `${price.mandi}, ${price.date}`
    }));
  }

  private getOfflineLLMResponse(prompt: string): string {
    try {
      // Extract the actual query from the prompt
      const queryMatch = prompt.match(/User Query:\s*([^\n]+)/i) ||
                        prompt.match(/FARMER'S QUESTION:\s*([^\n]+)/i) ||
                        prompt.match(/Query:\s*([^\n]+)/i);

      const query = queryMatch ? queryMatch[1].trim() : prompt.slice(0, 100);

      const response = offlineAIService.generateResponse(query, 'en');
      return offlineAIService.formatStructuredResponse(response, query);
    } catch (error) {
      console.error('Offline AI also failed:', error);
      return 'I apologize, but I cannot provide specific advice at the moment. For immediate assistance, please contact your local agricultural extension office or call the Kisan Call Center at 1800-180-1551.';
    }
  }

  private analyzeResponse(answer: string, sources: SourceReference[]): {
    answer: string;
    confidence: number;
    factualBasis: 'high' | 'medium' | 'low';
    generatedContent: string[];
    disclaimer?: string;
  } {
    const verifiedSources = sources.filter(s => s.freshness === 'fresh' && s.confidence > 0.7);
    const totalSources = sources.length;
    
    let factualBasis: 'high' | 'medium' | 'low';
    let confidence: number;
    let disclaimer: string | undefined;

    if (verifiedSources.length >= 2 && totalSources >= 2) {
      factualBasis = 'high';
      confidence = 0.9;
    } else if (verifiedSources.length >= 1 || totalSources >= 1) {
      factualBasis = 'medium';
      confidence = 0.7;
      disclaimer = 'This advice is based on available data, but please verify locally for your specific conditions.';
    } else {
      factualBasis = 'low';
      confidence = 0.5;
      disclaimer = 'This response is based on general agricultural knowledge. Please consult local experts for location-specific advice.';
    }

    // Identify potentially generated content
    const generatedContent: string[] = [];
    const commonGenerativePatterns = [
      /generally speaking/i,
      /in most cases/i,
      /typically/i,
      /usually/i,
      /it is recommended/i
    ];

    const sentences = answer.split(/[.!?]+/);
    sentences.forEach(sentence => {
      if (commonGenerativePatterns.some(pattern => pattern.test(sentence))) {
        generatedContent.push(sentence.trim());
      }
    });

    return {
      answer,
      confidence,
      factualBasis,
      generatedContent,
      disclaimer
    };
  }
}

export const ragSystem = new RetrievalAugmentedGeneration();
