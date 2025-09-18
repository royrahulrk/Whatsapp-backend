const express = require("express");
const cors = require("cors");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const responseHandler = require("./middlewares/responseHandler");
const MongoStore = require("connect-mongo"); // Add MongoDB session store
const messageRoutes = require("./routes/messageRoutes");
const authRoutes = require("./routes/authRoutes");
const connectDB = require("./configs/db");
const app = express();
const multer = require("multer");
const path = require("path");

const upload = multer({ dest: "uploads/" });

const ORIGINS = [
  "http://localhost:3000",     // your frontend dev
  "http://localhost:5173",
  // add your prod domain(s) here
];
app.use(cors({
  origin: ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json());
app.use(cookieParser());
// Also accept HTML form submissions (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false, // Only save sessions with data
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 14 * 24 * 60 * 60, // 14 days
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production", // Set to true only in production with HTTPS
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // Adjust for cross-origin requests
    },
  })
);
app.use(responseHandler);
app.use(express.static("uploads"));



connectDB();

// Routes
app.use("/auth", authRoutes); // new auth endpoints
app.use("/api", messageRoutes);

module.exports = app;
