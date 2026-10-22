# 2. Turn on Developer Mode

Developer Mode is an official LG feature. It lets you install your own apps on the TV and opens an SSH connection for development. It is not rooting: the apps run in a restricted "jail" and cannot change the system.

## Create an LG Developer account

1. Go to [webostv.developer.lge.com](https://webostv.developer.lge.com) and create a free account.
2. Note the user ID (or email) and password. You type them on the TV with the remote, so a short ID with letters and numbers is easier.

## Install and turn on the Developer Mode app

1. On the TV, open the **LG Content Store** and install **Developer Mode**.
2. Open **Developer Mode** and sign in with the LG Developer account.
3. Turn on **Dev Mode Status**. The TV restarts.
4. Open **Developer Mode** again. It now shows:

| Field | Meaning |
| --- | --- |
| IP Address | The TV address on your network |
| Passphrase | Password for the SSH key (six characters) |
| Remain Session | Time until Developer Mode turns off (about 1000 hours on webOS 1.4) |
| Key Server | Lets a computer download the SSH key on port 9991 |
| Extend Session Time | Resets the remaining time |

## Set up SSH on the computer

1. In **Developer Mode**, turn on **Key Server**.
2. Run the setup script. Type the **Passphrase** from the TV screen when OpenSSL asks for it:

   ```bash
   TV_IP=192.168.1.50 scripts/setup-devmode.sh
   ```

   The script downloads the key, removes its passphrase, writes `.devmode/ssh_config`, installs the LG CLI locally, and tests the connection. It ends with a line like `Connected to LGSmartTV, webOS 1.4.0`.

3. Turn off **Key Server** on the TV. You do not need it again.

Now you can open a shell on the TV:

```bash
ssh -F .devmode/ssh_config lgtv
```

The shell runs as user `prisoner` inside the developer jail. It can install and remove developer apps and run Node.js, but it cannot change the system.

### Why the script removes the passphrase with OpenSSL

The TV gives an old-format key (PEM, AES-128 encrypted). Newer `ssh-keygen` builds can report `incorrect passphrase` for this format even when the passphrase is right. `openssl rsa` reads it reliably.

### Why `ssh-rsa` is enabled

The TV's SSH server (from 2014) offers only `ssh-rsa` keys. Modern OpenSSH turns that off by default, so `ssh_config` turns it on for this host only.

## Keep Developer Mode alive

Developer Mode turns off when **Remain Session** reaches zero. Then the TV may remove the apps you installed.

- Open **Developer Mode** and press **Extend Session Time** before the time runs out.
- With about 1000 hours, that is roughly once every 40 days. Put a reminder in your calendar.

Next: [Install on the TV](03-install-on-the-tv.md).
