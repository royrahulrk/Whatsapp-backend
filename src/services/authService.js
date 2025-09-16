const bcrypt = require("bcrypt");
const { validationResult } = require("express-validator");
const User = require("../models/User");
const { signJwt } = require("../utils/jwt");

const SALT_ROUNDS = 10;

// Normalize phone to E.164 like +<country><number>. For the UI example, India +91
function normalizePhone(phone, defaultCountryCode = "+91") {
  if (!phone) return undefined;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits.startsWith("91")) {
    // If user typed leading 0 or country code missing, prepend default
    if (digits.startsWith("0")) digits = digits.substring(1);
    digits = `91${digits}`;
  }
  return `+${digits}`;
}

async function signup(req, res) {
  // Validate
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
  }

  const { firstName, lastName, username, email, phone, timezone, password, confirmPassword, termsAccepted } = req.body;

  if (password !== confirmPassword) {
    return res.error("Passwords do not match", 400);
  }

  try {
    // Uniqueness checks
    const existing = await User.findOne({ $or: [{ email: email?.toLowerCase() }, { username: username?.toLowerCase() }, { phone: normalizePhone(phone) }] });
    if (existing) {
      return res.error("User with same email/username/phone already exists", 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await User.create({
      firstName,
      lastName,
      username: username?.toLowerCase(),
      email: email?.toLowerCase(),
      phone: normalizePhone(phone),
      timezone,
      passwordHash,
      termsAccepted: !!termsAccepted,
      termsAcceptedAt: termsAccepted ? new Date() : undefined,
    });

    return res.success({ user }, "Account created");
  } catch (err) {
    console.error("signup error", err);
    return res.error("Failed to create account", 500);
  }
}

async function signin(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
  }

  const { email, password, rememberMe } = req.body;

  try {
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user || !user.passwordHash) {
      return res.error("Invalid credentials", 401);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.error("Invalid credentials", 401);

    const token = signJwt({ userId: user.id }, { rememberMe: !!rememberMe });

    return res.success({ token, user: user.toJSON() }, "Signed in");
  } catch (err) {
    console.error("signin error", err);
    return res.error("Failed to sign in", 500);
  }
}

module.exports = { signup, signin };
