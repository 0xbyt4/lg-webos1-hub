# 5. webOS 1 pitfalls we hit

These cost us time. If you build your own webOS 1 app, read this first.

## Developer Mode and SSH

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ssh-keygen -p` says `incorrect passphrase` with the right passphrase | The TV key is a legacy PEM file (AES-128-CBC) | Decrypt with `openssl rsa -in webos_rsa -out webos_rsa.open` |
| SSH: `no matching host key type found` | The TV offers only `ssh-rsa` | `HostKeyAlgorithms +ssh-rsa` and `PubkeyAcceptedAlgorithms +ssh-rsa` for this host |
| `ping` from the TV shell always fails | The jail does not allow raw sockets | Test with TCP, for example `nc -z` from the computer |
| `python` on the TV crashes or has no `BaseHTTPServer` | The TV's Python 2.7 has most of its standard library removed | Use Node.js (`node`, v0.10.15) |

## luna-send

| Symptom | Cause | Fix |
| --- | --- | --- |
| `luna-send-pub -n 1 ...` prints nothing and exits | On webOS 1.4 the "wait for N replies" mode is broken | Use `luna-send-pub -i ...` in the background, read its output, then stop it |
| `Unknown method "getForegroundAppInfo"` from the shell | That method is only on SSAP, not on the public luna bus | Use SSAP for app manager queries |
| `'current flag' must be specified` from `activitymanager/getDetails` | Required flags | Send `"current": true, "internal": false` |

## Services (Node.js on the TV)

| Symptom | Cause | Fix |
| --- | --- | --- |
| The service and its HTTP server die after about 5 seconds | `webos-service` exits after 5 s without activities | `service.activityManager._stopTimer(); service.activityManager.exitOnTimeout = false;` |
| A reinstalled service still runs old code | The old process keeps running | Call the service's built-in `quit` method before installing |
| Progress messages from a `service.call(...)` never arrive | The request object was garbage-collected | Use `service.subscribe(...)` and keep a reference until done |
| An Activity Manager schedule never starts the service | Activities from the public bus are saved with `"callback": null` | No fix found: open the app after a restart |

## SSAP

| Symptom | Cause | Fix |
| --- | --- | --- |
| `system.launcher/close` returns `500` | webOS 1 needs the launch `sessionId` | Send `sessionId = base64("<appId>:undefined")` |
| A second `close` within a second reports success again | Closing is asynchronous | Ignore; a later call returns `500` (not running) |
| `401 insufficient permissions` | Permission not in the pairing manifest | Add it to `PERMISSIONS` and pair again (the TV prompts again) |
| App icon URLs stop working | Icon paths contain a session hash that changes | Reload the app list and fetch again |

## Web apps

| Symptom | Cause | Fix |
| --- | --- | --- |
| Modern JavaScript fails silently | WebKit 537 (Chrome 26 era) | ES5 only; `XMLHttpRequest`; `-webkit-` prefixes |
| Seven tiles per row instead of eight | `width` plus border is wider than planned | `box-sizing: border-box` |
| `userScripts` in `appinfo.json` does nothing | Not supported on webOS 1.4 | Not available on this version |
| `vendorExtension.userAgent` has no effect for a developer app | Ignored for developer apps | Not available on this version |
| A page in an `<iframe>` stays `about:blank` | The site sends `X-Frame-Options` | Frames cannot show such sites |
| No developer console | The TV has none | Send errors to the server (`POST /api/log`) and read `/api/logs` |

## Other

| Symptom | Cause | Fix |
| --- | --- | --- |
| Each "open URL" in the TV browser adds a tab | `system.launcher/open` always opens a new tab | Launch the browser without a URL to bring back the last tab, or use a web app instead |
| The load average is 4–5 while the TV is idle | Video driver threads wait in the "D" state and count as load | Not a real CPU load; measure CPU time in `/proc/<pid>/stat` instead |
| The phone cannot reach a server that the computer can reach | A VPN on the phone, or the server restarted at that moment | Turn off the VPN and try again |

Next: [Troubleshooting](06-troubleshooting.md).
