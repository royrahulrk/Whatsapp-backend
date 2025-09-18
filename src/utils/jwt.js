const jwt = require("jsonwebtoken");

// Access/Refresh token configuration
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m"; // short-lived
const REFRESH_EXPIRES_IN_DEFAULT = process.env.JWT_REFRESH_EXPIRES_IN || "7d"; // default
const REFRESH_EXPIRES_IN_REMEMBER =
  process.env.JWT_REFRESH_EXPIRES_IN_REMEMBER || "30d"; // when rememberMe

function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (e) {
    return null;
  }
}

function signRefreshToken(payload, { rememberMe } = {}) {
  const expiresIn = rememberMe
    ? REFRESH_EXPIRES_IN_REMEMBER
    : REFRESH_EXPIRES_IN_DEFAULT;
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn });
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (e) {
    return null;
  }
}

// Backwards compatible helpers (used in existing code)
function signJwt(payload, { rememberMe } = {}) {
  // For backward compatibility, this returns an access token with longer expiry if rememberMe
  const expiresIn = rememberMe
    ? REFRESH_EXPIRES_IN_REMEMBER
    : ACCESS_EXPIRES_IN;
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  // legacy
  signJwt,
  verifyJwt,
};
