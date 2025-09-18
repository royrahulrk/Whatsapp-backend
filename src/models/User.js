const mongoose = require("mongoose");

// App User schema (no embedded WhatsApp accounts)
const userSchema = new mongoose.Schema(
  {
    // App account fields
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
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

module.exports = mongoose.model("User", userSchema);
