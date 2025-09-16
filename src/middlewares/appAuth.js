const { verifyJwt } = require("../utils/jwt");

// App-level auth using JWT (separate from WhatsApp QR/session auth)
// Looks for token in Authorization: Bearer <token> or cookie named 'token'
module.exports = function requireAppAuth(req, res, next) {
  try {
    let token;
    const auth = req.headers["authorization"] || req.headers["Authorization"]; // some clients send capitalized
    if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
      token = auth.substring(7);
    }

    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.error("Unauthorized", 401);
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.userId) {
      return res.error("Unauthorized", 401);
    }

    req.appUserId = payload.userId;
    return next();
  } catch (e) {
    console.error("requireAppAuth error:", e);
    return res.error("Unauthorized", 401);
  }
};
