const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    userId: { type: String, required: true }, // WhatsApp number (not app user ID)
    from: { type: String, required: true },
    to: { type: String, required: true },
    body: { type: String },
    type: { 
        type: String, 
        enum: ["chat", "image", "video", "audio", "document", "location", "contact", "sticker"],
        default: "chat" 
    },
    direction: { type: String, enum: ["in", "out"], required: true },
    status: { type: String, enum: ["sent", "delivered", "read", "failed"], default: "sent" },
    messageId: { type: String, unique: true, sparse: true }, // WhatsApp message ID
    
    // Additional fields for better message management
    quotedMessageId: { type: String }, // For reply messages
    mediaUrl: { type: String }, // For media messages
    mediaType: { type: String }, // MIME type for media
    fileName: { type: String }, // Original filename for documents
    fileSize: { type: Number }, // File size in bytes
    
    // Location data
    latitude: { type: Number },
    longitude: { type: Number },
    locationDescription: { type: String },
    
    // Contact data
    contactName: { type: String },
    contactNumber: { type: String },
    
    // Metadata
    isForwarded: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    ack: { type: Number, default: 0 }, // WhatsApp acknowledgment level
    
    timestamp: { type: Date, default: Date.now },
    editedAt: { type: Date },
    deletedAt: { type: Date }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Indexes for better query performance
messageSchema.index({ userId: 1, timestamp: -1 }); // For getting user messages by time
messageSchema.index({ from: 1, to: 1, timestamp: -1 }); // For conversation queries
messageSchema.index({ messageId: 1 }); // For finding specific messages
messageSchema.index({ quotedMessageId: 1 }); // For finding reply chains
messageSchema.index({ type: 1, timestamp: -1 }); // For filtering by message type
messageSchema.index({ status: 1 }); // For filtering by status

module.exports = mongoose.model("Message", messageSchema);
