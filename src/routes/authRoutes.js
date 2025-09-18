const express = require("express");
const router = express.Router();
const {
  signup,
  signin,
  signupValidators,
  signinValidators,
  logoutUser,
  refreshToken,
} = require("../controllers/authController");

router.post("/signup", signupValidators, signup);
/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Signup a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *     responses:
 *       200:
 *         description: User signed up
 */
router.post("/signin", signinValidators, signin);
/**
 * @swagger
 * /auth/signin:
 *   post:
 *     summary: Signin a user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SigninRequest'
 *     responses:
 *       200:
 *         description: User signed in
 */
router.post("/logout", logoutUser);
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout a user
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: User logged out
 */
// Public endpoint to refresh tokens using refresh token cookie/header
router.post("/refresh", refreshToken);
/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Auth]
 *     description: Send refresh token in cookie (refreshToken) or Authorization header as Bearer.
 *     security: []
 *     responses:
 *       200:
 *         description: Token refreshed
 */

module.exports = router;
