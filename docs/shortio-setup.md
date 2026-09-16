# 🔗 Short.io Integration Setup

## Get Your Short.io API Key

1. **Go to [Short.io](https://short.io/)**
2. **Sign up for a free account**
3. **Go to Settings → API**
4. **Copy your API key**
5. **Add it to your `.env` file:**

```env
SHORTIO_API_KEY=your_actual_api_key_here
```

## Features

- ✅ **Clean OAuth URLs** - Instead of long Zoom URLs, users get clean short.io links
- ✅ **Analytics** - Track OAuth link clicks in Short.io dashboard
- ✅ **Professional appearance** - Short links look more trustworthy
- ✅ **Fallback** - If Short.io is down, bot uses original URLs

## OAuth URL Examples

**Without Short.io:**
```
https://zoom.us/oauth/authorize?response_type=code&client_id=K3t8Sd3rSZOSKfkyMftDXg&redirect_uri=https%3A%2F%2Fpupfrisky.com%2Fzoom-callback&state=YOUR_TELEGRAM_USER_ID
```

**With Short.io:**
```
https://short.io/abc123
```

## How It Works

1. User runs `/zoomlogin`
2. Bot shows "🔗 Generating secure authorization link..."
3. Bot creates OAuth URL and sends to Short.io API
4. Bot sends shortened link to user
5. User clicks clean short link
6. Redirects to Zoom OAuth → Your domain → Bot activation

## Custom Domain (Optional)

If you have a Short.io premium account, you can use your own domain:

```javascript
// In bot.cjs, change the domain in shortenUrl function:
domain: 'go.pupfrisky.com' // instead of 'short.io'
```

This makes links like: `https://go.pupfrisky.com/zoom123`

## Testing

1. Add your Short.io API key to `.env`
2. Restart the bot
3. Try `/zoomlogin` - you should see a loading message then a short link
4. Check your Short.io dashboard for analytics

Ready to make your OAuth flow professional! 🚀
