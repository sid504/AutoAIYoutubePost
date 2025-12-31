import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';

/**
 * Netlify Scheduled Function - Runs on cron schedule
 * This function triggers the broadcast generation process
 * Configured in netlify.toml to run every 2.4 hours (144 minutes)
 */
export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext
) => {
  console.log('[SCHEDULED] Broadcast trigger started at', new Date().toISOString());

  try {
    // Check daily quota (stored in environment or external storage)
    const dailyQuota = parseInt(process.env.DAILY_UPLOAD_LIMIT || '10');
    const today = new Date().toISOString().split('T')[0];
    
    // In production, you'd check quota from a database or external storage
    // For now, we'll proceed and let the background function handle quota checks
    
    // Trigger the background broadcast function
    const backgroundUrl = `${process.env.URL || event.headers.host}/.netlify/functions/background-broadcast`;
    
    const response = await fetch(backgroundUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || 'internal-key'}`,
      },
      body: JSON.stringify({
        trigger: 'scheduled',
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Background function failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Broadcast process triggered',
        broadcastId: result.broadcastId,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error: any) {
    console.error('[SCHEDULED] Error:', error);
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

