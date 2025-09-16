function formatNumber(number) {
  let num = number.toString().replace(/\D/g, ""); // keep only digits
  if (!num.startsWith("91")) {
    num = "91" + num; // default India, change if you send outside India
  }
  return num + "@c.us"; // WhatsApp ID
}

// utils/numberFormatter.js
const normalizeNumber = (jid) => {
  if (!jid) return null;
  return jid.toString().replace("@c.us", ""); // strip @c.us
};

module.exports = { formatNumber, normalizeNumber };
