import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/components/ui/use-toast';
import { preprocessQuery } from '@/utils/queryPreprocessor';
import { ragSystem, RAGResponse } from '@/services/ragSystem';
import { processLanguageQuery } from '@/utils/languageProcessor';

export interface Query {
  id: string;
  user_id: string;
  query_text: string;
  original_query_text: string | null;
  translated_query_text: string | null;
  detected_language: string | null;
  language: string;
  advice: string;
  explanation: string | null;
  created_at: string;
  sources?: any[];
  confidence?: number;
  factual_basis?: 'high' | 'medium' | 'low';
  gemini_validated?: boolean;
}

export const useQueries = () => {
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const generateAdviceWithRAG = async (queryText: string, language: string): Promise<RAGResponse> => {
    try {
      return await ragSystem.generateAdvice(queryText, language);
    } catch (error) {
      console.error('Error calling RAG system:', error);

      // Enhanced fallback response that's always helpful
      const isHindi = language === 'hi';
      const fallbackAnswer = isHindi ?
        `🌾 **कृषि सलाह** (सिस्टम त्रुटि के कारण सामान्य सुझाव)\n\n💡 **तत्काल सुझाव:**\n• अपनी मिट्टी की जांच कराएं\n• मौसम के अनुसार फसल का चयन करें\n• स्थानीय कृषि विशेषज्ञ से संपर्क करें\n• उ��ित सिंचाई और उर्वरक का प्रयोग करें\n\n📞 **सहायता:**\n• किसान कॉल सेंटर: 1800-180-1551\n• निकटतम कृषि केंद्र से मिलें\n\n⚠️ **नोट:** यह सामान्य सलाह है। विस्तृत जानकारी के लिए इंटरनेट कनेक्शन की जांच करें।` :
        `��� **Agricultural Advisory** (General guidance due to system error)\n\n💡 **Immediate Suggestions:**\n• Test your soil regularly for nutrients\n• Choose crops suitable for current season\n• Contact local agricultural extension office\n• Use appropriate irrigation and fertilization\n\n📞 **Support:**\n• Kisan Call Center: 1800-180-1551\n• Visit nearest Krishi Vigyan Kendra\n\n⚠️ **Note:** This is general advice. Check internet connection for detailed, data-driven guidance.`;

      return {
        answer: `**${queryText}**\n\n${fallbackAnswer}`,
        sources: [],
        confidence: 0.4,
        factualBasis: 'low',
        generatedContent: ['General agricultural guidance'],
        disclaimer: "System temporarily unavailable - showing general farming guidance"
      };
    }
  };

  const fetchQueries = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('queries')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setQueries(data || []);
    } catch (error) {
      console.error('Error fetching queries:', error);
      toast({
        title: "Error",
        description: "Failed to fetch query history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const submitQuery = async (queryText: string, language: string) => {
    if (!user) return;

    setLoading(true);

    // STEP 1: Enhanced Language Processing
    console.log('🗣️ Processing language for query:', queryText);
    const languageResult = processLanguageQuery(queryText);

    console.log(`📝 Language Detection: ${languageResult.detectedLanguage} (${(languageResult.confidence * 100).toFixed(0)}% confidence)`);

    // STEP 2: ALWAYS generate the AI response first (using processed language data)
    const ragResponse = await generateAdviceWithRAG(languageResult.translatedQuery || queryText, languageResult.detectedLanguage || language);

    // STEP 3: Process the original query for additional context
    const processed = preprocessQuery(queryText);

    // STEP 4: Create comprehensive response object with language processing data
    const responseData = {
      id: `temp_${Date.now()}`,
      user_id: user.id,
      query_text: processed.cleanedText || queryText,
      original_query_text: languageResult.originalQuery,
      translated_query_text: languageResult.isTranslationRequired ? languageResult.translatedQuery : null,
      detected_language: languageResult.detectedLanguage,
      language,
      advice: ragResponse.answer,
      explanation: ragResponse.disclaimer || `🌾 AI-generated advice with ${ragResponse.factualBasis} factual basis (${(ragResponse.confidence * 100).toFixed(0)}% confidence)`,
      created_at: new Date().toISOString(),
      sources: ragResponse.sources,
      confidence: ragResponse.confidence,
      factual_basis: ragResponse.factualBasis,
      gemini_validated: true
    };

    // STEP 4: Try to save to database with retries (but never block the response)
    let savedToDatabase = false;
    let retryCount = 0;
    const maxRetries = 3;

    const attemptSave = async () => {
      try {
        // Check if user is still authenticated before attempting save
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('User session expired. Please sign in again.');
        }

        const { data, error } = await supabase
          .from('queries')
          .insert([{
            user_id: user.id,
            query_text: processed.cleanedText || queryText,
            original_query_text: languageResult.originalQuery,
            translated_query_text: languageResult.isTranslationRequired ? languageResult.translatedQuery : null,
            detected_language: languageResult.detectedLanguage,
            language,
            advice: ragResponse.answer,
            explanation: responseData.explanation
          }])
          .select()
          .single();

        if (!error && data) {
          savedToDatabase = true;
          responseData.id = data.id; // Update with real ID
          setQueries(prev => [data, ...prev.slice(0, 9)]);
          console.log('✅ Query saved to database successfully');
          return data;
        } else {
          throw error;
        }
      } catch (err: any) {
        const errorMessage = err?.message || 'Unknown error';
        console.warn(`⚠️ Database save attempt ${retryCount + 1} failed:`, errorMessage);
        retryCount++;

        // Handle specific error types
        if (errorMessage.includes('session expired') || errorMessage.includes('JWT')) {
          console.error('❌ Authentication expired. User needs to sign in again.');
          toast({
            title: "Session Expired",
            description: "Please sign in again to save your queries.",
            variant: "destructive",
          });
          return; // Don't retry for auth errors
        }

        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.log(`🔄 Retrying in ${delay}ms...`);
          setTimeout(attemptSave, delay);
        } else {
          console.error('❌ All database save attempts failed:', errorMessage);
          // Show a more informative error to the user
          toast({
            title: "Unable to save to history",
            description: `Database error: ${errorMessage}. Your advice is still available below.`,
            variant: "destructive",
          });
        }
      }
    };

    // Start save attempts in background (non-blocking)
    attemptSave();

    // STEP 5: Show response immediately with appropriate message
    if (processed.isValid !== false) {
      toast({
        title: "🌾 Your farming advice is ready!",
        description: "AI has processed your question successfully.",
      });
    } else {
      toast({
        title: "🌾 Advice generated",
        description: "Your question has been processed with basic formatting.",
      });
    }

    // Check save status after a reasonable delay and show appropriate feedback
    setTimeout(() => {
      if (!savedToDatabase) {
        // Only show this if all retries haven't finished yet
        if (retryCount < maxRetries) {
          toast({
            title: "⚠️ Saving to history...",
            description: "Your advice is ready below. Still trying to save to history.",
            variant: "default",
          });
        }
      }
    }, 3000);

    setLoading(false);
    return responseData;
  };

  const deleteQuery = async (queryId: string) => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('queries')
        .delete()
        .eq('id', queryId)
        .eq('user_id', user.id);

      if (error) throw error;
      
      setQueries(prev => prev.filter(q => q.id !== queryId));
      
      toast({
        title: "Query deleted",
        description: "The query has been removed from your history.",
      });
    } catch (error) {
      console.error('Error deleting query:', error);
      toast({
        title: "Error",
        description: "Failed to delete query. Please try again.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (user) {
      fetchQueries();
    }
  }, [user]);

  return {
    queries,
    loading,
    submitQuery,
    deleteQuery,
    refetch: fetchQueries
  };
};
