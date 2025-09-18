// getClientByUserId removed; client-based sending is disabled in this build
const { formatNumber } = require("../utils/numberFormatter");
const Message = require("../models/Message");
const { normalizeNumber } = require("../utils/numberFormatter");
const { Location, MessageMedia } = require("whatsapp-web.js");
const { parse } = require("csv-parse");
const fs = require("fs");
const path = require("path");

const SendMessage = async (userId, to, message) => {
  console.log(`📤 userId to send to: ${userId}`);
  console.log(`📤 Attempting to send to: ${to}`);
  console.log(`📤 message to send to: ${message}`);
  try {
    // Sending disabled without client integration
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(`SendMessage Error for user ${userId}:`, err.message);
    return { success: false, error: err.message };
  }
};

const sendAttachment = async (userId, to, filePath, caption = "") => {
  try {
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(`SendAttachment Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const sendLocation = async (
  userId,
  to,
  latitude,
  longitude,
  description = ""
) => {
  try {
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(`SendLocation Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const broadcastMessage = async (userId, recipients, message) => {
  try {
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(`BroadcastMessage Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const getGroupIds = async (userId) => {
  try {
    console.warn(
      "getGroupIds skipped: messaging client is disabled in this deployment"
    );
    return [];
  } catch (err) {
    console.error(`GetGroupIds Error for user ${userId}:`, err);
    throw err;
  }
};

const sendBulkMessages = async (userId, filePath) => {
  console.log(
    `Processing bulk messages for user ${userId} from file: ${filePath}`
  );
  // Messaging client disabled
  throw new Error("Messaging client is disabled in this deployment");

  const results = [];
  const parser = fs
    .createReadStream(filePath)
    .pipe(parse({ columns: true, trim: true }));

  for await (const row of parser) {
    const { phoneNumber, message } = row;
    if (!phoneNumber || !message) {
      results.push({
        phoneNumber,
        success: false,
        error: "Missing phoneNumber or message",
      });
      continue;
    }

    try {
      const formattedTo = formatNumber(phoneNumber);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // throttle
      const response = await SendMessage(userId, formattedTo, message);
      results.push({
        phoneNumber,
        success: response.success,
        ...(response.success ? { response } : { error: response.error }),
      });
    } catch (err) {
      results.push({ phoneNumber, success: false, error: err.message });
    }
  }

  console.log(`Bulk processing completed for user ${userId}`);
  return results;
};

const ReplyMessage = async (userId, messageId, replyText) => {
  try {
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(`ReplyMessage Error for user ${userId}:`, err.message);
    return { success: false, error: err.message };
  }
};

const SendAttachmentMessage = async (userId, to, file, caption = "") => {
  try {
    return {
      success: false,
      error: "Messaging client is disabled in this deployment",
    };
  } catch (err) {
    console.error(
      `SendAttachmentMessage Error for user ${userId}:`,
      err.message
    );
    return { success: false, error: err.message };
  }
};

module.exports = {
  SendMessage,
  sendAttachment,
  sendLocation,
  broadcastMessage,
  getGroupIds,
  sendBulkMessages,
  ReplyMessage,
  SendAttachmentMessage,
};
