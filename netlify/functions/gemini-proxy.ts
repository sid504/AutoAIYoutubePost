import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import {
    fetchDailyAINews,
    generateStructuredContent,
    generateImage,
    generateAudio,
    generateSEOMetadata,
    generateYouTubeThumbnail,
} from './shared/geminiServiceServer';

/**
 * Unified Gemini API Proxy Function
 * Keeps API key secret on server-side
 * Client calls this function instead of Gemini directly
 */
export const handler: Handler = async (
    event: HandlerEvent,
    context: HandlerContext
) => {
    // CORS headers for browser requests
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }

    try {
        const body = event.body ? JSON.parse(event.body) : {};
        const { action, ...params } = body;

        let result: any;

        switch (action) {
            case 'fetchNews':
                result = await fetchDailyAINews();
                break;

            case 'generateScript':
                result = await generateStructuredContent(params.topic, params.newsContext);
                break;

            case 'generateImage':
                result = await generateImage(params.prompt);
                break;

            case 'generateAudio':
                result = await generateAudio(params.text);
                break;

            case 'generateSEO':
                result = await generateSEOMetadata(params.script, params.topic);
                break;

            case 'generateThumbnail':
                result = await generateYouTubeThumbnail(params.topic, params.title);
                break;

            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: `Unknown action: ${action}` }),
                };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, data: result }),
        };
    } catch (error: any) {
        console.error('[gemini-proxy] Error:', error);

        // Use the status code from the error if available (e.g. 429 for rate limiting)
        const statusCode = error.status || error.code || 500;
        const validStatusCode = (typeof statusCode === 'number' && statusCode >= 100 && statusCode < 600) ? statusCode : 500;

        return {
            statusCode: validStatusCode,
            headers,
            body: JSON.stringify({
                success: false,
                error: error.message || 'Internal server error',
            }),
        };
    }
};
