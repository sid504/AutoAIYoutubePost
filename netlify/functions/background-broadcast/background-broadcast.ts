import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { 
  generateStructuredContent, 
  generateImage, 
  generateAudio, 
  fetchDailyAINews,
  generateSEOMetadata,
  generateYouTubeThumbnail,
  TOPIC_ROTATION 
} from '../shared/geminiServiceServer';

const DAILY_UPLOAD_LIMIT = 10;

/**
 * Netlify Background Function - Handles long-running broadcast generation
 * This function can run up to 15 minutes
 * Generates content, but video recording must be done client-side or via headless browser
 */
export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext
) => {
  // Verify internal API key for security
  const authHeader = event.headers.authorization;
  const expectedKey = process.env.INTERNAL_API_KEY || 'internal-key';
  
  if (authHeader !== `Bearer ${expectedKey}` && event.httpMethod !== 'OPTIONS') {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  console.log('[BACKGROUND] Broadcast generation started');

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { youtubeAccessToken, topic, useDailyNews = true } = body;

    // Check daily quota
    const today = new Date().toISOString().split('T')[0];
    // In production, store quota in a database or external storage
    // For now, we'll proceed and let YouTube API handle rate limits

    // Get topic
    const activeTopic = useDailyNews 
      ? TOPIC_ROTATION[Math.floor(Math.random() * TOPIC_ROTATION.length)]
      : topic || TOPIC_ROTATION[0];

    console.log(`[BACKGROUND] Generating broadcast for topic: ${activeTopic}`);

    // Step 1: Fetch news context
    let newsContext = "";
    let groundingSources: any[] = [];
    
    if (useDailyNews) {
      console.log('[BACKGROUND] Fetching daily news...');
      const news = await fetchDailyAINews();
      newsContext = news.summary;
      groundingSources = news.sources;
    }

    // Step 2: Generate script
    console.log('[BACKGROUND] Generating script...');
    const segments = await generateStructuredContent(activeTopic, newsContext);
    const fullScript = segments.map((s: any) => s.text).join(" ");

    // Step 3: Generate background images
    console.log('[BACKGROUND] Generating images...');
    const backgroundImages = await Promise.all(
      segments.map((s: any) => generateImage(`Cinematic wide shot: ${s.visualPrompt}`))
    );

    // Step 4: Generate audio
    console.log('[BACKGROUND] Generating audio...');
    const audioBlobUrl = await generateAudio(fullScript);

    // Step 5: Generate SEO metadata
    console.log('[BACKGROUND] Generating SEO metadata...');
    const seo = await generateSEOMetadata(fullScript, activeTopic);

    // Step 6: Generate thumbnail
    console.log('[BACKGROUND] Generating thumbnail...');
    const thumbnailUrl = await generateYouTubeThumbnail(activeTopic, seo.title);

    const broadcastContent = {
      topic: activeTopic,
      segments,
      backgroundImages,
      audioBlobUrl,
      fullScript,
      thumbnailUrl,
      seoTags: seo.tags,
      seoTitle: seo.title,
      seoDescription: seo.description,
      newsSources: groundingSources,
      newsContext,
    };

    // If YouTube token provided, we can prepare for upload
    // But video recording must happen client-side or via headless browser
    if (youtubeAccessToken) {
      console.log('[BACKGROUND] YouTube token provided, content ready for upload');
      // Return content to be recorded and uploaded by client or headless service
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        broadcastId: `broadcast-${Date.now()}`,
        content: broadcastContent,
        message: 'Content generated successfully. Video recording must be done client-side or via headless browser.',
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error: any) {
    console.error('[BACKGROUND] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

