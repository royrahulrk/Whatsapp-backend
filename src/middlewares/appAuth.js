const { verifyJwt } = require("../utils/jwt");

// App-level auth using JWT (separate from WhatsApp QR/session auth)
module.exports = function requireAppAuth(req, res, next) {
  try {
    let token;

    // console.log("Headers:", req.headers);
    // console.log("Cookies:", req.cookies);

    // 1. Check Authorization header
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
      token = auth.substring(7);
    }

    // 2. Fallback to cookies
    if (!token && req.cookies) {
      if (req.cookies.auth_token) {
        token = req.cookies.auth_token;
        // console.log("Token found in cookie: auth_token");
      } else if (req.cookies.token) {
        token = req.cookies.token;
        // console.log("Token f/ound in cookie: token");
      }
    }

    if (!token) {
      return res.error("Unauthorized", 401);
    }

    // 3. Verify JWT
    const payload = verifyJwt(token);
    if (!payload) {
      console.log("Invalid token");
      return res.error("Unauthorized", 401);
    }

    // 4. Determine userId
    let userId = payload.userId;

    // If not present in token, check auth_user cookie
    if (!userId && req.cookies && req.cookies.auth_user) {
      try {
        const authUser = JSON.parse(req.cookies.auth_user);
        if (authUser && authUser._id) {
          userId = authUser._id;
        }
      } catch (e) {
        console.warn("Failed to parse auth_user cookie:", e);
      }
    }

    if (!userId) {
      console.log("No userId found in token or cookies");
      return res.error("Unauthorized", 401);
    }

    // 5. Attach to req for downstream handlers
    req.appUserId = userId;
    req.appAuthPayload = payload;      // full decoded JWT
    req.appAuthCookies = req.cookies;  // keep all cookies

    return next();
  } catch (e) {
    console.error("requireAppAuth error:", e);
    return res.error("Unauthorized", 401);
  }
};
