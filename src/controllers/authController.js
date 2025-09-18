const { body } = require("express-validator");
const {
  signup: signupService,
  signin: signinService,
} = require("../services/authService");
const {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
} = require("../utils/jwt");

// Validators derived from UI fields
const signupValidators = [
  body("firstName").trim().notEmpty().withMessage("First name is required"),
  body("lastName").optional().isString().trim(),
  body("username")
    .trim()
    .notEmpty()
    .withMessage("Username is required")
    .bail()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username 3-30 chars")
    .matches(/^[a-z0-9_\.]+$/i)
    .withMessage("Username can contain letters, numbers, _ and ."),
  body("email").isEmail().withMessage("Valid email required").normalizeEmail(),
  body("phone")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .withMessage("Phone must be a string"),
  body("timezone").trim().notEmpty().withMessage("Timezone is required"),
  body("password")
    .isStrongPassword({
      minLength: 8,
      minNumbers: 1,
      minLowercase: 1,
      minUppercase: 1,
      minSymbols: 0,
    })
    .withMessage("Password too weak"),
  body("confirmPassword")
    .notEmpty()
    .withMessage("Confirm password is required"),
  // Coerce string "true"/"false" to boolean when coming from forms
  body("termsAccepted")
    .toBoolean()
    .isBoolean()
    .custom((v) => v === true)
    .withMessage("You must accept the terms of use"),
];

const signinValidators = [
  body("email").isEmail().withMessage("Valid email required").normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
  body("rememberMe").optional().isBoolean(),
];

async function signup(req, res) {
  return signupService(req, res);
}

async function signin(req, res) {
  return signinService(req, res);
}

// Logout controller clears auth cookies (no server sessions used)
async function logoutUser(req, res) {
  try {
    // Clear session cookie and any auth token cookie if used
    const cookieOpts = {
      path: "/",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
    };
    // If JWT stored in cookie named 'token', clear it as well
    res.clearCookie("token", {
      path: "/",
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
    });
    res.clearCookie("refreshToken", {
      path: "/",
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
    });

    // Return minimal success payload as requested
    return res.status(200).json({ message: "Logout successful" });
  } catch (err) {
    console.error("logout error", err);
    return res.status(500).json({ message: "Failed to logout" });
  }
}

// Issue new access token using refresh token (from cookie or Authorization header as Bearer)
async function refreshToken(req, res) {
  try {
    let token = req.cookies?.refreshToken;
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    if (
      !token &&
      auth &&
      typeof auth === "string" &&
      auth.startsWith("Bearer ")
    ) {
      token = auth.substring(7);
    }
    if (!token) return res.error("No refresh token", 401);

    const payload = verifyRefreshToken(token);
    if (!payload || !payload.userId)
      return res.error("Invalid refresh token", 401);

    // Optionally rotate refresh token
    const newAccess = signAccessToken({ userId: payload.userId });
    const newRefresh = signRefreshToken({ userId: payload.userId });

    const cookieOpts = {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    };
    res.cookie("token", newAccess, cookieOpts);
    res.cookie("refreshToken", newRefresh, cookieOpts);

    return res.success(
      { token: newAccess, refreshToken: newRefresh },
      "Token refreshed"
    );
  } catch (err) {
    console.error("refreshToken error", err);
    return res.error("Failed to refresh token", 500);
  }
}

module.exports = {
  signup,
  signin,
  signupValidators,
  signinValidators,
  logoutUser,
  refreshToken,
};
