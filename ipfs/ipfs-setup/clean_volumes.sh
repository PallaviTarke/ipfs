#!/bin/bash
# Clear contents of specified Docker volumes
for volume in ipfs-setup_ipfs1-data ipfs-setup_ipfs2-data ipfs-setup_ipfs3-data ipfs-setup_ipfs4-data; do
  echo "Cleaning volume: $volume"
  docker run --rm -v $volume:/data alpine sh -c "rm -rf /data/*"
done
