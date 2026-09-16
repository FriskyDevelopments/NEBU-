#!/bin/bash

echo "🚂 RAILWAY DEPLOYMENT FIX SCRIPT"
echo "================================="
echo ""

echo "🔍 Current Railway Status:"
echo "• URL: https://nebulosa-production.railway.app"
echo "• Health: $(curl -s https://nebulosa-production.railway.app/health)"
echo "• Main page: Shows Railway API default"
echo "• OAuth callback: 404 Not Found"
echo ""

echo "💡 DEPLOYMENT SOLUTIONS:"
echo ""
echo "1. 🔄 FORCE REDEPLOY (if you have Railway CLI):"
echo "   railway up"
echo "   railway deploy"
echo ""

echo "2. 📝 CHECK ENVIRONMENT VARIABLES:"
echo "   railway variables"
echo "   # Should have: BOT_TOKEN, ZOOM_CLIENT_ID, etc."
echo ""

echo "3. 🔧 MANUAL REDEPLOY (via GitHub):"
echo "   git add ."
echo "   git commit -m 'Fix Railway deployment'"
echo "   git push origin main"
echo "   # If Railway is connected to GitHub, this will trigger redeploy"
echo ""

echo "4. 🎯 IMMEDIATE WORKAROUND:"
echo "   # Update Zoom app to allow GitHub Pages callback"
echo "   # Then switch local bot to use GitHub Pages"
echo ""

echo "📋 ENVIRONMENT VARIABLES NEEDED ON RAILWAY:"
echo "BOT_TOKEN=YOUR_BOT_TOKEN"
echo "ZOOM_CLIENT_ID=K3t8Sd3rSZOSKfkyMftDXg"
echo "ZOOM_CLIENT_SECRET=Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB"
echo "ZOOM_REDIRECT_URI=https://nebulosa-production.railway.app/auth/zoom/callback"
echo "PORT=3000"
echo ""

echo "🚀 NEXT STEPS:"
echo "1. Try Railway CLI commands above"
echo "2. OR update Zoom app for GitHub Pages callback"
echo "3. Test OAuth immediately"
