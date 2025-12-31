/**
 * API Service for server-side content generation
 * Use this to generate content on the server instead of client-side
 * Video recording still happens client-side due to browser API requirements
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/.netlify/functions';

export interface BroadcastContentResponse {
  success: boolean;
  broadcastId: string;
  content: {
    topic: string;
    segments: Array<{
      text: string;
      visualPrompt: string;
      layout: 'CENTER' | 'SIDEBAR' | 'FULL_IMAGE';
      highlights: string[];
    }>;
    backgroundImages: string[];
    audioBlobUrl: string; // Base64 data URL
    fullScript: string;
    thumbnailUrl: string;
    seoTags: string[];
    seoTitle: string;
    seoDescription: string;
    newsSources: any[];
    newsContext: string;
  };
  message: string;
  timestamp: string;
}

/**
 * Generate broadcast content on the server
 * @param topic Optional topic (if not provided, uses daily news rotation)
 * @param youtubeAccessToken Optional YouTube access token for upload preparation
 * @param useDailyNews Whether to use daily news rotation
 */
export const generateBroadcastContent = async (
  topic?: string,
  youtubeAccessToken?: string,
  useDailyNews: boolean = true
): Promise<BroadcastContentResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}/background-broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: In production, you'd want to secure this endpoint
        // For now, INTERNAL_API_KEY can be set as an environment variable
        ...(import.meta.env.VITE_INTERNAL_API_KEY && {
          'Authorization': `Bearer ${import.meta.env.VITE_INTERNAL_API_KEY}`
        }),
      },
      body: JSON.stringify({
        topic,
        youtubeAccessToken,
        useDailyNews,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `API request failed: ${response.statusText}`);
    }

    const data: BroadcastContentResponse = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Content generation failed');
    }

    return data;
  } catch (error: any) {
    console.error('[API] Failed to generate content:', error);
    throw error;
  }
};

/**
 * Trigger a scheduled broadcast manually (for testing)
 */
export const triggerScheduledBroadcast = async (): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE_URL}/scheduled-broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(import.meta.env.VITE_INTERNAL_API_KEY && {
          'Authorization': `Bearer ${import.meta.env.VITE_INTERNAL_API_KEY}`
        }),
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `API request failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('[API] Failed to trigger scheduled broadcast:', error);
    throw error;
  }
};

