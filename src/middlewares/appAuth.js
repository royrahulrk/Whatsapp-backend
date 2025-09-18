const {
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
} = require("../utils/jwt");

// App-level auth using JWT (separate from WhatsApp QR/session auth)
// Looks for token in Authorization: Bearer <token> or cookie named 'token'
module.exports = function requireAppAuth(req, res, next) {
  try {
    let accessToken;
    let refreshToken;

    const auth = req.headers["authorization"] || req.headers["Authorization"]; // some clients send capitalized
    if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
      accessToken = auth.substring(7);
    }

    // Support cookies: access in 'token', refresh in 'refreshToken'
    if (!accessToken && req.cookies && req.cookies.token) {
      accessToken = req.cookies.token;
    }
    if (req.cookies && req.cookies.refreshToken) {
      refreshToken = req.cookies.refreshToken;
    }

    let payload = accessToken ? verifyAccessToken(accessToken) : null;

    // If access token invalid/expired, try refresh token
    if ((!payload || !payload.userId) && refreshToken) {
      const refreshPayload = verifyRefreshToken(refreshToken);
      if (refreshPayload && refreshPayload.userId) {
        // Issue new access token and attach to response for client to update
        const newAccess = signAccessToken({ userId: refreshPayload.userId });
        // Optionally set as cookie for convenience
        res.cookie("token", newAccess, {
          httpOnly: true,
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
        payload = verifyAccessToken(newAccess);
      }
    }

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
