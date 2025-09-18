/*
  One-time migration: move embedded user.whatsappuser[] into WhatsAppAccount documents
  Safe to run multiple times; uses upsert semantics keyed by { user, number }
*/
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const WhatsAppAccount = require("../src/models/WhatsAppAccount");

async function migrate(uri) {
  if (!uri) throw new Error("Missing MONGODB_URI env var");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const cursor = User.find({
    whatsappuser: { $exists: true, $type: "array", $ne: [] },
  }).cursor();
  let migrated = 0;
  for await (const user of cursor) {
    const accounts = user.whatsappuser || [];
    for (const acc of accounts) {
      if (!acc.number) continue; // cannot migrate without number

      await WhatsAppAccount.findOneAndUpdate(
        { user: user._id, number: acc.number },
        {
          user: user._id,
          name: acc.name ?? null,
          number: acc.number ?? null,
          qrCode: acc.qrCode ?? null,
          qrStatus: acc.qrStatus,
          qr: acc.qr ?? null,
          createdAt: acc.createdAt || new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      migrated++;
    }
  }

  console.log(`Migration complete. Migrated/Upserted entries: ${migrated}`);
  await mongoose.disconnect();
}

migrate(process.env.MONGO_URI || process.env.MONGODB_URI).catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
