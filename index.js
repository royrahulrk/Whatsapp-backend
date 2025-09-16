require("dotenv").config();
const connectDB = require("./src/configs/db");
const app = require("./src/app");

const PORT = process.env.PORT || 5000;

console.log("📌 Loaded MONGO_URI:", process.env.MONGO_URI);  // 👈 debug

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
