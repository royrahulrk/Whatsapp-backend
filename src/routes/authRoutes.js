const express = require("express");
const router = express.Router();
const { signup, signin, signupValidators, signinValidators, logoutUser } = require("../controllers/authController");

router.post("/signup", signupValidators, signup);
router.post("/signin", signinValidators, signin);
router.post("/logout", logoutUser);


module.exports = router;
