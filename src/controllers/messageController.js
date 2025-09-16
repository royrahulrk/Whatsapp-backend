const { getQr, getLatestQr, logout, getMessages, getOrCreateClient, getClientByUserId, linkAppUserToSession, getSessionConnectResult, resolveUserIdFromSession } = require("../configs/whatsapp");
const User = require("../models/User");
const { SendMessage,sendAttachment,sendLocation,broadcastMessage,getGroupIds,sendBulkMessages } = require("../services/messageService");
const Message = require("../models/Message");
const { normalizeNumber,formatNumber } = require("../utils/numberFormatter");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");



const getQrCode = async (req, res) => {
  try {
    // Always generate a fresh WhatsApp QR session per request
    const newQrSessionId = uuidv4();
    req.session.sessionId = newQrSessionId;
    await new Promise((r) => req.session.save(r));

    // Require user _id, prefer body; fallback to query or existing auth context
    const providedId = req.body?._id || req.query?._id || req.user?._id || req.session?.authUserId;
    if (!providedId) return res.error("_id is required", 400);

    try {
      const exists = await User.exists({ _id: providedId });
      if (!exists) return res.error("User not found", 404);
      // Link app user -> this fresh QR session so we can persist on 'ready'
      linkAppUserToSession(newQrSessionId, providedId);
    } catch (e) {
      console.error("/api/qr user lookup error:", e);
      return res.error("Failed to verify user", 500);
    }

    // Kick off client immediately and wait briefly for QR
    const { qr } = await getQr(newQrSessionId);
    if (!qr) return res.error("QR not ready, try again", 503);

    // Return PNG bytes
    const base64Data = qr.replace(/^data:image\/png;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, "base64");
    res.set("Content-Type", "image/png");
    // Prevent caching so QR stays fresh
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.send(imgBuffer);
  } catch (err) {
    console.error("❌ Failed to generate/fetch QR:", err);
    return res.error("Failed to generate QR code", 500);
  }
};

// Report QR status for a specific account/session
// Accepts: query/body params
// - userId: Mongo _id of the app user
// - accountId: identifier of the WA account (matches whatsappuser.clientId or whatsappuser.number)
// - sessionId: temp QR session id (during pending)
const getQrStatus = async (req, res) => {
  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const { userId: userIdParam, accountId, sessionId: sessionIdParam } = params;
    const cookieSessionId = req.session?.sessionId;

    // Prefer explicit sessionId, else cookieSessionId
    const sessionId = sessionIdParam || cookieSessionId || null;

    // If identifiers are not provided, fallback to legacy behavior
    if (!userIdParam && !accountId && !sessionId) {
      const legacySessionId = req.session.sessionId;
      if (!legacySessionId) return res.success({ authenticated: false }, "No QR session started yet");
      const { userId, clientData } = resolveUserIdFromSession(legacySessionId);
      const auth = !!(userId && clientData?.isAuthenticated);
      const result = getSessionConnectResult(legacySessionId, { clear: false });
      return res.success({ authenticated: auth, userId: auth ? userId : null, result }, "QR session status");
    }

    // Load user and locate the target account entry
    let userDoc = null;
    if (userIdParam) {
      userDoc = await User.findById(userIdParam).select("whatsappuser");
    } else if (sessionId) {
      userDoc = await User.findOne({ "whatsappuser.sessionId": sessionId }).select("whatsappuser");
    }

    if (!userDoc) {
      return res.error("User or session not found", 404);
    }

    const accounts = userDoc.whatsappuser || [];
    let acc = null;
    if (sessionId) {
      acc = accounts.find((w) => w?.sessionId === sessionId);
    }
    if (!acc && accountId) {
      acc = accounts.find((w) => w?.clientId === accountId || w?.number === accountId);
    }

    if (!acc) {
      return res.success({ status: "not_found" }, "Account not found for provided identifiers");
    }

    // Derive status and QR
    const status = acc.qrStatus || (acc.clientId ? "authenticated" : "pending");
    const payload = { status };

    if (status === "pending") {
      // Return QR only when pending
      payload.qrCode = acc.qrCode || null;
    } else if (status === "scanned") {
      // Do not return QR after scanned
      payload.qrCode = null;
    } else if (status === "authenticated") {
      // Also verify runtime state if possible
      const { clientData } = sessionId ? resolveUserIdFromSession(sessionId) : { clientData: null };
      payload.authenticated = !!clientData?.isAuthenticated || true;
    }

    // Include minimal account info for frontend mapping
    payload.account = {
      name: acc.name || null,
      number: acc.number || null,
      clientId: acc.clientId || null,
    };

    return res.success(payload, "QR status");
  } catch (err) {
    console.error("/api/qr/status error:", err);
    return res.error("Failed to get QR status", 500);
  }
};

// Removed: saveWhatsappUser route flow. Now persisted automatically on WA ready using link from session.

// Send message
const sendMessage = async (req, res) => {
  try {
    const { userId, to, message } = req.body;

    // Validation
    if (!userId || !to || !message) {
      return res.error("`userId`, `to`, and `message` are required", 400);
    }

    // Session checks
    if (!req.session.userId) {
      console.warn(
        `❌ No session userId found for request with userId ${userId}, sessionID: ${req.sessionID}`
      );
      return res.error("Not authenticated. Please scan QR code at /api/qr.", 401);
    }
    if (userId !== req.session.userId) {
      console.warn(
        `❌ Unauthorized: userId ${userId} does not match session userId ${req.session.userId}, sessionID: ${req.sessionID}`
      );
      return res.error("Unauthorized", 401);
    }

    // Call service
    const result = await SendMessage(userId, to, message);

    if (result.success) {
      return res.success(result, "Message sent successfully");
    } else {
      // If the error is because the number isn’t on WhatsApp, return 400 (client error), not 500
      if (result.error && result.error.includes("not a registered WhatsApp number")) {
        return res.error(result.error, 400);
      }
      return res.error(result.error || "Failed to send message", 500);
    }
  } catch (err) {
    console.error(`❌ Send message error for user ${req.body?.userId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};
// Get messages
const getMessagesController = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.error("Not authenticated", 401);
    }

    const { phone } = req.params;
    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client) {
      return res.error("WhatsApp client not ready", 500);
    }
    const client = clientData.client;

    const myNumber = normalizeNumber(client.info.wid._serialized);
    const chatId = phone.includes("@g.us") ? phone : formatNumber(phone);
    const contactNumber = normalizeNumber(chatId);

    const messages = await Message.find({
      userId,
      $or: [
        { from: contactNumber, to: myNumber },
        { from: myNumber, to: contactNumber }
      ]
    }).sort({ timestamp: 1 });

    res.success(messages, "Conversation fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Reply to message
const replyMessage = async (req, res) => {
  try {
    const { userId, messageId, replyText } = req.body;
    // console.log("Reply request body:", req.body);
    if (!userId || !messageId || !replyText) {
      return res.error("`userId`, `messageId`, and `replyText` are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client) {
      return res.error("WhatsApp client not ready", 503);
    }
    const client = clientData.client;

    const message = await client.getMessageById(messageId);
    if (!message) {
      return res.error("Message not found", 404);
    }

    const reply = await message.reply(replyText);
    const outgoing = new Message({
      userId,
      from: normalizeNumber(client.info.wid._serialized),
      to: normalizeNumber(message.from),
      body: replyText,
      type: "chat",
      direction: "out",
      status: "sent",
      messageId: reply.id._serialized
    });
    await outgoing.save();
    res.success({ messageId: reply.id._serialized }, "Reply sent successfully");
  } catch (err) {
    console.error(`Reply error for user ${req.body.userId}:`, err);
    res.error(err.message, 500);
  }
};

// Send attachment
const sendAttachmentMessage = async (req, res) => {
  try {
    const { userId, to, caption } = req.body;
    const file = req.file;
    if (!userId || !to || !file) {
      return res.error("`userId`, `to`, and file upload are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const filePath = path.join(__dirname, "../Uploads", file.filename);
    const result = await sendAttachment(userId, to, filePath, caption);
    if (result.success) {
      res.success(result, "Attachment sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Send location
const sendLocationMessage = async (req, res) => {
  try {
    const { userId, to, latitude, longitude, description } = req.body;
    if (!userId || !to || !latitude || !longitude) {
      return res.error("`userId`, `to`, `latitude`, and `longitude` are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const result = await sendLocation(userId, to, latitude, longitude, description);
    if (result.success) {
      res.success(result, "Location sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Broadcast
const broadcast = async (req, res) => {
  try {
    const { userId, recipients, message } = req.body;
    if (!userId || !recipients || !Array.isArray(recipients) || !message) {
      return res.error("`userId`, `recipients` (array), and `message` are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const result = await broadcastMessage(userId, recipients, message);
    if (result.success) {
      res.success(result.results, "Broadcast sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Get message status
const getMessageStatus = async (req, res) => {
  try {
    const { userId, messageId } = req.params;
    if (!userId || !messageId) {
      return res.error("`userId` and `messageId` are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client.info) {
      return res.error("WhatsApp client not ready", 503);
    }
    const client = clientData.client;

    const message = await client.getMessageById(messageId);
    if (!message) {
      return res.error("Message not found", 404);
    }

    let status = "sent";
    if (message.ack >= 2) status = "delivered";
    if (message.ack >= 3) status = "read";

    let readBy = null;
    if (message.to.includes("@g.us")) {
      const info = await message.getInfo();
      readBy = info?.read ? Object.keys(info.read) : [];
    }

    res.success({ status, readBy }, "Message status fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Get groups
const getGroups = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.error("Not authenticated", 401);
    }

    const groups = await getGroupIds(userId);
    res.success(groups, "Groups fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Send bulk messages
const sendBulk = async (req, res) => {
  try {
    const { userId } = req.body;
    console.log("Bulk send request body:", req.body);
    if (!userId || !req.file) {
      return res.error("`userId` and CSV file are required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    const results = await sendBulkMessages(userId, req.file.path);
    res.success(results, "Bulk messages sent");
  } catch (err) {
    res.error(err.message, 500);
  }
};

const getUserWhatsAppAccounts = async (req, res) => {
  try {
    // Prefer app-authenticated user from JWT, fallback to query/body for flexibility
    const userId = req.appUserId || req.query.userId || req.body.userId;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const user = await User.findById(userId).select("whatsappuser");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      accounts: user.whatsappuser || [],
    });
  } catch (error) {
    console.error("Error fetching WhatsApp accounts:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Logout
const logoutUser = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.error("`userId` is required", 400);
    }
    if (userId !== req.session.userId) {
      return res.error("Unauthorized", 401);
    }

    await logout(userId);
    req.session.destroy();
    res.success({}, "Logged out successfully");
  } catch (err) {
    res.error(err.message, 500);
  }
};

module.exports = {
  getQrCode,
  getQrStatus,
  sendMessage,
  logoutUser,
  getMessages: getMessagesController, // Renamed to avoid conflict
  replyMessage,
  sendAttachmentMessage,
  sendLocationMessage,
  broadcast,
  getMessageStatus,
  getGroups,
  sendBulk,
  getUserWhatsAppAccounts
};
