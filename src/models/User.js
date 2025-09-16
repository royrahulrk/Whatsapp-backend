const mongoose = require("mongoose");

// Sub-schema for WhatsApp profiles linked to an app user
const whatsappUserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    number: { type: String, trim: true }, // raw number, e.g. 916376289176
    clientId: { type: String, trim: true }, // identifier for the WA client/session (e.g., wid.user)

    // New fields for per-account QR tracking
    sessionId: { type: String, trim: true }, // temp identifier while pending login
    qrCode: { type: String, default: null }, // data URL or base64 of current QR
    qrStatus: {
      type: String,
      enum: ["pending", "scanned", "authenticated", "failed"],
      default: undefined,
    },

    // Back-compat with previous `qr` field (kept but unused going forward)
    qr: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Keep existing fields used by WhatsApp integration, and extend with auth fields
const userSchema = new mongoose.Schema(
  {
    // // WhatsApp identity (optional for regular web account users)
    // userId: { type: String }, // wid.user (e.g., 916376289176)
    // pushname: { type: String }, // WhatsApp display name
    // platform: { type: String }, // e.g., android

    // Aggregated WA profiles for this app user (append-only)
    whatsappuser: { type: [whatsappUserSchema], default: [] },

    // App account fields
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    username: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true }, // store in E.164 like +911234567890
    timezone: { type: String, trim: true },
    passwordHash: { type: String },
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash; // never expose
        return ret;
      },
    },
  }
);

userSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Ensure unique index only applies when userId is actually set to a non-null value
// This avoids duplicate key errors for documents without WhatsApp linkage
userSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $exists: true, $ne: null } } }
);

module.exports = mongoose.model("User", userSchema);