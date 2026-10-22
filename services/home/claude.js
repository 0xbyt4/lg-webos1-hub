// Minimal Claude Messages API client for the TV's Node.js 0.10 (ES5, callbacks).
//
// The official SDK needs a modern Node.js, so this sends raw HTTPS requests.
// Checked on the TV: OpenSSL 1.0.1h reaches api.anthropic.com with TLS 1.2 and the
// built-in root certificates (see tools/tls-check.js).
var https = require("https");

// Prices in USD per million tokens, for the usage estimate on the phone page.
// Claude Haiku 5.5 has no server-side refusal fallback, so it gets no "fallbacks".
// webSearch: the web search tool version; dynamic filtering (_20260209) is not on Haiku.
var MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", input: 4, output: 20, fallback: true, webSearch: "web_search_20260209" },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", input: 2, output: 10, fallback: true, webSearch: "web_search_20260209" },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", input: 0.1, output: 0.5, fallback: false, webSearch: "web_search_20250305" }
};
var WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches, on top of the tokens
var EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];
var TIMEOUT_MS = 120000;
var MAX_RETRIES = 2;

function ApiError(status, type, message) {
  this.name = "ApiError";
  this.status = status;
  this.type = type;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);

function retryable(err) {
  return err.status === 0 || err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
}

function post(apiKey, body, cb) {
  var data = JSON.stringify(body);
  var headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
  // Server-side fallback: on a safety decline the API retries on the model Anthropic
  // recommends for that category, inside the same call.
  if (body.fallbacks === "default") headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  var done = false;
  function finish(err, result, retryAfter) {
    if (done) return;
    done = true;
    cb(err, result, retryAfter);
  }
  var req = https.request({
    host: "api.anthropic.com",
    port: 443,
    path: "/v1/messages",
    method: "POST",
    headers: headers,
    servername: "api.anthropic.com" // send SNI explicitly; old Node.js may not set it
  }, function (res) {
    var chunks = [];
    res.on("data", function (c) { chunks.push(c); });
    res.on("end", function () {
      var text = Buffer.concat(chunks).toString("utf8");
      var json = null;
      try {
        json = JSON.parse(text);
      } catch (e) {
        return finish(new ApiError(res.statusCode, "parse_error", "unreadable answer from the API"));
      }
      if (res.statusCode >= 400) {
        var e = json && json.error ? json.error : {};
        return finish(new ApiError(res.statusCode, e.type || "api_error", e.message || "HTTP " + res.statusCode),
          null, parseInt(res.headers["retry-after"] || "0", 10));
      }
      finish(null, json);
    });
  });
  req.setTimeout(TIMEOUT_MS, function () {
    req.abort();
    finish(new ApiError(0, "timeout", "the API did not answer in " + TIMEOUT_MS / 1000 + " s"));
  });
  req.on("error", function (e) {
    finish(new ApiError(0, "network", e.message));
  });
  req.end(data);
}

// POST /v1/messages with retries on rate limits, overload and network errors.
function createMessage(apiKey, body, cb) {
  (function attempt(n) {
    post(apiKey, body, function (err, result, retryAfter) {
      if (err && retryable(err) && n < MAX_RETRIES) {
        var wait = retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * Math.pow(2, n);
        return setTimeout(function () { attempt(n + 1); }, wait);
      }
      cb(err, result);
    });
  })(0);
}

function webSearches(usage) {
  return (usage && usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
}

// Approximate cost: cache writes cost about 1.25x input, cache reads about 0.1x.
function cost(model, usage) {
  var m = MODELS[model];
  if (!m || !usage) return 0;
  return ((usage.input_tokens || 0) * m.input +
    (usage.cache_creation_input_tokens || 0) * m.input * 1.25 +
    (usage.cache_read_input_tokens || 0) * m.input * 0.1 +
    (usage.output_tokens || 0) * m.output) / 1e6 + webSearches(usage) * WEB_SEARCH_USD;
}

module.exports = { createMessage: createMessage, cost: cost, webSearches: webSearches, MODELS: MODELS, EFFORTS: EFFORTS, ApiError: ApiError };
