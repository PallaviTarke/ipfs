#!/bin/bash

# Wait for redis-master to resolve
until getent hosts redis-master > /dev/null; do
  echo "Waiting for redis-master to be resolvable..."
  sleep 1
done

MASTER_IP=$(getent hosts redis-master | awk '{ print $1 }')
echo "Resolved redis-master to $MASTER_IP"

# Create config directory if it doesn't exist
mkdir -p /tmp/redis

cat <<EOF > /tmp/redis/sentinel.conf
port 26379
dir /tmp
sentinel monitor mymaster $MASTER_IP 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
EOF

exec redis-server /tmp/redis/sentinel.conf --sentinel
