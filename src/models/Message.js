const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    body: { type: String},
    type: { type: String, default: "chat" },
    direction: { type: String, enum: ["in", "out"], required: true },
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    messageId: { type: String }, // Already added in previous response
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema);
