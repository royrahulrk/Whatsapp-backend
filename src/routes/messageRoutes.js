const express = require("express");
const multer = require("multer");
const { getQrCode, getQrStatus, getQrCodeJson, getQrCodeImage, generateQrBase64, sendMessage, logoutUser,getMessages,replyMessage,sendAttachmentMessage,sendLocationMessage,broadcast,getMessageStatus,getGroups,sendBulk,getUserWhatsAppAccounts } = require("../controllers/messageController");
const { resolveUserIdFromSession } = require("../configs/whatsapp");
const requireAppAuth = require("../middlewares/appAuth");
const router = express.Router();
// configure multer to store files temporarily
const upload = multer({ dest: "uploads/" });


const requireAuth = async (req, res, next) => {
  try {
    if (!req.session.userId && req.session.sessionId) {
      const { userId, clientData } = resolveUserIdFromSession(req.session.sessionId);
      if (userId && clientData?.isAuthenticated) {
        req.session.userId = userId;
        await new Promise((r) => req.session.save(r));
        console.log(`✅ Hydrated session: sessionId=${req.session.sessionId} → userId=${userId}`);
      }
    }

    if (!req.session.userId) {
      return res.error("Not authenticated. Please scan QR code at /api/qr.", 401);
    }
    next();
  } catch (e) {
    console.error("requireAuth error:", e);
    return res.error("Auth middleware error", 500);
  }
};

// QR code routes (no login required for QR retrieval)
router.get("/qr", getQrCode); // existing PNG stream (waits)
router.get("/qr/status", getQrStatus); // returns authenticated flag and duplicate/connected result

// This endpoint is app-auth only; it doesn't require WhatsApp session auth
router.get("/whatsapp-accounts", getUserWhatsAppAccounts);

// Apply auth middleware to all other routes
router.use(requireAuth);

router.post("/send", sendMessage);
router.post("/reply", replyMessage);
router.post("/logout", logoutUser);
router.get("/messages/:phone", getMessages);
router.post("/send-attachment", upload.single("file"), sendAttachmentMessage);
router.post("/send-location", sendLocationMessage);
router.post("/broadcast", broadcast);
router.get("/message-status/:userId/:messageId", getMessageStatus);
router.get("/groups", getGroups);
router.post("/send-bulk", upload.single("csvFile"), sendBulk);
// Moved above behind requireAppAuth

module.exports = router;
