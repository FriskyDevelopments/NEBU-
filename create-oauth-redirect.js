#!/usr/bin/env node

/**
 * Script to create the correct OAuth link
 * Uses a specific slug to avoid conflicts
 */

const fs = require('fs');
const https = require('https');

const SHORTIO_API_KEY = process.env.SHORTIO_API_KEY;

if (!SHORTIO_API_KEY) {
    console.error('❌ SHORTIO_API_KEY environment variable is not set');
    process.exit(1);
}
const DOMAIN = 'pupfrisky.com';

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    resolve({ status: res.statusCode, data: response });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(data);
        }

        req.end();
    });
}

async function createOAuthRedirect() {
    console.log('📤 Creating OAuth redirect link...');

    const svgContent = fs.readFileSync('./favicon.svg', 'utf8');
    const base64Content = Buffer.from(svgContent).toString('base64');

    const data = JSON.stringify({
        originalURL: 'https://pupfrisky.com/zoom-callback.php',
        domain: DOMAIN,
        path: 'auth',
        allowDuplicates: false,
        favicon: `image/svg+xml;base64,${base64Content}`,
        title: '🔑 Zoom OAuth Redirect - LA NUBE BOT',
        tags: ['oauth', 'zoom', 'redirect', 'auth', 'callback']
    });

    const options = {
        hostname: 'api.short.io',
        port: 443,
        path: '/links',
        method: 'POST',
        headers: {
            'Authorization': SHORTIO_API_KEY,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    try {
        const response = await makeRequest(options, data);

        if (response.status === 201) {
            console.log(`✅ OAuth link ${response.data.secureShortURL || response.data.shortURL}`);
            console.log(`📄 ${response.data.title}`);
            console.log(`📍 ${response.data.originalURL}`);
            console.log(`🆔 Link ${response.data.id}`);
            return response.data;
        } else if (response.status === 409) {
            console.log(`⚠️  The /auth link already exists`);
            return null;
        } else {
            console.error(`❌ ${response.status}`);
            console.error(`📄 `, response.data);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return null;
    }
}

async function createZoomCallback() {
    console.log('📤 Creating zoom-auth link...');

    const svgContent = fs.readFileSync('./favicon.svg', 'utf8');
    const base64Content = Buffer.from(svgContent).toString('base64');

    const data = JSON.stringify({
        originalURL: 'https://pupfrisky.com/zoom-callback.php',
        domain: DOMAIN,
        path: 'zoom-auth',
        allowDuplicates: false,
        favicon: `image/svg+xml;base64,${base64Content}`,
        title: '🔑 Zoom Authentication - LA NUBE BOT',
        tags: ['zoom', 'auth', 'oauth', 'callback', 'redirect']
    });

    const options = {
        hostname: 'api.short.io',
        port: 443,
        path: '/links',
        method: 'POST',
        headers: {
            'Authorization': SHORTIO_API_KEY,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    try {
        const response = await makeRequest(options, data);

        if (response.status === 201) {
            console.log(`✅ Zoom Auth link ${response.data.secureShortURL || response.data.shortURL}`);
            console.log(`📄 ${response.data.title}`);
            console.log(`📍 ${response.data.originalURL}`);
            console.log(`🆔 Link ${response.data.id}`);
            return response.data;
        } else if (response.status === 409) {
            console.log(`⚠️  The /zoom-auth link already exists`);
            return null;
        } else {
            console.error(`❌ ${response.status}`);
            console.error(`📄 `, response.data);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('📋 Configuration:');
    console.log(`   API Key: ✅ Configured`);
    console.log(`   Domain: ${DOMAIN}`);
    console.log(`   Destination: https://pupfrisky.com/zoom-callback.php`);
    console.log('');

    // Create alternative OAuth links
    const authLink = await createOAuthRedirect();
    console.log('');

    const zoomAuthLink = await createZoomCallback();
    console.log('');

    if (authLink || zoomAuthLink) {
        console.log('🎉 OAuth links created successfully!');
        console.log('');
        console.log('📋 URLs to use as Redirect URI in Zoom:');

        if (authLink) {
            console.log(`   🔗 Option 1: ${authLink.secureShortURL || authLink.shortURL}`);
        }

        if (zoomAuthLink) {
            console.log(`   🔗 Option 2: ${zoomAuthLink.secureShortURL || zoomAuthLink.shortURL}`);
        }

        console.log('');
        console.log('✅ Use any of these links as Redirect URI');
        console.log('   in your Zoom OAuth application configuration!');

        // Save information
        const oauthInfo = {
            created_at: new Date().toISOString(),
            auth_link: authLink,
            zoom_auth_link: zoomAuthLink,
            destination: 'https://pupfrisky.com/zoom-callback.php'
        };

        fs.writeFileSync('./oauth-redirect-links.json', JSON.stringify(oauthInfo, null, 2));
        console.log('💾 Information saved in oauth-redirect-links.json');
    } else {
        console.log('⚠️  Links already exist or there were errors creating them');
    }
}

main().catch(console.error);