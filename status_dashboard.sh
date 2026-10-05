#!/usr/bin/env bash
# Verifica o status da control plane do Vanguard Dashboard
systemctl status vanguard-dashboard --no-pager
echo ""
echo "=== Health Endpoint ==="
curl -s http://localhost:3001/api/health || echo "Serviço inacessível"
echo ""
