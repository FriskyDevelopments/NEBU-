// 🔄 Backup Bot Instance for Render
// Free tier failover bot running on Render

const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN_BACKUP;
const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_MODE = process.env.BACKUP_MODE === 'true';

console.log('🔄 Starting Nebulosa Backup Bot on Render...');
console.log(`📍 Backup Mode: ${BACKUP_MODE}`);
console.log(`💾 Database: ${DATABASE_URL ? 'Connected' : 'Not configured'}`);

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Database connection
let dbConnection = null;

async function connectDatabase() {
  if (DATABASE_URL) {
    try {
      dbConnection = await mysql.createConnection(DATABASE_URL);
      console.log('✅ Database connected (Backup Bot)');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
    }
  }
}

// Log analytics to database
async function logAnalytics(userId, command, success = true, responseTime = 0, error = null) {
  if (!dbConnection) return;
  
  try {
    await dbConnection.execute(`
      INSERT INTO bot_analytics (user_id, command, platform, response_time_ms, success, error_message)
      VALUES (?, ?, 'render', ?, ?, ?)
    `, [userId, command, responseTime, success, error]);
  } catch (err) {
    console.error('Analytics logging failed:', err.message);
  }
}

// 🏠 Start command
bot.onText(/\/start/, async (msg) => {
  const startTime = Date.now();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    const welcomeMessage = `
🔄 *Nebulosa Backup Bot* - Render Instance

🎯 *Status*: Active on Render (Free Tier)
🚂 *Primary*: Railway production bot
⚡ *Preview*: Vercel serverless functions  
🎨 *Backup*: This Render instance

*Available Commands:*
/start - Show this message
/status - Check all platform status
/health - Backup bot health
/help - Get help

💡 *Note*: This is the backup instance running on Render's free tier. For full functionality, use the main bot.
    `;
    
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    await logAnalytics(userId, '/start', true, Date.now() - startTime);
    
  } catch (error) {
    console.error('Start command error:', error);
    await logAnalytics(userId, '/start', false, Date.now() - startTime, error.message);
  }
});

// 📊 Status command
bot.onText(/\/status/, async (msg) => {
  const startTime = Date.now();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    // Get platform status from database
    let statusMessage = '📊 *Platform Status Report*\n\n';
    
    if (dbConnection) {
      const [platformStatus] = await dbConnection.execute(`
        SELECT platform, status, response_time_ms, uptime_percentage, last_check
        FROM platform_health 
        WHERE last_check > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        ORDER BY platform
      `);
      
      const platforms = {
        'railway': '🚂 Railway (Production)',
        'vercel': '⚡ Vercel (Serverless)', 
        'render': '🎨 Render (Backup)'
      };
      
      for (const platform of Object.keys(platforms)) {
        const status = platformStatus.find(s => s.platform === platform);
        if (status) {
          const icon = status.status === 'healthy' ? '✅' : status.status === 'degraded' ? '⚠️' : '❌';
          statusMessage += `${platforms[platform]}: ${icon} ${status.status.toUpperCase()}\n`;
          statusMessage += `  Response: ${status.response_time_ms}ms, Uptime: ${status.uptime_percentage}%\n\n`;
        } else {
          statusMessage += `${platforms[platform]}: ❓ No recent data\n\n`;
        }
      }
    } else {
      statusMessage += '⚠️ Database connection unavailable\n';
      statusMessage += '🎨 Render Backup: ✅ ONLINE\n';
      statusMessage += '🚂 Railway Main: ❓ Unknown\n';
      statusMessage += '⚡ Vercel Functions: ❓ Unknown\n';
    }
    
    statusMessage += `\n⏰ Last checked: ${new Date().toLocaleString()}`;
    
    await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    await logAnalytics(userId, '/status', true, Date.now() - startTime);
    
  } catch (error) {
    console.error('Status command error:', error);
    await bot.sendMessage(chatId, '❌ Status check failed. Please try again later.');
    await logAnalytics(userId, '/status', false, Date.now() - startTime, error.message);
  }
});

// 🏥 Health command
bot.onText(/\/health/, async (msg) => {
  const startTime = Date.now();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    const healthInfo = `
🏥 *Backup Bot Health*

🎨 *Platform*: Render Free Tier
📊 *Status*: ✅ Healthy
⏱️ *Uptime*: ${Math.floor(process.uptime() / 60)} minutes
💾 *Memory*: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
🌐 *Environment*: ${process.env.NODE_ENV || 'development'}
💿 *Database*: ${dbConnection ? '✅ Connected' : '❌ Disconnected'}

🔄 *Backup Mode*: ${BACKUP_MODE ? 'ACTIVE' : 'STANDBY'}
📡 *Last Check*: ${new Date().toLocaleString()}
    `;
    
    await bot.sendMessage(chatId, healthInfo, { parse_mode: 'Markdown' });
    await logAnalytics(userId, '/health', true, Date.now() - startTime);
    
  } catch (error) {
    console.error('Health command error:', error);
    await logAnalytics(userId, '/health', false, Date.now() - startTime, error.message);
  }
});

// 📚 Help command  
bot.onText(/\/help/, async (msg) => {
  const startTime = Date.now();
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    const helpMessage = `
📚 *Nebulosa Backup Bot Help*

🔄 *This is the backup instance* running on Render's free tier.

*Available Commands:*
/start - Welcome message
/status - Check all platform status
/health - Backup bot health check
/help - This help message

*Platform Architecture:*
🚂 *Railway* - Main production bot ($5/month)
⚡ *Vercel* - OAuth callbacks & previews (FREE)
🎨 *Render* - This backup bot & admin panel (FREE)
💾 *PlanetScale* - Database storage (FREE)

*For full bot features*, use the main bot instance.

💡 *Admin*: Telegram owner commands (/status /who /logout /shutdown)
📊 *Documentation*: https://nebulosa-docs.onrender.com
    `;
    
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    await logAnalytics(userId, '/help', true, Date.now() - startTime);
    
  } catch (error) {
    console.error('Help command error:', error);
    await logAnalytics(userId, '/help', false, Date.now() - startTime, error.message);
  }
});

// 🚀 Initialize backup bot
async function initializeBackupBot() {
  try {
    await connectDatabase();
    
    if (BACKUP_MODE) {
      console.log('✅ Backup bot initialized in ACTIVE mode');
      
      // Start webhook mode for Render
      const express = require('express');
      const app = express();
      const PORT = process.env.PORT || 10000;
      
      app.use(express.json());
      
      // Webhook endpoint for Telegram
      app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      });
      
      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({
          status: 'healthy',
          platform: 'render',
          service: 'backup-bot',
          backup_mode: BACKUP_MODE,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        });
      });
      
      app.listen(PORT, () => {
        console.log(`🎨 Backup bot webhook listening on port ${PORT}`);
        
        // Set webhook URL
        const webhookUrl = `https://nebulosa-backup-bot.onrender.com/webhook/${BOT_TOKEN}`;
        bot.setWebHook(webhookUrl);
        console.log(`📡 Webhook set to: ${webhookUrl}`);
      });
      
    } else {
      console.log('⏸️ Backup bot initialized in STANDBY mode');
    }
    
  } catch (error) {
    console.error('❌ Backup bot initialization failed:', error);
  }
}

// 🛡️ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Backup bot shutting down...');
  if (dbConnection) {
    await dbConnection.end();
  }
  process.exit(0);
});

// Start the backup bot
initializeBackupBot();

module.exports = { bot, connectDatabase, logAnalytics };
