// configs/whatsapp.js
const { Client, LocalAuth, MessageMedia, Location, Contact, Poll, Buttons, List } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const Message = require("../models/Message");
const User = require("../models/User");
const WhatsAppAccount = require("../models/WhatsAppAccount");
const { normalizeNumber, formatNumber } = require("../utils/numberFormatter");

// Global client storage and session management
const clients = new Map();
const sessionToUserId = new Map();
const sessionToAppUserId = new Map();
const sessionConnectResult = new Map();
const clientStatus = new Map(); // Track client connection status

// Configuration constants
const SESSION_TIMEOUT = 60000; // 1 minute
const QR_TIMEOUT = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Link a QR session to the logged-in app user's MongoDB _id
 */
function linkAppUserToSession(sessionId, appUserId) {
  if (!sessionId || !appUserId) {
    console.warn("⚠️ Invalid sessionId or appUserId provided to linkAppUserToSession");
    return;
  }
  sessionToAppUserId.set(sessionId, String(appUserId));
  console.log(`🔗 Linked session ${sessionId} to app user ${appUserId}`);
}

/**
 * Enhanced client creation with better error handling and modern features
 */
function createClient(sessionId) {
  console.log(`🚀 Creating new WhatsApp client for session: ${sessionId}`);
  
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: "./sessions",
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--window-size=1920,1080",
      ],
      timeout: SESSION_TIMEOUT,
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
  });

  // Set initial client status
  clientStatus.set(sessionId, { status: 'initializing', lastActivity: Date.now() });

  // QR Code generation event
  client.on("qr", async (qr) => {
    try {
      console.log(`📱 QR Code generated for session: ${sessionId}`);
      const qrCodeUrl = await qrcode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
      
      // Update client data
      clients.set(sessionId, {
        client,
        qrCodeUrl,
        isAuthenticated: false,
        userId: null,
        qrGeneratedAt: Date.now(),
        status: 'qr_generated'
      });

      // Update client status
      clientStatus.set(sessionId, { 
        status: 'qr_generated', 
        lastActivity: Date.now(),
        qrCode: qrCodeUrl 
      });

      // Persist QR status in database
      await updateWhatsAppAccountQRStatus(sessionId, qrCodeUrl, "pending");
      
    } catch (err) {
      console.error(`❌ Error generating QR code for session ${sessionId}:`, err);
      clients.set(sessionId, {
        client,
        qrCodeUrl: null,
        isAuthenticated: false,
        userId: null,
        qrGeneratedAt: null,
        status: 'error'
      });
      clientStatus.set(sessionId, { status: 'error', lastActivity: Date.now(), error: err.message });
    }
  });

  // Authentication success event
  client.on("authenticated", async () => {
    console.log(`✅ Session ${sessionId} authenticated with WhatsApp`);
    
    const clientData = clients.get(sessionId);
    if (clientData) {
      clients.set(sessionId, {
        ...clientData,
        isAuthenticated: true,
        status: 'authenticated'
      });
    }

    clientStatus.set(sessionId, { status: 'authenticated', lastActivity: Date.now() });
    await updateWhatsAppAccountQRStatus(sessionId, null, "scanned");
  });

  // Client ready event - most important for functionality
  client.on("ready", async () => {
    try {
      const userId = client.info.wid._serialized.replace("@c.us", "");
      console.log(`🚀 WhatsApp Client Ready for user: ${userId}`);
      console.log(`📱 Device: ${client.info.platform} - ${client.info.pushname}`);

      // Clean up any existing session for this user
      await cleanupExistingSession(userId);

      // Store client with normalized userId
      clients.set(userId, {
        client,
        qrCodeUrl: null,
        isAuthenticated: true,
        userId,
        qrGeneratedAt: null,
        status: 'ready',
        info: {
          pushname: client.info.pushname,
          platform: client.info.platform,
          phone: client.info.wid.user
        }
      });

      // Update mappings
      sessionToUserId.set(sessionId, userId);
      clientStatus.set(userId, { 
        status: 'ready', 
        lastActivity: Date.now(),
        info: client.info 
      });

      // Clean up temporary sessionId entry
      if (clients.has(sessionId)) {
        clients.delete(sessionId);
      }

      // Update database with connection info
      await finalizeWhatsAppAccountConnection(sessionId, userId, client.info);

    } catch (err) {
      console.error(`❌ Error in ready event for session ${sessionId}:`, err);
      clientStatus.set(sessionId, { status: 'error', lastActivity: Date.now(), error: err.message });
    }
  });

  // Enhanced message handling with better data extraction
  client.on("message", async (msg) => {
    try {
      const userId = sessionToUserId.get(sessionId) || client.info?.wid?.user;
      if (!userId) return;

      // Extract comprehensive message data
      const messageData = await extractMessageData(msg, userId, client);
      
      // Save to database
      const incoming = new Message(messageData);
      await incoming.save();
      
      console.log(`📩 New ${msg.type} message saved for user ${userId}`);
      
      // Update last activity
      clientStatus.set(userId, { 
        ...clientStatus.get(userId), 
        lastActivity: Date.now() 
      });

    } catch (err) {
      console.error(`❌ Failed to save incoming message for session ${sessionId}:`, err);
    }
  });

  // Message acknowledgment updates
  client.on("message_ack", async (msg, ack) => {
    try {
      const statusMap = {
        1: "sent",
        2: "delivered", 
        3: "read"
      };
      
      await Message.updateOne(
        { messageId: msg.id._serialized },
        { status: statusMap[ack] || "unknown" }
      );
      
    } catch (err) {
      console.error(`❌ Failed to update message ack:`, err);
    }
  });

  // Group join/leave events
  client.on("group_join", async (notification) => {
    console.log(`👥 User joined group: ${notification.chatId}`);
  });

  client.on("group_leave", async (notification) => {
    console.log(`👥 User left group: ${notification.chatId}`);
  });

  // Connection state changes
  client.on("change_state", (state) => {
    console.log(`🔄 Client state changed to: ${state}`);
    const userId = sessionToUserId.get(sessionId);
    if (userId) {
      clientStatus.set(userId, { 
        ...clientStatus.get(userId), 
        connectionState: state,
        lastActivity: Date.now() 
      });
    }
  });

  // Disconnection handling with cleanup
  client.on("disconnected", async (reason) => {
    const userId = sessionToUserId.get(sessionId) || client.info?.wid?.user;
    console.log(`⚠️ Client disconnected - User: ${userId || sessionId}, Reason: ${reason}`);
    
    try {
      // Update database status
      await updateWhatsAppAccountQRStatus(sessionId, null, "failed");
      
      // Clean up all references
      await cleanupClientReferences(sessionId, userId);
      
    } catch (err) {
      console.error(`❌ Error during disconnection cleanup:`, err);
    }
  });

  // Authentication failure
  client.on("auth_failure", async (msg) => {
    console.error(`❌ Authentication failed for session ${sessionId}:`, msg);
    clientStatus.set(sessionId, { status: 'auth_failed', lastActivity: Date.now(), error: msg });
    await updateWhatsAppAccountQRStatus(sessionId, null, "failed");
  });

  // Initialize the client
  client.initialize().catch(err => {
    console.error(`❌ Failed to initialize client for session ${sessionId}:`, err);
    clientStatus.set(sessionId, { status: 'init_failed', lastActivity: Date.now(), error: err.message });
  });

  return client;
}

/**
 * Helper function to extract comprehensive message data
 */
async function extractMessageData(msg, userId, client) {
  const baseData = {
    userId,
    from: normalizeNumber(msg.from),
    to: normalizeNumber(msg.to || client.info.wid._serialized),
    body: msg.body || "",
    type: msg.type,
    direction: msg.fromMe ? "out" : "in",
    status: "received",
    messageId: msg.id._serialized,
    timestamp: new Date(msg.timestamp * 1000),
    isForwarded: msg.isForwarded || false,
    isStarred: msg.isStarred || false
  };

  // Handle quoted messages
  if (msg.hasQuotedMsg) {
    try {
      const quotedMsg = await msg.getQuotedMessage();
      baseData.quotedMessageId = quotedMsg.id._serialized;
    } catch (err) {
      console.warn("Failed to get quoted message:", err);
    }
  }

  // Handle location messages
  if (msg.type === "location" && msg.location) {
    baseData.latitude = msg.location.latitude;
    baseData.longitude = msg.location.longitude;
    baseData.locationDescription = msg.location.description;
  }

  // Handle contact messages
  if (msg.type === "contact" && msg.vCards) {
    baseData.contactName = msg.vCards[0]?.displayName;
    baseData.contactNumber = msg.vCards[0]?.waid;
  }

  // Handle media messages
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        baseData.mediaType = media.mimetype;
        baseData.fileName = media.filename;
        // Note: In production, you'd want to save the media file and store the path
        // baseData.mediaUrl = await saveMediaFile(media, msg.id._serialized);
      }
    } catch (err) {
      console.warn("Failed to download media:", err);
    }
  }

  return baseData;
}

/**
 * Helper function to update WhatsApp account QR status
 */
async function updateWhatsAppAccountQRStatus(sessionId, qrCodeUrl, status) {
  try {
    const appUserId = sessionToAppUserId.get(sessionId);
    if (!appUserId) return;

    await WhatsAppAccount.findOneAndUpdate(
      { user: appUserId, number: null },
      { 
        user: appUserId, 
        qrCode: qrCodeUrl, 
        qrStatus: status,
        lastSeen: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error(`❌ Failed to update QR status for session ${sessionId}:`, err);
  }
}

/**
 * Helper function to finalize WhatsApp account connection
 */
async function finalizeWhatsAppAccountConnection(sessionId, userId, clientInfo) {
  try {
    const appUserId = sessionToAppUserId.get(sessionId);
    if (!appUserId) {
      console.log(`ℹ️ No app user linked to session ${sessionId}; skipping WhatsAppAccount persist`);
      return;
    }

    const name = clientInfo.pushname || null;
    const number = clientInfo.wid.user;

    // Find existing placeholder or create new
    let existing = await WhatsAppAccount.findOne({
      user: appUserId,
      number: null,
    });
    
    const updatedExisting = !!existing;
    if (!existing) {
      existing = await WhatsAppAccount.findOne({ user: appUserId, number });
    }

    if (existing) {
      existing.name = name;
      existing.number = number;
      existing.qrStatus = "authenticated";
      existing.qrCode = null;
      existing.isActive = true;
      existing.lastSeen = new Date();
      existing.sessionData = {
        platform: clientInfo.platform,
        pushname: clientInfo.pushname
      };
      await existing.save();
      console.log(`✅ Updated WhatsApp profile for app user ${appUserId}`);
    } else {
      await WhatsAppAccount.create({
        user: appUserId,
        name,
        number,
        qrStatus: "authenticated",
        qrCode: null,
        isActive: true,
        lastSeen: new Date(),
        sessionData: {
          platform: clientInfo.platform,
          pushname: clientInfo.pushname
        }
      });
      console.log(`✅ Created WhatsApp profile for app user ${appUserId}`);
    }

    // Store connection result
    sessionConnectResult.set(sessionId, {
      status: "connected",
      message: updatedExisting
        ? "WhatsApp account connected (updated)"
        : "WhatsApp account connected",
      number,
      name,
      userId,
    });

  } catch (err) {
    console.error(`❌ Failed to finalize WhatsApp account for session ${sessionId}:`, err);
  } finally {
    // Clear the mapping once processed
    sessionToAppUserId.delete(sessionId);
  }
}

/**
 * Helper function to clean up existing sessions
 */
async function cleanupExistingSession(userId) {
  if (clients.has(userId)) {
    console.log(`📌 Cleaning up existing session for user ${userId}`);
    try {
      const existingClient = clients.get(userId);
      if (existingClient?.client) {
        await existingClient.client.destroy();
      }
    } catch (err) {
      console.warn(`⚠️ Failed to destroy old client for ${userId}:`, err.message);
    }
    clients.delete(userId);
  }
}

/**
 * Helper function to clean up client references
 */
async function cleanupClientReferences(sessionId, userId) {
  // Clean up maps
  clients.delete(sessionId);
  if (userId) clients.delete(userId);
  sessionToUserId.delete(sessionId);
  sessionToAppUserId.delete(sessionId);
  clientStatus.delete(sessionId);
  if (userId) clientStatus.delete(userId);
  
  // Update database
  if (userId) {
    try {
      await WhatsAppAccount.updateMany(
        { number: userId },
        { isActive: false, lastSeen: new Date() }
      );
    } catch (err) {
      console.error("Failed to update account status:", err);
    }
  }
}

/**
 * Get or create a client for a session
 */
function getOrCreateClient(sessionId) {
  let clientData = clients.get(sessionId);
  if (!clientData) {
    console.log(`🔄 Creating new client for session: ${sessionId}`);
    const client = createClient(sessionId);
    clientData = {
      client,
      qrCodeUrl: null,
      isAuthenticated: false,
      userId: null,
      qrGeneratedAt: null,
      status: 'creating'
    };
    clients.set(sessionId, clientData);
  }
  return clientData;
}

/**
 * Get client by user ID with enhanced lookup
 */
function getClientByUserId(userId) {
  const key = userId.replace("@c.us", "");
  const clientData = clients.get(key);
  
  if (!clientData) {
    console.warn(`⚠️ No client found for userId: ${key}`);
    console.log("📋 Available clients:", Array.from(clients.keys()));
    return null;
  }
  
  // Check if client is still connected
  if (clientData.client && clientData.isAuthenticated) {
    return clientData;
  }
  
  console.warn(`⚠️ Client found but not authenticated for userId: ${key}`);
  return null;
}

/**
 * Get latest QR code without waiting
 */
function getLatestQr(sessionId) {
  const mappedUserId = sessionToUserId.get(sessionId);

  if (mappedUserId) {
    const clientData = clients.get(mappedUserId);
    if (clientData && clientData.isAuthenticated) {
      return {
        qr: null,
        authenticated: true,
        userId: mappedUserId,
        qrGeneratedAt: null,
        status: 'authenticated'
      };
    }
  }

  const clientData = getOrCreateClient(sessionId);
  const status = clientStatus.get(sessionId);

  return {
    qr: clientData.qrCodeUrl || null,
    authenticated: !!clientData.isAuthenticated && !!clientData.userId,
    userId: clientData.userId || null,
    qrGeneratedAt: clientData.qrGeneratedAt || null,
    status: status?.status || 'unknown'
  };
}

/**
 * Get QR code with timeout and retry logic
 */
const getQr = async (sessionId, timeout = QR_TIMEOUT) => {
  const userId = sessionToUserId.get(sessionId);
  
  // Check if already authenticated
  if (userId) {
    const clientData = getClientByUserId(userId);
    if (clientData && clientData.isAuthenticated) {
      console.log(`📌 Found authenticated client for sessionId ${sessionId} with userId ${userId}`);
      return { qr: null, authenticated: true, userId, status: 'authenticated' };
    }
  }

  const clientData = getOrCreateClient(sessionId);
  
  // If already authenticated
  if (clientData.isAuthenticated && clientData.userId) {
    console.log(`📌 Client already authenticated for sessionId ${sessionId} with userId ${clientData.userId}`);
    return { qr: null, authenticated: true, userId: clientData.userId, status: 'authenticated' };
  }

  // Wait for QR if not available
  if (!clientData.qrCodeUrl) {
    console.log(`📌 Waiting for QR code for sessionId ${sessionId}`);
    
    let attempts = 0;
    while (attempts < MAX_RETRY_ATTEMPTS && !clientData.qrCodeUrl) {
      await new Promise((resolve) => setTimeout(resolve, timeout / MAX_RETRY_ATTEMPTS));
      attempts++;
      
      const updatedClientData = clients.get(sessionId);
      if (updatedClientData?.qrCodeUrl) {
        return {
          qr: updatedClientData.qrCodeUrl,
          authenticated: false,
          userId: null,
          status: 'qr_ready'
        };
      }
    }
    
    // If still no QR after retries
    return {
      qr: null,
      authenticated: false,
      userId: null,
      status: 'timeout',
      error: 'QR generation timeout'
    };
  }

  return { 
    qr: clientData.qrCodeUrl, 
    authenticated: false, 
    userId: null,
    status: 'qr_ready'
  };
};

/**
 * Enhanced logout with proper cleanup
 */
const logout = async (userId) => {
  const clientData = clients.get(userId);
  if (!clientData) {
    throw new Error(`No client found for user ${userId}`);
  }
  
  if (!clientData.isAuthenticated) {
    throw new Error(`User ${userId} is not logged in`);
  }
  
  try {
    console.log(`👋 Logging out user ${userId}`);
    
    // Logout from WhatsApp
    await clientData.client.logout();
    
    // Update database
    await WhatsAppAccount.updateMany(
      { number: userId },
      { 
        isActive: false, 
        lastSeen: new Date(),
        qrStatus: "disconnected"
      }
    );
    
    // Clean up references
    await cleanupClientReferences(null, userId);
    
    console.log(`✅ User ${userId} logged out successfully`);
    
  } catch (err) {
    console.error(`❌ Logout failed for user ${userId}:`, err);
    throw new Error(`Logout failed: ${err.message}`);
  }
};

/**
 * Get messages for a user with pagination
 */
const getMessages = async (userId, options = {}) => {
  const { limit = 50, skip = 0, sort = { timestamp: -1 } } = options;
  
  try {
    return await Message.find({ userId })
      .sort(sort)
      .limit(limit)
      .skip(skip)
      .lean();
  } catch (err) {
    console.error(`❌ Failed to get messages for user ${userId}:`, err);
    throw new Error(`Failed to retrieve messages: ${err.message}`);
  }
};

/**
 * Resolve user ID from session with status
 */
function resolveUserIdFromSession(sessionId) {
  const userId = sessionToUserId.get(sessionId) || null;
  const clientData = userId ? clients.get(userId) : clients.get(sessionId);
  const status = clientStatus.get(sessionId) || clientStatus.get(userId);
  
  return { 
    userId, 
    clientData,
    status: status?.status || 'unknown',
    lastActivity: status?.lastActivity || null
  };
}

/**
 * Get session connection result
 */
function getSessionConnectResult(sessionId, { clear = true } = {}) {
  const result = sessionConnectResult.get(sessionId) || null;
  if (clear && result) {
    sessionConnectResult.delete(sessionId);
  }
  return result;
}

/**
 * Get client status information
 */
function getClientStatus(identifier) {
  return clientStatus.get(identifier) || { status: 'not_found' };
}

/**
 * Get all active clients
 */
function getActiveClients() {
  const activeClients = [];
  for (const [key, clientData] of clients.entries()) {
    if (clientData.isAuthenticated && clientData.client) {
      activeClients.push({
        userId: key,
        status: clientData.status,
        info: clientData.info,
        lastActivity: clientStatus.get(key)?.lastActivity
      });
    }
  }
  return activeClients;
}

/**
 * Cleanup inactive sessions (utility function)
 */
function cleanupInactiveSessions() {
  const now = Date.now();
  const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, status] of clientStatus.entries()) {
    if (now - status.lastActivity > INACTIVE_THRESHOLD) {
      console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
      const userId = sessionToUserId.get(sessionId);
      cleanupClientReferences(sessionId, userId);
    }
  }
}

// Periodic cleanup of inactive sessions
setInterval(cleanupInactiveSessions, 60 * 60 * 1000); // Run every hour

module.exports = {
  // Core functions
  getOrCreateClient,
  getClientByUserId,
  getQr,
  getLatestQr,
  logout,
  getMessages,
  
  // Session management
  resolveUserIdFromSession,
  linkAppUserToSession,
  getSessionConnectResult,
  
  // Status and monitoring
  getClientStatus,
  getActiveClients,
  
  // Utilities
  cleanupInactiveSessions,
  
  // Constants
  SESSION_TIMEOUT,
  QR_TIMEOUT,
  MAX_RETRY_ATTEMPTS
};
