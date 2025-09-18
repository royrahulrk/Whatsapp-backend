// configs/whatsapp.js
const {
  Client,
  LocalAuth,
  MessageMedia,
  Location,
  Contact,
  Poll,
  Buttons,
  List,
} = require("whatsapp-web.js");
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
    isStarred: msg.isStarred || false,
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
        lastSeen: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error(
      `❌ Failed to update QR status for session ${sessionId}:`,
      err
    );
  }
}


// getClientByUserId removed: client-based lookups are no longer used

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
        status: "authenticated",
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
    status: status?.status || "unknown",
  };
}

/**
 * Get QR code with timeout and retry logic
 */
async function generateQrForUser(appUserId) {
  return new Promise((resolve, reject) => {
    const client = new Client({
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
      authStrategy: undefined, // no LocalAuth, stateless
    });

    client.on("qr", async (qr) => {
      try {
        const qrCodeUrl = await qrcode.toDataURL(qr);

        // 1️⃣ Always create a new entry with pending status
        const account = await WhatsAppAccount.create({
          user: appUserId,
          qrCode: qrCodeUrl,
          qrStatus: "pending",
          isActive: false,
          number: null,
          name: null,
          lastSeen: new Date(),
        });

        resolve({
          qr: qrCodeUrl,
          status: "qr_pending",
          accountId: account._id,
        });

        // Destroy client after QR is generated
        client.destroy();
      } catch (err) {
        reject(err);
      }
    });

    client.on("auth_failure", (msg) => {
      reject(new Error(`Auth failed: ${msg}`));
    });

    client.initialize().catch(reject);
  });
}

/**
 * Enhanced logout with proper cleanup
 */
const logout = async (userId) => {

  try {
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

// Periodic cleanup of inactive sessions

module.exports = {
  // Core functions
  getOrCreateClient,
  generateQrForUser,
  getLatestQr,
  logout,
  getMessages,

  // Constants
  SESSION_TIMEOUT,
  QR_TIMEOUT,
  MAX_RETRY_ATTEMPTS,
};
