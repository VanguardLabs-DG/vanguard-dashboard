#!/usr/bin/env bash
# Para o serviço da control plane do Vanguard Dashboard
systemctl stop vanguard-dashboard
systemctl status vanguard-dashboard --no-pager
