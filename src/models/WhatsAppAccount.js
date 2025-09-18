const mongoose = require("mongoose");

// Standalone WhatsApp account linked to an App User
const whatsAppAccountSchema = new mongoose.Schema(
  {
    // Link to app user
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // WhatsApp identity
    name: { type: String, trim: true },
    number: { type: String, trim: true }, // raw number e.g. 916376289176
    // QR / session tracking
    qrCode: { type: String, default: null }, // data URL/base64 for UI polling
    qrStatus: {
      type: String,
      enum: ["pending", "scanned", "authenticated", "failed"],
      default: undefined,
    },

    // Session management for whatsapp-web.js
    sessionId: { type: String, unique: true, sparse: true }, // UUID for session identification
    sessionData: { type: mongoose.Schema.Types.Mixed }, // Store session data if needed
    lastSeen: { type: Date }, // Last activity timestamp
    isActive: { type: Boolean, default: false }, // Whether the client is currently active

    // Legacy field kept for back-compat if needed by UI
    qr: { type: String },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    toJSON: { virtuals: true },
  }
);

whatsAppAccountSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Prevent duplicates
// Unique number globally when present
whatsAppAccountSchema.index(
  { number: 1 },
  {
    unique: true,
    partialFilterExpression: { number: { $exists: true, $ne: null } },
  }
);

// Also avoid duplicates per user in case number uniqueness is relaxed later
whatsAppAccountSchema.index(
  { user: 1, number: 1 },
  {
    unique: true,
    partialFilterExpression: { number: { $exists: true, $ne: null } },
  }
);

module.exports = mongoose.model("WhatsAppAccount", whatsAppAccountSchema);
