#!/bin/sh
set -e

CONFIG_FILE="/data/ipfs-cluster/service.json"

# Patch REST API listen address if needed
if grep -q "/ip4/127.0.0.1/tcp/9094" "$CONFIG_FILE"; then
  echo "[*] Patching REST API listen address to 0.0.0.0..."
  sed -i 's#/ip4/127.0.0.1/tcp/9094#/ip4/0.0.0.0/tcp/9094#' "$CONFIG_FILE"
fi

exec ipfs-cluster-service daemon
