# Deployment Guide: Background Process Setup

## Problem
The auto-broadcast feature was running in the browser using `setInterval`, which stops when the browser closes. For production, we need the process to run independently on the server.

## Solution
We've created Netlify Serverless Functions that run independently of the browser:

1. **Scheduled Function** (`scheduled-broadcast`) - Triggers the broadcast process on a schedule
2. **Background Function** (`background-broadcast`) - Handles the long-running content generation

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables in Netlify

Go to your Netlify site dashboard → Site settings → Environment variables and add:

- `GEMINI_API_KEY` - Your Google Gemini API key
- `INTERNAL_API_KEY` - A secret key for internal API calls (generate a random string)
- `DAILY_UPLOAD_LIMIT` - Daily upload limit (default: 10)

### 3. Configure Scheduled Function

**Option A: Using Netlify UI (Recommended)**
1. Go to your site dashboard → Functions
2. Find `scheduled-broadcast` function
3. Enable "Schedule" option
4. Set cron expression: `0 */2 * * *` (every 2 hours in UTC)
   - For every 2.4 hours, use: `0 0,2,4,6,8,10,12,14,16,18,20,22 * * *` (runs at even hours)

**Option B: Using External Scheduler**
Use a free cron service like:
- [cron-job.org](https://cron-job.org)
- [EasyCron](https://www.easycron.com)
- GitHub Actions (create `.github/workflows/broadcast.yml`)

Schedule a POST request to:
```
https://your-site.netlify.app/.netlify/functions/background-broadcast
```

Headers:
```
Authorization: Bearer YOUR_INTERNAL_API_KEY
Content-Type: application/json
```

Body:
```json
{
  "youtubeAccessToken": "optional-if-stored-securely",
  "useDailyNews": true
}
```

### 4. Video Recording Limitation

**Important**: Video recording requires browser APIs (Canvas, MediaRecorder) which are not available in serverless functions. 

**Current Solution**: 
- Content generation (script, images, audio, SEO) runs server-side ✅
- Video recording must be done client-side or via headless browser service

**Future Options**:
1. **Keep client-side recording**: Frontend receives generated content and records video
2. **Use headless browser service**: Deploy a separate service (Railway, Render, VPS) with Puppeteer/Playwright
3. **Use video rendering API**: Services like Bannerbear, Creatomate, or Remotion

### 5. Testing Locally

Install Netlify CLI:
```bash
npm install -g netlify-cli
```

Run locally:
```bash
netlify dev
```

Test the background function:
```bash
curl -X POST http://localhost:8888/.netlify/functions/background-broadcast \
  -H "Authorization: Bearer your-internal-key" \
  -H "Content-Type: application/json" \
  -d '{"useDailyNews": true}'
```

### 6. Deploy to Netlify

```bash
# Build and deploy
npm run build
netlify deploy --prod

# Or connect to GitHub for automatic deployments
```

## Architecture

```
┌─────────────────┐
│  Netlify Cron   │ (or external scheduler)
│  Every 2 hours  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ scheduled-broadcast.ts   │ (Scheduled Function)
│ - Checks quota           │
│ - Triggers background    │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background-broadcast.ts  │ (Background Function)
│ - Generates content      │ ⏱️ Up to 15 min
│ - Script, images, audio  │
│ - SEO metadata           │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Returns content to:      │
│ - Frontend (for recording)│
│ - Or headless browser    │
└─────────────────────────┘
```

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `INTERNAL_API_KEY` | Secret key for internal API calls | Yes |
| `DAILY_UPLOAD_LIMIT` | Maximum uploads per day | No (default: 10) |
| `URL` | Your Netlify site URL (auto-set) | Auto |

## Troubleshooting

### Function not triggering
- Check Netlify function logs in dashboard
- Verify cron schedule is enabled
- Check environment variables are set

### Content generation fails
- Verify `GEMINI_API_KEY` is correct
- Check API quota limits
- Review function logs for errors

### Video recording not working
- Remember: Video recording requires browser/client-side execution
- Consider using headless browser service for full automation

## Next Steps

1. **For full automation**: Set up a headless browser service (Puppeteer/Playwright) on Railway or Render
2. **For quota management**: Implement database storage (Supabase, MongoDB) for daily quota tracking
3. **For YouTube auth**: Store refresh tokens securely (encrypted environment variables or database)

