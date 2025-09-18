const {
  getQr,
  logout,
  getClientByUserId,
  linkAppUserToSession,
  getSessionConnectResult,
  resolveUserIdFromSession,
} = require("../configs/whatsapp");
const User = require("../models/User");
const {
  SendMessage,
  sendAttachment,
  sendLocation,
  broadcastMessage,
  getGroupIds,
  sendBulkMessages,
} = require("../services/messageService");
const Message = require("../models/Message");
const { normalizeNumber, formatNumber } = require("../utils/numberFormatter");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Helper: verify the account belongs to the authenticated app user and is authenticated
async function getOwnedAuthenticatedAccount(appUserId, accountId) {
  const userDoc = await User.findById(appUserId).select("whatsappuser");
  if (!userDoc) return { error: "User not found", status: 404 };
  const acc = (userDoc.whatsappuser || []).find(
    (w) => (w?.clientId === accountId || w?.number === accountId) && w?.qrStatus === "authenticated"
  );
  if (!acc) return { error: "Account not found or not authenticated", status: 404 };
  return { acc };
}

// Generate or reuse a QR session for the authenticated app user and return base64 QR JSON
const generateQrCode = async (req, res) => {
  try {
    const appUserId = req.appUserId;
    if (!appUserId) return res.error("Unauthorized", 401);

    const userDoc = await User.findById(appUserId).select("whatsappuser");
    if (!userDoc) return res.error("User not found", 404);

    const accounts = userDoc.whatsappuser || [];
    const pendingAcc = accounts.find((w) => w?.qrStatus === "pending" && !!w?.sessionId);

    let sessionIdToUse;
    if (pendingAcc) {
      sessionIdToUse = pendingAcc.sessionId;
    } else {
      sessionIdToUse = uuidv4();
      userDoc.whatsappuser.push({
        sessionId: sessionIdToUse,
        qrStatus: "pending",
        createdAt: new Date(),
      });
      await userDoc.save();
    }

    // Link app user so when the WA client is ready we can persist under this user
    linkAppUserToSession(sessionIdToUse, appUserId);

    // Ensure a client is initializing and try to fetch a QR (with small wait inside getQr)
    const { qr, authenticated, userId } = await getQr(sessionIdToUse);
    if (authenticated) {
      return res.success({ authenticated: true, account: { number: userId } }, "Already authenticated");
    }
    if (!qr) return res.error("QR not ready, try again", 503);

    return res.success({ qrId: sessionIdToUse, qrCode: qr }, "QR generated");
  } catch (err) {
    console.error("❌ Failed to generate/fetch QR:", err);
    return res.error("Failed to generate QR code", 500);
  }
};

// Get QR/session status for this app user's QR id
const getQrStatus = async (req, res) => {
  try {
    const appUserId = req.appUserId;
    const qrId = req.query.qrId || req.body?.qrId;
    if (!appUserId) return res.error("Unauthorized", 401);
    if (!qrId) return res.error("qrId is required", 400);

    const userDoc = await User.findById(appUserId).select("whatsappuser");
    if (!userDoc) return res.error("User not found", 404);

    const acc = (userDoc.whatsappuser || []).find((w) => w?.sessionId === qrId);
    if (!acc) return res.success({ status: "not_found" }, "QR not found for this user");

    const status = acc.qrStatus || (acc.clientId ? "authenticated" : "pending");
    const payload = { status };

    if (status === "pending") {
      payload.qrCode = acc.qrCode || null;
    } else if (status === "scanned") {
      payload.qrCode = null;
    } else if (status === "authenticated") {
      const { clientData } = resolveUserIdFromSession(qrId) || {};
      payload.authenticated = !!clientData?.isAuthenticated || true;
    }

    // Include connection result details if any
    payload.result = getSessionConnectResult(qrId, { clear: false });

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

// Send message (by accountId)
const sendMessage = async (req, res) => {
  try {
    const { accountId, to, message } = req.body;
    const appUserId = req.appUserId;

    if (!accountId || !to || !message) {
      return res.error("`accountId`, `to`, and `message` are required", 400);
    }

    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const result = await SendMessage(acc.number, to, message);

    if (result.success) {
      return res.success(result, "Message sent successfully");
    } else {
      if (result.error && result.error.includes("not a registered WhatsApp number")) {
        return res.error(result.error, 400);
      }
      return res.error(result.error || "Failed to send message", 500);
    }
  } catch (err) {
    console.error("❌ Send message error:", err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Get messages (by accountId + phone)
const getMessagesController = async (req, res) => {
  try {
    const appUserId = req.appUserId;
    const { accountId, phone } = req.params;

    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const clientData = getClientByUserId(acc.number);
    if (!clientData || !clientData.client) {
      return res.error("WhatsApp client not ready", 500);
    }
    const client = clientData.client;

    const myNumber = normalizeNumber(client.info.wid._serialized);
    const chatId = phone.includes("@g.us") ? phone : formatNumber(phone);
    const contactNumber = normalizeNumber(chatId);

    const messages = await Message.find({
      userId: acc.number,
      $or: [
        { from: contactNumber, to: myNumber },
        { from: myNumber, to: contactNumber },
      ],
    }).sort({ timestamp: 1 });

    res.success(messages, "Conversation fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Reply to message (by accountId)
const replyMessage = async (req, res) => {
  try {
    const { accountId, messageId, replyText } = req.body;
    if (!accountId || !messageId || !replyText) {
      return res.error("`accountId`, `messageId`, and `replyText` are required", 400);
    }
    const appUserId = req.appUserId;
    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const clientData = getClientByUserId(acc.number);
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
      userId: acc.number,
      from: normalizeNumber(client.info.wid._serialized),
      to: normalizeNumber(message.from),
      body: replyText,
      type: "chat",
      direction: "out",
      status: "sent",
      messageId: reply.id._serialized,
    });
    await outgoing.save();
    res.success({ messageId: reply.id._serialized }, "Reply sent successfully");
  } catch (err) {
    console.error("Reply error:", err);
    res.error(err.message, 500);
  }
};

// Send attachment (by accountId)
const sendAttachmentMessage = async (req, res) => {
  try {
    const { accountId, to, caption } = req.body;
    const file = req.file;
    if (!accountId || !to || !file) {
      return res.error("`accountId`, `to`, and file upload are required", 400);
    }

    const appUserId = req.appUserId;
    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const filePath = path.join(process.cwd(), "uploads", file.filename);
    const result = await sendAttachment(acc.number, to, filePath, caption);
    if (result.success) {
      res.success(result, "Attachment sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Send location (by accountId)
const sendLocationMessage = async (req, res) => {
  try {
    const { accountId, to, latitude, longitude, description } = req.body;
    if (!accountId || !to || !latitude || !longitude) {
      return res.error("`accountId`, `to`, `latitude`, and `longitude` are required", 400);
    }

    const appUserId = req.appUserId;
    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const result = await sendLocation(acc.number, to, latitude, longitude, description);
    if (result.success) {
      res.success(result, "Location sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Broadcast (by accountId)
const broadcast = async (req, res) => {
  try {
    const { accountId, recipients, message } = req.body;
    if (!accountId || !recipients || !Array.isArray(recipients) || !message) {
      return res.error("`accountId`, `recipients` (array), and `message` are required", 400);
    }

    const appUserId = req.appUserId;
    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const result = await broadcastMessage(acc.number, recipients, message);
    if (result.success) {
      res.success(result.results, "Broadcast sent successfully");
    } else {
      res.error(result.error, 500);
    }
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Get message status (by accountId)
const getMessageStatus = async (req, res) => {
  try {
    const { accountId, messageId } = req.params;
    const appUserId = req.appUserId;
    if (!accountId || !messageId) {
      return res.error("`accountId` and `messageId` are required", 400);
    }

    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const clientData = getClientByUserId(acc.number);
    if (!clientData || !clientData.client?.info) {
      return res.error("WhatsApp client not ready", 503);
    }
    const client = clientData.client;

    const message = await client.getMessageById(messageId);
    if (!message) {
      return res.error("Message not found", 404);
    }

    let statusText = "sent";
    if (message.ack >= 2) statusText = "delivered";
    if (message.ack >= 3) statusText = "read";

    let readBy = null;
    if (message.to.includes("@g.us")) {
      const info = await message.getInfo();
      readBy = info?.read ? Object.keys(info.read) : [];
    }

    res.success({ status: statusText, readBy }, "Message status fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Get groups (by accountId in query)
const getGroups = async (req, res) => {
  try {
    const appUserId = req.appUserId;
    const accountId = req.query.accountId;
    if (!accountId) return res.error("`accountId` is required", 400);

    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const groups = await getGroupIds(acc.number);
    res.success(groups, "Groups fetched");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// Send bulk messages (by accountId)
const sendBulk = async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId || !req.file) {
      return res.error("`accountId` and CSV file are required", 400);
    }

    const appUserId = req.appUserId;
    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    const results = await sendBulkMessages(acc.number, req.file.path);
    res.success(results, "Bulk messages sent");
  } catch (err) {
    res.error(err.message, 500);
  }
};

// List WhatsApp accounts for the authenticated app user
const getUserWhatsAppAccounts = async (req, res) => {
  try {
    const userId = req.appUserId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
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

// Logout specific WhatsApp account (by accountId)
const logoutUser = async (req, res) => {
  try {
    const { accountId } = req.body;
    const appUserId = req.appUserId;
    if (!accountId) {
      return res.error("`accountId` is required", 400);
    }

    const { acc, error, status } = await getOwnedAuthenticatedAccount(appUserId, accountId);
    if (error) return res.error(error, status);

    await logout(acc.number);
    res.success({}, "Logged out successfully");
  } catch (err) {
    res.error(err.message, 500);
  }
};

module.exports = {
  generateQrCode,
  getQrStatus,
  sendMessage,
  logoutUser,
  getMessages: getMessagesController,
  replyMessage,
  sendAttachmentMessage,
  sendLocationMessage,
  broadcast,
  getMessageStatus,
  getGroups,
  sendBulk,
  getUserWhatsAppAccounts,
};

