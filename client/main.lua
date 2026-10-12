--[[
    ╔══════════════════════════════════════════════════════════════╗
    ║  vanguard_dashboard — Client Script (main.lua)              ║
    ║  Ponte de alta performance entre o jogo e o NUI             ║
    ╚══════════════════════════════════════════════════════════════╝
    Consumo em repouso: 0.00 ms (Zero ticks por frame)
]]

local isNUIConnected = false
local currentStreamToken = nil
local currentStreamTimestamp = 0

local function SendConfigToNUI()
    local pId = GetPlayerServerId(PlayerId())
    if not pId or pId <= 0 then return end

    SendNUIMessage({
        type = 'init',
        backendUrl = FW_CONFIG.PUBLIC_BACKEND_URL or 'https://137.131.156.73.sslip.io',
        apiSecret = FW_CONFIG.API_SECRET or '',
        streamToken = currentStreamToken,
        playerId = pId,
        streamFps = FW_CONFIG.STREAM_FPS or 20,
        streamQuality = FW_CONFIG.STREAM_QUALITY or 0.5,
        resolutionScale = FW_CONFIG.STREAM_RESOLUTION_SCALE or 0.5,
    })
end

-- Recebe Stream Token efêmero assinado individualmente pelo servidor
RegisterNetEvent('vanguard_dashboard:client:setStreamToken', function(tokenData)
    if tokenData and tokenData.token then
        currentStreamToken = tokenData.token
        currentStreamTimestamp = tokenData.timestamp or 0
        SendNUIMessage({
            type = 'setStreamToken',
            streamToken = currentStreamToken,
            timestamp = currentStreamTimestamp
        })
    end
end)

-- Handshake disparado quando o DOM do NUI termina de carregar
RegisterNUICallback('nuiReady', function(_, cb)
    cb({})
    TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
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
        TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
        SendConfigToNUI()

        local retries = 0
        while not isNUIConnected and retries < 10 do
            Wait(6000)
            if not isNUIConnected then
                retries = retries + 1
                TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
                SendConfigToNUI()
            end
        end
    end)
end)

AddEventHandler('playerSpawned', function()
    CreateThread(function()
        Wait(2000)
        TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
        if not isNUIConnected then
            SendConfigToNUI()
        end
    end)
end)

RegisterCommand('reconnect_telagem', function()
    isNUIConnected = false
    TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
    SendConfigToNUI()
end, false)

RegisterCommand('telagem_reset', function()
    isNUIConnected = false
    TriggerServerEvent('vanguard_dashboard:server:requestStreamToken')
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

local isPlayerFrozen = false

RegisterNetEvent('vanguard_dashboard:client:freeze', function(toggle)
    isPlayerFrozen = (toggle == true)
    local ped = PlayerPedId()

    if DoesEntityExist(ped) then
        FreezeEntityPosition(ped, isPlayerFrozen)
        if IsPedInAnyVehicle(ped, false) then
            local veh = GetVehiclePedIsIn(ped, false)
            if DoesEntityExist(veh) then
                FreezeEntityPosition(veh, isPlayerFrozen)
            end
        end
    end

    if isPlayerFrozen then
        -- Thread contínua para manter o jogador congelado mesmo se NoClip ou outro recurso tentar descongelar
        CreateThread(function()
            while isPlayerFrozen do
                local currentPed = PlayerPedId()
                if DoesEntityExist(currentPed) then
                    FreezeEntityPosition(currentPed, true)
                    DisablePlayerFiring(PlayerId(), true)
                    -- Desabilita comandos de locomoção, pulo, sprint e ataque
                    DisableControlAction(0, 24, true)  -- Attack
                    DisableControlAction(0, 25, true)  -- Aim
                    DisableControlAction(0, 30, true)  -- Move LR
                    DisableControlAction(0, 31, true)  -- Move UD
                    DisableControlAction(0, 32, true)  -- Move W
                    DisableControlAction(0, 33, true)  -- Move S
                    DisableControlAction(0, 34, true)  -- Move A
                    DisableControlAction(0, 35, true)  -- Move D
                    DisableControlAction(0, 21, true)  -- Sprint
                    DisableControlAction(0, 22, true)  -- Jump
                    DisableControlAction(0, 23, true)  -- Enter vehicle
                    DisableControlAction(0, 75, true)  -- Exit vehicle
                    DisableControlAction(0, 140, true) -- Melee
                    DisableControlAction(0, 141, true) -- Melee
                    DisableControlAction(0, 142, true) -- Melee

                    if IsPedInAnyVehicle(currentPed, false) then
                        local veh = GetVehiclePedIsIn(currentPed, false)
                        if DoesEntityExist(veh) then
                            FreezeEntityPosition(veh, true)
                        end
                    end
                end
                Wait(0)
            end

            -- Ao descongelar, garante liberação da entidade
            local finalPed = PlayerPedId()
            if DoesEntityExist(finalPed) then
                FreezeEntityPosition(finalPed, false)
                if IsPedInAnyVehicle(finalPed, false) then
                    local veh = GetVehiclePedIsIn(finalPed, false)
                    if DoesEntityExist(veh) then
                        FreezeEntityPosition(veh, false)
                    end
                end
            end
        end)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:teleport', function(coords)
    if not coords then return end
    local ped = PlayerPedId()
    if DoesEntityExist(ped) then
        SetEntityCoords(ped, coords.x + 0.0, coords.y + 0.0, coords.z + 0.0, false, false, false, false)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:repairVehicle', function(netId)
    local veh = 0
    if netId and netId > 0 then
        veh = NetworkGetEntityFromNetworkId(netId)
    else
        veh = GetVehiclePedIsIn(PlayerPedId(), false)
    end

    if DoesEntityExist(veh) then
        SetVehicleFixed(veh)
        SetVehicleEngineHealth(veh, 1000.0)
        SetVehicleBodyHealth(veh, 1000.0)
        SetVehicleDirtLevel(veh, 0.0)
        SetVehicleUndriveable(veh, false)
    end
end)

RegisterNetEvent('vanguard_dashboard:client:deleteVehicle', function(netId)
    local veh = 0
    if netId and netId > 0 then
        veh = NetworkGetEntityFromNetworkId(netId)
    else
        veh = GetVehiclePedIsIn(PlayerPedId(), false)
    end

    if DoesEntityExist(veh) then
        SetEntityAsMissionEntity(veh, true, true)
        DeleteVehicle(veh)
    end
end)
