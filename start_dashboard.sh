#!/usr/bin/env bash
# Inicia o serviço da control plane do Vanguard Dashboard
systemctl start vanguard-dashboard
systemctl status vanguard-dashboard --no-pager
