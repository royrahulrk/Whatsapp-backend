const express = require("express");
const multer = require("multer");
const {
  getQrCode,
  getQrStatus,
  getQrCodeJson,
  getQrCodeImage,
  generateQrBase64,
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
const router = express.Router();
// configure multer to store files temporarily
const upload = multer({ dest: "uploads/" });

// Authentication is enforced at app level: app.use('/api', requireAppAuth, messageRoutes)

// QR code routes (require app auth; WhatsApp session not required yet)

/**
 * @swagger
 * /api/qr:
 *   get:
 *     summary: Get WhatsApp QR code (PNG stream)
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code image
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get("/qr", getQrCode); // existing PNG stream (waits)

/**
 * @swagger
 * /api/qr/status:
 *   get:
 *     summary: Get WhatsApp QR code status
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code status
 */
router.get("/qr/status", getQrStatus); // returns authenticated flag and duplicate/connected result

// This endpoint is app-auth only; it doesn't require WhatsApp session auth

/**
 * @swagger
 * /api/whatsapp-accounts:
 *   get:
 *     summary: Get WhatsApp accounts for user
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of WhatsApp accounts
 */
router.get("/whatsapp-accounts", getUserWhatsAppAccounts);

/**
 * @swagger
 * /api/send:
 *   post:
 *     summary: Send a WhatsApp message
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendMessageRequest'
 *           examples:
 *             default:
 *               value:
 *                 userId: "66f0c8f9e4b9b2b1c1234567"
 *                 to: "+919812345678"
 *                 message: "Hello from API"
 *     responses:
 *       200:
 *         description: Message sent
 */
router.post("/send", sendMessage);

/**
 * @swagger
 * /api/reply:
 *   post:
 *     summary: Reply to a WhatsApp message
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReplyMessageRequest'
 *     responses:
 *       200:
 *         description: Message replied
 */
router.post("/reply", replyMessage);

/**
 * @swagger
 * /api/logout:
 *   post:
 *     summary: Logout WhatsApp user
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User logged out
 */
router.post("/logout", logoutUser);

/**
 * @swagger
 * /api/messages/{phone}:
 *   get:
 *     summary: Get messages for a phone number
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *         example: "+919812345678"
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get("/messages/:phone", getMessages);

/**
 * @swagger
 * /api/send-attachment:
 *   post:
 *     summary: Send a WhatsApp message with attachment
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/SendAttachmentRequest'
 *     responses:
 *       200:
 *         description: Attachment sent
 */
router.post("/send-attachment", upload.single("file"), sendAttachmentMessage);

/**
 * @swagger
 * /api/send-location:
 *   post:
 *     summary: Send a WhatsApp message with location
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendLocationRequest'
 *     responses:
 *       200:
 *         description: Location sent
 */
router.post("/send-location", sendLocationMessage);

/**
 * @swagger
 * /api/broadcast:
 *   post:
 *     summary: Broadcast a WhatsApp message
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BroadcastRequest'
 *     responses:
 *       200:
 *         description: Broadcast sent
 */
router.post("/broadcast", broadcast);

/**
 * @swagger
 * /api/message-status/{userId}/{messageId}:
 *   get:
 *     summary: Get message status
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message status
 */
router.get("/message-status/:userId/:messageId", getMessageStatus);

/**
 * @swagger
 * /api/groups:
 *   get:
 *     summary: Get WhatsApp groups
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
router.get("/groups", getGroups);

/**
 * @swagger
 * /api/send-bulk:
 *   post:
 *     summary: Send bulk WhatsApp messages
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/SendBulkRequest'
 *     responses:
 *       200:
 *         description: Bulk messages sent
 */
router.post("/send-bulk", upload.single("csvFile"), sendBulk);
// Moved above behind requireAppAuth

module.exports = router;
