const { body } = require("express-validator");
const { signup: signupService, signin: signinService } = require("../services/authService");

// Validators derived from UI fields
const signupValidators = [
  body("firstName").trim().notEmpty().withMessage("First name is required"),
  body("lastName").optional().isString().trim(),
  body("username")
    .trim()
    .notEmpty().withMessage("Username is required")
    .bail()
    .isLength({ min: 3, max: 30 }).withMessage("Username 3-30 chars")
    .matches(/^[a-z0-9_\.]+$/i).withMessage("Username can contain letters, numbers, _ and ."),
  body("email").isEmail().withMessage("Valid email required").normalizeEmail(),
  body("phone").optional({ nullable: true, checkFalsy: true }).isString().withMessage("Phone must be a string"),
  body("timezone").trim().notEmpty().withMessage("Timezone is required"),
  body("password")
    .isStrongPassword({ minLength: 8, minNumbers: 1, minLowercase: 1, minUppercase: 1, minSymbols: 0 })
    .withMessage("Password too weak"),
  body("confirmPassword").notEmpty().withMessage("Confirm password is required"),
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

// Logout controller clears session and auth cookies
async function logoutUser(req, res) {
  try {
    // Destroy server-side session if present
    await new Promise((resolve) => {
      if (req.session) {
        req.session.destroy(() => resolve());
      } else {
        resolve();
      }
    });

    // Clear session cookie and any auth token cookie if used
    const cookieOpts = {
      path: "/",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
    };
    // Default express-session cookie name is 'connect.sid'
    res.clearCookie("connect.sid", cookieOpts);
    // If JWT stored in cookie named 'token', clear it as well
    res.clearCookie("token", { path: "/", sameSite: cookieOpts.sameSite, secure: cookieOpts.secure });

    // Return minimal success payload as requested
    return res.status(200).json({ message: "Logout successful" });
  } catch (err) {
    console.error("logout error", err);
    return res.status(500).json({ message: "Failed to logout" });
  }
}

module.exports = { signup, signin, signupValidators, signinValidators, logoutUser };
