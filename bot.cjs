const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const { registerMeetingCommandAudit } = require('./bot/meetingCommandAudit');
const { 
  getAccessToken, 
  refreshAccessToken, 
  getUserProfile, 
  getUserMeetings, 
  getMeetingDetails, 
  getLiveMeetingParticipants,
  createMeeting,
  createInstantMeetingWithSettings,
  updateMeetingSettings,
  updateParticipantStatus,
  sendZoomChatMessage,
  sendDirectZoomMessage,
  getMeetingChatMessages,
  moveToWaitingRoom,
  admitFromWaitingRoom,
  promoteToCohost,
  startMeeting,
  endMeeting 
} = require('./zoomAuth.js');

// Import ZoomBrowserBot for multipin automation
const { ZoomBrowserBot } = require('./zoomBrowserBot.js');

require('dotenv').config();

// Error handling for bot
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log('🤖 LA NUBE BOT starting up...');
console.log('Bot token configured:', process.env.BOT_TOKEN ? 'Yes' : 'No');
console.log('Observatory channel:', process.env.LOG_CHANNEL_ID ? 'Yes' : 'No');

registerMeetingCommandAudit(bot);

// Admin user IDs (configure via env; no hardcoded owners)
const ADMIN_IDS = [process.env.ADMIN_USER_ID].filter(Boolean).map(id => parseInt(id));

// Owner gate: single source of truth is OWNER_ID (numeric Telegram user id).
// Number() + integer check — NaN / 'undefined' / empty values fail closed.
const OWNER_ID = Number(process.env.OWNER_ID);
const ownerConfigured = Number.isInteger(OWNER_ID) && OWNER_ID > 0;
if (!ownerConfigured) {
  const msg = 'OWNER_ID env is not a valid numeric Telegram user id — admin commands are DISABLED.';
  if (process.env.NODE_ENV === 'production') console.error('🚨 ' + msg);
  else console.warn('⚠️ ' + msg);
}

// Active sessions storage
let activeSessions = new Map();
let botMetrics = {
  activeUsers: 0,
  commandsToday: 0,
  totalCommands: 0,
  uptime: Date.now()
};

// Language preferences storage
let userLanguages = new Map();

// Zoom tokens storage (userId -> {accessToken, refreshToken, expiresAt})
let userZoomTokens = new Map();

// OAuth state sessions for Zoom login (CSRF protection): state -> { telegramUserId, timestamp }
let oauthStateSessions = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Violation tracking and multipin management
let violationCounts = new Map(); // userId -> count
let multipinGrants = new Map(); // userId -> {granted: boolean, grantedAt: timestamp, cameraOffAt: timestamp}
let multipinTimers = new Map(); // userId -> timeoutId for 60-second camera-off timer
let monitoredMeetings = new Map(); // meetingId -> {hostId, isActive, participants}
let activeMonitors = new Map(); // userId -> intervalId
let chatHistory = new Map(); // meetingId -> [{user, message, timestamp}]
let spamDetection = new Map(); // userId -> {messageCount, lastMessage, violations}
let meetingHostChats = new Map(); // meetingId -> {hostId, cohostIds: Set(), participants: Set()}

// Browser bot management for multipin automation
let activeBrowserBots = new Map(); // meetingId -> ZoomBrowserBot instance
let pendingMultipinActions = new Map(); // meetingId -> [{action: 'pin'|'unpin', userName, timestamp}]

// ─── Sticker Draft, Review, and Disposal System ───────────────────────────
// Every sticker/image received starts as a draft; users must explicitly approve.
const stickerDrafts = new Map(); // draftId -> draft object
const userDraftIds = new Map();  // userId  -> [draftId, ...]
const DRAFT_EXPIRY_DAYS = 7;     // unreviewed drafts auto-expire after this many days


// Alert channels - Currently using NEBULOSO'S OBSERVATORY as primary channel
const OBSERVATORY_CHANNEL = process.env.OBSERVATORY_CHANNEL_ID || process.env.LOG_CHANNEL_ID; // Primary logging channel
const HIGH_HEAT_CHANNEL = process.env.HIGH_HEAT_CHANNEL_ID || process.env.OBSERVATORY_CHANNEL_ID || process.env.LOG_CHANNEL_ID; // Fallback to same channel
const COMMAND_CHAT_ID = process.env.COMMAND_CHAT_ID; // Telegram group for hosts/cohosts
const COMMAND_CHAT_LINK = process.env.COMMAND_CHAT_LINK || 'https://t.me/+YOUR_COMMAND_CHAT_LINK';

// Language strings
const strings = {
  en: {
    welcome: {
      title: "🌟 *Welcome to La NUBE BOT!* ☁️",
      greeting: "Hello {username}! I'm your Zoom meeting assistant.",
      commands: "*Available Commands:*",
      commandList: [
        "/start - Show this message",
        "/zoomlogin - Connect your Zoom account", 
        "/startsession - Start Zoom session (Admin only)",
        "/roominfo - Get current Zoom Room information",
        "/scanroom - Advanced participant monitoring with auto-moderation",
        "/createroom - Create instant meeting with auto-multipin",
        "/monitor - Start/stop automatic monitoring",
        "/startbot - Start browser bot for multipin automation (Admin)",
        "/stopbot - Stop browser bot automation (Admin)",
        "/botstatus - Check browser bot status",
        "/chatwatch - Monitor and moderate Zoom chat",
        "/promote - Promote user to cohost", 
        "/commandchat - Manage Command Chat integration",
        "/docs - Access documentation and guides",
        "/status - Current session status",
        "/shutdown - Stop bot (Admin only)",
        "/language - Change language / Cambiar idioma 🇺🇸🇲🇽"
      ],
      features: "*Features:*",
      featureList: [
        "✅ OAuth integration with Zoom",
        "✅ Secure meeting management", 
        "✅ Real-time monitoring",
        "✅ Automated multipin via browser bot",
        "✅ Camera + hand raise requirements"
      ],
      ready: "Ready to start? Use /zoomlogin to connect your Zoom account!"
    },
    zoomlogin: {
      title: "🔗 *Zoom Account Connection*",
      instruction: "To connect your Zoom account, click the link:",
      security: "*Security Notice:*",
      securityList: [
        "- This is a secure OAuth connection",
        "- We only request necessary permissions",
        "- Your credentials are never stored",
        "- Connection expires automatically"
      ],
      steps: "*What's next?*",
      stepList: [
        "1. Click the link",
        "2. Sign in to your Zoom account", 
        "3. Authorize La NUBE BOT",
        "4. Return here when done"
      ],
      confirmation: "Authorization will be confirmed automatically."
    },
    errors: {
      authUrl: "❌ Error generating Zoom authentication URL. Please try again.",
      session: "❌ Error starting session. Please try again.",
      roomInfo: "❌ Error getting room information.",
      scanRoom: "❌ Error scanning room.",
      shutdown: "❌ Error terminating session.",
      unauthorized: "❌ Unauthorized. This command is only for administrators.",
      noSession: "❌ No active session found."
    },
    success: {
      authComplete: "✅ Zoom authentication completed successfully!",
      sessionStarted: "✅ Zoom session started successfully!",
      sessionEnded: "✅ Session terminated successfully.",
      connected: "🟢 Connected to Zoom",
      ready: "Bot is ready for use."
    }
  },
  es: {
    welcome: {
      title: "🌟 *¡Bienvenido a La NUBE BOT!* ☁️",
      greeting: "¡Hola {username}! Soy tu asistente para reuniones de Zoom.",
      commands: "*Comandos Disponibles:*",
      commandList: [
        "/start - Mostrar este mensaje",
        "/zoomlogin - Conectar tu cuenta de Zoom",
        "/startsession - Iniciar sesión de Zoom (Solo admin)",
        "/roominfo - Información de la sala de Zoom actual",
        "/scanroom - Monitoreo avanzado con auto-moderación",
        "/createroom - Crear reunión instantánea con auto-multipin", 
        "/monitor - Iniciar/parar monitoreo automático",
        "/startbot - Iniciar bot navegador para automatización multipin (Admin)",
        "/stopbot - Detener automatización bot navegador (Admin)",
        "/botstatus - Verificar estado del bot navegador",
        "/chatwatch - Monitorear y moderar chat de Zoom",
        "/promote - Promover usuario a cohost",
        "/commandchat - Gestionar integración Command Chat",
        "/docs - Acceder documentación y guías",
        "/status - Estado de la sesión actual",
        "/shutdown - Terminar bot (Solo admin)",
        "/language - Change language / Cambiar idioma 🇺🇸🇲🇽"
      ],
      features: "*Características:*",
      featureList: [
        "✅ Integración OAuth con Zoom",
        "✅ Gestión segura de reuniones",
        "✅ Monitoreo en tiempo real",
        "✅ Multipin automatizado vía bot navegador",
        "✅ Requisitos cámara + mano levantada"
      ],
      ready: "¡Listo para empezar? ¡Usa /zoomlogin para conectar tu cuenta de Zoom!"
    },
    zoomlogin: {
      title: "🔗 *Conexión de Cuenta Zoom*",
      instruction: "Para conectar tu cuenta de Zoom, haz clic en el enlace:",
      security: "*Aviso de Seguridad:*",
      securityList: [
        "- Esta es una conexión OAuth segura",
        "- Solo solicitamos permisos necesarios",
        "- Tus credenciales nunca se almacenan",
        "- La conexión expira automáticamente"
      ],
      steps: "*¿Qué sigue?*",
      stepList: [
        "1. Haz clic en el enlace",
        "2. Inicia sesión en tu cuenta Zoom",
        "3. Autoriza a La NUBE BOT", 
        "4. Regresa aquí cuando termines"
      ],
      confirmation: "La autorización se confirmará automáticamente."
    },
    errors: {
      authUrl: "❌ Error generando URL de autenticación de Zoom. Intenta de nuevo.",
      session: "❌ Error iniciando la sesión. Intenta de nuevo.",
      roomInfo: "❌ Error obteniendo información de la sala.",
      scanRoom: "❌ Error escaneando la sala.",
      shutdown: "❌ Error terminando la sesión.",
      unauthorized: "❌ No autorizado. Este comando es solo para administradores.",
      noSession: "❌ No se encontró sesión activa."
    },
    success: {
      authComplete: "✅ ¡Autenticación de Zoom completada exitosamente!",
      sessionStarted: "✅ ¡Sesión de Zoom iniciada exitosamente!",
      sessionEnded: "✅ Sesión terminada exitosamente.",
      connected: "🟢 Conectado a Zoom",
      ready: "Bot listo para usar."
    }
  }
};

function getUserLanguage(userId) {
  return userLanguages.get(userId) || 'en';
}

function setUserLanguage(userId, language) {
  userLanguages.set(userId, language);
}

function getString(userId, path) {
  const lang = getUserLanguage(userId);
  const keys = path.split('.');
  let result = strings[lang];
  
  for (const key of keys) {
    if (result && typeof result === 'object') {
      result = result[key];
    } else {
      return path; // Return path if not found
    }
  }
  
  return result || path;
}

// Helper functions
function isAdmin(userId) {
  // Owner comes only from OWNER_ID env; missing/malformed values fail closed.
  if (!ownerConfigured) return false;
  return Number(userId) === OWNER_ID || ADMIN_IDS.includes(Number(userId));
}

function trackCommand(command, userId) {
  botMetrics.totalCommands++;
  botMetrics.commandsToday++;
  console.log(`📊 Comando ${command} usado por usuario ${userId}`);
}

async function logToChannel(message, userId = null) {
  if (process.env.LOG_CHANNEL_ID) {
    try {
      const logMessage = userId ? `[User: ${userId}] ${message}` : message;
      await bot.sendMessage(process.env.LOG_CHANNEL_ID, logMessage);
    } catch (error) {
      console.error('Error logging to channel:', error);
    }
  }
}

// Send alerts to HIGH HEAT HEADQUARTERS (falls back to Observatory if separate channel not configured)
async function alertHighHeat(message, userId = null, meetingId = null) {
  const channelId = HIGH_HEAT_CHANNEL;
  if (!channelId) {
    console.log('High Heat channel not configured, logging to Observatory');
    return logToObservatory(`🚨 HIGH HEAT: ${message}`, userId, meetingId);
  }
  
  try {
    const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const userInfo = userId ? `\n👤 User: ${userId}` : '';
    const meetingInfo = meetingId ? `\n📹 Meeting: ${meetingId}` : '';
    
    const alertMessage = `
🚨　ＬＡ　ＮＵＢＥ　：　ＨＩＧＨ　ＨＥＡＴ　🔥

${message}${userInfo}${meetingInfo}

⏰ ${timestamp} 🇲🇽
⋆｡° HEADQUARTERS °｡⋆
    `;
    
    await bot.sendMessage(channelId, alertMessage);
  } catch (error) {
    console.error('Error sending High Heat alert:', error);
    // Fallback to Observatory
    logToObservatory(`🚨 HIGH HEAT: ${message}`, userId, meetingId);
  }
}

// Send logs to NEBULOSO'S OBSERVATORY
async function logToObservatory(message, userId = null, meetingId = null) {
  const channelId = OBSERVATORY_CHANNEL;
  if (!channelId) {
    console.log('Observatory channel not configured, logging to console:', message);
    return;
  }
  
  try {
    const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const userInfo = userId ? `\n👤 User: ${userId}` : '';
    const meetingInfo = meetingId ? `\n📹 Meeting: ${meetingId}` : '';
    
    const fullMessage = `
🔭　ＮＥＢＵＬＯＳＯ'Ｓ　ＯＢＳＥＲＶＡＴＯＲＹ　🌌

${message}${userInfo}${meetingInfo}

⏰ ${timestamp} 🇲🇽
    `;
    
    await bot.sendMessage(channelId, fullMessage);
  } catch (error) {
    console.error('Error sending to Observatory:', error);
  }
}

// Detect violations and disruptive behavior
function analyzeParticipantBehavior(participant, previousState = null) {
  const violations = [];
  
  // Check for camera violations (off-cam users)
  if (participant.video === 'off') {
    violations.push({
      type: 'CAMERA_OFF',
      severity: 'MEDIUM',
      message: `${participant.user_name} has camera disabled`
    });
  }
  
  // Check for potential spam behavior (rapid join/leave would need websocket monitoring)
  if (previousState && previousState.join_time !== participant.join_time) {
    const timeDiff = new Date(participant.join_time) - new Date(previousState.join_time);
    if (timeDiff < 30000) { // Rejoined within 30 seconds
      violations.push({
        type: 'RAPID_REJOIN',
        severity: 'HIGH', 
        message: `${participant.user_name} rapid rejoin detected`
      });
    }
  }
  
  // Check for suspicious names or behavior patterns
  const suspiciousPatterns = [
    /bot/i, /spam/i, /hack/i, /test\d+/i, /user\d+/i
  ];
  
  if (suspiciousPatterns.some(pattern => pattern.test(participant.user_name))) {
    violations.push({
      type: 'SUSPICIOUS_NAME',
      severity: 'HIGH',
      message: `${participant.user_name} has suspicious username pattern`
    });
  }
  
  return violations;
}

// Detect spam in chat messages
function detectSpamInMessage(message, userId, meetingId) {
  const violations = [];
  
  // Check for links
  const linkPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b)/gi;
  if (linkPattern.test(message)) {
    violations.push({
      type: 'LINK_SPAM',
      severity: 'HIGH',
      message: 'Posted unauthorized link in chat'
    });
  }
  
  // Check for duplicate messages
  const userSpam = spamDetection.get(userId) || { messageCount: 0, lastMessage: '', violations: 0 };
  
  if (userSpam.lastMessage === message.trim()) {
    violations.push({
      type: 'DUPLICATE_MESSAGE',
      severity: 'MEDIUM',
      message: 'Posted duplicate message'
    });
  }
  
  // Check for message burst (too many messages too fast)
  const now = Date.now();
  if (!userSpam.lastTimestamp) userSpam.lastTimestamp = now;
  
  const timeDiff = now - userSpam.lastTimestamp;
  if (timeDiff < 5000) { // Less than 5 seconds between messages
    userSpam.messageCount++;
    if (userSpam.messageCount > 3) {
      violations.push({
        type: 'MESSAGE_BURST',
        severity: 'HIGH',
        message: 'Sending messages too quickly (spam burst)'
      });
    }
  } else {
    userSpam.messageCount = 1; // Reset counter
  }
  
  // Update spam detection data
  userSpam.lastMessage = message.trim();
  userSpam.lastTimestamp = now;
  spamDetection.set(userId, userSpam);
  
  return violations;
}

// Send waiting room message with bilingual explanation
async function sendWaitingRoomMessage(accessToken, meetingId, participantId, reason = 'policy_violation') {
  const waitingRoomMessage = `
🚫 You've been moved to the Waiting Room.  
Possible reasons:  
• Camera off 🎥 • Away too long 💤 • Rule violation ⚠️

🚫 Has sido movido a la Sala de Espera.  
Posibles razones:  
• Cámara apagada 🎥 • Ausente mucho tiempo 💤 • Violación de reglas ⚠️

Please address the issue and wait to be readmitted.
Por favor, resuelve el problema y espera a ser readmitido.
  `;
  
  try {
    await sendZoomChatMessage(accessToken, meetingId, waitingRoomMessage, participantId);
    await moveToWaitingRoom(accessToken, meetingId, participantId, reason);
  } catch (error) {
    console.error('Error sending waiting room message:', error);
  }
}

// Send cohost promotion message with Command Chat integration
async function sendCohostPromotionMessage(accessToken, meetingId, participantId, participantName = 'User') {
  const promotionMessage = `
🌫️ You've been promoted to Cohost!  
EN: Join Command Chat → ${COMMAND_CHAT_LINK}
ES: Únete al Cuarto de Comando → ${COMMAND_CHAT_LINK}

📣　ＳＰＲＥＡＤ　ＴＨＥ　ＮＵＢＥ ☁️

EN: Please feel free to promote the room 🌐  
This space grows when YOU share it.

ES: Siéntete libre de promocionar la sala 🌐  
Este espacio crece cuando TÚ lo compartes.

Ways to help:  
🎨 Make your own art, posters, stickers  
🔁 Resend invites or cloud messages  
📎 Post the room link in your networks  
💬 Hype the vibe and invite new clouds

Let's bring in more energy, more familia, more heat 🔥
Because the NUBE belongs to all of us 💠
  `;
  
  try {
    // Promote to cohost in Zoom
    await promoteToCohost(accessToken, meetingId, participantId);
    
    // Add to meeting host chat
    await addToMeetingHostChat(accessToken, meetingId, participantId, participantName, 'cohost');
    
    // Send direct message to the promoted user
    await sendDirectZoomMessage(accessToken, meetingId, participantId, promotionMessage);
    
    // Also announce in main chat
    const announceMessage = `
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
🌫️ @${participantName} has been promoted to Cohost!
Welcome to the Command Team 👑
    `;
    await sendZoomChatMessage(accessToken, meetingId, announceMessage);
    
    // Notify meeting host chat
    await notifyMeetingHostChat(
      accessToken,
      meetingId,
      `👑 New Cohost Promoted\n👤 User: @${participantName}\n✅ Added to Host Chat\n🎯 Room promotion instructions sent`
    );
    
    // Notify Command Chat via Telegram
    if (COMMAND_CHAT_ID) {
      const commandChatNotification = `
👑 *New Cohost Promoted*

🌫️ *User:* @${participantName}
🆔 *Meeting:* ${meetingId}
📅 *Time:* ${new Date().toLocaleString()}

*Actions taken:*
• ✅ Zoom cohost privileges granted
• 🔐 Added to meeting Host Chat
• 📨 Command Chat invitation sent via Zoom
• 🎯 Room promotion instructions provided

Welcome to the Command Team! 🚀
      `;
      
      try {
        await bot.sendMessage(COMMAND_CHAT_ID, commandChatNotification, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error sending to Command Chat:', error);
      }
    }
    
    await logToObservatory(
      `👑 COHOST PROMOTED\n👤 ${participantName} promoted to cohost\n🔐 Added to meeting Host Chat\n📨 Command Chat invitation sent\n🎯 Room promotion instructions provided`,
      participantId,
      meetingId
    );
  } catch (error) {
    console.error('Error promoting to cohost:', error);
  }
}

// Send message to meeting-specific host chat (in Zoom)
async function notifyMeetingHostChat(accessToken, meetingId, message) {
  try {
    const hostChatMessage = `
🔐　ＨＯＳＴ　ＣＨＡＴ　☁️
${message}

⏰ ${new Date().toLocaleTimeString()}
    `;
    
    // Send to hosts and cohosts only via direct Zoom message
    const hostChat = meetingHostChats.get(meetingId);
    if (hostChat) {
      // Send to host
      await sendDirectZoomMessage(accessToken, meetingId, hostChat.hostId, hostChatMessage);
      
      // Send to all cohosts
      for (const cohostId of hostChat.cohostIds) {
        await sendDirectZoomMessage(accessToken, meetingId, cohostId, hostChatMessage);
      }
    }
    
    await logToObservatory(
      `🔐 HOST CHAT NOTIFICATION\n📝 Message: ${message}\n👥 Recipients: ${hostChat ? 1 + hostChat.cohostIds.size : 0}`,
      null,
      meetingId
    );
  } catch (error) {
    console.error('Error notifying meeting host chat:', error);
  }
}

// Manage meeting host chat membership
async function updateMeetingHostChat(accessToken, meetingId, hostId = null) {
  try {
    const participants = await getLiveMeetingParticipants(accessToken, meetingId);
    
    if (!meetingHostChats.has(meetingId)) {
      meetingHostChats.set(meetingId, {
        hostId: hostId,
        cohostIds: new Set(),
        participants: new Set()
      });
    }
    
    const hostChat = meetingHostChats.get(meetingId);
    const currentParticipants = new Set(participants.map(p => p.participant_user_id || p.user_id));
    const previousParticipants = hostChat.participants;
    
    // Detect who left the meeting
    const leftParticipants = [...previousParticipants].filter(id => !currentParticipants.has(id));
    
    // Remove left participants from cohost list
    for (const leftId of leftParticipants) {
      if (hostChat.cohostIds.has(leftId)) {
        hostChat.cohostIds.delete(leftId);
        await notifyMeetingHostChat(
          accessToken, 
          meetingId, 
          `👤 Cohost left meeting\n🚪 Removed from Host Chat\n🆔 ID: ${leftId}`
        );
      }
    }
    
    // Update current participants
    hostChat.participants = currentParticipants;
    
    // Identify current cohosts from Zoom API (if available)
    for (const participant of participants) {
      const userId = participant.participant_user_id || participant.user_id;
      
      // Check if they have cohost role (this would need to be detected from Zoom API response)
      if (participant.role === 'cohost' || participant.is_cohost) {
        if (!hostChat.cohostIds.has(userId)) {
          hostChat.cohostIds.add(userId);
          await notifyMeetingHostChat(
            accessToken, 
            meetingId, 
            `👑 New cohost detected\n✅ Added to Host Chat\n👤 User: ${participant.user_name}\n🆔 ID: ${userId}`
          );
        }
      }
    }
    
  } catch (error) {
    console.error('Error updating meeting host chat:', error);
  }
}

// Add user to meeting host chat
async function addToMeetingHostChat(accessToken, meetingId, userId, userName, role = 'cohost') {
  try {
    if (!meetingHostChats.has(meetingId)) {
      meetingHostChats.set(meetingId, {
        hostId: null,
        cohostIds: new Set(),
        participants: new Set()
      });
    }
    
    const hostChat = meetingHostChats.get(meetingId);
    
    if (role === 'host') {
      hostChat.hostId = userId;
    } else if (role === 'cohost') {
      hostChat.cohostIds.add(userId);
    }
    
    hostChat.participants.add(userId);
    
    // Send welcome message to new host chat member
    const welcomeMessage = `
🔐　ＷＥＬＣＯＭＥ　ＴＯ　ＨＯＳＴ　ＣＨＡＴ　☁️

👤 Welcome @${userName}!
👑 Role: ${role.toUpperCase()}
🆔 Meeting: ${meetingId}

You now receive:
• 📊 Scan results and violations
• 🚨 Real-time moderation alerts  
• 👥 Participant status updates
• 🔧 Host coordination messages

This is your private command center 🎛️
    `;
    
    await sendDirectZoomMessage(accessToken, meetingId, userId, welcomeMessage);
    
    await logToObservatory(
      `🔐 HOST CHAT MEMBER ADDED\n👤 ${userName} (${role})\n📨 Welcome message sent`,
      userId,
      meetingId
    );
    
  } catch (error) {
    console.error('Error adding to meeting host chat:', error);
  }
}

// Remove user from meeting host chat
async function removeFromMeetingHostChat(accessToken, meetingId, userId, userName, reason = 'left meeting') {
  try {
    const hostChat = meetingHostChats.get(meetingId);
    if (!hostChat) return;
    
    const wasCohost = hostChat.cohostIds.has(userId);
    
    if (hostChat.hostId === userId) {
      hostChat.hostId = null;
    }
    hostChat.cohostIds.delete(userId);
    hostChat.participants.delete(userId);
    
    if (wasCohost) {
      await notifyMeetingHostChat(
        accessToken, 
        meetingId, 
        `🚪 Host Chat Member Removed\n👤 User: @${userName}\n📋 Reason: ${reason}\n🚫 No longer receiving host notifications`
      );
    }
    
    await logToObservatory(
      `🔐 HOST CHAT MEMBER REMOVED\n👤 ${userName}\n📋 Reason: ${reason}`,
      userId,
      meetingId
    );
    
  } catch (error) {
    console.error('Error removing from meeting host chat:', error);
  }
}

// Notify Command Chat of important events (external Telegram group)
async function notifyCommandChat(message, meetingId = null) {
  if (!COMMAND_CHAT_ID) return;
  
  try {
    const timestamp = new Date().toLocaleString();
    const fullMessage = `
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
⋆　Command Notification　⋆

${message}

${meetingId ? `🆔 Meeting: ${meetingId}` : ''}
🕐 Time: ${timestamp}
    `;
    
    await bot.sendMessage(COMMAND_CHAT_ID, fullMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error notifying Command Chat:', error);
  }
}

// 🤖 Browser Bot Management for Multipin Automation
async function startBrowserBot(meetingId, meetingData, userToken = null) {
  try {
    if (activeBrowserBots.has(meetingId)) {
      console.log(`🤖 Browser bot already active for meeting: ${meetingId}`);
      return activeBrowserBots.get(meetingId);
    }

    console.log(`🚀 Starting browser bot for meeting: ${meetingId}`);
    
    const browserBot = new ZoomBrowserBot(meetingData, userToken);
    const started = await browserBot.start();
    
    if (started) {
      activeBrowserBots.set(meetingId, browserBot);
      pendingMultipinActions.set(meetingId, []);
      
      console.log(`✅ Browser bot started for meeting: ${meetingId}`);
      
      await logToObservatory(
        `🤖 BROWSER BOT STARTED\n🆔 Meeting: ${meetingId}\n🎯 Multipin automation: ACTIVE\n🔗 Bot name: ${browserBot.botName}`,
        null,
        meetingId
      );
      
      return browserBot;
    } else {
      console.error(`❌ Failed to start browser bot for meeting: ${meetingId}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error starting browser bot for meeting ${meetingId}:`, error);
    return null;
  }
}

async function stopBrowserBot(meetingId) {
  try {
    const browserBot = activeBrowserBots.get(meetingId);
    if (browserBot) {
      await browserBot.cleanup();
      activeBrowserBots.delete(meetingId);
      pendingMultipinActions.delete(meetingId);
      
      console.log(`🔚 Browser bot stopped for meeting: ${meetingId}`);
      
      await logToObservatory(
        `🔚 BROWSER BOT STOPPED\n🆔 Meeting: ${meetingId}\n🎯 Multipin automation: DEACTIVATED`,
        null,
        meetingId
      );
    }
  } catch (error) {
    console.error(`❌ Error stopping browser bot for meeting ${meetingId}:`, error);
  }
}

async function executeMultipinAction(meetingId, action, userName) {
  try {
    const browserBot = activeBrowserBots.get(meetingId);
    if (!browserBot || !browserBot.isReady()) {
      console.log(`⚠️ Browser bot not ready for meeting: ${meetingId}`);
      return 'BOT_NOT_READY';
    }

    let result;
    if (action === 'pin') {
      result = await browserBot.multipinUser(userName);
      console.log(`🎯 Multipin action executed: ${userName} - Result: ${result}`);
    } else if (action === 'unpin') {
      result = await browserBot.unpinUser(userName);
      console.log(`🔄 Unpin action executed: ${userName} - Result: ${result}`);
    }

    await logToObservatory(
      `🎛️ MULTIPIN ACTION\n🆔 Meeting: ${meetingId}\n👤 User: ${userName}\n🎯 Action: ${action.toUpperCase()}\n📊 Result: ${result}`,
      null,
      meetingId
    );

    return result;
  } catch (error) {
    console.error(`❌ Error executing multipin action for ${userName}:`, error);
    return 'ERROR';
  }
}

async function promoteUserToCohost(meetingId, userId, userName) {
  try {
    const browserBot = activeBrowserBots.get(meetingId);
    if (!browserBot || !browserBot.isReady()) {
      console.log(`⚠️ Browser bot not ready for cohost promotion: ${meetingId}`);
      return false;
    }

    // Wait for cohost status with a promotion request callback
    const requestCallback = async () => {
      console.log(`📨 Requesting cohost promotion for browser bot in meeting: ${meetingId}`);
      // This callback can send a message to meeting host requesting promotion
    };

    const promoted = await browserBot.waitForCohostStatus(requestCallback);
    
    if (promoted) {
      await logToObservatory(
        `👑 BROWSER BOT PROMOTED\n🆔 Meeting: ${meetingId}\n🤖 Bot: ${browserBot.botName}\n🎯 Multipin automation: ENHANCED`,
        null,
        meetingId
      );
    }

    return promoted;
  } catch (error) {
    console.error(`❌ Error promoting browser bot to cohost:`, error);
    return false;
  }
}

// Grant or revoke multipin access based on camera status with enhanced messaging
// 🎯 CORE MULTIPIN SYSTEM - Camera + Hand Raise Required
async function manageMultipinAccess(accessToken, meetingId, participant) {
  const userId = participant.participant_user_id || participant.user_id;
  const userName = participant.user_name;
  if (!userId) return 'NO_USER_ID';
  
  const hasCamera = participant.video === 'on';
  const hasHandRaised = participant.hand_raised || false; // Check if hand is raised
  const currentStatus = multipinGrants.get(userId);
  const now = Date.now();
  
  // Check if user qualifies for multipin (camera ON + hand raised)
  const qualifiesForMultipin = hasCamera && hasHandRaised;
  
  if (qualifiesForMultipin && (!currentStatus || !currentStatus.granted)) {
    // ✅ GRANT MULTIPIN - Camera ON + Hand Raised
    multipinGrants.set(userId, {
      granted: true,
      grantedAt: now,
      cameraOffAt: null
    });
    
    // Clear any existing timer
    if (multipinTimers.has(userId)) {
      clearTimeout(multipinTimers.get(userId));
      multipinTimers.delete(userId);
    }

    // 🎯 EXECUTE ACTUAL MULTIPIN via Browser Bot
    const multipinResult = await executeMultipinAction(meetingId, 'pin', userName);
    const multipinStatus = multipinResult === 'MULTIPIN_GRANTED' ? '✅ ACTIVE' : '⚠️ PENDING';
    
    const multipinGrantMessage = `
🎯　ＭＵＬＴＩＰＩＮ　ＧＲＡＮＴＥＤ　☁️

¡Felicidades ${userName}!

📸 Camera: ON ✅  •  🙋 Hand raised: YES ✅
🎛️ Multipin access: GRANTED ⚡
🤖 Browser automation: ${multipinStatus}

Support LA NUBE BOT:
💳 Donate: https://paypal.me/lanubeteam
🔗 More info: https://pupfrisky.com

Keep your camera on to maintain access! 📸
    `;
    
    try {
      await sendDirectZoomMessage(accessToken, meetingId, userId, multipinGrantMessage);
    } catch (error) {
      console.error('Error sending multipin grant message:', error);
    }
    
    await logToObservatory(
      `🎯 MULTIPIN GRANTED\n👤 ${userName}\n📹 Camera: ON\n🙋 Hand raised: YES\n🤖 Browser action: ${multipinResult}\n💌 Thank you message sent\n⚡ Access activated`,
      userId,
      meetingId
    );
    
    return 'GRANTED_SMOOTH';
    
  } else if (!hasCamera && currentStatus && currentStatus.granted) {
    // 📹 CAMERA OFF - Start 60-second timer
    if (!currentStatus.cameraOffAt) {
      // Mark when camera went off
      multipinGrants.set(userId, {
        ...currentStatus,
        cameraOffAt: now
      });
      
      // Set 60-second timer to revoke access
      const timerId = setTimeout(async () => {
        // Revoke multipin access after 60 seconds
        multipinGrants.delete(userId);
        multipinTimers.delete(userId);
        
        // 🔄 EXECUTE ACTUAL UNPIN via Browser Bot
        const unpinResult = await executeMultipinAction(meetingId, 'unpin', userName);
        const unpinStatus = unpinResult === 'MULTIPIN_REMOVED' ? '✅ REMOVED' : '⚠️ ERROR';
        
        const revocationMessage = `
🎯　ＭＵＬＴＩＰＩＮ　ＡＣＣＥＳＳ　ＥＸＰＩＲＥＤ　☁️

Hey ${userName}!

⏰ Camera has been OFF for 60+ seconds
🎛️ Multipin access: EXPIRED
🤖 Browser automation: ${unpinStatus}
🔄 To regain access: Turn camera ON + Raise your hand

📸 Camera ON + 🙋 Hand raised = Instant multipin restoration!
        `;
        
        try {
          await sendDirectZoomMessage(accessToken, meetingId, userId, revocationMessage);
        } catch (error) {
          console.error('Error sending multipin revocation message:', error);
        }
        
        await logToObservatory(
          `🎯 MULTIPIN EXPIRED\n👤 ${userName}\n⏰ Camera off for 60+ seconds\n🤖 Browser action: ${unpinResult}\n🔄 Must raise hand to regain access`,
          userId,
          meetingId
        );
        
      }, 60000); // 60 seconds
      
      multipinTimers.set(userId, timerId);
      
      await logToObservatory(
        `⏰ MULTIPIN TIMER STARTED\n👤 ${userName}\n📹 Camera OFF\n🕐 60-second countdown begun`,
        userId,
        meetingId
      );
    }
    
    return 'TIMER_STARTED';
    
  } else if (hasCamera && currentStatus && currentStatus.cameraOffAt && !currentStatus.granted) {
    // 📹 CAMERA BACK ON - Cancel timer, but still need hand raise
    if (multipinTimers.has(userId)) {
      clearTimeout(multipinTimers.get(userId));
      multipinTimers.delete(userId);
    }
    
    multipinGrants.set(userId, {
      granted: false,
      grantedAt: null,
      cameraOffAt: null
    });
    
    if (!hasHandRaised) {
      const handRaiseMessage = `
🎯　ＣＡＭＥＲＡ　ＲＥＳＴＯＲＥＤ　☁️

Welcome back ${userName}!

📹 Camera: ON ✅
🙋 To regain multipin: Please raise your hand

📸 Camera ON + 🙋 Hand raised = Instant multipin access!
      `;
      
      try {
        await sendDirectZoomMessage(accessToken, meetingId, userId, handRaiseMessage);
      } catch (error) {
        console.error('Error sending hand raise reminder:', error);
      }
    }
    
    return 'CAMERA_RESTORED';
  }
  
  return 'NO_CHANGE';
}

// 🚀 Enhanced multipin status for camera + hand raise system
async function getMultipinStatus(userId) {
  const status = multipinGrants.get(userId);
  const hasTimer = multipinTimers.has(userId);
  
  return {
    hasAccess: status && status.granted,
    status: status && status.granted ? 'ACTIVE' : 'INACTIVE',
    requirements: 'CAMERA_ON_AND_HAND_RAISED',
    grantedAt: status ? status.grantedAt : null,
    cameraOffAt: status ? status.cameraOffAt : null,
    hasActiveTimer: hasTimer,
    timestamp: new Date().toISOString()
  };
}

// 🎛️ Bulk multipin optimization for super smooth room operation
async function optimizeRoomForSmoothOperation(accessToken, meetingId) {
  try {
    const participants = await getLiveMeetingParticipants(accessToken, meetingId);
    
    let activeMultipin = 0;
    let pausedMultipin = 0;
    let newGrants = 0;
    let totalWithCamera = 0;
    let smoothOptimizations = 0;
    
    for (const participant of participants) {
      const userId = participant.participant_user_id || participant.user_id;
      const hasCamera = participant.video === 'on';
      
      if (hasCamera) {
        totalWithCamera++;
        
        const status = multipinGrants.get(userId);
        if (!status || !status.granted) {
          const result = await manageMultipinAccess(accessToken, meetingId, participant);
          if (result === 'GRANTED_SMOOTH') {
            newGrants++;
            smoothOptimizations++;
          }
        } else {
          activeMultipin++;
        }
      } else {
        const status = multipinGrants.get(userId);
        if (status && status.granted) {
          const result = await manageMultipinAccess(accessToken, meetingId, participant);
          if (result === 'TIMER_STARTED') {
            pausedMultipin++;
            smoothOptimizations++;
          }
        }
      }
    }
    
    // Comprehensive optimization report
    const optimizationReport = {
      totalParticipants: participants.length,
      withCamera: totalWithCamera,
      activeMultipin: activeMultipin + newGrants,
      pausedMultipin: pausedMultipin,
      newGrants: newGrants,
      optimizations: smoothOptimizations,
      smoothnessRatio: totalWithCamera > 0 ? ((activeMultipin + newGrants) / totalWithCamera * 100).toFixed(1) : 0
    };
    
    // Optimization complete (host chat notification only on request)
    
    await logToObservatory(
      `🚀 ROOM OPTIMIZATION COMPLETE\n📊 Smoothness: ${optimizationReport.smoothnessRatio}%\n🎯 Active multipin: ${optimizationReport.activeMultipin}\n✨ Optimizations: ${optimizationReport.optimizations}\n🎛️ Super smooth operation achieved`,
      null,
      meetingId
    );
    
    return optimizationReport;
    
  } catch (error) {
    console.error('Error optimizing room for smooth operation:', error);
    return null;
  }
}

// Process violations and take action
async function processViolations(accessToken, meetingId, participant, violations) {
  if (violations.length === 0) return;
  
  const userId = participant.participant_user_id || participant.user_id;
  const currentCount = violationCounts.get(userId) || 0;
  violationCounts.set(userId, currentCount + violations.length);
  
  const totalViolations = violationCounts.get(userId);
  
  // Log all violations to Observatory
  for (const violation of violations) {
    await logToObservatory(
      `⚠️ VIOLATION DETECTED\n👤 ${participant.user_name}\n🚫 Type: ${violation.type}\n📊 Severity: ${violation.severity}\n📝 ${violation.message}\n📈 Total Count: ${totalViolations}`,
      userId,
      meetingId
    );
  }
  
  // Take escalating action based on violation count and severity
  const highSeverityViolations = violations.filter(v => v.severity === 'HIGH');
  
  if (highSeverityViolations.length > 0 || totalViolations >= 3) {
    // Alert High Heat and prepare for removal
    await alertHighHeat(
      `🚨 REMOVAL CANDIDATE\n👤 ${participant.user_name}\n📊 Total Violations: ${totalViolations}\n🔥 High Severity: ${highSeverityViolations.length}\n\n⚠️ Recommend immediate action`,
      userId,
      meetingId
    );
    
    // Attempt to move to waiting room or remove participant
    try {
      // First try moving to waiting room with explanation
      await sendWaitingRoomMessage(accessToken, meetingId, userId, 'multiple_violations');
      
      // Remove from meeting host chat if they were a member
      await removeFromMeetingHostChat(accessToken, meetingId, userId, participant.user_name, 'violation removal');
      
      // Notify meeting host chat
      await notifyMeetingHostChat(
        accessToken,
        meetingId,
        `🚫 Participant Removed\n👤 User: @${participant.user_name}\n📋 Reason: Multiple violations\n📊 Violation count: ${totalViolations}`
      );
      
      // Enhanced removal notification
      await alertHighHeat(`
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
⋆ Participant Moved to Waiting Room ⋆

👤 User: @${participant.user_name}  
📤 Action: Moved to Waiting Room with explanation
🧭 Triggered by: Automatic violation detection  
📡 Bilingual message sent via Zoom Chat
🔐 Removed from Host Chat if member
📊 Final Violation Count: ${totalViolations}
      `, userId, meetingId);
      
      violationCounts.delete(userId); // Reset count after action
    } catch (error) {
      // Fallback to direct removal if waiting room fails
      try {
        await updateParticipantStatus(accessToken, meetingId, userId, 'remove');
        await alertHighHeat(`
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
⋆ Participant Removed ⋆

👤 User: @${participant.user_name}  
📤 Action: Direct removal (waiting room failed)
🧭 Triggered by: Automatic violation detection  
📊 Final Violation Count: ${totalViolations}
        `, userId, meetingId);
        violationCounts.delete(userId);
      } catch (removeError) {
        await alertHighHeat(
          `❌ REMOVAL FAILED\n👤 ${participant.user_name}\n🚫 Error: ${removeError.message}\n💡 Manual intervention required`,
          userId,
          meetingId
        );
      }
    }
  } else if (totalViolations >= 2) {
    // Warning level - mute participant
    try {
      await updateParticipantStatus(accessToken, meetingId, userId, 'mute');
      await alertHighHeat(
        `🔇 PARTICIPANT MUTED\n👤 ${participant.user_name}\n⚠️ Warning for violations\n📊 Count: ${totalViolations}`,
        userId,
        meetingId
      );
    } catch (error) {
      console.error('Failed to mute participant:', error);
    }
  }
}

// Short.io URL shortening function
async function shortenUrl(longUrl) {
  const apiKey = process.env.SHORTIO_API_KEY;
  
  if (!apiKey || apiKey === 'your_shortio_api_key_here') {
    console.log('🔗 No Short.io API key found, using original URL');
    return longUrl;
  }
  
  try {
    const response = await axios.post('https://api.short.io/links', {
      originalURL: longUrl,
      domain: 'short.io', // Use Short.io default domain (working)
      allowDuplicates: false,
      tags: ['zoom-oauth', 'la-nube-bot']
    }, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    const shortUrl = response.data.shortURL;
    console.log('✅ URL shortened:', longUrl, '->', shortUrl);
    return shortUrl;
    
  } catch (error) {
    console.log('⚠️ Short.io error, using original URL:', error.message);
    return longUrl;
  }
}

function createOAuthState(userId) {
  const state = crypto.randomBytes(32).toString('hex');
  oauthStateSessions.set(state, { telegramUserId: userId, timestamp: Date.now() });
  return state;
}

function resolveOAuthState(state) {
  const session = oauthStateSessions.get(state);
  if (!session) {
    return null;
  }
  oauthStateSessions.delete(state);
  if (Date.now() - session.timestamp > OAUTH_STATE_TTL_MS) {
    return null;
  }
  return session.telegramUserId;
}

async function generateAuthUrl(userId) {
  const redirectUri = process.env.ZOOM_REDIRECT_URI || 'https://pupfr.github.io/Nebulosa/zoom-callback.html';
  const clientId = (process.env.ZOOM_USER_CLIENT_ID || 'K3t8Sd3rSZOSKfkyMftDXg').trim();
  
  // Create the OAuth URL
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${createOAuthState(userId)}`;
  
  console.log('🔍 OAuth URL Generation:');
  console.log('Client ID:', clientId);
  console.log('Redirect URI:', redirectUri);
  console.log('Original OAuth URL:', authUrl);
  
  // Shorten the URL with Short.io
  const shortUrl = await shortenUrl(authUrl);
  console.log('Final URL (shortened):', shortUrl);
  
  return shortUrl;
}

// ─── Sticker Draft Helper Functions ──────────────────────────────────────────

function generateDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function createStickerDraft(userId, chatId, fileId, fileType) {
  const id = generateDraftId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DRAFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const draft = {
    id,
    userId,
    chatId,
    fileId,
    fileType,
    status: 'draft',
    messageId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
  stickerDrafts.set(id, draft);
  if (!userDraftIds.has(userId)) {
    userDraftIds.set(userId, []);
  }
  userDraftIds.get(userId).push(id);
  return draft;
}

function getUserDraftsByStatus(userId, status) {
  const ids = userDraftIds.get(userId) || [];
  return ids
    .map(id => stickerDrafts.get(id))
    .filter(d => d && (status === null || d.status === status));
}

function updateDraftStatus(draftId, status) {
  const draft = stickerDrafts.get(draftId);
  if (!draft) return null;
  draft.status = status;
  draft.updatedAt = new Date();
  stickerDrafts.set(draftId, draft);
  return draft;
}

function formatDraftStatus(status) {
  const statusMap = {
    draft: '⏳ Pending review',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    expired: '⌛ Expired',
    published: '🌟 Published',
    archived: '📦 Archived'
  };
  return statusMap[status] || status;
}

function formatDraftEntry(draft, index) {
  const age = Math.floor((Date.now() - draft.createdAt.getTime()) / (1000 * 60 * 60));
  const expiresIn = Math.max(0, Math.floor((draft.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  return `${index + 1}. ID: \`${draft.id}\`\n   Type: ${draft.fileType} | ${formatDraftStatus(draft.status)}\n   Created: ${age}h ago | Expires in: ${expiresIn}d`;
}

function getDraftActionKeyboard(draftId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `sticker_approve_${draftId}` },
        { text: '🔄 Retry', callback_data: `sticker_retry_${draftId}` }
      ],
      [
        { text: '🗑 Reject', callback_data: `sticker_reject_${draftId}` },
        { text: '💾 Save for Later', callback_data: `sticker_save_${draftId}` }
      ],
      [
        { text: '🌟 Publish', callback_data: `sticker_publish_${draftId}` }
      ]
    ]
  };
}

// Cleanup worker: auto-expire drafts that have passed their expiry time
// and remove their IDs from the user lookup arrays to prevent memory growth.
function runStickerCleanup() {
  const now = Date.now();
  let expiredCount = 0;

  for (const [draftId, draft] of stickerDrafts) {
    if (
      draft.status === 'draft' &&
      draft.expiresAt &&
      draft.expiresAt.getTime() <= now
    ) {
      draft.status = 'expired';
      draft.updatedAt = new Date();
      stickerDrafts.set(draftId, draft);
      expiredCount++;
    }
  }

  // Remove IDs for fully terminal (expired/rejected) drafts from user arrays
  // to keep memory usage bounded over time.
  for (const [userId, ids] of userDraftIds) {
    const kept = ids.filter(id => {
      const d = stickerDrafts.get(id);
      return d && d.status !== 'expired' && d.status !== 'rejected';
    });
    userDraftIds.set(userId, kept);
  }

  if (expiredCount > 0) {
    console.log(`🧹 Sticker cleanup: ${expiredCount} draft(s) expired.`);
  }
}

// Helper: validate a draft is eligible for publishing
function assertDraftPublishable(draft) {
  if (!draft) return 'Draft not found.';
  if (draft.status === 'expired') return 'This draft has expired.';
  if (draft.status === 'rejected') return 'This draft has been rejected.';
  if (draft.status === 'published') return 'This draft is already published.';
  if (draft.status !== 'approved') return 'You must approve the draft before publishing.';
  return null;
}

// Run cleanup once a day
setInterval(runStickerCleanup, 24 * 60 * 60 * 1000);

// ─── Sticker Draft Message Handler ───────────────────────────────────────────

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Use the highest-resolution photo
  const photos = msg.photo;
  const best = photos[photos.length - 1];
  const fileId = best.file_id;

  const draft = createStickerDraft(userId, chatId, fileId, 'photo');

  const previewMsg = await bot.sendPhoto(chatId, fileId, {
    caption:
      `🪄 *Draft sticker ready!*\n\n` +
      `Status: ${formatDraftStatus('draft')}\n` +
      `⚠️ This sticker is *NOT* in your final set yet.\n` +
      `It will auto-expire in *${DRAFT_EXPIRY_DAYS} days* if not reviewed.\n\n` +
      `Draft ID: \`${draft.id}\``,
    parse_mode: 'Markdown',
    reply_markup: getDraftActionKeyboard(draft.id)
  });

  draft.messageId = previewMsg.message_id;
  stickerDrafts.set(draft.id, draft);
});

bot.on('sticker', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const fileId = msg.sticker.file_id;

  const draft = createStickerDraft(userId, chatId, fileId, 'sticker');

  const previewMsg = await bot.sendSticker(chatId, fileId, {
    reply_markup: getDraftActionKeyboard(draft.id)
  });

  await bot.sendMessage(chatId,
    `🪄 *Draft sticker ready!*\n\n` +
    `Status: ${formatDraftStatus('draft')}\n` +
    `⚠️ This sticker is *NOT* in your final set yet.\n` +
    `It will auto-expire in *${DRAFT_EXPIRY_DAYS} days* if not reviewed.\n\n` +
    `Draft ID: \`${draft.id}\``,
    { parse_mode: 'Markdown' }
  );

  draft.messageId = previewMsg.message_id;
  stickerDrafts.set(draft.id, draft);
});

// Commands
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'User';
  
  trackCommand('/start', userId);
  
  const lang = getUserLanguage(userId);
  const welcome = strings[lang].welcome;
  
  const welcomeMessage = `
${welcome.title}

${welcome.greeting.replace('{username}', username)}

${welcome.commands}
${welcome.commandList.join('\n')}

${welcome.features}
${welcome.featureList.join('\n')}

${welcome.ready}
  `;

  try {
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    await logToChannel(`New user started bot: @${username}`, userId);
  } catch (error) {
    console.error('Error sending welcome message:', error);
    await logToChannel(`Error sending welcome message to user ${userId}: ${error.message}`, userId);
  }
});

// Language selection command
bot.onText(/\/language/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  trackCommand('/language', userId);
  
  const message = "🌍 *Language Selection*\n\nChoose your preferred language:\nElige tu idioma preferido:";
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🇺🇸 English", callback_data: "lang_en" },
        { text: "🇲🇽 Español", callback_data: "lang_es" }
      ]
    ]
  };
  
  try {
    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard 
    });
  } catch (error) {
    console.error('Error sending language selection:', error);
  }
});

// Handle language selection callbacks
bot.on('callback_query', async (callbackQuery) => {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  
  if (data.startsWith('lang_')) {
    const selectedLang = data.replace('lang_', '');
    setUserLanguage(userId, selectedLang);
    
    let responseMessage;
    if (selectedLang === 'en') {
      responseMessage = "Language changed to English! 🇺🇸\n\nType /start to see the menu in English.";
    } else {
      responseMessage = "¡Idioma cambiado a Español! 🇲🇽\n\nEscribe /start para ver el menú en español.";
    }
    
    try {
      await bot.editMessageText(responseMessage, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown'
      });
      
      await bot.answerCallbackQuery(callbackQuery.id);
      await logToChannel(`User ${userId} changed language to ${selectedLang}`, userId);
    } catch (error) {
      console.error('Error updating language:', error);
    }
  }

  // ─── Sticker Draft Action Callbacks ────────────────────────────────────────
  if (data.startsWith('sticker_')) {
    const parts = data.split('_');
    // format: sticker_<action>_<draftId...> (draftId may contain underscores)
    const action = parts[1];
    const draftId = parts.slice(2).join('_');
    const draft = stickerDrafts.get(draftId);

    try {
      if (!draft) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Draft not found or already deleted.' });
        return;
      }

      if (draft.userId !== userId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 This draft does not belong to you.' });
        return;
      }

      if (draft.status === 'expired') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '⌛ This draft has expired and cannot be modified.' });
        return;
      }

      if (action === 'approve') {
        updateDraftStatus(draftId, 'approved');
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Draft approved! Use /publish to add it to your collection.' });
        await bot.sendMessage(chatId,
          `✅ *Draft approved!*\n\nDraft ID: \`${draftId}\`\n\nUse /publish to add it to your final collection or Telegram sticker set.`,
          { parse_mode: 'Markdown' }
        );
        await logToChannel(`User ${userId} approved sticker draft ${draftId}`, userId);

      } else if (action === 'retry') {
        // Keep the current draft as-is and create a new draft slot
        // (In a real implementation you would trigger a new generation; here we acknowledge the retry)
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🔄 Send a new photo or sticker to create another draft.' });
        await bot.sendMessage(chatId,
          `🔄 *Retry requested*\n\nYour current draft (\`${draftId}\`) is still saved as a draft.\nSend another photo or sticker to generate a new version.`,
          { parse_mode: 'Markdown' }
        );

      } else if (action === 'reject') {
        updateDraftStatus(draftId, 'rejected');
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🗑 Draft moved to trash.' });
        await bot.sendMessage(chatId,
          `🗑 *Draft rejected and moved to trash.*\n\nDraft ID: \`${draftId}\`\nIt will be automatically deleted within 24 hours.\n\nUse /trash to view your discarded drafts.`,
          { parse_mode: 'Markdown' }
        );
        await logToChannel(`User ${userId} rejected sticker draft ${draftId}`, userId);

      } else if (action === 'save') {
        // Already in draft status — just confirm
        await bot.answerCallbackQuery(callbackQuery.id, { text: '💾 Saved to your draft vault.' });
        await bot.sendMessage(chatId,
          `💾 *Saved for later!*\n\nDraft ID: \`${draftId}\`\nStatus: ${formatDraftStatus('draft')}\n\nUse /mydrafts to review it when you're ready.`,
          { parse_mode: 'Markdown' }
        );

      } else if (action === 'publish') {
        const publishError = assertDraftPublishable(draft);
        if (publishError) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: `⚠️ ${publishError}` });
          return;
        }
        updateDraftStatus(draftId, 'published');
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🌟 Published!' });
        await bot.sendMessage(chatId,
          `🌟 *Sticker published!*\n\nDraft ID: \`${draftId}\`\nStatus: ${formatDraftStatus('published')}\n\nYour sticker is now part of your approved collection.`,
          { parse_mode: 'Markdown' }
        );
        await logToChannel(`User ${userId} published sticker draft ${draftId}`, userId);
      }
    } catch (error) {
      console.error('Error handling sticker callback:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ An error occurred. Please try again.' });
    }
  }
});

bot.onText(/\/zoomlogin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'User';
  
  trackCommand('/zoomlogin', userId);
  
  try {
    const lang = getUserLanguage(userId);
    
    // Show loading message while generating short URL
    const loadingMsg = lang === 'es' ? 
      '🔗 Generando enlace de autorización seguro...' : 
      '🔗 Generating secure authorization link...';
    
    const loadingMessage = await bot.sendMessage(chatId, loadingMsg);
    
    // Generate the OAuth URL (with short.io)
    const authUrl = await generateAuthUrl(userId);
    
    const zoomLoginText = strings[lang].zoomlogin;
    
    const message = `
${zoomLoginText.title}

${zoomLoginText.instruction}
👉 [Connect to Zoom](${authUrl})

${zoomLoginText.security}
${zoomLoginText.securityList.join('\n')}

${zoomLoginText.steps}
${zoomLoginText.stepList.join('\n')}

${zoomLoginText.confirmation}

🔗 *Shortened link for easy access*
    `;

    // Delete loading message and send the actual message
    await bot.deleteMessage(chatId, loadingMessage.message_id);
    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false 
    });
    
    await logToChannel(`New Zoom OAuth request from user: @${username} | Short URL: ${authUrl}`, userId);
    
  } catch (error) {
    console.error('Error generating Zoom auth URL:', error);
    const lang = getUserLanguage(userId);
    const errorMsg = strings[lang].errors.authUrl;
    await bot.sendMessage(chatId, errorMsg);
  }
});

bot.onText(/\/startsession/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'Usuario';
  
  trackCommand('/startsession', userId);
  
  if (!isAdmin(userId)) {
    const lang = getUserLanguage(userId);
    const adminOnly = lang === 'es' ? '❌ Este comando es solo para administradores.' : '❌ This command is for administrators only.';
    await bot.sendMessage(chatId, adminOnly);
    return;
  }
  
  try {
    // Check if user has Zoom token
    const sessionId = `session_${Date.now()}`;
    activeSessions.set(chatId, {
      sessionId,
      startTime: new Date(),
      adminUser: username,
      participants: new Map()
    });
    
    const lang = getUserLanguage(userId);
    const sessionMessage = lang === 'es' ? `🎯 Sesión de Zoom Iniciada

ID de Sesión: ${sessionId}
Administrador: @${username}
Iniciada: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}

Comandos de Sesión:
/roominfo - Ver información de la sala
/scanroom - Escanear participantes
/status - Estado actual
/shutdown - Terminar sesión

✅ La sesión está activa y lista para monitoreo.` : `🎯 Zoom Session Started

Session ID: ${sessionId}
Administrator: @${username}
Started: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}

Session Commands:
/roominfo - View room information
/scanroom - Scan participants
/status - Current status
/shutdown - End session

✅ Session is active and ready for monitoring.`;
    
    await bot.sendMessage(chatId, sessionMessage);
    await logToObservatory(`🎯 Sesión iniciada por admin @${username}`, userId);
  } catch (error) {
    console.error('Error starting session:', error);
    const lang = getUserLanguage(userId);
    const errorMsg = lang === 'es' ? '❌ Error iniciando la sesión. Intenta de nuevo.' : '❌ Error starting session. Please try again.';
    await bot.sendMessage(chatId, errorMsg);
    await logToChannel(`Error iniciando sesión por usuario ${userId}: ${error.message}`, userId);
  }
});

bot.onText(/\/roominfo/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  trackCommand('/roominfo', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Get user's meetings
    const meetings = await getUserMeetings(accessToken);
    const userProfile = await getUserProfile(accessToken);
    
    if (lang === 'es') {
      const roomInfo = `
📊 Información de la Cuenta Zoom

👤 Usuario: ${userProfile.first_name} ${userProfile.last_name}
📧 Email: ${userProfile.email}
🆔 ID Zoom: ${userProfile.id}

📅 Reuniones Programadas: ${meetings.meetings?.length || 0}
🔗 URL Personal: ${userProfile.personal_meeting_url || 'No disponible'}

Estado de la Cuenta: ✅ Conectada
Última Sincronización: ${new Date().toLocaleTimeString('es-ES')}

${meetings.meetings?.length > 0 ? 
  `Próximas Reuniones:\n${meetings.meetings.slice(0, 3).map(meeting => 
    `• ${meeting.topic}\n  🕐 ${new Date(meeting.start_time).toLocaleString('es-ES')}`
  ).join('\n')}` : 
  'No hay reuniones programadas'}
      `;
      await bot.sendMessage(chatId, roomInfo);
    } else {
      const roomInfo = `
📊 Zoom Account Information

👤 User: ${userProfile.first_name} ${userProfile.last_name}
📧 Email: ${userProfile.email}
🆔 Zoom ID: ${userProfile.id}

📅 Scheduled Meetings: ${meetings.meetings?.length || 0}
🔗 Personal URL: ${userProfile.personal_meeting_url || 'Not available'}

Account Status: ✅ Connected
Last Sync: ${new Date().toLocaleTimeString('en-US')}

${meetings.meetings?.length > 0 ? 
  `Upcoming Meetings:\n${meetings.meetings.slice(0, 3).map(meeting => 
    `• ${meeting.topic}\n  🕐 ${new Date(meeting.start_time).toLocaleString('en-US')}`
  ).join('\n')}` : 
  'No scheduled meetings'}
      `;
      await bot.sendMessage(chatId, roomInfo);
    }
    
  } catch (error) {
    console.error('Error getting room info:', error);
    
    if (error.message === 'NO_TOKEN') {
      const message = lang === 'es' 
        ? '❌ No tienes una cuenta de Zoom conectada. Usa /zoomlogin para conectar tu cuenta.'
        : '❌ You don\'t have a Zoom account connected. Use /zoomlogin to connect your account.';
      await bot.sendMessage(chatId, message);
    } else if (error.message === 'TOKEN_REFRESH_FAILED') {
      const message = lang === 'es'
        ? '❌ Tu token de Zoom ha expirado. Usa /zoomlogin para reconectar tu cuenta.'
        : '❌ Your Zoom token has expired. Use /zoomlogin to reconnect your account.';
      await bot.sendMessage(chatId, message);
    } else {
      const message = lang === 'es'
        ? '❌ Error obteniendo información de Zoom. Intenta más tarde.'
        : '❌ Error getting Zoom information. Try again later.';
      await bot.sendMessage(chatId, message);
    }
  }
});

bot.onText(/\/scanroom (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/scanroom', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Get live participants from the meeting
    const participants = await getLiveMeetingParticipants(accessToken, meetingId);
    
    if (participants.length === 0) {
      const message = lang === 'es'
        ? '📭 No se encontraron participantes en esta reunión. Verifica que la reunión esté activa y el ID sea correcto.'
        : '📭 No participants found in this meeting. Check that the meeting is active and the ID is correct.';
      await bot.sendMessage(chatId, message);
      return;
    }
    
    // Analyze participants and process violations
    const withVideo = participants.filter(p => p.video === 'on');
    const withoutVideo = participants.filter(p => p.video === 'off');
    const muted = participants.filter(p => p.audio === 'muted');
    
    // Process violations and optimize multipin for super smooth operation
    let totalMultipinChanges = 0;
    
    for (const participant of participants) {
      const violations = analyzeParticipantBehavior(participant);
      
      await processViolations(accessToken, meetingId, participant, violations);
      
      // Core multipin processing with camera + hand raise requirements
      const multipinResult = await manageMultipinAccess(accessToken, meetingId, participant);
      if (multipinResult === 'GRANTED_SMOOTH' || multipinResult === 'TIMER_STARTED') {
        totalMultipinChanges++;
      }
    }
    
    // Quiet room optimization - log to Observatory only
    if (totalMultipinChanges > 0) {
      const optimization = await optimizeRoomForSmoothOperation(accessToken, meetingId);
      if (optimization) {
        await logToObservatory(
          `🚀 SCANROOM MULTIPIN OPTIMIZATION\n📊 Changes: ${totalMultipinChanges}\n🎯 Active: ${optimization.activeMultipin}\n📈 Smoothness: ${optimization.smoothnessRatio}%`,
          userId,
          meetingId
        );
      }
    }
    
    const scanResults = `
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
⋆　Ｌａ　ｎｕｂｅ　ｌｏ　ｖｅ　ｔｏｄｏ　⋆

🛰️ Escaneo inicializado por host.
🧿 Verificando visibilidad...

${withVideo.length > 0 ? withVideo.map(p => `👁️ @${p.user_name || 'usuario'} - OK`).join('\n') : ''}
${withoutVideo.length > 0 ? withoutVideo.map(p => `🔇 @${p.user_name || 'usuario'} - Cámara OFF → Movido a sala de espera`).join('\n') : ''}

☁️ Operación completa.

🌫️ La NUBE BOT — Reporte de Escaneo

🔍 Participantes escaneados: ${participants.length}  
👁️ Cámaras ON: ${withVideo.length}  
🔇 Cámaras OFF: ${withoutVideo.length} → Movidos a sala de espera  

⋆ Comando ejecutado por: Host @${msg.from.username || 'admin'}
    `;
    await bot.sendMessage(chatId, scanResults, { parse_mode: 'Markdown' });
    
    // Update host chat membership and notify with multipin optimization
    await updateMeetingHostChat(accessToken, meetingId, userId);
    
    // Optimize room for super smooth operation
    const optimization = await optimizeRoomForSmoothOperation(accessToken, meetingId);
    
    // Only notify host chat about violations, not routine multipin optimization
    if (withoutVideo.length > 0) {
      await notifyMeetingHostChat(
        accessToken,
        meetingId,
        `📊 Scan Results\n🔍 Participants: ${participants.length}\n👁️ Cameras ON: ${withVideo.length}\n⚠️ Violations processed: ${withoutVideo.length}`
      );
    } else {
      const scanResults = `
✦　ＬＡ　ＮＵＢＥ　ＢＯＴ　☁️　
⋆　Ｔｈｅ　ｃｌｏｕｄ　ｓｅｅｓ　ａｌｌ　⋆

🛰️ Scan initialized by host.
🧿 Checking visibility...

${withVideo.length > 0 ? withVideo.map(p => `👁️ @${p.user_name || 'user'} - OK`).join('\n') : ''}
${withoutVideo.length > 0 ? withoutVideo.map(p => `🔇 @${p.user_name || 'user'} - Camera OFF → Moved to waiting room`).join('\n') : ''}

☁️ Operation complete.

🌫️ La NUBE BOT — Room Scan Report

🔍 Participants scanned: ${participants.length}  
👁️ Cameras ON: ${withVideo.length}  
🔇 Cameras OFF: ${withoutVideo.length} → Moved to waiting room  

⋆ Command issued by: Host @${msg.from.username || 'admin'}
      `;
      await bot.sendMessage(chatId, scanResults, { parse_mode: 'Markdown' });
      
      // Update host chat membership and notify with multipin optimization
      await updateMeetingHostChat(accessToken, meetingId, userId);
      
      // Optimize room for super smooth operation
      const optimization = await optimizeRoomForSmoothOperation(accessToken, meetingId);
      
      // Only notify host chat about violations, not routine multipin optimization
      if (withoutVideo.length > 0) {
        await notifyMeetingHostChat(
          accessToken,
          meetingId,
          `📊 Scan Results\n🔍 Participants: ${participants.length}\n👁️ Cameras ON: ${withVideo.length}\n⚠️ Violations processed: ${withoutVideo.length}`
        );
      }
    }
    
    await logToChannel(`Room scan completed for meeting ${meetingId}`, userId);
    
  } catch (error) {
    console.error('Error scanning room:', error);
    
    if (error.message === 'NO_TOKEN') {
      const message = lang === 'es' 
        ? '❌ No tienes una cuenta de Zoom conectada. Usa /zoomlogin para conectar tu cuenta.'
        : '❌ You don\'t have a Zoom account connected. Use /zoomlogin to connect your account.';
      await bot.sendMessage(chatId, message);
    } else if (error.message === 'TOKEN_REFRESH_FAILED') {
      const message = lang === 'es'
        ? '❌ Tu token de Zoom ha expirado. Usa /zoomlogin para reconectar tu cuenta.'
        : '❌ Your Zoom token has expired. Use /zoomlogin to reconnect your account.';
      await bot.sendMessage(chatId, message);
    } else {
      const message = lang === 'es'
        ? '❌ Error escaneando la reunión. Verifica que el ID sea correcto y la reunión esté activa.'
        : '❌ Error scanning meeting. Check that the ID is correct and the meeting is active.';
      await bot.sendMessage(chatId, message);
    }
  }
});

// Test mode /scanroom command (simulated data)
bot.onText(/\/scanroom$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'Usuario';
  
  trackCommand('/scanroom', userId);
  
  if (!isAdmin(userId)) {
    const lang = getUserLanguage(userId);
    const adminOnly = lang === 'es' ? '❌ Este comando es solo para administradores.' : '❌ This command is for administrators only.';
    await bot.sendMessage(chatId, adminOnly);
    return;
  }
  
  try {
    const lang = getUserLanguage(userId);
    
    // Simulate room scanning for demo purposes
    const scanResults = lang === 'es' ? `
🔍 **Escaneo de Sala Zoom Completado** *(Modo Prueba)*

**Resumen de Participantes:**
👥 Total de participantes: 8
📹 Con cámara encendida: 5
🎤 Con micrófono activo: 3
✋ Con mano levantada: 2

**Detalles por Usuario:**
1. @usuario1 - 📹✋ (Cámara + Mano)
2. @usuario2 - 📹🎤 (Cámara + Audio)
3. @usuario3 - 🎤 (Solo audio)
4. @usuario4 - 📹 (Solo cámara)
5. @usuario5 - ✋ (Solo mano levantada)

**Acciones Recomendadas:**
• 2 usuarios califican para multipin
• 3 usuarios necesitan activar cámara
• Monitoreo continuo activo

*Escaneo simulado: ${new Date().toLocaleString('es-ES')}*` : `
🔍 **Zoom Room Scan Completed** *(Test Mode)*

**Participant Summary:**
👥 Total participants: 8
📹 Camera on: 5
🎤 Microphone active: 3
✋ Hand raised: 2

**User Details:**
1. @user1 - 📹✋ (Camera + Hand)
2. @user2 - 📹🎤 (Camera + Audio)
3. @user3 - 🎤 (Audio only)
4. @user4 - 📹 (Camera only)
5. @user5 - ✋ (Hand raised only)

**Recommended Actions:**
• 2 users qualify for multipin
• 3 users need to activate camera
• Continuous monitoring active

*Simulated scan: ${new Date().toLocaleString('en-US')}*`;
    
    await bot.sendMessage(chatId, scanResults, { parse_mode: 'Markdown' });
    await logToObservatory(`🔍 Escaneo simulado completado por admin @${username}`, userId);
    
  } catch (error) {
    console.error('Error in simulated room scan:', error);
    const lang = getUserLanguage(userId);
    const errorMsg = lang === 'es' ? '❌ Error en escaneo simulado.' : '❌ Simulated scan error.';
    await bot.sendMessage(chatId, errorMsg);
  }
});

// Create instant meeting command (alternative to multi-pin limitations)
bot.onText(/\/createroom (.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const topic = match[1] || '';
  const lang = getUserLanguage(userId);
  
  trackCommand('/createroom', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Create instant meeting with optimized settings for participant management
    const meetingTopic = topic || (lang === 'es' ? 'Reunión La NUBE BOT' : 'La NUBE BOT Meeting');
    const meeting = await createInstantMeetingWithSettings(accessToken, meetingTopic);
    
    if (lang === 'es') {
      const meetingInfo = `
🎯 *¡Reunión Creada Exitosamente!*

📋 *Tema:* ${meeting.topic}
🆔 *ID de Reunión:* \`${meeting.id}\`
🔗 *URL de Unión:* [Unirse a la Reunión](${meeting.join_url})

📱 *Información de Marcado:*
• *Número:* ${meeting.settings.global_dial_in_countries?.[0]?.number || 'No disponible'}
• *ID de Conferencia:* ${meeting.id}

⚙️ *Configuraciones Optimizadas:*
• ✅ Video del anfitrión habilitado
• ✅ Video de participantes habilitado  
• ✅ Audio bidireccional
• ❌ Sala de espera deshabilitada
• ❌ Silenciar al entrar deshabilitado

*💡 Consejo:* Esta reunión está optimizada para mejor control de participantes. Usa /scanroom ${meeting.id} para monitorear participantes una vez que esté activa.

*🕐 Duración:* 60 minutos
*⏰ Iniciada:* ${new Date().toLocaleString('es-ES')}
      `;
      
      await bot.sendMessage(chatId, meetingInfo, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } else {
      const meetingInfo = `
🎯 *Meeting Created Successfully!*

📋 *Topic:* ${meeting.topic}
🆔 *Meeting ID:* \`${meeting.id}\`
🔗 *Join URL:* [Join Meeting](${meeting.join_url})

📱 *Dial-in Information:*
• *Number:* ${meeting.settings.global_dial_in_countries?.[0]?.number || 'Not available'}
• *Conference ID:* ${meeting.id}

⚙️ *Optimized Settings:*
• ✅ Host video enabled
• ✅ Participant video enabled
• ✅ Two-way audio
• ❌ Waiting room disabled  
• ❌ Mute upon entry disabled

*💡 Tip:* This meeting is optimized for better participant control. Use /scanroom ${meeting.id} to monitor participants once it's active.

*🕐 Duration:* 60 minutes
*⏰ Started:* ${new Date().toLocaleString('en-US')}
      `;
      
      await bot.sendMessage(chatId, meetingInfo, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    }
    
    await logToChannel(`User ${userId} created instant meeting: ${meeting.id}`, userId);
    
    // 🤖 Auto-start browser bot for multipin automation
    try {
      const meetingData = {
        meetingId: meeting.id.toString(),
        link: meeting.join_url,
        passcode: meeting.password || 'No passcode required'
      };
      
      const browserBot = await startBrowserBot(meeting.id.toString(), meetingData, accessToken);
      
      if (browserBot) {
        const autoBotMessage = lang === 'es'
          ? `🤖 *¡Automatización Activada!*\n\n✅ Browser bot iniciado automáticamente\n🎯 Multipin automático: ACTIVO\n🔄 Monitoreando cámara + mano levantada\n\n*El bot manejará automáticamente:*\n• ✅ Multipin para usuarios con cámara ON + mano\n• ⏰ Unpin tras 60s sin cámara\n• 📝 Registro completo en Observatory`
          : `🤖 *Automation Activated!*\n\n✅ Browser bot started automatically\n🎯 Automatic multipin: ACTIVE\n🔄 Monitoring camera + hand raised\n\n*Bot will automatically handle:*\n• ✅ Multipin for users with camera ON + hand\n• ⏰ Unpin after 60s without camera\n• 📝 Complete Observatory logging`;
          
        await bot.sendMessage(chatId, autoBotMessage, { parse_mode: 'Markdown' });
        
        // Notify Command Chat about auto-started bot
        await notifyCommandChat(
          `🎯 AUTO-STARTED BROWSER BOT\n🆔 Meeting: ${meeting.id}\n👤 Creator: @${msg.from.username || 'user'}\n🤖 Multipin automation: AUTO-ACTIVE`,
          meeting.id.toString()
        );
      }
    } catch (autoBotError) {
      console.error('Error auto-starting browser bot:', autoBotError);
      // Don't fail the meeting creation if browser bot fails
      const fallbackMessage = lang === 'es'
        ? `⚠️ *Nota:* Automatización no disponible ahora. Usa \`/startbot ${meeting.id} ${meeting.join_url}\` para activarla manualmente.`
        : `⚠️ *Note:* Automation not available now. Use \`/startbot ${meeting.id} ${meeting.join_url}\` to activate it manually.`;
      
      await bot.sendMessage(chatId, fallbackMessage, { parse_mode: 'Markdown' });
    }
    
  } catch (error) {
    console.error('Error creating meeting:', error);
    
    if (error.message === 'NO_TOKEN') {
      const message = lang === 'es' 
        ? '❌ No tienes una cuenta de Zoom conectada. Usa /zoomlogin para conectar tu cuenta.'
        : '❌ You don\'t have a Zoom account connected. Use /zoomlogin to connect your account.';
      await bot.sendMessage(chatId, message);
    } else if (error.message === 'TOKEN_REFRESH_FAILED') {
      const message = lang === 'es'
        ? '❌ Tu token de Zoom ha expirado. Usa /zoomlogin para reconectar tu cuenta.'
        : '❌ Your Zoom token has expired. Use /zoomlogin to reconnect your account.';
      await bot.sendMessage(chatId, message);
    } else {
      const message = lang === 'es'
        ? '❌ Error creando la reunión. Intenta más tarde.'
        : '❌ Error creating meeting. Try again later.';
      await bot.sendMessage(chatId, message);
    }
  }
});

// Fallback for /createroom without topic
bot.onText(/\/createroom$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? '📝 *Uso del comando /createroom*\n\nPara crear una reunión instantánea, usa:\n`/createroom [TEMA_OPCIONAL]`\n\nEjemplos:\n`/createroom` (tema por defecto)\n`/createroom Reunión de Equipo`\n\n💡 *Características:*\n• Reunión instantánea (60 min)\n• Video habilitado para todos\n• Sin sala de espera\n• Optimizada para monitoreo'
    : '📝 *How to use /createroom*\n\nTo create an instant meeting, use:\n`/createroom [OPTIONAL_TOPIC]`\n\nExamples:\n`/createroom` (default topic)\n`/createroom Team Meeting`\n\n💡 *Features:*\n• Instant meeting (60 min)\n• Video enabled for all\n• No waiting room\n• Optimized for monitoring';
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  trackCommand('/status', userId);
  
  const session = activeSessions.get(chatId);
  const uptimeMinutes = Math.floor((Date.now() - botMetrics.uptime) / 1000 / 60);
  const activeBots = [...activeBrowserBots.entries()];
  
  const lang = getUserLanguage(userId);
  const statusMessage = lang === 'es' ? `
⚡ *Estado del Bot La NUBE*

*Estado General:* Operativo ✅
*Tiempo Activo:* ${uptimeMinutes} minutos
*Comandos Ejecutados:* ${botMetrics.totalCommands}

*Sesión Actual:*
${session ? `
• ID: ${session.sessionId}
• Estado: Activa ✅
• Duración: ${Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60)} min
• Admin: ${session.adminUser}
` : '• Sin sesión activa ❌'}

*Browser Bots (Multipin):*
${activeBots.length > 0 ? activeBots.map(([meetingId, bot]) => 
  `• Reunión: ${meetingId}\n  Estado: ${bot.isReady() ? '✅ Activo' : '⚠️ Error'}\n  Bot: ${bot.botName}`
).join('\n') : '• Sin bots activos ❌'}

*Integración Zoom:*
• OAuth: Configurado ✅
• Redirect URI: Configurado ✅
• API: Lista para usar ✅
• Automatización: ${activeBots.length > 0 ? '✅ Activa' : '❌ Inactiva'}

*Dashboard:* Disponible en la interfaz web
  ` : `
⚡ *LA NUBE Bot Status*

*General Status:* Operational ✅
*Uptime:* ${uptimeMinutes} minutes
*Commands Executed:* ${botMetrics.totalCommands}

*Current Session:*
${session ? `
• ID: ${session.sessionId}
• Status: Active ✅
• Duration: ${Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60)} min
• Admin: ${session.adminUser}
` : '• No active session ❌'}

*Browser Bots (Multipin):*
${activeBots.length > 0 ? activeBots.map(([meetingId, bot]) => 
  `• Meeting: ${meetingId}\n  Status: ${bot.isReady() ? '✅ Active' : '⚠️ Error'}\n  Bot: ${bot.botName}`
).join('\n') : '• No active bots ❌'}

*Zoom Integration:*
• OAuth: Configured ✅
• Redirect URI: Configured ✅
• API: Ready to use ✅
• Automation: ${activeBots.length > 0 ? '✅ Active' : '❌ Inactive'}

*Dashboard:* Available in web interface
  `;
  
  await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/shutdown/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || 'Usuario';
  
  trackCommand('/shutdown', userId);
  
  if (!isAdmin(userId)) {
    const lang = getUserLanguage(userId);
    const adminOnly = lang === 'es' ? '❌ Este comando es solo para administradores.' : '❌ This command is for administrators only.';
    await bot.sendMessage(chatId, adminOnly);
    return;
  }
  
  const session = activeSessions.get(chatId);
  if (!session) {
    const lang = getUserLanguage(userId);
    const noSession = lang === 'es' ? '❌ No hay sesión activa para terminar.' : '❌ No active session to end.';
    await bot.sendMessage(chatId, noSession);
    return;
  }
  
  try {
    const duration = Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60);
    
    // 🤖 Cleanup browser bots before shutdown
    const activeBots = [...activeBrowserBots.keys()];
    for (const meetingId of activeBots) {
      await stopBrowserBot(meetingId);
    }
    
    activeSessions.delete(chatId);
    
    const lang = getUserLanguage(userId);
    const shutdownMessage = lang === 'es' ? `
🔴 *Sesión Terminada*

*Sesión:* ${session.sessionId}
*Duración Total:* ${duration} minutos
*Terminada por:* @${username}
*Hora:* ${new Date().toLocaleString('es-ES')}

✅ La sesión ha sido cerrada exitosamente.
¡Gracias por usar La NUBE BOT!
    ` : `
🔴 *Session Ended*

*Session:* ${session.sessionId}
*Total Duration:* ${duration} minutes
*Ended by:* @${username}
*Time:* ${new Date().toLocaleString('en-US')}

✅ Session has been closed successfully.
Thank you for using LA NUBE BOT!
    `;
    
    await bot.sendMessage(chatId, shutdownMessage, { parse_mode: 'Markdown' });
    await logToChannel(`Sesión ${session.sessionId} terminada por admin @${username}`, userId);
  } catch (error) {
    console.error('Error shutting down session:', error);
    const lang = getUserLanguage(userId);
    const errorMsg = lang === 'es' ? '❌ Error terminando la sesión.' : '❌ Error ending session.';
    await bot.sendMessage(chatId, errorMsg);
  }
});

// Handle unknown commands
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Skip if it's not a command or a known command
  if (!text || !text.startsWith('/')) return;
  
  const knownCommands = ['/start', '/zoomlogin', '/startsession', '/roominfo', '/scanroom', '/status', '/shutdown'];
  if (knownCommands.includes(text)) return;
  
  const helpMessage = `
❓ *Comando no reconocido*

*Comandos disponibles:*
/start - Mensaje de bienvenida
/zoomlogin - Conectar cuenta Zoom
/startsession - Iniciar sesión (Admin)
/roominfo - Info de la sala
/scanroom - Escanear participantes
/status - Estado del bot
/shutdown - Terminar sesión (Admin)

¿Necesitas ayuda? Usa /start para ver la información completa.
  `;
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Automatic monitoring command
bot.onText(/\/monitor (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/monitor', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Check if already monitoring
    if (activeMonitors.has(userId)) {
      clearInterval(activeMonitors.get(userId));
      activeMonitors.delete(userId);
      
      const message = lang === 'es'
        ? `⏹️ *Monitoreo Automático Detenido*\n\nEl monitoreo anterior ha sido detenido. Iniciando nuevo monitoreo para la reunión: \`${meetingId}\``
        : `⏹️ *Automatic Monitoring Stopped*\n\nPrevious monitoring has been stopped. Starting new monitoring for meeting: \`${meetingId}\``;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
    
    // Start continuous monitoring
    const monitorInterval = setInterval(async () => {
      try {
        const participants = await getLiveMeetingParticipants(accessToken, meetingId);
        
        if (participants.length > 0) {
          // Process each participant for violations and multipin access
          for (const participant of participants) {
            const violations = analyzeParticipantBehavior(participant);
            await processViolations(accessToken, meetingId, participant, violations);
            await manageMultipinAccess(accessToken, meetingId, participant);
          }
          
          // Log monitoring activity to Observatory
          await logToObservatory(
            `🔄 AUTO-MONITOR SCAN\n👥 Participants: ${participants.length}\n📹 With Video: ${participants.filter(p => p.video === 'on').length}\n🔇 Muted: ${participants.filter(p => p.audio === 'muted').length}`,
            userId,
            meetingId
          );
        }
      } catch (error) {
        console.error('Monitor error:', error);
        if (error.message.includes('404') || error.message.includes('not found')) {
          // Meeting ended, stop monitoring
          clearInterval(activeMonitors.get(userId));
          activeMonitors.delete(userId);
          
          const endMessage = lang === 'es'
            ? `📴 *Monitoreo Finalizado*\n\nLa reunión ${meetingId} ha terminado. Monitoreo automático detenido.`
            : `📴 *Monitoring Ended*\n\nMeeting ${meetingId} has ended. Automatic monitoring stopped.`;
          
          await bot.sendMessage(chatId, endMessage);
          await logToObservatory(
            `📴 AUTO-MONITOR ENDED\nMeeting concluded`,
            userId,
            meetingId
          );
        }
      }
    }, 30000); // Monitor every 30 seconds
    
    activeMonitors.set(userId, monitorInterval);
    
    if (lang === 'es') {
      const startMessage = `
🔄 *Monitoreo Automático Iniciado*

🆔 *Reunión:* \`${meetingId}\`
⏱️ *Intervalo:* 30 segundos
🤖 *Estado:* Activo

*Características del Monitoreo:*
• ✅ Detección automática de violaciones
• ✅ Gestión automática de multipin
• ✅ Alertas a HIGH HEAT para infracciones graves
• ✅ Registro completo en NEBULOSO'S OBSERVATORY
• ✅ Remoción automática por comportamiento disruptivo

*Para detener:* /monitor stop
      `;
      await bot.sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
    } else {
      const startMessage = `
🔄 *Automatic Monitoring Started*

🆔 *Meeting:* \`${meetingId}\`
⏱️ *Interval:* 30 seconds  
🤖 *Status:* Active

*Monitoring Features:*
• ✅ Automatic violation detection
• ✅ Automatic multipin management
• ✅ HIGH HEAT alerts for serious violations
• ✅ Complete logging to NEBULOSO'S OBSERVATORY
• ✅ Automatic removal for disruptive behavior

*To stop:* /monitor stop
      `;
      await bot.sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
    }
    
    await logToObservatory(
      `🔄 AUTO-MONITOR STARTED\n👤 Host: ${userId}\n⏱️ Interval: 30s`,
      userId,
      meetingId
    );
    
  } catch (error) {
    console.error('Error starting monitor:', error);
    
    if (error.message === 'NO_TOKEN') {
      const message = lang === 'es' 
        ? '❌ No tienes una cuenta de Zoom conectada. Usa /zoomlogin para conectar tu cuenta.'
        : '❌ You don\'t have a Zoom account connected. Use /zoomlogin to connect your account.';
      await bot.sendMessage(chatId, message);
    } else {
      const message = lang === 'es'
        ? '❌ Error iniciando el monitoreo automático. Verifica que el ID de reunión sea correcto.'
        : '❌ Error starting automatic monitoring. Check that the meeting ID is correct.';
      await bot.sendMessage(chatId, message);
    }
  }
});

// Stop monitoring
bot.onText(/\/monitor stop/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  if (activeMonitors.has(userId)) {
    clearInterval(activeMonitors.get(userId));
    activeMonitors.delete(userId);
    
    const message = lang === 'es'
      ? '⏹️ *Monitoreo Automático Detenido*\n\nEl monitoreo ha sido detenido exitosamente.'
      : '⏹️ *Automatic Monitoring Stopped*\n\nMonitoring has been stopped successfully.';
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    await logToObservatory(`⏹️ AUTO-MONITOR STOPPED\n👤 User: ${userId}`, userId);
  } else {
    const message = lang === 'es'
      ? '❌ No hay monitoreo activo para detener.'
      : '❌ No active monitoring to stop.';
    
    await bot.sendMessage(chatId, message);
  }
});

// Monitor command help
bot.onText(/\/monitor$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? `📝 *Uso del comando /monitor*

*Iniciar monitoreo automático:*
\`/monitor [ID_DE_REUNION]\`

*Detener monitoreo:*
\`/monitor stop\`

*Características:*
• 🔄 Escaneo cada 30 segundos
• ⚠️ Detección automática de violaciones
• 🎥 Gestión de multipin por cámara
• 🚨 Alertas automáticas a HIGH HEAT
• 📝 Registro completo en OBSERVATORY

*Ejemplo:*
\`/monitor 123456789\``
    : `📝 *How to use /monitor*

*Start automatic monitoring:*
\`/monitor [MEETING_ID]\`

*Stop monitoring:*
\`/monitor stop\`

*Features:*
• 🔄 Scan every 30 seconds
• ⚠️ Automatic violation detection
• 🎥 Multipin management by camera
• 🚨 Automatic HIGH HEAT alerts
• 📝 Complete OBSERVATORY logging

*Example:*
\`/monitor 123456789\``;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Chat monitoring command
bot.onText(/\/chatwatch (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/chatwatch', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Start chat monitoring interval
    const chatMonitorInterval = setInterval(async () => {
      try {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        
        const chatMessages = await getMeetingChatMessages(
          accessToken, 
          meetingId, 
          fiveMinutesAgo.toISOString(), 
          now.toISOString()
        );
        
        if (chatMessages && chatMessages.messages) {
          for (const message of chatMessages.messages) {
            const violations = detectSpamInMessage(message.content, message.sender, meetingId);
            
            if (violations.length > 0) {
              // Log violations
              for (const violation of violations) {
                await logToObservatory(
                  `💬 CHAT VIOLATION\n👤 ${message.sender}\n🚫 Type: ${violation.type}\n📝 Message: "${message.content}"\n📊 Severity: ${violation.severity}`,
                  message.sender,
                  meetingId
                );
              }
              
              // Take action based on violation type
              const highSeverityViolations = violations.filter(v => v.severity === 'HIGH');
              if (highSeverityViolations.length > 0) {
                await sendWaitingRoomMessage(accessToken, meetingId, message.sender, 'chat_violation');
                await alertHighHeat(
                  `🚨 CHAT SPAM DETECTED\n👤 User: ${message.sender}\n📝 Violation: ${highSeverityViolations[0].type}\n📤 Moved to waiting room`,
                  message.sender,
                  meetingId
                );
              }
            }
          }
        }
        
      } catch (error) {
        console.error('Chat monitor error:', error);
        if (error.message.includes('404')) {
          clearInterval(chatMonitorInterval);
          const endMessage = lang === 'es'
            ? `📴 *Monitoreo de Chat Finalizado*\n\nLa reunión ${meetingId} ha terminado.`
            : `📴 *Chat Monitoring Ended*\n\nMeeting ${meetingId} has ended.`;
          await bot.sendMessage(chatId, endMessage);
        }
      }
    }, 15000); // Check every 15 seconds
    
    // Store the interval for cleanup
    activeMonitors.set(`chat_${userId}`, chatMonitorInterval);
    
    if (lang === 'es') {
      const startMessage = `
💬 Monitoreo de Chat Iniciado

🆔 Reunión: ${meetingId}
⏱️ Intervalo: 15 segundos
🤖 Estado: Activo

Detección Automática:
• 🌐 Enlaces → Eliminación automática
• 🌀 Mensajes duplicados → Advertencias
• 💥 Ráfagas de spam → Sala de espera
• 🚷 Violaciones → HIGH HEAT alerts

Para detener: /chatwatch stop
      `;
      await bot.sendMessage(chatId, startMessage);
    } else {
      const startMessage = `
💬 Chat Monitoring Started

🆔 Meeting: ${meetingId}
⏱️ Interval: 15 seconds
🤖 Status: Active

Automatic Detection:
• 🌐 Links → Automatic deletion
• 🌀 Duplicate messages → Warnings
• 💥 Spam bursts → Waiting room
• 🚷 Violations → HIGH HEAT alerts

To stop: /chatwatch stop
      `;
      await bot.sendMessage(chatId, startMessage);
    }
    
    await logToObservatory(
      `💬 CHAT MONITOR STARTED\n👤 Host: ${userId}\n⏱️ Interval: 15s\n🎯 Spam detection active`,
      userId,
      meetingId
    );
    
  } catch (error) {
    console.error('Error starting chat monitor:', error);
    const message = lang === 'es'
      ? '❌ Error iniciando el monitoreo de chat. Verifica el ID de reunión.'
      : '❌ Error starting chat monitoring. Check the meeting ID.';
    await bot.sendMessage(chatId, message);
  }
});

// Stop chat monitoring
bot.onText(/\/chatwatch stop/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const chatMonitorKey = `chat_${userId}`;
  if (activeMonitors.has(chatMonitorKey)) {
    clearInterval(activeMonitors.get(chatMonitorKey));
    activeMonitors.delete(chatMonitorKey);
    
    const message = lang === 'es'
      ? '⏹️ *Monitoreo de Chat Detenido*\n\nEl monitoreo de chat ha sido detenido exitosamente.'
      : '⏹️ *Chat Monitoring Stopped*\n\nChat monitoring has been stopped successfully.';
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    await logToObservatory(`💬 CHAT MONITOR STOPPED\n👤 User: ${userId}`, userId);
  } else {
    const message = lang === 'es'
      ? '❌ No hay monitoreo de chat activo para detener.'
      : '❌ No active chat monitoring to stop.';
    
    await bot.sendMessage(chatId, message);
  }
});

// 🤖 Browser Bot Commands for Multipin Automation

// Start browser bot for multipin automation
bot.onText(/\/startbot (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const meetingLink = match[2];
  const lang = getUserLanguage(userId);
  
  trackCommand('/startbot', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Check if browser bot is already running
    if (activeBrowserBots.has(meetingId)) {
      const message = lang === 'es'
        ? `🤖 *Browser Bot Ya Activo*\n\n🆔 Reunión: \`${meetingId}\`\n🎯 Estado: Multipin automático funcionando\n\nUsa \`/stopbot ${meetingId}\` para detenerlo.`
        : `🤖 *Browser Bot Already Active*\n\n🆔 Meeting: \`${meetingId}\`\n🎯 Status: Automatic multipin running\n\nUse \`/stopbot ${meetingId}\` to stop it.`;
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      return;
    }
    
    // Create meeting data object
    const meetingData = {
      meetingId: meetingId,
      link: meetingLink,
      passcode: 'No passcode required' // Can be updated if needed
    };
    
    // Start browser bot
    const browserBot = await startBrowserBot(meetingId, meetingData, accessToken);
    
    if (browserBot) {
      const message = lang === 'es'
        ? `🤖 *Browser Bot Iniciado*\n\n🆔 Reunión: \`${meetingId}\`\n🔗 Enlace: ${meetingLink}\n🎯 Estado: Multipin automático ACTIVO\n🤖 Bot: ${browserBot.botName}\n\n*Características Activas:*\n• ✅ Multipin automático por cámara + mano\n• ✅ Unpin automático tras 60s sin cámara\n• ✅ Monitoreo en tiempo real\n• ✅ Registro completo en Observatory\n\n*Para detener:* \`/stopbot ${meetingId}\``
        : `🤖 *Browser Bot Started*\n\n🆔 Meeting: \`${meetingId}\`\n🔗 Link: ${meetingLink}\n🎯 Status: Automatic multipin ACTIVE\n🤖 Bot: ${browserBot.botName}\n\n*Active Features:*\n• ✅ Automatic multipin for camera + hand\n• ✅ Auto-unpin after 60s without camera\n• ✅ Real-time monitoring\n• ✅ Complete Observatory logging\n\n*To stop:* \`/stopbot ${meetingId}\``;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      // Notify Command Chat
      await notifyCommandChat(
        `🤖 BROWSER BOT STARTED\n🆔 Meeting: ${meetingId}\n👤 Started by: @${msg.from.username || 'admin'}\n🎯 Multipin automation: ACTIVE`,
        meetingId
      );
      
    } else {
      const message = lang === 'es'
        ? `❌ *Error al Iniciar Browser Bot*\n\n🆔 Reunión: \`${meetingId}\`\nNo se pudo iniciar la automatización del multipin. Verifica que:\n• El enlace de Zoom sea válido\n• La reunión esté activa\n• Tu cuenta tenga permisos de host/cohost`
        : `❌ *Browser Bot Start Failed*\n\n🆔 Meeting: \`${meetingId}\`\nCould not start multipin automation. Check that:\n• Zoom link is valid\n• Meeting is active\n• Your account has host/cohost permissions`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
    
  } catch (error) {
    console.error('Error starting browser bot:', error);
    const message = lang === 'es'
      ? '❌ Error al iniciar browser bot para automatización de multipin.'
      : '❌ Error starting browser bot for multipin automation.';
    await bot.sendMessage(chatId, message);
  }
});

// Stop browser bot
bot.onText(/\/stopbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/stopbot', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  try {
    // Check if browser bot is running
    if (!activeBrowserBots.has(meetingId)) {
      const message = lang === 'es'
        ? `⚠️ *No hay Browser Bot Activo*\n\n🆔 Reunión: \`${meetingId}\`\nNo hay automatización de multipin corriendo para esta reunión.`
        : `⚠️ *No Active Browser Bot*\n\n🆔 Meeting: \`${meetingId}\`\nNo multipin automation running for this meeting.`;
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      return;
    }
    
    // Stop browser bot
    await stopBrowserBot(meetingId);
    
    const message = lang === 'es'
      ? `🔚 *Browser Bot Detenido*\n\n🆔 Reunión: \`${meetingId}\`\n🎯 Estado: Multipin automático DETENIDO\n\n*Automatización finalizada:*\n• ❌ Multipin automático desactivado\n• ❌ Monitoreo de cámara detenido\n• ✅ Registros guardados en Observatory\n\nPuedes reiniciar con \`/startbot\``
      : `🔚 *Browser Bot Stopped*\n\n🆔 Meeting: \`${meetingId}\`\n🎯 Status: Automatic multipin STOPPED\n\n*Automation ended:*\n• ❌ Automatic multipin disabled\n• ❌ Camera monitoring stopped\n• ✅ Logs saved to Observatory\n\nYou can restart with \`/startbot\``;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
    // Notify Command Chat
    await notifyCommandChat(
      `🔚 BROWSER BOT STOPPED\n🆔 Meeting: ${meetingId}\n👤 Stopped by: @${msg.from.username || 'admin'}\n🎯 Multipin automation: DEACTIVATED`,
      meetingId
    );
    
  } catch (error) {
    console.error('Error stopping browser bot:', error);
    const message = lang === 'es'
      ? '❌ Error al detener browser bot.'
      : '❌ Error stopping browser bot.';
    await bot.sendMessage(chatId, message);
  }
});

// Browser bot status
bot.onText(/\/botstatus$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  trackCommand('/botstatus', userId);
  
  try {
    const activeBots = [...activeBrowserBots.entries()];
    
    if (activeBots.length === 0) {
      const message = lang === 'es'
        ? `🤖 *Estado de Browser Bots*\n\n*Bots Activos:* 0\n📊 Estado: Sin automatización de multipin\n\n*Para iniciar:*\n\`/startbot [MEETING_ID] [ZOOM_LINK]\`\n\n*Ejemplo:*\n\`/startbot 123456789 https://zoom.us/j/123456789\``
        : `🤖 *Browser Bot Status*\n\n*Active Bots:* 0\n📊 Status: No multipin automation\n\n*To start:*\n\`/startbot [MEETING_ID] [ZOOM_LINK]\`\n\n*Example:*\n\`/startbot 123456789 https://zoom.us/j/123456789\``;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      return;
    }
    
    let statusMessage = lang === 'es'
      ? `🤖 *Estado de Browser Bots*\n\n*Bots Activos:* ${activeBots.length}\n\n`
      : `🤖 *Browser Bot Status*\n\n*Active Bots:* ${activeBots.length}\n\n`;
    
    for (const [meetingId, bot] of activeBots) {
      const multipinnedUsers = await bot.getMultipinnedUsers();
      const botStatus = bot.isReady() ? '✅ ACTIVE' : '⚠️ ERROR';
      
      statusMessage += lang === 'es'
        ? `*Reunión:* \`${meetingId}\`\n*Estado:* ${botStatus}\n*Bot:* ${bot.botName}\n*Usuarios multipinned:* ${multipinnedUsers.length}\n*Conectado:* ${bot.isConnected ? 'Sí' : 'No'}\n\n`
        : `*Meeting:* \`${meetingId}\`\n*Status:* ${botStatus}\n*Bot:* ${bot.botName}\n*Multipinned users:* ${multipinnedUsers.length}\n*Connected:* ${bot.isConnected ? 'Yes' : 'No'}\n\n`;
    }
    
    statusMessage += lang === 'es'
      ? `*Comandos:*\n• \`/stopbot [MEETING_ID]\` - Detener bot específico\n• \`/startbot [MEETING_ID] [LINK]\` - Iniciar nuevo bot`
      : `*Commands:*\n• \`/stopbot [MEETING_ID]\` - Stop specific bot\n• \`/startbot [MEETING_ID] [LINK]\` - Start new bot`;
    
    await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error getting browser bot status:', error);
    const message = lang === 'es'
      ? '❌ Error al obtener estado de browser bots.'
      : '❌ Error getting browser bot status.';
    await bot.sendMessage(chatId, message);
  }
});

// Promote user to cohost
bot.onText(/\/promote (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const participantName = match[2];
  const lang = getUserLanguage(userId);
  
  trackCommand('/promote', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  try {
    const accessToken = await getValidZoomToken(userId);
    const participants = await getLiveMeetingParticipants(accessToken, meetingId);
    
    // Find participant by name
    const participant = participants.find(p => 
      p.user_name.toLowerCase().includes(participantName.toLowerCase())
    );
    
    if (!participant) {
      const message = lang === 'es'
        ? `❌ No se encontró participante con nombre: ${participantName}`
        : `❌ Participant not found with name: ${participantName}`;
      await bot.sendMessage(chatId, message);
      return;
    }
    
    // Promote to cohost with enhanced messaging
    await sendCohostPromotionMessage(accessToken, meetingId, participant.participant_user_id, participant.user_name);
    
    if (lang === 'es') {
      const successMessage = `
✅ *Usuario Promovido a Cohost*

👤 *Usuario:* ${participant.user_name}
🆔 *Reunión:* ${meetingId}
👑 *Rol:* Cohost
📨 *Invitación:* Enviada al Command Chat

*Mensaje incluye:*
• Enlace al Command Chat
• Instrucciones de promoción de sala
• Información bilingüe

🔐 El usuario ahora tiene acceso completo de cohost.
      `;
      await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    } else {
      const successMessage = `
✅ *User Promoted to Cohost*

👤 *User:* ${participant.user_name}
🆔 *Meeting:* ${meetingId}
👑 *Role:* Cohost
📨 *Invitation:* Sent to Command Chat

*Message includes:*
• Command Chat link
• Room promotion instructions
• Bilingual information

🔐 User now has full cohost access.
      `;
      await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    }
    
  } catch (error) {
    console.error('Error promoting user:', error);
    const message = lang === 'es'
      ? '❌ Error promoviendo usuario. Verifica que el ID de reunión y nombre sean correctos.'
      : '❌ Error promoting user. Check that meeting ID and name are correct.';
    await bot.sendMessage(chatId, message);
  }
});

// Promote command help
bot.onText(/\/promote$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? `📝 *Uso del comando /promote*

*Promover usuario a cohost:*
\`/promote [ID_DE_REUNION] [NOMBRE_USUARIO]\`

*Ejemplo:*
\`/promote 123456789 Juan\`

*Características:*
• 👑 Promoción automática a cohost
• 📨 Invitación al Command Chat
• 🌐 Instrucciones de promoción de sala
• 🔐 Solo para administradores

*Nota:* El nombre puede ser parcial (ej: "Juan" encuentra "Juan Pérez")`
    : `📝 *How to use /promote*

*Promote user to cohost:*
\`/promote [MEETING_ID] [USERNAME]\`

*Example:*
\`/promote 123456789 John\`

*Features:*
• 👑 Automatic cohost promotion
• 📨 Command Chat invitation
• 🌐 Room promotion instructions
• 🔐 Admin-only command

*Note:* Name can be partial (e.g. "John" finds "John Doe")`;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Chat monitoring help
bot.onText(/\/chatwatch$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? `📝 *Uso del comando /chatwatch*

*Iniciar monitoreo de chat:*
\`/chatwatch [ID_DE_REUNION]\`

*Detener monitoreo:*
\`/chatwatch stop\`

*Detección Automática:*
• 🌐 Enlaces → Eliminación automática
• 🌀 Mensajes duplicados (2+ líneas repetidas)
• 💥 Ráfagas de spam (muchos mensajes muy rápido)
• 🚷 Violaciones → Sala de espera + alerts

*Ejemplo:*
\`/chatwatch 123456789\`

*Intervalo:* 15 segundos`
    : `📝 *How to use /chatwatch*

*Start chat monitoring:*
\`/chatwatch [MEETING_ID]\`

*Stop monitoring:*
\`/chatwatch stop\`

*Automatic Detection:*
• 🌐 Links → Automatic deletion
• 🌀 Duplicate messages (2+ repeated lines)
• 💥 Spam bursts (too many messages too fast)
• 🚷 Violations → Waiting room + alerts

*Example:*
\`/chatwatch 123456789\`

*Interval:* 15 seconds`;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command Chat management
bot.onText(/\/commandchat/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  trackCommand('/commandchat', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  if (lang === 'es') {
    const commandChatInfo = `
🔐　ＣＯＭＭＡＮＤ　ＣＨＡＴ　ＩＮＴＥＧＲＡＴＩＯＮ　☁️

*Estado del Command Chat:*
• ID del Chat: ${COMMAND_CHAT_ID ? '✅ Configurado' : '❌ No configurado'}
• Enlace: ${COMMAND_CHAT_LINK}

*Funciones del Command Chat:*
• 👑 Notificaciones de promoción a cohost
• 🚨 Alertas críticas de moderación
• 📊 Reportes de actividad en tiempo real
• 🔧 Control de sala para hosts y cohosts

*Configuración requerida:*
1. Crear grupo privado de Telegram
2. Añadir LA NUBE BOT como administrador
3. Configurar COMMAND_CHAT_ID en variables de entorno
4. Actualizar COMMAND_CHAT_LINK con enlace del grupo

*Usuarios autorizados:*
• Hosts de reuniones Zoom
• Cohosts promovidos automáticamente
• Administradores del sistema

🔐 Este es el centro de comando para gestión avanzada de las salas.
    `;
    await bot.sendMessage(chatId, commandChatInfo, { parse_mode: 'Markdown' });
  } else {
    const commandChatInfo = `
🔐　ＣＯＭＭＡＮＤ　ＣＨＡＴ　ＩＮＴＥＧＲＡＴＩＯＮ　☁️

*Command Chat Status:*
• Chat ID: ${COMMAND_CHAT_ID ? '✅ Configured' : '❌ Not configured'}
• Link: ${COMMAND_CHAT_LINK}

*Command Chat Functions:*
• 👑 Cohost promotion notifications
• 🚨 Critical moderation alerts
• 📊 Real-time activity reports
• 🔧 Room control for hosts and cohosts

*Required Setup:*
1. Create private Telegram group
2. Add LA NUBE BOT as administrator
3. Set COMMAND_CHAT_ID in environment variables
4. Update COMMAND_CHAT_LINK with group link

*Authorized Users:*
• Zoom meeting hosts
• Auto-promoted cohosts
• System administrators

🔐 This is the command center for advanced room management.
    `;
    await bot.sendMessage(chatId, commandChatInfo, { parse_mode: 'Markdown' });
  }
});

// Enhanced monitoring with Command Chat notifications
bot.onText(/\/monitor (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/monitor', userId);
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    // Notify Command Chat that monitoring started
    await notifyCommandChat(
      `🔄 *Monitoring Started*\n👤 Host: @${msg.from.username || 'admin'}\n🎯 Auto-moderation active`,
      meetingId
    );
    
    // Check if already monitoring
    if (activeMonitors.has(userId)) {
      clearInterval(activeMonitors.get(userId));
      activeMonitors.delete(userId);
      
      const message = lang === 'es'
        ? `⏹️ *Monitoreo Automático Detenido*\n\nEl monitoreo anterior ha sido detenido. Iniciando nuevo monitoreo para la reunión: \`${meetingId}\``
        : `⏹️ *Automatic Monitoring Stopped*\n\nPrevious monitoring has been stopped. Starting new monitoring for meeting: \`${meetingId}\``;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
    
    // Start continuous monitoring
    const monitorInterval = setInterval(async () => {
      try {
        const participants = await getLiveMeetingParticipants(accessToken, meetingId);
        
        if (participants.length > 0) {
          let violationsDetected = 0;
          
          // Update host chat membership
          await updateMeetingHostChat(accessToken, meetingId);
          
          // Process each participant for violations and core multipin access
          for (const participant of participants) {
            const violations = analyzeParticipantBehavior(participant);
            if (violations.length > 0) violationsDetected += violations.length;
            
            await processViolations(accessToken, meetingId, participant, violations);
            
            // Core multipin management with camera + hand raise requirements
            const multipinResult = await manageMultipinAccess(accessToken, meetingId, participant);
            if (multipinResult === 'GRANTED_SMOOTH' || multipinResult === 'TIMER_STARTED') {
              // Log multipin state changes for tracking
            }
          }
          
          // Optimize room for super smooth operation every 5th scan
          const scanCount = (activeMonitors.get(userId + '_count') || 0) + 1;
          activeMonitors.set(userId + '_count', scanCount);
          
          if (scanCount % 5 === 0) {
            const optimization = await optimizeRoomForSmoothOperation(accessToken, meetingId);
            if (optimization && optimization.smoothnessRatio < 50) {
              // Alert only if room smoothness is critically low (< 50%)
              await notifyMeetingHostChat(
                accessToken,
                meetingId,
                `⚠️ LOW ENGAGEMENT ALERT\n📊 Camera usage: ${optimization.smoothnessRatio}%\n💡 Consider encouraging camera participation`
              );
            }
          }
          
          // Log monitoring activity to Observatory
          await logToObservatory(
            `🔄 AUTO-MONITOR SCAN\n👥 Participants: ${participants.length}\n📹 With Video: ${participants.filter(p => p.video === 'on').length}\n🔇 Muted: ${participants.filter(p => p.audio === 'muted').length}\n⚠️ Violations: ${violationsDetected}`,
            userId,
            meetingId
          );
          
          // Auto-monitor continues (multipin notifications only on request)
          const activeMultipinCount = [...multipinGrants.values()].filter(status => status.granted === true).length;
          const multipinRatio = participants.length > 0 ? (activeMultipinCount / participants.length * 100).toFixed(1) : 0;
          
          // Only notify host chat for violations and significant events, not routine multipin
          if (violationsDetected > 2) {
            await notifyMeetingHostChat(
              accessToken,
              meetingId,
              `🔄 Auto-Monitor Scan\n👥 Participants: ${participants.length}\n📹 With Video: ${participants.filter(p => p.video === 'on').length}\n⚠️ Violations: ${violationsDetected} (requires attention)`
            );
          }
          
          // Notify Command Chat of significant violations
          if (violationsDetected > 3) {
            await notifyCommandChat(
              `⚠️ *High Violation Activity*\n🔍 Scan detected ${violationsDetected} violations\n👥 ${participants.length} participants\n🎯 Auto-moderation active`,
              meetingId
            );
          }
        }
      } catch (error) {
        console.error('Monitor error:', error);
        if (error.message.includes('404') || error.message.includes('not found')) {
          // Meeting ended, stop monitoring
          clearInterval(activeMonitors.get(userId));
          activeMonitors.delete(userId);
          
          // Clean up meeting host chat
          meetingHostChats.delete(meetingId);
          
          const endMessage = lang === 'es'
            ? `📴 *Monitoreo Finalizado*\n\nLa reunión ${meetingId} ha terminado. Monitoreo automático detenido.`
            : `📴 *Monitoring Ended*\n\nMeeting ${meetingId} has ended. Automatic monitoring stopped.`;
          
          await bot.sendMessage(chatId, endMessage);
          await logToObservatory(
            `📴 AUTO-MONITOR ENDED\nMeeting concluded\n🔐 Host chat disbanded`,
            userId,
            meetingId
          );
          
          await notifyCommandChat(
            `📴 *Monitoring Session Ended*\n🎯 Meeting concluded\n⏱️ Auto-monitoring stopped\n🔐 Host chat disbanded`,
            meetingId
          );
        }
      }
    }, 30000); // Monitor every 30 seconds
    
    activeMonitors.set(userId, monitorInterval);
    
    if (lang === 'es') {
      const startMessage = `
🔄 *Monitoreo Automático Iniciado*

🆔 *Reunión:* \`${meetingId}\`
⏱️ *Intervalo:* 30 segundos
🤖 *Estado:* Activo

*Características del Monitoreo:*
• ✅ Detección automática de violaciones
• ✅ Gestión automática de multipin
• ✅ Alertas a HIGH HEAT para infracciones graves
• ✅ Registro completo en NEBULOSO'S OBSERVATORY
• ✅ Remoción automática por comportamiento disruptivo
• ✅ Notificaciones al Command Chat

*Para detener:* /monitor stop
      `;
      await bot.sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
    } else {
      const startMessage = `
🔄 *Automatic Monitoring Started*

🆔 *Meeting:* \`${meetingId}\`
⏱️ *Interval:* 30 seconds  
🤖 *Status:* Active

*Monitoring Features:*
• ✅ Automatic violation detection
• ✅ Automatic multipin management
• ✅ HIGH HEAT alerts for serious violations
• ✅ Complete logging to NEBULOSO'S OBSERVATORY
• ✅ Automatic removal for disruptive behavior
• ✅ Command Chat notifications

*To stop:* /monitor stop
      `;
      await bot.sendMessage(chatId, startMessage, { parse_mode: 'Markdown' });
    }
    
    await logToObservatory(
      `🔄 AUTO-MONITOR STARTED\n👤 Host: ${userId}\n⏱️ Interval: 30s\n📨 Command Chat notified`,
      userId,
      meetingId
    );
    
  } catch (error) {
    console.error('Error starting monitor:', error);
    
    if (error.message === 'NO_TOKEN') {
      const message = lang === 'es' 
        ? '❌ No tienes una cuenta de Zoom conectada. Usa /zoomlogin para conectar tu cuenta.'
        : '❌ You don\'t have a Zoom account connected. Use /zoomlogin to connect your account.';
      await bot.sendMessage(chatId, message);
    } else {
      const message = lang === 'es'
        ? '❌ Error iniciando el monitoreo automático. Verifica que el ID de reunión sea correcto.'
        : '❌ Error starting automatic monitoring. Check that the meeting ID is correct.';
      await bot.sendMessage(chatId, message);
    }
  }
});

// Handle authorization success callback
async function handleZoomAuthSuccess(userId, tokenData) {
  try {
    // Store the access token and refresh token for future use
    const expiresAt = Date.now() + (tokenData.expires_in * 1000);
    userZoomTokens.set(userId.toString(), {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: expiresAt
    });
    
    console.log(`Zoom auth successful for user ${userId}`);
    
    // Get user profile to personalize confirmation
    try {
      const profile = await getUserProfile(tokenData.access_token);
      const lang = getUserLanguage(userId);
      const successMessage = lang === 'es' 
        ? `✅ *¡Autorización Exitosa!*

Tu cuenta de Zoom ha sido conectada exitosamente.

👋 ¡Hola ${profile.first_name}!

*Ahora puedes:*
• Gestionar reuniones de Zoom
• Monitorear participantes en tiempo real
• Crear y controlar sesiones
• Usar todas las funciones del bot

¡La NUBE BOT está listo para ayudarte!`
        : `✅ *Authorization Successful!*

Your Zoom account has been connected successfully.

👋 Hello ${profile.first_name}!

*You can now:*
• Manage Zoom meetings
• Monitor participants in real-time
• Create and control sessions
• Use all bot functions

La NUBE BOT is ready to help you!`;
      
      await bot.sendMessage(userId, successMessage, { parse_mode: 'Markdown' });
    } catch (profileError) {
      const lang = getUserLanguage(userId);
      const message = lang === 'es' 
        ? `✅ *¡Autorización Exitosa!*

Tu cuenta de Zoom ha sido conectada exitosamente.

*Ahora puedes:*
• Gestionar reuniones de Zoom  
• Monitorear participantes
• Usar todas las funciones del bot

¡La NUBE BOT está listo para ayudarte!`
        : `✅ *Authorization Successful!*

Your Zoom account has been connected successfully.

*You can now:*
• Manage Zoom meetings
• Monitor participants
• Use all bot functions

La NUBE BOT is ready to help you!`;
      await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    }
    
    await logToChannel(`User ${userId} completed Zoom authentication successfully`);
  } catch (error) {
    console.error('Error handling Zoom auth success:', error);
    await logToChannel(`Error handling successful authentication for user ${userId}: ${error.message}`);
  }
}

// Helper function to get valid access token (refresh if needed)
async function getValidZoomToken(userId) {
  const tokenData = userZoomTokens.get(userId.toString());
  if (!tokenData) {
    throw new Error('NO_TOKEN');
  }

  // Check if token is expired (with 5 minute buffer)
  if (Date.now() > (tokenData.expiresAt - 300000)) {
    try {
      const newTokenData = await refreshAccessToken(tokenData.refreshToken);
      const newExpiresAt = Date.now() + (newTokenData.expires_in * 1000);
      
      userZoomTokens.set(userId.toString(), {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || tokenData.refreshToken,
        expiresAt: newExpiresAt
      });
      
      return newTokenData.access_token;
    } catch (refreshError) {
      // Remove invalid token
      userZoomTokens.delete(userId.toString());
      throw new Error('TOKEN_REFRESH_FAILED');
    }
  }

  return tokenData.accessToken;
}

// Manejo de errores
bot.on('polling_error', (error) => {
  console.error('Error de polling de Telegram:', error);
});

process.on('SIGINT', () => {
  console.log('🛑 Deteniendo bot...');
  bot.stopPolling();
  process.exit(0);
});

// Browser Bot Command Handlers
bot.onText(/\/startbot (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const zoomLink = match[2];
  const lang = getUserLanguage(userId);
  
  trackCommand('/startbot', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  try {
    const accessToken = await getValidZoomToken(userId);
    
    const meetingData = {
      meetingId: meetingId,
      link: zoomLink,
      passcode: 'No passcode required'
    };
    
    const browserBot = await startBrowserBot(meetingId, meetingData, accessToken);
    
    if (browserBot) {
      const message = lang === 'es'
        ? `🤖 *Browser Bot Iniciado*\n\n✅ Bot activo para reunión: \`${meetingId}\`\n🎯 Multipin automático: ACTIVO\n🔄 Monitoreando cámara + mano levantada\n\n*El bot manejará automáticamente:*\n• ✅ Multipin para usuarios con cámara ON + mano\n• ⏰ Unpin tras 60s sin cámara\n• 📝 Registro completo en Observatory`
        : `🤖 *Browser Bot Started*\n\n✅ Bot active for meeting: \`${meetingId}\`\n🎯 Automatic multipin: ACTIVE\n🔄 Monitoring camera + hand raised\n\n*Bot will automatically handle:*\n• ✅ Multipin for users with camera ON + hand\n• ⏰ Unpin after 60s without camera\n• 📝 Complete Observatory logging`;
        
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
      const message = lang === 'es'
        ? '❌ Error iniciando browser bot. Verifica el enlace de Zoom.'
        : '❌ Error starting browser bot. Check the Zoom link.';
      await bot.sendMessage(chatId, message);
    }
  } catch (error) {
    console.error('Error starting browser bot:', error);
    const message = lang === 'es'
      ? '❌ Error iniciando browser bot.'
      : '❌ Error starting browser bot.';
    await bot.sendMessage(chatId, message);
  }
});

bot.onText(/\/stopbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const meetingId = match[1];
  const lang = getUserLanguage(userId);
  
  trackCommand('/stopbot', userId);
  
  if (!isAdmin(userId)) {
    const message = lang === 'es'
      ? '❌ Este comando es solo para administradores.'
      : '❌ This command is admin-only.';
    await bot.sendMessage(chatId, message);
    return;
  }
  
  try {
    await stopBrowserBot(meetingId);
    
    const message = lang === 'es'
      ? `🔚 *Browser Bot Detenido*\n\n✅ Bot detenido para reunión: \`${meetingId}\`\n❌ Multipin automático: DESACTIVADO\n🧹 Recursos limpiados exitosamente`
      : `🔚 *Browser Bot Stopped*\n\n✅ Bot stopped for meeting: \`${meetingId}\`\n❌ Automatic multipin: DEACTIVATED\n🧹 Resources cleaned up successfully`;
      
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error stopping browser bot:', error);
    const message = lang === 'es'
      ? '❌ Error deteniendo browser bot.'
      : '❌ Error stopping browser bot.';
    await bot.sendMessage(chatId, message);
  }
});

bot.onText(/\/botstatus/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  trackCommand('/botstatus', userId);
  
  const activeBots = [...activeBrowserBots.entries()];
  
  if (activeBots.length === 0) {
    const message = lang === 'es'
      ? '📊 *Estado Browser Bots*\n\n❌ No hay browser bots activos\n\nUsa `/startbot [meeting_id] [zoom_link]` para iniciar uno.'
      : '📊 *Browser Bots Status*\n\n❌ No active browser bots\n\nUse `/startbot [meeting_id] [zoom_link]` to start one.';
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return;
  }
  
  const botList = activeBots.map(([meetingId, bot]) => {
    const status = bot.isReady() ? '✅ Activo' : '⚠️ Error';
    const statusEn = bot.isReady() ? '✅ Active' : '⚠️ Error';
    return lang === 'es' 
      ? `• Reunión: \`${meetingId}\`\n  Estado: ${status}\n  Bot: ${bot.botName}\n  Conectado: ${bot.isConnected ? 'Sí' : 'No'}`
      : `• Meeting: \`${meetingId}\`\n  Status: ${statusEn}\n  Bot: ${bot.botName}\n  Connected: ${bot.isConnected ? 'Yes' : 'No'}`;
  }).join('\n\n');
  
  const message = lang === 'es'
    ? `📊 *Estado Browser Bots*\n\n🤖 Bots activos: ${activeBots.length}\n\n${botList}\n\n*Comandos:*\n• \`/stopbot [meeting_id]\` - Detener bot específico`
    : `📊 *Browser Bots Status*\n\n🤖 Active bots: ${activeBots.length}\n\n${botList}\n\n*Commands:*\n• \`/stopbot [meeting_id]\` - Stop specific bot`;
    
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Browser bot help commands
bot.onText(/\/startbot$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? `📝 *Uso del comando /startbot*

*Iniciar browser bot para automatización:*
\`/startbot [ID_REUNION] [ENLACE_ZOOM]\`

*Ejemplo:*
\`/startbot 123456789 https://zoom.us/j/123456789\`

*Automatización Incluida:*
• 🎯 Multipin automático (cámara ON + mano levantada)
• ⏰ Unpin automático tras 60s sin cámara
• 🔄 Monitoreo continuo en tiempo real
• 📝 Registro completo en Observatory
• 🤖 Navegador headless con Puppeteer

*Requisitos:*
• ✅ Permisos de administrador
• ✅ Cuenta Zoom conectada
• ✅ Reunión activa

*Otros comandos:*
• \`/stopbot [ID_REUNION]\` - Detener bot
• \`/botstatus\` - Ver estado de todos los bots`
    : `📝 *How to use /startbot*

*Start browser bot for automation:*
\`/startbot [MEETING_ID] [ZOOM_LINK]\`

*Example:*
\`/startbot 123456789 https://zoom.us/j/123456789\`

*Included Automation:*
• 🎯 Automatic multipin (camera ON + hand raised)
• ⏰ Auto-unpin after 60s without camera
• 🔄 Continuous real-time monitoring
• 📝 Complete Observatory logging
• 🤖 Headless browser with Puppeteer

*Requirements:*
• ✅ Administrator permissions
• ✅ Zoom account connected
• ✅ Active meeting

*Other commands:*
• \`/stopbot [MEETING_ID]\` - Stop bot
• \`/botstatus\` - View all bot status`;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/stopbot$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getUserLanguage(userId);
  
  const message = lang === 'es'
    ? `📝 *Uso del comando /stopbot*

*Detener browser bot específico:*
\`/stopbot [ID_REUNION]\`

*Ejemplo:*
\`/stopbot 123456789\`

*Al detener se:*
• 🔚 Cierra navegador automáticamente
• 📊 Guarda logs en Observatory
• 🧹 Limpia recursos del sistema
• ❌ Desactiva multipin automático

*Ver bots activos:*
\`/botstatus\` - Lista todos los bots corriendo

*Nota:* Solo administradores pueden usar este comando.`
    : `📝 *How to use /stopbot*

*Stop specific browser bot:*
\`/stopbot [MEETING_ID]\`

*Example:*
\`/stopbot 123456789\`

*When stopping:*
• 🔚 Closes browser automatically
• 📊 Saves logs to Observatory
• 🧹 Cleans up system resources
• ❌ Disables automatic multipin

*View active bots:*
\`/botstatus\` - Lists all running bots

*Note:* Only administrators can use this command.`;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Documentation command
bot.onText(/\/docs(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const docType = match[1].trim();
  
  trackCommand('/docs', userId);
  
  const lang = getUserLanguage(userId);
  
  // Base GitHub URLs for documentation
  const baseUrl = 'https://github.com/PupFr/Nebulosa/blob/main/docs/';
  const docs = {
    setup: `${baseUrl}setup-guide.md`,
    oauth: `${baseUrl}github-oauth-setup.md`,
    multipin: `${baseUrl}multipin-automation.md`,
    shortio: `${baseUrl}shortio-setup.md`,
    all: 'https://github.com/PupFr/Nebulosa/tree/main/docs'
  };
  
  try {
    let message, targetUrl;
    
    if (docType === 'setup' || docType === 'configuracion') {
      targetUrl = docs.setup;
      message = lang === 'es' 
        ? '📋 **Guía de Configuración**\n\nAccede a la documentación completa de configuración:'
        : '📋 **Setup Guide**\n\nAccess the complete setup documentation:';
    } else if (docType === 'oauth') {
      targetUrl = docs.oauth;
      message = lang === 'es'
        ? '🔐 **Configuración OAuth**\n\nGuía para configurar OAuth con GitHub:'
        : '🔐 **OAuth Setup**\n\nGuide to configure OAuth with GitHub:';
    } else if (docType === 'multipin') {
      targetUrl = docs.multipin;
      message = lang === 'es'
        ? '📌 **Automatización Multipin**\n\nDocumentación del sistema de multipin automático:'
        : '📌 **Multipin Automation**\n\nAutomatic multipin system documentation:';
    } else if (docType === 'shortio') {
      targetUrl = docs.shortio;
      message = lang === 'es'
        ? '🔗 **Configuración Short.io**\n\nGuía para configurar enlaces cortos:'
        : '🔗 **Short.io Setup**\n\nGuide to configure short links:';
    } else {
      // Show all documentation
      targetUrl = docs.all;
      message = lang === 'es'
        ? `📚 **Documentación Completa**

🔗 **Enlaces de documentación disponibles:**

📋 \`/docs setup\` - Guía de configuración
🔐 \`/docs oauth\` - Configuración OAuth  
📌 \`/docs multipin\` - Automatización multipin
🔗 \`/docs shortio\` - Configuración Short.io

📖 **Documentación completa en GitHub:**`
        : `📚 **Complete Documentation**

🔗 **Available documentation links:**

📋 \`/docs setup\` - Setup guide
🔐 \`/docs oauth\` - OAuth configuration
📌 \`/docs multipin\` - Multipin automation  
🔗 \`/docs shortio\` - Short.io setup

📖 **Complete documentation on GitHub:**`;
    }
    
    // Use GitHub URL directly (no shortening for docs)
    message += `\n\n🌐 ${targetUrl}`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error in /docs command:', error);
    const errorMsg = lang === 'es'
      ? '❌ Error al generar enlace de documentación. Intenta más tarde.'
      : '❌ Error generating documentation link. Try again later.';
    await bot.sendMessage(chatId, errorMsg);
  }
});

// Add test mode commands
console.log('🤖 La NUBE BOT iniciado y escuchando comandos...');

// ─── Sticker Draft Commands ───────────────────────────────────────────────────

// /mydrafts — show drafts pending review
bot.onText(/\/mydrafts/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  trackCommand('/mydrafts', userId);
  runStickerCleanup();

  const drafts = getUserDraftsByStatus(userId, 'draft');

  if (drafts.length === 0) {
    return bot.sendMessage(chatId,
      `📂 *Your Draft Vault*\n\nNo pending drafts found.\n\nSend a photo or sticker to create your first draft!`,
      { parse_mode: 'Markdown' }
    );
  }

  const list = drafts.map((d, i) => formatDraftEntry(d, i)).join('\n\n');

  await bot.sendMessage(chatId,
    `📂 *Your Draft Vault* (${drafts.length} pending)\n\n${list}\n\nUse the buttons on each draft message to Approve, Retry, Reject, or Save for Later.`,
    { parse_mode: 'Markdown' }
  );
});

// /myapproved — show approved stickers
bot.onText(/\/myapproved/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  trackCommand('/myapproved', userId);

  const approved = getUserDraftsByStatus(userId, 'approved');
  const published = getUserDraftsByStatus(userId, 'published');
  const all = [...approved, ...published];

  if (all.length === 0) {
    return bot.sendMessage(chatId,
      `✅ *Approved Collection*\n\nNo approved stickers yet.\n\nApprove a draft from /mydrafts to build your collection!`,
      { parse_mode: 'Markdown' }
    );
  }

  const list = all.map((d, i) => formatDraftEntry(d, i)).join('\n\n');

  await bot.sendMessage(chatId,
    `✅ *Approved Collection* (${all.length} sticker${all.length !== 1 ? 's' : ''})\n\n${list}\n\nUse /publish to add approved stickers to your final Telegram sticker set.`,
    { parse_mode: 'Markdown' }
  );
});

// /trash — show rejected/expired stickers
bot.onText(/\/trash/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  trackCommand('/trash', userId);
  runStickerCleanup();

  const rejected = getUserDraftsByStatus(userId, 'rejected');
  const expired = getUserDraftsByStatus(userId, 'expired');
  const all = [...rejected, ...expired];

  if (all.length === 0) {
    return bot.sendMessage(chatId,
      `🗑 *Trash*\n\nYour trash is empty. Rejected and expired drafts appear here.`,
      { parse_mode: 'Markdown' }
    );
  }

  const list = all.map((d, i) => formatDraftEntry(d, i)).join('\n\n');

  await bot.sendMessage(chatId,
    `🗑 *Trash* (${all.length} item${all.length !== 1 ? 's' : ''})\n\n${list}\n\nThese drafts will be automatically cleaned up soon.`,
    { parse_mode: 'Markdown' }
  );
});

// /publish — publish an approved sticker to the collection
bot.onText(/\/publish(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const draftId = match[1].trim();

  trackCommand('/publish', userId);

  if (!draftId) {
    const approved = getUserDraftsByStatus(userId, 'approved');
    if (approved.length === 0) {
      return bot.sendMessage(chatId,
        `🌟 *Publish Sticker*\n\nNo approved stickers available to publish.\n\nFirst approve a draft via /mydrafts, then use:\n\`/publish <draft_id>\``,
        { parse_mode: 'Markdown' }
      );
    }
    const list = approved.map((d, i) => formatDraftEntry(d, i)).join('\n\n');
    return bot.sendMessage(chatId,
      `🌟 *Publish Sticker*\n\nYour approved stickers:\n\n${list}\n\nTo publish, use:\n\`/publish <draft_id>\``,
      { parse_mode: 'Markdown' }
    );
  }

  const draft = stickerDrafts.get(draftId);
  if (!draft) {
    return bot.sendMessage(chatId, `❌ Draft \`${draftId}\` not found.`, { parse_mode: 'Markdown' });
  }
  if (draft.userId !== userId) {
    return bot.sendMessage(chatId, `🚫 You do not own this draft.`);
  }
  const publishError = assertDraftPublishable(draft);
  if (publishError) {
    return bot.sendMessage(chatId,
      `⚠️ ${publishError}\nCurrent status: ${formatDraftStatus(draft.status)}`,
      { parse_mode: 'Markdown' }
    );
  }

  updateDraftStatus(draftId, 'published');
  await bot.sendMessage(chatId,
    `🌟 *Sticker published!*\n\nDraft ID: \`${draftId}\`\nStatus: ${formatDraftStatus('published')}\n\nYour sticker is now part of your approved collection and ready for your Telegram sticker set.`,
    { parse_mode: 'Markdown' }
  );
  await logToChannel(`User ${userId} published sticker draft ${draftId}`, userId);
});

module.exports = { bot, handleZoomAuthSuccess, resolveOAuthState, botMetrics, activeSessions };