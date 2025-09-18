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

    linkStatus: {
      type: String,
      enum: ["pending", "authenticated", "failed", 'disconnected'],
      default: undefined,
    },

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
