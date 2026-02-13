#!/bin/bash
set -e
sudo tee /etc/systemd/system/cloudflared-tunnel.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Tunnel for WisePlan
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url http://localhost:80
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-tunnel
sudo systemctl start cloudflared-tunnel
echo "Tunnel running. Get URL: sudo journalctl -u cloudflared-tunnel -n 50 --no-pager | grep trycloudflare"
