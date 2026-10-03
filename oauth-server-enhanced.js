const express = require('express');
const axios = require('axios');
const { handleZoomAuthSuccess } = require('./bot.cjs');
const oauthState = require('./oauth-state');

const app = express();
const PORT = 3000;

// Enhanced OAuth callback handler with better error handling
app.get('/auth/zoom/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  
  console.log('🔗 OAuth callback received:');
  console.log('Code:', code ? `${code.substring(0, 10)}...` : 'Missing');
  console.log('State (User ID):', state);
  console.log('Error:', error);
  console.log('Error Description:', error_description);
  
  // Handle OAuth errors from Zoom
  if (error) {
    console.error('❌ OAuth error from Zoom:', error, error_description);
    res.status(400).send(`
      <html>
        <head>
          <title>❌ OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .error { color: #dc3545; }
            .code { background: #f8f9fa; padding: 10px; border-radius: 5px; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ OAuth Error</h1>
            <p class="error">Zoom returned an error: <strong>${error}</strong></p>
            ${error_description ? `<p>${error_description}</p>` : ''}
            <p>Common solutions:</p>
            <ul style="text-align: left;">
              <li>Try the authorization again</li>
              <li>Check if your Zoom app is properly configured</li>
              <li>Verify redirect URI matches exactly</li>
            </ul>
            <p><a href="#" onclick="window.close()">Close this window</a></p>
          </div>
        </body>
      </html>
    `);
    return;
  }
  
  // Check for missing authorization code
  if (!code) {
    console.error('❌ Authorization code missing');
    res.status(400).send(`
      <html>
        <head>
          <title>❌ OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ OAuth Error</h1>
            <p class="error">Authorization code not received from Zoom.</p>
            <p>This usually means:</p>
            <ul style="text-align: left;">
              <li>The authorization was cancelled</li>
              <li>There was a network error</li>
              <li>The redirect URI is misconfigured</li>
            </ul>
            <p>Please try again from Telegram with <code>/zoomlogin</code></p>
            <p><a href="#" onclick="window.close()">Close this window</a></p>
          </div>
        </body>
      </html>
    `);
    return;
  }
  
  try {
    console.log('🔄 Attempting token exchange...');
    
    // SECURITY: validate the OAuth `state` BEFORE exchanging the authorization
    // code for tokens (RFC 6749 §10.12 CSRF protection). An unverified state
    // means the callback cannot be trusted, so we refuse to exchange
    // credentials.
    const stateResult = oauthState.validate(state);
    if (!stateResult.valid) {
      console.error('❌ OAuth state validation failed:', stateResult.reason);
      res.status(403).send(`
        <html>
          <head>
            <title>❌ OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>❌ OAuth Error</h1>
              <p class="error">Invalid or expired authorization request.</p>
              <p>The login link can only be used once and expires after a few
              minutes. Please start again from Telegram with
              <code>/zoomlogin</code>.</p>
              <p><a href="#" onclick="window.close()">Close this window</a></p>
            </div>
          </body>
        </html>
      `);
      return;
    }
    // Verified Telegram user id captured when the state was issued.
    const verifiedUserId = stateResult.metadata;
    
    // Get credentials
    const clientId = process.env.ZOOM_USER_CLIENT_ID || process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_USER_CLIENT_SECRET || process.env.ZOOM_CLIENT_SECRET;
    const redirectUri = process.env.ZOOM_REDIRECT_URI || 'https://pupfr.github.io/Nebulosa/zoom-callback.html';
    
    console.log('Using Client ID:', clientId ? `${clientId.substring(0, 8)}...` : 'Missing');
    console.log('Using Redirect URI:', redirectUri);
    
    if (!clientId || !clientSecret) {
      throw new Error('Missing Zoom client credentials');
    }
    
    // Method 1: Try with params (current method)
    let tokenResponse;
    try {
      tokenResponse = await axios.post('https://zoom.us/oauth/token', null, {
        params: {
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000 // 30 second timeout
      });
    } catch (error1) {
      console.log('❌ Method 1 failed, trying Method 2...');
      console.log('Error details:', error1.response?.data);
      
      // Method 2: Try with Basic Auth
      tokenResponse = await axios.post('https://zoom.us/oauth/token', new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }), {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
      });
    }
    
    const tokenData = tokenResponse.data;
    console.log('✅ Token exchange successful');
    console.log('Access token received:', tokenData.access_token ? 'Yes' : 'No');
    console.log('Refresh token received:', tokenData.refresh_token ? 'Yes' : 'No');
    console.log('Expires in:', tokenData.expires_in, 'seconds');
    
    // Handle success in bot — bind tokens to the verified user id.
    if (handleZoomAuthSuccess) {
      await handleZoomAuthSuccess(verifiedUserId, tokenData);
    }
    
    res.send(`
      <html>
        <head>
          <title>🎉 Connection Successful!</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
            .container { background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; max-width: 500px; margin: auto; }
            h1 { font-size: 2.5em; margin-bottom: 20px; }
            p { font-size: 1.2em; line-height: 1.6; }
            .success { color: #4CAF50; font-weight: bold; }
            ul { text-align: left; display: inline-block; }
            .close-btn { background: rgba(255,255,255,0.2); border: none; color: white; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎉 Connection Successful!</h1>
            <p class="success">✅ Your Zoom account has been successfully connected</p>
            <p>Return to Telegram to use all bot commands:</p>
            <ul>
              <li><strong>/startsession</strong> - Start Zoom session</li>
              <li><strong>/createroom</strong> - Create meeting with auto-multipin</li>
              <li><strong>/startbot</strong> - Start browser automation</li>
              <li><strong>/status</strong> - View system status</li>
            </ul>
            <p>You can now close this window and return to Telegram!</p>
            <button class="close-btn" onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('❌ OAuth token exchange failed:');
    console.error('Status:', error.response?.status);
    console.error('Error Data:', error.response?.data);
    console.error('Error Message:', error.message);
    
    // Detailed error analysis
    let errorDetails = '';
    let suggestions = '';
    
    if (error.response?.status === 400) {
      const errorData = error.response.data;
      
      if (errorData.error === 'invalid_grant') {
        errorDetails = 'Invalid or expired authorization code';
        suggestions = `
          <li>The authorization code has expired (they expire in ~10 minutes)</li>
          <li>The authorization code was already used (each code can only be used once)</li>
          <li>Try getting a fresh authorization code</li>
        `;
      } else if (errorData.error === 'invalid_client') {
        errorDetails = 'Invalid client credentials';
        suggestions = `
          <li>Check your Zoom app Client ID and Secret</li>
          <li>Ensure you're using the correct OAuth app</li>
          <li>Verify the app is published/enabled</li>
        `;
      } else if (errorData.error === 'invalid_request') {
        errorDetails = 'Invalid request format';
        suggestions = `
          <li>Check that redirect_uri matches exactly in your Zoom app</li>
          <li>Ensure all required parameters are present</li>
          <li>Verify the request format is correct</li>
        `;
      } else {
        errorDetails = `Zoom API error: ${errorData.error}`;
        suggestions = `
          <li>Check the Zoom Marketplace for app configuration</li>
          <li>Verify all OAuth settings</li>
          <li>Try again in a few minutes</li>
        `;
      }
    } else if (error.response?.status === 401) {
      errorDetails = 'Unauthorized - Invalid credentials';
      suggestions = `
        <li>Check your Client ID and Secret</li>
        <li>Ensure credentials are for a User OAuth app</li>
        <li>Verify the app is properly configured</li>
      `;
    } else {
      errorDetails = error.message;
      suggestions = `
        <li>Check network connectivity</li>
        <li>Try again in a few minutes</li>
        <li>Contact support if the issue persists</li>
      `;
    }
    
    res.status(500).send(`
      <html>
        <head>
          <title>❌ OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .error { color: #dc3545; }
            .code { background: #f8f9fa; padding: 10px; border-radius: 5px; font-family: monospace; margin: 10px 0; }
            ul { text-align: left; }
            .close-btn { background: #dc3545; border: none; color: white; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ OAuth Error</h1>
            <p class="error">Failed to exchange authorization code for tokens.</p>
            <div class="code">Error: ${errorDetails}</div>
            <p><strong>Possible solutions:</strong></p>
            <ul>${suggestions}</ul>
            <p><strong>Next steps:</strong></p>
            <ol style="text-align: left;">
              <li>Try the authorization again with <code>/zoomlogin</code></li>
              <li>Check your Zoom app configuration</li>
              <li>Run the diagnostic script: <code>node diagnose-oauth-error.js</code></li>
            </ol>
            <button class="close-btn" onclick="window.close()">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>🤖 LA NUBE BOT OAuth Server</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .status { color: #28a745; font-weight: bold; }
          .code { background: #f8f9fa; padding: 10px; border-radius: 5px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 LA NUBE BOT OAuth Server</h1>
          <p class="status">✅ OAuth callback server is running on port ${PORT}</p>
          <p>Use <code>/zoomlogin</code> in Telegram to start OAuth flow.</p>
          <p><strong>Callback URL:</strong></p>
          <div class="code">http://localhost:${PORT}/auth/zoom/callback</div>
          <p><em>Make sure this URL is added to your Zoom app's redirect URIs.</em></p>
        </div>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Enhanced OAuth callback server running on http://localhost:${PORT}`);
  console.log(`📱 OAuth callback URL: http://localhost:${PORT}/auth/zoom/callback`);
  console.log(`🔍 For troubleshooting, run: node diagnose-oauth-error.js`);
});

module.exports = app;
