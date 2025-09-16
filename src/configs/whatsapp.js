// configs/whatsapp.js
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const Message = require("../models/Message");
const User = require("../models/User");
const { normalizeNumber,formatNumber } = require("../utils/numberFormatter");


const clients = new Map();
const sessionToUserId = new Map();
// Link a QR session (created at /api/qr) to the logged-in app user's Mongo _id
const sessionToAppUserId = new Map();
// Track connection outcome for a given QR session (e.g., duplicate vs new)
const sessionConnectResult = new Map();

function linkAppUserToSession(sessionId, appUserId) {
  if (!sessionId || !appUserId) return;
  sessionToAppUserId.set(sessionId, String(appUserId));
}

function createClient(sessionId) {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: "./sessions",
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--window-size=1920,1080"],
      timeout: 60000,
    },
  });

  client.on("qr", async (qr) => {
    try {
      const qrCodeUrl = await qrcode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
      clients.set(sessionId, { client, qrCodeUrl, isAuthenticated: false, userId: null, qrGeneratedAt: Date.now() });
      console.log(`📌 QR Generated for session ${sessionId}`);

      // Persist per-account QR status for the app user (pending)
      try {
        const appUserId = sessionToAppUserId.get(sessionId);
        if (appUserId) {
          const appUserDoc = await User.findById(appUserId);
          if (appUserDoc) {
            appUserDoc.whatsappuser = appUserDoc.whatsappuser || [];
            const idx = appUserDoc.whatsappuser.findIndex((w) => w?.sessionId === sessionId);
            if (idx >= 0) {
              appUserDoc.whatsappuser[idx].qrCode = qrCodeUrl;
              appUserDoc.whatsappuser[idx].qrStatus = "pending";
            } else {
              appUserDoc.whatsappuser.push({
                sessionId,
                qrCode: qrCodeUrl,
                qrStatus: "pending",
                createdAt: new Date(),
              });
            }
            await appUserDoc.save();
          }
        }
      } catch (dbErr) {
        console.error(`❌ Failed to persist pending QR for session ${sessionId}:`, dbErr);
      }
    } catch (err) {
      console.error(`❌ Error generating QR code for session ${sessionId}:`, err);
      clients.set(sessionId, { client, qrCodeUrl: null, isAuthenticated: false, userId: null, qrGeneratedAt: null });
    }
  });

  client.on("authenticated", () => {
    console.log(`✅ Session ${sessionId} authenticated with WhatsApp`);
    clients.set(sessionId, { ...clients.get(sessionId), isAuthenticated: true });

    // Mark as scanned in DB (use authenticated as proxy for scanned)
    (async () => {
      try {
        const appUserId = sessionToAppUserId.get(sessionId);
        if (!appUserId) return;
        const appUserDoc = await User.findById(appUserId);
        if (!appUserDoc) return;
        const idx = (appUserDoc.whatsappuser || []).findIndex((w) => w?.sessionId === sessionId);
        if (idx >= 0) {
          appUserDoc.whatsappuser[idx].qrStatus = "scanned";
          appUserDoc.whatsappuser[idx].qrCode = null; // hide QR after scan
          await appUserDoc.save();
        }
      } catch (e) {
        console.error(`❌ Failed to mark scanned for session ${sessionId}:`, e);
      }
    })();
  });

client.on("ready", async () => {
  // Always normalize to raw number (no @c.us)
  const userId = client.info.wid._serialized.replace("@c.us", "");
  console.log(`🚀 WhatsApp Client Ready for user ${userId}`);

  // If an old session exists for this user, clean it up
  if (clients.has(userId)) {
    console.log(`📌 Existing session found for user ${userId}, cleaning up`);
    try {
      await clients.get(userId).client.destroy();
    } catch (err) {
      console.warn(`⚠️ Failed to destroy old client for ${userId}:`, err.message);
    }
    clients.delete(userId);
  }

  // Store client with normalized userId
  clients.set(userId, {
    client,
    qrCodeUrl: null,
    isAuthenticated: true,
    userId,
    qrGeneratedAt: null,
  });

  // Map sessionId → userId for reverse lookups
  sessionToUserId.set(sessionId, userId);

  // Cleanup temporary sessionId entry
  if (clients.has(sessionId)) {
    clients.delete(sessionId);
  }

  // console.log(`📌 Mapped sessionId ${sessionId} to userId ${userId}`);
  // console.log("🔑 Current clients map keys:", Array.from(clients.keys()));

  // Save user details to DB
  // NOTE: Avoid creating a separate WhatsApp-only User document.
  // We intentionally skip persisting `{ userId, pushname, platform }` as a standalone user
  // to prevent duplicate users. Instead, we only attach WhatsApp info to the
  // logged-in app user's `whatsappuser` array below.

  // Persist WhatsApp account under the logged-in app user's document (append-only)
  try {
    const appUserId = sessionToAppUserId.get(sessionId);
    if (appUserId) {
      const qr = clients.get(userId)?.qrCodeUrl || clients.get(sessionId)?.qrCodeUrl || null;
      const name = client.info.pushname || null;
      const number = client.info.wid.user; // raw number, no @c.us
      const clientId = number; // use wid.user as stable client id

      const appUserDoc = await User.findById(appUserId);
      if (appUserDoc) {
        appUserDoc.whatsappuser = appUserDoc.whatsappuser || [];
        // De-duplicate by clientId or number. If found, update fields; else push new entry.
        let idx = appUserDoc.whatsappuser.findIndex(
          (w) => w?.clientId === clientId || w?.number === number
        );
        // Prefer pending entry created for this session
        const pendingIdx = appUserDoc.whatsappuser.findIndex((w) => w?.sessionId === sessionId);
        if (pendingIdx >= 0) idx = pendingIdx;

        if (idx >= 0) {
          appUserDoc.whatsappuser[idx].name = name;
          appUserDoc.whatsappuser[idx].number = number;
          appUserDoc.whatsappuser[idx].clientId = clientId;
          // Update QR tracking fields
          appUserDoc.whatsappuser[idx].qrStatus = "authenticated";
          appUserDoc.whatsappuser[idx].qrCode = null;
          appUserDoc.whatsappuser[idx].sessionId = undefined;
          if (qr) appUserDoc.whatsappuser[idx].qr = qr; // legacy
          // keep original createdAt
          await appUserDoc.save();
          console.log(`✅ Updated existing WhatsApp profile for app user ${appUserId}`);
          // Mark as duplicate (already connected) for this QR session
          sessionConnectResult.set(sessionId, {
            status: "duplicate",
            message: "This WhatsApp account is already connected",
            number,
            name,
            userId,
          });
        } else {
          appUserDoc.whatsappuser.push({
            name,
            number,
            clientId,
            qr: qr || null, // legacy
            qrCode: null,
            qrStatus: "authenticated",
            sessionId: undefined,
            createdAt: new Date(),
          });
          await appUserDoc.save();
          console.log(`✅ Added WhatsApp profile to app user ${appUserId}`);
          // Mark as newly connected for this QR session
          sessionConnectResult.set(sessionId, {
            status: "connected",
            message: "WhatsApp account connected",
            number,
            name,
            userId,
          });
        }
      } else {
        console.warn(`⚠️ App user not found for _id=${appUserId}, cannot append whatsappuser`);
      }
    } else {
      console.log(`ℹ️ No app user linked to session ${sessionId}; skipping whatsappuser append`);
    }
  } catch (err) {
    console.error(`❌ Failed to append whatsappuser for session ${sessionId}:`, err);
  } finally {
    // Clear the mapping once processed
    sessionToAppUserId.delete(sessionId);
  }
});


  client.on("message", async (msg) => {
    try {
      const userId = sessionToUserId.get(sessionId) || client.info.wid.user;
      const myNumber = client.info.wid.user;
      const fromNumber = msg.from.replace("@c.us", "").replace("@g.us", "");
      const body = msg.body || "";
      const incoming = new Message({
        userId,
        from: normalizeNumber(msg.from),
        to: normalizeNumber(client.info.wid._serialized),
        body,
        type: msg.type,
        direction: "in",
        status: "sent",
        messageId: msg.id._serialized,
        timestamp: new Date(msg.timestamp * 1000),
      });
      await incoming.save();
      console.log(`📩 New incoming message for user ${userId}:`, incoming);
    } catch (err) {
      console.error(`❌ Failed to save incoming message for session ${sessionId}:`, err);
    }
  });

  client.on("disconnected", (reason) => {
    const userId = sessionToUserId.get(sessionId) || client.info?.wid.user;
    console.log(`⚠️ User ${userId || sessionId} disconnected: ${reason}`);
    // Best-effort: if we had a pending session, mark it failed
    (async () => {
      try {
        const appUserId = sessionToAppUserId.get(sessionId);
        if (!appUserId) return;
        const appUserDoc = await User.findById(appUserId);
        if (!appUserDoc) return;
        const idx = (appUserDoc.whatsappuser || []).findIndex((w) => w?.sessionId === sessionId);
        if (idx >= 0 && appUserDoc.whatsappuser[idx].qrStatus !== "authenticated") {
          appUserDoc.whatsappuser[idx].qrStatus = "failed";
          await appUserDoc.save();
        }
      } catch (e) {
        console.error(`❌ Failed to mark failed for session ${sessionId}:`, e);
      }
    })();
    clients.delete(sessionId);
    if (userId) clients.delete(userId);
    sessionToUserId.delete(sessionId);
    sessionToAppUserId.delete(sessionId);
    client.destroy();
  });

  client.initialize();
  console.log(`📌 Initializing client for session ${sessionId}`);
  return client;
}

function getOrCreateClient(sessionId) {
  let clientData = clients.get(sessionId);
  if (!clientData) {
    const client = createClient(sessionId);
    clientData = { client, qrCodeUrl: null, isAuthenticated: false, userId: null, qrGeneratedAt: null };
    clients.set(sessionId, clientData);
  }
  return clientData;
}

function getClientByUserId(userId) {
  const key = userId.replace("@c.us", ""); // always raw number
  console.log("Looking up client for userId:", key);
  console.log("Current clients map keys:", Array.from(clients.keys()));
  return clients.get(key);
  // return clients.get(userId);
}


// Immediate (non-blocking) QR fetch. Returns the most recent QR if present without waiting.
// If the session is already authenticated, returns authenticated=true and userId.
function getLatestQr(sessionId) {
  const mappedUserId = sessionToUserId.get(sessionId);

  if (mappedUserId) {
    const clientData = clients.get(mappedUserId);
    if (clientData && clientData.isAuthenticated) {
      return {
        qr: null,
        authenticated: true,
        userId: mappedUserId,
        qrGeneratedAt: null,
      };
    }
  }

  // Ensure a client exists for this session (kick off initialization if not yet created)
  const clientData = getOrCreateClient(sessionId);

  const qr = clientData.qrCodeUrl || null;
  const qrGeneratedAt = clientData.qrGeneratedAt || null;

  return {
    qr,
    authenticated: !!clientData.isAuthenticated && !!clientData.userId,
    userId: clientData.userId || null,
    qrGeneratedAt,
  };
}

const getQr = async (sessionId, timeout = 20000) => {
  const userId = sessionToUserId.get(sessionId);
  if (userId) {
    const clientData = getClientByUserId(userId);
    if (clientData) {
      console.log(`📌 Found authenticated client for sessionId ${sessionId} with userId ${userId}`);
      return { qr: null, authenticated: true, userId };
    }
  }

  const clientData = getOrCreateClient(sessionId);
  if (clientData.isAuthenticated && clientData.userId) {
    console.log(`📌 Client already authenticated for sessionId ${sessionId} with userId ${clientData.userId}`);
    return { qr: null, authenticated: true, userId: clientData.userId };
  }

  if (!clientData.qrCodeUrl) {
    console.log(`📌 Waiting for QR code for sessionId ${sessionId}`);
    await new Promise((resolve) => setTimeout(resolve, timeout));
    const updatedClientData = clients.get(sessionId);
    return {
      qr: updatedClientData?.qrCodeUrl || null,
      authenticated: updatedClientData?.isAuthenticated || false,
      userId: updatedClientData?.userId || null,
    };
  }

  return { qr: clientData.qrCodeUrl, authenticated: false, userId: null };
};

const logout = async (userId) => {
  const clientData = clients.get(userId);
  if (!clientData || !clientData.isAuthenticated) {
    throw new Error("User not logged in");
  }
  try {
    await clientData.client.logout();
    clients.delete(userId);
    sessionToUserId.forEach((val, key) => {
      if (val === userId) sessionToUserId.delete(key);
    });
    console.log(`👋 User ${userId} logged out from WhatsApp`);
  } catch (err) {
    console.error(`❌ Logout failed for user ${userId}:`, err);
    throw err;
  }
};

function resolveUserIdFromSession(sessionId) {
  const userId = sessionToUserId.get(sessionId) || null;
  const clientData = userId ? clients.get(userId) : clients.get(sessionId);
  return { userId, clientData };
}


const getMessages = async (userId) => {
  return Message.find({ userId }).sort({ timestamp: 1 });
};
function getSessionConnectResult(sessionId, { clear = true } = {}) {
  const result = sessionConnectResult.get(sessionId) || null;
  if (clear && result) sessionConnectResult.delete(sessionId);
  return result;
}

module.exports = { getOrCreateClient, getClientByUserId, getQr, getLatestQr, logout, getMessages, resolveUserIdFromSession, linkAppUserToSession, getSessionConnectResult };