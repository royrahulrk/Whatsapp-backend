const { getClientByUserId } = require("../configs/whatsapp");
const { formatNumber } = require("../utils/numberFormatter");
const Message = require("../models/Message");
const { normalizeNumber } = require("../utils/numberFormatter");
const { Location } = require("whatsapp-web.js");
const { parse } = require("csv-parse");
const fs = require("fs");



const SendMessage = async (userId, to, message) => {
   console.log(`📤 userId to send to: ${userId}`);
   console.log(`📤 Attempting to send to: ${to}`);
  console.log(`📤 message to send to: ${message}`);
  try {
    const clientData = getClientByUserId(userId);
     console.log(`📤 clientData : ${clientData}`);
    if (!clientData || !clientData.client) {
      throw new Error("Client not found or not authenticated");
    }
    const client = clientData.client;

    const formattedTo = formatNumber(to);
    const phoneNumber = formattedTo.replace("@c.us", "").replace("@g.us", "");
    console.log("Formatted number:", formattedTo);

    const isRegistered = await client.isRegisteredUser(formattedTo);
    if (!isRegistered && !formattedTo.includes("@g.us")) {
      return { success: false, error: `❌ ${to} is not a registered WhatsApp number` };
    }

    const response = await client.sendMessage(formattedTo, message);

    const outgoing = new Message({
      userId,
      from: client.info.wid._serialized.replace("@c.us", ""),
      to: phoneNumber,
      body: message,
      type: "chat",
      direction: "out",
      status: response.ack >= 1 ? "delivered" : "sent",
      messageId: response.id._serialized
    });

    await outgoing.save();

    // Track delivery / read receipts
    let attempts = 0;
    const interval = setInterval(async () => {
      try {
        const updatedMessage = await client.getMessageById(response.id._serialized);
        const newStatus =
          updatedMessage.ack >= 2
            ? "read"
            : updatedMessage.ack >= 1
            ? "delivered"
            : "sent";

        await Message.updateOne(
          { messageId: response.id._serialized, userId },
          { status: newStatus }
        );

        if (formattedTo.includes("@g.us")) {
          const info = await updatedMessage.getInfo();
          if (info && info.read) {
            console.log(`👥 Group message read by:`, Object.keys(info.read));
            clearInterval(interval);
          }
        } else if (updatedMessage.ack === 2) {
          console.log(`✅ Individual message read: ${response.id._serialized}`);
          clearInterval(interval);
        }
      } catch (error) {
        console.error(`Error checking receipt for user ${userId}:`, error);
      }
      if (attempts++ > 10) clearInterval(interval);
    }, 5000);

    return { success: true, to: phoneNumber, response };
  } catch (err) {
    console.error(`SendMessage Error for user ${userId}:`, err.message);
    return { success: false, error: err.message };
  }
};

const sendAttachment = async (userId, to, filePath, caption = "") => {
  try {
    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client.info) {
      throw new Error("WhatsApp client not ready");
    }
    const client = clientData.client;

    const formattedTo = formatNumber(to);
    const phoneNumber = formattedTo.replace("@c.us", "").replace("@g.us", "");

    const media = MessageMedia.fromFilePath(filePath);
    const response = await client.sendMessage(formattedTo, media, { caption });

    const outgoing = new Message({
      userId,
      from: normalizeNumber(client.info.wid._serialized),
      to: normalizeNumber(formattedTo),
      body: caption || filePath,
      type: media.mimetype.split("/")[0],
      direction: "out",
      status: "sent",
      messageId: response.id._serialized
    });

    await outgoing.save();
    return { success: true, to: phoneNumber, response };
  } catch (err) {
    console.error(`SendAttachment Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const sendLocation = async (userId, to, latitude, longitude, description = "") => {
  try {
    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client.info) {
      throw new Error("WhatsApp client not ready");
    }
    const client = clientData.client;

    const formattedTo = formatNumber(to);
    const phoneNumber = formattedTo.replace("@c.us", "").replace("@g.us", "");

    const isRegistered = await client.isRegisteredUser(formattedTo);
    if (!isRegistered && !formattedTo.includes("@g.us")) {
      throw new Error("Number not registered on WhatsApp");
    }

    const location = new Location(latitude, longitude, description);
    const response = await client.sendMessage(formattedTo, location);

    const outgoing = new Message({
      userId,
      from: normalizeNumber(client.info.wid._serialized),
      to: normalizeNumber(formattedTo),
      body: description || `Location: ${latitude}, ${longitude}`,
      type: "location",
      direction: "out",
      status: response.ack >= 1 ? "delivered" : "sent",
      messageId: response.id._serialized
    });

    await outgoing.save();
    return { success: true, to: phoneNumber, response };
  } catch (err) {
    console.error(`SendLocation Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const broadcastMessage = async (userId, recipients, message) => {
  try {
    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client.info) {
      throw new Error("WhatsApp client not ready");
    }
    const client = clientData.client;

    const results = [];
    for (const to of recipients) {
      const formattedTo = formatNumber(to);
      const phoneNumber = formattedTo.replace("@c.us", "").replace("@g.us", "");
      const isRegistered = await client.isRegisteredUser(formattedTo);
      if (!isRegistered && !formattedTo.includes("@g.us")) {
        results.push({ to: phoneNumber, success: false, error: "Not registered on WhatsApp" });
        continue;
      }

      const response = await client.sendMessage(formattedTo, message);
      const outgoing = new Message({
        userId,
        from: normalizeNumber(client.info.wid._serialized),
        to: normalizeNumber(formattedTo),
        body: message,
        type: "chat",
        direction: "out",
        status: response.ack >= 1 ? "delivered" : "sent",
        messageId: response.id._serialized
      });
      await outgoing.save();
      results.push({ to: phoneNumber, success: true, response });
    }
    return { success: true, results };
  } catch (err) {
    console.error(`BroadcastMessage Error for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
};

const getGroupIds = async (userId) => {
  try {
    const clientData = getClientByUserId(userId);
    if (!clientData || !clientData.client.info) {
      throw new Error("WhatsApp client not ready");
    }
    const client = clientData.client;

    const chats = await client.getChats();
    const groups = chats
      .filter(chat => chat.isGroup)
      .map(chat => ({
        id: chat.id._serialized,
        name: chat.name || "Unnamed Group"
      }));
    console.log(`Group chats for user ${userId}:`, groups);
    return groups;
  } catch (err) {
    console.error(`GetGroupIds Error for user ${userId}:`, err);
    throw err;
  }
};

const sendBulkMessages = async (userId, filePath) => {
  console.log(`Processing bulk messages for user ${userId} from file: ${filePath}`);
  const clientData = getClientByUserId(userId);
  if (!clientData || !clientData.client) {
    throw new Error("WhatsApp client not ready");
  }

  const results = [];
  const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, trim: true }));

  for await (const row of parser) {
    const { phoneNumber, message } = row;
    if (!phoneNumber || !message) {
      results.push({ phoneNumber, success: false, error: "Missing phoneNumber or message" });
      continue;
    }

    try {
      const formattedTo = formatNumber(phoneNumber);
      await new Promise(resolve => setTimeout(resolve, 1000)); // throttle
      const response = await SendMessage(userId, formattedTo, message);
      results.push({
        phoneNumber,
        success: response.success,
        ...(response.success ? { response } : { error: response.error })
      });
    } catch (err) {
      results.push({ phoneNumber, success: false, error: err.message });
    }
  }

  console.log(`Bulk processing completed for user ${userId}`);
  return results;
};


module.exports = { SendMessage, sendAttachment, sendLocation, broadcastMessage, getGroupIds, sendBulkMessages };