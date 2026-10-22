# 6. Troubleshooting

Start with the hub log: `ssh -F .devmode/ssh_config lgtv 'curl -s http://127.0.0.1:8765/api/logs'`.

## The phone cannot open the page

1. Check that the address has the port: `http://192.168.1.50:8765`.
2. Check that the phone is on the same Wi-Fi as the TV, and turn off any VPN on the phone.
3. Check that the server runs:

   ```bash
   nc -z 192.168.1.50 8765 && echo "server is up"
   ```

4. If it is down, the TV restarted. Open **Home Screen** on the TV once.

## The page opens but says "TV not connected"

Read the hub log. A pairing error means `.tv_key` in the package is old: pair again with `node tools/pair.js <tv-ip>` and run `scripts/deploy.sh` again.

## The page asks for the access code again

The code is stored per address in the phone browser, so a new address (for example after the TV gets a new IP) or a private browser tab asks again. Enter the same code again. If nobody knows the code, remove `config.json` from the hub's settings folder over SSH (its path is in the hub log, line `settings file:`); this also removes the API key and the schedules.

## The assistant does not answer

| Message | Fix |
| --- | --- |
| `Add your Anthropic API key in Settings first` | **Settings** tab, **Claude**: save the API key |
| `The API key was not accepted` | The key is wrong or revoked; save a new one |
| `Daily limit reached` | Raise **Daily requests** in the Claude settings, or wait until tomorrow |
| `Claude is not reachable` | The TV has no internet, or the API is busy; try again |

## Games

| Problem | Fix |
| --- | --- |
| The TV says "This TV cannot run the games (no WebSocket)" | The TV's web engine has no WebSocket; the games cannot run on it yet |
| The TV says "Connecting to the hub..." | The hub does not run: open **Home Screen** once, then **Games** again |
| The phone says "wrong room code" or "no game is open on the TV" | Open **Games** on the TV and type the code it shows |
| The phone says "too many tries, wait a minute" | Many wrong codes in a minute stop all joins for a moment; wait and type the code again |
| A phone shows "reconnecting..." | The phone lost Wi-Fi or locked its screen; it joins again by itself as the same player |

## "On now" stays empty

The TV gives program guide data only while Live TV is on screen. Watch Live TV for a few minutes, then open **Home Screen** again.

## A pairing prompt appears again on the TV

The permission list in the pairing manifest changed, or the TV was reset. Accept the prompt; the new key is saved.

## `deploy.sh` fails

| Message | Fix |
| --- | --- |
| `set TV_IP to the TV address` | Run it as `TV_IP=192.168.1.50 scripts/deploy.sh` |
| `ssh: connect to host ... port 9922: Connection refused` or timeout | Developer Mode is off or expired. Open **Developer Mode** on the TV and check **Dev Mode Status**. |
| `Permission denied (publickey)` | The SSH key changed (Developer Mode was turned off and on). Turn on **Key Server** and run `scripts/setup-devmode.sh` again. |
| `.tv_key: No such file` | Pair first: `node tools/pair.js <tv-ip>` |
| `ares-package: command not found` | Run `scripts/setup-devmode.sh` (it installs the LG CLI into `.devmode/tools`) |

## The apps disappeared from the TV

Developer Mode expired. Turn it on again, then run `scripts/setup-devmode.sh` and `scripts/deploy.sh`. Press **Extend Session Time** regularly to avoid this.

## The TV is slow

- Press **Free memory** in the **Remote** tab, or open apps from **Home Screen** (it frees memory first).
- See what uses memory:

  ```bash
  ssh -F .devmode/ssh_config lgtv 'free; for d in /proc/[0-9]*; do r=$(grep VmRSS $d/status 2>/dev/null | awk "{print \$2}"); [ -n "$r" ] && echo "$r $(cat $d/comm)"; done | sort -rn | head'
  ```

  The largest process is usually `QtWebProcess`, the engine of the web app on screen.

- A high load average (4–5) alone is normal on this TV. See [pitfalls](05-webos1-pitfalls.md#other).
