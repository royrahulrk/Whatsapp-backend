const { generateQrForUser, logout } = require("../configs/whatsapp");
const User = require("../models/User");
const WhatsAppAccount = require("../models/WhatsAppAccount");
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
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");

const getQrCode = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;

    // Kick off client immediately and wait briefly for QR
    const { qr } = await generateQrForUser(newQrSessionId);
    if (!qr) return res.error("QR not ready, try again", 503);

    // Return PNG bytes
    const base64Data = qr.replace(/^data:image\/png;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, "base64");
    res.set("Content-Type", "image/png");
    // Prevent caching so QR stays fresh
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
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
// - accountId: identifier of the WA account (use WhatsApp number)
const getQrStatus = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const params = { ...(req.query || {}), ...(req.body || {}) };
    const { accountId } = params;

    // Look up account from standalone collection
    let acc = null;
    if (accountId) {
      acc = await WhatsAppAccount.findOne({
        user: userId,
        number: accountId,
      });
    } else {
      // If no specific account ID, get the first account for this user
      acc = await WhatsAppAccount.findOne({ user: userId });
    }

    if (!acc) {
      return res.success({ status: "not_found" }, "Account not found for user");
    }

    // Derive status and QR
    const status = acc.qrStatus || (acc.number ? "authenticated" : "pending");
    const payload = { status };

    if (status === "pending") {
      // Return QR only when pending
      payload.qrCode = acc.qrCode || null;
    } else if (status === "scanned") {
      // Do not return QR after scanned
      payload.qrCode = null;
    }

    // Include minimal account info for frontend mapping
    payload.account = {
      name: acc.name || null,
      number: acc.number || null,
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
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { to, message, whatsappNumber } = req.body;

    // Validation
    if (!to || !message) {
      return res.error("`to` and `message` are required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Call service with the WhatsApp number from the account
    const result = await SendMessage(whatsappAccount.number, to, message);

    if (result.success) {
      return res.success(result, "Message sent successfully");
    } else {
      // If the error is because the number isn't on WhatsApp, return 400 (client error), not 500
      if (
        result.error &&
        result.error.includes("not a registered WhatsApp number")
      ) {
        return res.error(result.error, 400);
      }
      return res.error(result.error || "Failed to send message", 500);
    }
  } catch (err) {
    console.error(`❌ Send message error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};
// Get messages
const getMessagesController = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { phone } = req.params;
    const { whatsappNumber } = req.query;

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    const myNumber = whatsappAccount.number; // our WA number (userId in messages)
    const chatId = phone.includes("@g.us") ? phone : formatNumber(phone);
    const contactNumber = normalizeNumber(chatId);

    const messages = await Message.find({
      userId: whatsappAccount.number,
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

// Reply to a message
const replyMessage = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { messageId, replyText, whatsappNumber } = req.body;

    // Validation
    if (!messageId || !replyText) {
      return res.error("`messageId` and `replyText` are required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Call service with the WhatsApp number from the account
    const result = await ReplyMessage(
      whatsappAccount.number,
      messageId,
      replyText
    );

    if (result.success) {
      return res.success(result, "Reply sent successfully");
    } else {
      return res.error(result.error || "Failed to send reply", 500);
    }
  } catch (err) {
    console.error(`❌ Reply message error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Send attachment message
const sendAttachmentMessage = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { to, caption, whatsappNumber } = req.body;

    // Validation
    if (!to || !req.file) {
      return res.error("`to` and file attachment are required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Call service with the WhatsApp number from the account
    const result = await SendAttachmentMessage(
      whatsappAccount.number,
      to,
      req.file,
      caption
    );

    if (result.success) {
      return res.success(result, "Attachment sent successfully");
    } else {
      return res.error(result.error || "Failed to send attachment", 500);
    }
  } catch (err) {
    console.error(`❌ Send attachment error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Send location
const sendLocationMessage = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { to, latitude, longitude, description, whatsappNumber } = req.body;

    // Validation
    if (!to || !latitude || !longitude) {
      return res.error("`to`, `latitude`, and `longitude` are required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Call service with the WhatsApp number from the account
    const result = await sendLocation(
      whatsappAccount.number,
      to,
      latitude,
      longitude,
      description
    );

    if (result.success) {
      return res.success(result, "Location sent successfully");
    } else {
      return res.error(result.error || "Failed to send location", 500);
    }
  } catch (err) {
    console.error(`❌ Send location error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Broadcast
const broadcast = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { recipients, message, whatsappNumber } = req.body;

    // Validation
    if (!recipients || !Array.isArray(recipients) || !message) {
      return res.error("`recipients` (array) and `message` are required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Call service with the WhatsApp number from the account
    const result = await broadcastMessage(
      whatsappAccount.number,
      recipients,
      message
    );

    if (result.success) {
      return res.success(result.results, "Broadcast sent successfully");
    } else {
      return res.error(result.error || "Failed to send broadcast", 500);
    }
  } catch (err) {
    console.error(`❌ Broadcast error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Get message status
const getMessageStatus = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { messageId } = req.params;
    const { whatsappNumber } = req.query;

    // Validation
    if (!messageId) {
      return res.error("`messageId` is required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    // Derive status from our DB copy since we no longer use live client API here
    const doc = await Message.findOne({
      userId: whatsappAccount.number,
      messageId,
    }).lean();
    if (!doc) {
      return res.error("Message not found", 404);
    }

    // Map persisted status
    const status = doc.status || "sent";
    const readBy = null; // Not tracked without client context for groups
    return res.success({ status, readBy }, "Message status fetched");
  } catch (err) {
    console.error(
      `❌ Get message status error for user ${req.appUserId}:`,
      err
    );
    return res.error(err.message || "Internal server error", 500);
  }
};

// Get groups
const getGroups = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { whatsappNumber } = req.query;

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    const groups = await getGroupIds(whatsappAccount.number);
    return res.success(groups, "Groups fetched");
  } catch (err) {
    console.error(`❌ Get groups error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

// Send bulk messages
const sendBulk = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { whatsappNumber } = req.body;

    // Validation
    if (!req.file) {
      return res.error("CSV file is required", 400);
    }

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    const results = await sendBulkMessages(
      whatsappAccount.number,
      req.file.path
    );
    return res.success(results, "Bulk messages sent");
  } catch (err) {
    console.error(`❌ Send bulk error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
  }
};

const getUserWhatsAppAccounts = async (req, res) => {
  try {
    // Prefer app-authenticated user from JWT, fallback to query/body for flexibility
    const userId = req.appUserId || req.query.userId || req.body.userId;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    const user = await User.findById(userId).select("_id");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const accounts = await WhatsAppAccount.find({ user: user._id }).select(
      "name number qrStatus createdAt updatedAt"
    );
    return res.status(200).json({ success: true, accounts });
  } catch (error) {
    console.error("Error fetching WhatsApp accounts:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Logout
const logoutUser = async (req, res) => {
  try {
    // Get user ID from JWT token (set by appAuth middleware)
    const userId = req.appUserId;
    if (!userId) return res.error("Authentication required", 401);

    const { whatsappNumber } = req.body;

    // Get the WhatsApp account for this user
    let whatsappAccount;
    if (whatsappNumber) {
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        number: whatsappNumber,
      });
    } else {
      // Use the first authenticated account if no specific number provided
      whatsappAccount = await WhatsAppAccount.findOne({
        user: userId,
        qrStatus: "authenticated",
      });
    }

    if (!whatsappAccount || !whatsappAccount.number) {
      return res.error(
        "No authenticated WhatsApp account found. Please scan QR code first.",
        400
      );
    }

    await logout(whatsappAccount.number);
    return res.success({}, "Logged out successfully");
  } catch (err) {
    console.error(`❌ Logout error for user ${req.appUserId}:`, err);
    return res.error(err.message || "Internal server error", 500);
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
  getUserWhatsAppAccounts,
};
