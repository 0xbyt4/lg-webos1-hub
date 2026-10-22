#!/usr/bin/env bash
# One-time Developer Mode setup on the computer.
# Usage: TV_IP=192.168.1.50 scripts/setup-devmode.sh
#
# Before running: turn on "Dev Mode Status" and "Key Server" in the TV's Developer Mode
# app, and note the Passphrase it shows. You type the passphrase when openssl asks; it is
# never stored. The script:
#   1. downloads the TV's SSH key from the key server (port 9991),
#   2. removes the key's passphrase (openssl asks for it),
#   3. writes .devmode/ssh_config with a host named "lgtv",
#   4. installs the LG webOS CLI into .devmode/tools (no global install),
#   5. checks the SSH connection.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TV_IP="${TV_IP:?set TV_IP to the TV address, e.g. TV_IP=192.168.1.50}"
DEV="$ROOT/.devmode"
CLI_VERSION="3.2.6"

if ! [[ "$TV_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "invalid TV_IP: $TV_IP" >&2
  exit 1
fi

mkdir -p "$DEV"
chmod 700 "$DEV"

echo "1/5 Downloading the SSH key from the TV key server..."
if ! curl -fsS -m 10 -o "$DEV/webos_rsa" "http://$TV_IP:9991/webos_rsa"; then
  echo "Could not reach the key server. Turn on \"Key Server\" in the Developer Mode app." >&2
  exit 1
fi
chmod 600 "$DEV/webos_rsa"

echo "2/5 Removing the key passphrase. Type the Passphrase shown in the Developer Mode app."
# Older OpenSSH builds may refuse the TV's legacy PEM key, so openssl does the decryption.
openssl rsa -in "$DEV/webos_rsa" -out "$DEV/webos_rsa.open"
chmod 600 "$DEV/webos_rsa.open"

echo "3/5 Writing $DEV/ssh_config..."
cat > "$DEV/ssh_config" <<EOF
Host lgtv
  HostName $TV_IP
  Port 9922
  User prisoner
  IdentityFile $DEV/webos_rsa.open
  IdentitiesOnly yes
  UserKnownHostsFile $DEV/known_hosts
  StrictHostKeyChecking accept-new
  HostKeyAlgorithms +ssh-rsa
  PubkeyAcceptedAlgorithms +ssh-rsa
  ConnectTimeout 10
  LogLevel ERROR
EOF

echo "4/5 Installing the LG webOS CLI $CLI_VERSION into $DEV/tools..."
npm install --prefix "$DEV/tools" "@webos-tools/cli@$CLI_VERSION" --no-fund --no-audit --loglevel=error

echo "5/5 Checking the SSH connection..."
ssh -F "$DEV/ssh_config" lgtv 'echo "Connected to $(uname -n), webOS $(grep -o "\"webos_release\": \"[^\"]*" /var/run/nyx/os_info.json | cut -d\" -f4)"'

echo "Done. You can turn off \"Key Server\" on the TV now."
