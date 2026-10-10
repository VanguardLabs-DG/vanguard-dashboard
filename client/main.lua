--[[
    ╔══════════════════════════════════════════════════════════════╗
    ║  vanguard_dashboard — Client Script (main.lua)              ║
    ║  Ponte de alta performance entre o jogo e o NUI             ║
    ╚══════════════════════════════════════════════════════════════╝
    Consumo em repouso: 0.00 ms (Zero ticks por frame)
]]

local isNUIConnected = false

local function SendConfigToNUI()
    local pId = GetPlayerServerId(PlayerId())
    if not pId or pId <= 0 then return end

    SendNUIMessage({
        type = 'init',
        backendUrl = FW_CONFIG.PUBLIC_BACKEND_URL or 'https://137.131.156.73.sslip.io',
        apiSecret = FW_CONFIG.API_SECRET,
        playerId = pId,
        streamFps = FW_CONFIG.STREAM_FPS or 20,
        streamQuality = FW_CONFIG.STREAM_QUALITY or 0.5,
        resolutionScale = FW_CONFIG.STREAM_RESOLUTION_SCALE or 0.5,
    })
end

-- Handshake disparado quando o DOM do NUI termina de carregar
RegisterNUICallback('nuiReady', function(_, cb)
    cb({})
    SendConfigToNUI()
end)

-- Callback disparado quando o NUI confirma conexão de socket com o backend
RegisterNUICallback('nuiConnected', function(_, cb)
    cb({})
    isNUIConnected = true
end)

-- Inicialização com watchdog inteligente e não bloqueante
AddEventHandler('onClientResourceStart', function(resourceName)
    if GetCurrentResourceName() ~= resourceName then return end

    CreateThread(function()
        Wait(1500)
        SendConfigToNUI()

        local retries = 0
        while not isNUIConnected and retries < 10 do
            Wait(6000)
            if not isNUIConnected then
                retries = retries + 1
                SendConfigToNUI()
            end
        end
    end)
end)

AddEventHandler('playerSpawned', function()
    CreateThread(function()
        Wait(2000)
        if not isNUIConnected then
            SendConfigToNUI()
        end
    end)
end)

RegisterCommand('reconnect_telagem', function()
    isNUIConnected = false
    SendConfigToNUI()
end, false)

RegisterCommand('telagem_reset', function()
    isNUIConnected = false
    SendConfigToNUI()
end, false)

-- ─── Ações Administrativas Executadas no Cliente (Pilar 3) ────

RegisterNetEvent('vanguard_dashboard:client:heal', function()
    local ped = PlayerPedId()
    if DoesEntityExist(ped) then
        SetEntityHealth(ped, 200)
        SetPedArmour(ped, 100)
        ClearPedBloodDamage(ped)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:revive', function()
    local ped = PlayerPedId()
    if DoesEntityExist(ped) then
        local coords = GetEntityCoords(ped)
        local heading = GetEntityHeading(ped)
        NetworkResurrectLocalPlayer(coords.x, coords.y, coords.z, heading, true, false)
        SetEntityHealth(ped, 200)
        ClearPedBloodDamage(ped)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:freeze', function(toggle)
    local ped = PlayerPedId()
    if DoesEntityExist(ped) then
        FreezeEntityPosition(ped, toggle == true)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:teleport', function(coords)
    if not coords then return end
    local ped = PlayerPedId()
    if DoesEntityExist(ped) then
        SetEntityCoords(ped, coords.x + 0.0, coords.y + 0.0, coords.z + 0.0, false, false, false, false)
    end
end)
