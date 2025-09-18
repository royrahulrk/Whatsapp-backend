const express = require("express");
const cors = require("cors");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const responseHandler = require("./middlewares/responseHandler");
const MongoStore = require("connect-mongo"); // MongoDB session store
const messageRoutes = require("./routes/messageRoutes");
const authRoutes = require("./routes/authRoutes");
const connectDB = require("./configs/db");
const app = express();
const multer = require("multer");
const path = require("path");
const requireAppAuth = require("./middlewares/appAuth");

const upload = multer({ dest: "uploads/" });

const ORIGINS = [
  "http://localhost:3000", // your frontend dev
  "http://localhost:5173",
  // add your prod domain(s) here
];
app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
// Also accept HTML form submissions (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));
app.use(responseHandler);
app.use(express.static("uploads"));

// Trust proxy if behind one (needed for secure cookies on some hosts)
app.set("trust proxy", 1);

// Session middleware so req.session is available (used by WhatsApp QR/login flow)
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 14 * 24 * 60 * 60, // 14 days
    }),
    cookie: {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    },
  })
);

// Swagger UI endpoint
const { swaggerUi, swaggerSpec } = require("./configs/swagger");
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    swaggerOptions: { persistAuthorization: true },
  })
);

connectDB();

// Routes
// Public auth endpoints (signup/signin/refresh/logout)
app.use("/auth", authRoutes);

// Protect and handle /api routes: all routes under /api require JWT app auth
app.use("/api", requireAppAuth, messageRoutes);

module.exports = app;
