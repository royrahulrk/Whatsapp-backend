const jwt = require("jsonwebtoken");

const DEFAULT_EXPIRY = "1d"; // configurable per rememberMe

function signJwt(payload, { rememberMe } = {}) {
  const expiresIn = rememberMe ? "30d" : DEFAULT_EXPIRY;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { signJwt, verifyJwt };
