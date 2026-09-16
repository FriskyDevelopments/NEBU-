# 🚂 Railway Environment Variables Setup

## Step 1: Access Railway Dashboard
Go to: https://railway.app/dashboard
Find your project: "Nebulosa" or "LA NUBE BOT"

## Step 2: Add Environment Variables
In your Railway project, go to **Variables** tab and add these:

```bash
BOT_TOKEN=YOUR_BOT_TOKEN
AUTHORIZED_GROUP_ID=-1002726059191
ZOOM_USER_CLIENT_ID=vGVyI0IRv6si45iKO_qIw
ZOOM_USER_CLIENT_SECRET=qL0UeGFWeQM2Csu1Z1G2J4RAZt4QGzi6
ZOOM_CLIENT_ID=vGVyI0IRv6si45iKO_qIw
ZOOM_CLIENT_SECRET=qL0UeGFWeQM2Csu1Z1G2J4RAZt4QGzi6
ZOOM_REDIRECT_URI=https://pupfr.github.io/Nebulosa/zoom-callback.html
ZOOM_SECRET_TOKEN=REDACTED-rotate-in-Zoom-Marketplace
PORT=3000
NODE_ENV=production
```

## Step 3: Deploy
Railway should automatically redeploy when you push to GitHub or you can trigger manually.

## Troubleshooting ETELEGRAM 404 Error

The error means Railway can't access the bot token. Ensure:

1. ✅ **BOT_TOKEN** is set in Railway Variables (not in .env file)
2. ✅ **No spaces** around the token value
3. ✅ **Correct token format**: `YOUR_BOT_TOKEN`
4. ✅ **Railway deployment** is using the correct start command: `node production-bot.js`

## Quick Fix Commands (Railway CLI)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Set variables
railway variables set BOT_TOKEN=YOUR_BOT_TOKEN
railway variables set PORT=3000
railway variables set NODE_ENV=production

# Deploy
railway up
```

## Check Deployment Status

```bash
# View logs
railway logs

# Check variables
railway variables

# Check domain
railway domain
```
