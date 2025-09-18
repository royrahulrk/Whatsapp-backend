const express = require("express");
const multer = require("multer");
const {
  generateQrCode,
  getQrStatus,
  sendMessage,
  logoutUser,
  getMessages,
  replyMessage,
  sendAttachmentMessage,
  sendLocationMessage,
  broadcast,
  getMessageStatus,
  getGroups,
  sendBulk,
  getUserWhatsAppAccounts,
} = require("../controllers/messageController");
const requireAppAuth = require("../middlewares/appAuth");
const router = express.Router();
// configure multer to store files temporarily
const upload = multer({ dest: "uploads/" });

// Apply app-level JWT auth to all routes under /api/messages
router.use(requireAppAuth);

// QR routes (behind app auth)
router.post("/qr/generate", generateQrCode);
router.get("/qr/status", getQrStatus); // expects ?qrId=...

// List accounts for app user
router.get("/whatsapp-accounts", getUserWhatsAppAccounts);

// Messaging routes (use accountId)
router.post("/send", sendMessage);
router.post("/reply", replyMessage);
router.post("/logout", logoutUser);
router.get("/messages/:accountId/:phone", getMessages);
router.post("/send-attachment", upload.single("file"), sendAttachmentMessage);
router.post("/send-location", sendLocationMessage);
router.post("/broadcast", broadcast);
router.get("/message-status/:accountId/:messageId", getMessageStatus);
router.get("/groups", getGroups); // ?accountId=...
router.post("/send-bulk", upload.single("csvFile"), sendBulk);

module.exports = router;
