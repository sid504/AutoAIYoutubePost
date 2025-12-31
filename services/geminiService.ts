/**
 * Client-side API Service
 * Calls Netlify Functions (server-side) instead of Gemini directly
 * This keeps the API key secure on the server
 */

// Determine API endpoint based on environment
const getApiUrl = () => {
  // In production (Netlify), use relative path
  // In development, Vite proxy will handle it OR use localhost:8888
  if (import.meta.env.DEV) {
    // For local dev with `netlify dev`, functions are at /.netlify/functions/
    return '/.netlify/functions/gemini-proxy';
  }
  return '/.netlify/functions/gemini-proxy';
};

const callProxy = async (action: string, params: Record<string, any> = {}) => {
  const response = await fetch(getApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API call failed: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }
  return result.data;
};

export const TOPIC_ROTATION = [
  "AI & Tech Updates",
  "Electronics & Gadgets",
  "Current Global Affairs",
  "Health & Fitness",
  "Global Politics",
  "Beauty & Skincare",
  "Space & Science",
  "Business & Finance",
  "Automotive Innovation",
  "Environment & Sustainability"
];

export const fetchDailyAINews = async () => {
  return callProxy('fetchNews');
};

export const generateStructuredContent = async (topic: string, newsContext?: string) => {
  return callProxy('generateScript', { topic, newsContext });
};

export const generateImage = async (prompt: string): Promise<string> => {
  return callProxy('generateImage', { prompt });
};

export const generateAudio = async (text: string): Promise<string> => {
  return callProxy('generateAudio', { text });
};

export const generateSEOMetadata = async (script: string, topic: string) => {
  return callProxy('generateSEO', { script, topic });
};

export const generateYouTubeThumbnail = async (topic: string, title: string): Promise<string> => {
  return callProxy('generateThumbnail', { topic, title });
};

// YouTube upload still happens client-side (uses user's OAuth token)
export const uploadToYouTube = async (
  videoBlob: Blob,
  title: string,
  description: string,
  accessToken: string,
  tags?: string[],
  thumbnailDataUrl?: string
) => {
  const metadata = {
    snippet: {
      title,
      description,
      categoryId: '27', // Education
      tags: tags || []
    },
    status: {
      privacyStatus: 'public'
    }
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('video', videoBlob);

  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'YouTube Upload Failed');
  }

  const videoData = await response.json();
  const videoId = videoData.id;

  // Set Thumbnail if provided
  if (videoId && thumbnailDataUrl) {
    try {
      const thumbResponse = await fetch(thumbnailDataUrl);
      const blob = await thumbResponse.blob();
      await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'image/jpeg'
        },
        body: blob
      });
    } catch (e) {
      console.warn("Failed to set thumbnail, video remains with default.", e);
    }
  }

  return videoData;
};

export const uploadToYouTubeWithThumbnail = async (videoBlob: Blob, title: string, description: string, tags: string[], thumbnailDataUrl: string, accessToken: string) => {
  return uploadToYouTube(videoBlob, title, description, accessToken, tags, thumbnailDataUrl);
};
