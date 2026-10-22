# What the TV gives us, and what we can build

Status column: **Tested** = checked on the TV (LG 47LB652V, webOS 1.4.0, 2026-10-20). **Untested** = documented or likely, not checked yet. **No** = checked and not available.

## 1. What the service can reach on the TV

### TV control (SSAP, port 3000)

| Capability | Call | Status |
| --- | --- | --- |
| Launch, list and close apps | `system.launcher/launch`, `listLaunchPoints`, `system.launcher/close` | Tested |
| App on screen | `applicationManager/getForegroundAppInfo` | Tested |
| Volume up, down, read level | `audio/volumeUp`, `volumeDown`, `getVolume` | Tested |
| Mute | pointer socket key `MUTE` | Tested |
| Channel up, down | `tv/channelUp`, `tv/channelDown` | Tested |
| Channel list (number, name, id) | `tv/getChannelList` (484 channels) | Tested |
| Current channel | `tv/getCurrentChannel` (Live TV must be on screen) | Tested |
| Program guide of the current channel | `tv/getChannelProgramInfo` (start, end, name, description, `isPresent`) | Tested |
| Program guide of another channel | `tv/getChannelProgramInfo` with `channelId` (Live TV must be on screen) | Tested |
| Switch to a channel | `tv/openChannel` with `channelId` | Untested |
| Toast message on screen | `system.notifications/createToast` | Tested |
| Remote keys, cursor, click, scroll | pointer input socket | Tested |
| Type into the focused text field | `com.webos.service.ime/insertText`, `sendEnterKey`, `deleteCharacters` | Tested |
| Play, pause | `media.controls/play`, `pause` | Tested |
| Play a video from a URL | `media.viewer/open` (opens SmartShare) | Tested |
| Open a web page | `system.launcher/open` with a URL | Tested |
| Model and system info | `system/getSystemInfo` | Tested |
| Power off | `system/turnOff` | Tested (accepted) |
| Switch input (HDMI) | `tv/switchInput`, `tv/getExternalInputList` | No (`401` with the current pairing) |
| Screen off with sound on | `com.webos.service.tv.power/turnOffScreen` | Untested |

### Developer Mode jail (Node.js service, SSH)

| Capability | Status |
| --- | --- |
| Outbound HTTPS to `api.anthropic.com` (Node.js 0.10, OpenSSL 1.0.1h) | Tested |
| Listen on a port for the phone (HTTP) | Tested |
| Service keeps running after its app closes | Tested |
| Write files (`/media/developer/temp`) | Tested |
| Free storage for apps | Tested (about 875 MB) |
| Install and remove our own apps (`appInstallService/dev/*`) | Tested |
| Memory and CPU (`/proc/meminfo`, `/proc/stat`), uptime | Tested |
| Temperature | No (no thermal or hwmon entries in the jail) |
| Start by itself after a TV restart | No (Activity Manager stores no callback for public-bus services) |
| TV microphone (Magic Remote voice) | No |
| Screenshot of the TV screen | No |
| Root, system apps, system settings | No (and not wanted) |

## 2. What we can build with that

| Feature | How | Needs the API |
| --- | --- | --- |
| Health monitor | Every minute: free memory and CPU; close background apps when memory is low; warn on long high CPU | No |
| Scheduler | Time-based tasks ("07:30 news", "22:00 lower the volume") inside the service | No (the task may use it) |
| Talk to the TV | Typed or dictated text from the phone → Claude → tools → TV | Yes |
| "What is on?" | Program guide + Claude summary ("the film on channel X starts at 21:00") | Yes |
| Find and open a channel by name | Local name search over the channel list, then `openChannel` | No (Claude only picks the intent) |
| News panel | Scheduled task: Claude with web search → short headlines → stored on the TV → shown by the TV app | Yes, at schedule time only |
| Reminders | Scheduler + toast ("Medicine time") | No |
| Sleep timer | Scheduler + power off or volume down | No |
| Daily summary on the phone | Health history, what was watched (from the foreground app and channel) | Optional |

## 3. Languages

| Part | Runs on | Language | Why |
| --- | --- | --- | --- |
| Assistant service | TV, Node.js 0.10.15 | JavaScript ES5, callbacks | The only usable runtime on the TV; its Python 2.7 has most of the standard library removed |
| Claude API calls | TV | Raw HTTPS + JSON | The official SDK needs a modern Node.js |
| TV app (news panel, answers) | TV web engine, WebKit 537 | HTML, CSS, ES5 JavaScript | No flexbox, grid or `fetch` |
| Phone page (command box, settings, health) | Phone browser | HTML, CSS, modern JavaScript | Voice through the keyboard's dictation key |
| Install and test tools | Computer | Bash, Node.js | No packages to install |

No build step and no dependencies on the TV: plain files that the TV runs as they are.

## 4. Speed and low resource use

**On the TV**

- The model runs at Anthropic. The TV only sends and receives small JSON messages.
- One Node.js process for the remote, the assistant and the games (about 15–30 MB).
- Reading `/proc/meminfo` and `/proc/stat` once a minute costs microseconds.
- Timers instead of polling loops. Nothing runs between tasks.
- Cache what changes slowly: the channel list once a day, the program guide for 10 minutes, the news until the next scheduled run. Showing the news makes no API call.
- Keep large data out of memory: store only number, name and id of the 484 channels, not the full records.
- The TV app is static HTML with a few elements; no animations beyond simple CSS transitions.
- TLS handshakes are slow on this CPU. Measure the cost, and reuse the connection when the old Node.js allows it.

**Toward the API (cost and latency)**

- Keep the system prompt and tool list identical between requests and mark them for prompt caching: cheaper and faster.
- Send short tool results. Example: a `find_channel` tool searches the channel list on the TV and returns three matches instead of 484 channels.
- Small `max_tokens` and low effort for simple commands ("volume up"); more for questions and news.
- Structured output (JSON schema) for the news, so the TV app needs no text parsing.
- Model, effort and `max_tokens` are settings on the phone page.
- A daily limit stops the scheduler from running up cost; also set a monthly spend limit in the Anthropic Console.

## 5. What the TV does not allow (and our answer)

| Limit | Answer |
| --- | --- |
| No temperature | Use long high CPU load as an indirect sign |
| No start after restart | Open the app once after the TV turns on; schedules resume then |
| No TV microphone | Dictation on the phone keyboard |
| No screenshot of the TV | Show results on the TV app and the phone page instead |
| Old certificates (valid until January 2028) | Ship a current CA bundle with the service |
