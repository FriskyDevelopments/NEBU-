console.log('🔧 ZOOM OAUTH 4700 ERROR - DEFINITIVE DIAGNOSTIC');
console.log('='.repeat(60));
console.log('');

// All possible combinations we've found in your files
const configurations = [
    {
        name: 'Config 1: Current bot settings',
        clientId: 'vGVyI0IRv6si45iKO_qIw',
        clientSecret: 'Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB',
        redirectUri: 'https://pupfrisky.com/zoom-callback'
    },
    {
        name: 'Config 2: GitHub Pages (from working files)',
        clientId: 'vGVyI0IRv6si45iKO_qIw',
        clientSecret: 'Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB',
        redirectUri: 'https://pupfr.github.io/Nebulosa/zoom-callback.html'
    },
    {
        name: 'Config 3: Railway deployment',
        clientId: 'vGVyI0IRv6si45iKO_qIw',
        clientSecret: 'Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB',
        redirectUri: 'https://nebulosa-production.railway.app/auth/zoom/callback'
    },
    {
        name: 'Config 4: Alternative with old client ID',
        clientId: 'K3t8Sd3rSZOSKfkyMftDXg',
        clientSecret: 'Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB',
        redirectUri: 'https://pupfr.github.io/Nebulosa/zoom-callback.html'
    }
];

console.log('📋 TEST THESE URLs MANUALLY:');
console.log('');

configurations.forEach((config, index) => {
    const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&state=test${index + 1}&scope=meeting:read meeting:write user:read`;

    console.log(`${index + 1}️⃣ ${config.name}`);
    console.log(`   Client ID: ${config.clientId}`);
    console.log(`   Redirect: ${config.redirectUri}`);
    console.log(`   URL: ${authUrl}`);
    console.log('');
});

console.log('🎯 INSTRUCTIONS:');
console.log('1. Copy each URL above and test it in your browser');
console.log('2. The one that does NOT give 4700 error is your working config');
console.log('3. Tell me which number works and I will update the bot');
console.log('');
console.log('💡 OR: Go to marketplace.zoom.us → Your Apps → Find your OAuth app');
console.log('   Check the "OAuth Allow List" to see exact allowed URLs');
console.log('');

// Also create working .env template
console.log('📄 RECOMMENDED .env FILE:');
console.log('');
console.log('# Copy this into a .env file in your project root');
console.log('BOT_TOKEN=YOUR_BOT_TOKEN');
console.log('ZOOM_CLIENT_ID=vGVyI0IRv6si45iKO_qIw');
console.log('ZOOM_CLIENT_SECRET=Gb9JmLsI1brv4bPdAPB9CSknQV4GiFB');
console.log('ZOOM_REDIRECT_URI=https://pupfr.github.io/Nebulosa/zoom-callback.html');
console.log('');
console.log('✅ This will eliminate hardcoded values and use environment variables');
