# GitHub Actions Scheduled Broadcast

This workflow triggers your Netlify background broadcast function on a schedule.

## Setup

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:
   - `NETLIFY_SITE_URL` - Your Netlify site URL (e.g., `https://your-site.netlify.app`)
   - `INTERNAL_API_KEY` - The same `INTERNAL_API_KEY` you set in Netlify environment variables

## Schedule

The workflow runs every 2 hours (UTC). To modify:
- Edit `.github/workflows/scheduled-broadcast.yml`
- Change the cron expression: `0 */2 * * *`
- For every 2.4 hours, you'd need multiple schedules or a different approach

## Manual Trigger

You can also trigger this workflow manually:
1. Go to Actions tab in GitHub
2. Select "Scheduled Broadcast" workflow
3. Click "Run workflow"

