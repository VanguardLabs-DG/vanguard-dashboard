--[[
  ╔══════════════════════════════════════════════════════════════╗
  ║  fivem-watch — FiveM Resource Manifest                      ║
  ║  Real-time player monitoring & live screen streaming         ║
  ║  Repository: https://github.com/user/fivem-watch             ║
  ╚══════════════════════════════════════════════════════════════╝

  DEPENDENCIES: None (100% Standalone)
  This resource requires NO external scripts or databases.

  HOW IT WORKS:
  1. Server script periodically collects player telemetry
     (ID, name, coords, health, armor, ping) and pushes it
     to the fivem-watch backend via HTTP.
  2. Client script runs a hidden NUI page that maintains a
     WebSocket connection to the backend. When an admin requests
     a live stream, the NUI captures the game screen using
     WebGL and sends WebP frames over the socket.
]]

fx_version 'cerulean'
game 'gta5'

name         'vanguard_dashboard'
description  'Painel de Monitoramento em Tempo Real & Live Screen Streaming — Vanguard Dashboard'
author       'Vanguard / rnaefe'
version      '1.0.0'

-- Server-side script (telemetry push)
server_scripts {
  'config.js',
  'server/main.js'
}

-- Client-side script (NUI bridge em Lua 5.4 - 0.00ms resmon)
client_scripts {
  'config.lua',
  'client/main.lua'
}

-- Hidden NUI page (WebGL screenshot + Socket.io)
ui_page 'web/index.html'

files {
  'web/index.html',
  'web/socket.io.min.js',
  'web/cfx-three.min.js'
}
