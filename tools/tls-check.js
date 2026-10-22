// Checks that the TV's Node.js (v0.10, ES5) can reach the Anthropic API over HTTPS.
//
// Run on the TV (no API key needed):
//   ssh -F .devmode/ssh_config lgtv 'node' < tools/tls-check.js
//
// A "401" status means the connection and the certificate check work; the API only
// refused the request because it carries no key. Any TLS or certificate error means
// the TV needs a newer CA bundle (passed as the "ca" option) or a relay.
var https = require("https");

console.log("node " + process.version + ", openssl " + (process.versions.openssl || "unknown"));

var req = https.request({
  host: "api.anthropic.com",
  port: 443,
  path: "/v1/models",
  method: "GET",
  servername: "api.anthropic.com", // send SNI explicitly; old Node may not do it by itself
  headers: { "anthropic-version": "2023-06-01" }
}, function (res) {
  var sock = res.socket;
  var cipher = sock.getCipher ? sock.getCipher() : null;
  console.log("status " + res.statusCode + (res.statusCode === 401 ? " (expected without a key: connection OK)" : ""));
  console.log("cipher " + (cipher ? cipher.name + " " + cipher.version : "unknown"));
  console.log("certificate authorized: " + sock.authorized + (sock.authorizationError ? " (" + sock.authorizationError + ")" : ""));
  res.resume();
});

req.on("error", function (e) {
  console.log("FAILED: " + (e.code || "") + " " + e.message);
});
req.setTimeout(15000, function () {
  console.log("FAILED: timeout");
  req.abort();
});
req.end();
