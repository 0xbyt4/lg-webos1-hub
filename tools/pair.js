// Pair with the TV and save the client key to .tv_key (any recent Node.js).
// Usage: node tools/pair.js 192.168.1.50
// The TV shows an "Allow?" prompt the first time; accept it with the TV remote.
// Keep .tv_key private: it gives control of the TV.
"use strict";

const path = require("path");
const TVClient = require("../services/home/ssap.js").TVClient;

const host = process.argv[2];
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host || "")) {
  console.error("usage: node tools/pair.js <tv-ip>");
  process.exit(1);
}
const tv = new TVClient(host, path.join(__dirname, "..", ".tv_key"));
console.log("Connecting... accept the prompt on the TV if it appears.");
tv.request("ssap://system/getSystemInfo", null, (err, info) => {
  if (err) {
    console.error("Pairing failed: " + err.message);
    process.exit(1);
  }
  console.log("Paired with " + (info.modelName || "the TV") + ". The key is in .tv_key.");
  process.exit(0);
}, 60000);
