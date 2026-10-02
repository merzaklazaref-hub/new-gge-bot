/*
 * Plugin: berimond invasion attack manager.
 * - Manages wave composition around chests, reputation, and commander whitelists.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Text",
                key: "wavesTillChests",
                default: "4"
            },
            {
                type: "Checkbox",
                key: "noEventTools",
                default: false
            },
            {
                type: "Checkbox",
                key: "reputation",
                default: false
            }
        ]

    }
const { movementEvents, movements, getResourceCastleList, ClientCommands, AreaType, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require('../commander.js')
const { sendXT, waitForResult, events, playerInfo, botConfig } = require('../../ggeBot.js')
const { getCommanderStats } = require('../../getEquipment.js')
const units = require('../../items/units.json')
const pretty = require('pretty-time')
const getAreaCached = require('../../getMap.js')
const err = require('../../err.json')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

const kingdomID = KingdomID.greatEmpire
const type = AreaType.beriCamp
const minTroopCount = 100
const eventID = 85
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let quit = false

events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return
    
    if(quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if(eventInfo.EID != eventID)
        return
    
    quit = false

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.mainCastle == e.type)

    let error = false
    let gaa
    do {
        try {
            gaa = await getAreaCached(kingdomID,
                sourceCastleArea.x - 50, sourceCastleArea.y - 50,
                sourceCastleArea.x + 50, sourceCastleArea.y + 50)
            error = false
        } catch (e) {
            console.error(e)
            error = true
        }
    } while (error);

    let areaInfo = gaa.areaInfo.filter(ai => ai.type == type)
    let areaCursor = 0

    const refreshCampAreas = async () => {
        try {
            const refreshed = await getAreaCached(kingdomID,
                sourceCastleArea.x - 50, sourceCastleArea.y - 50,
                sourceCastleArea.x + 50, sourceCastleArea.y + 50)

            const camps = refreshed.areaInfo.filter(ai => ai.type == type)
            if (camps.length <= 0)
                return

            areaInfo = camps
            areaCursor %= areaInfo.length
        } catch (e) {
            console.debug(e)
        }
    }

    const pickReadyCamp = () => {
        if (areaInfo.length <= 0)
            return

        const now = Date.now()
        for (let i = 0; i < areaInfo.length; i++) {
            const index = (areaCursor + i) % areaInfo.length
            const AI = areaInfo[index]

            const cooldownSeconds = Number(AI.extraData?.[2]) || 0
            const requestTime = Number(AI.timeSinceRequest) || now
            const remainingCooldown = requestTime + cooldownSeconds * 1000 - now

            if (remainingCooldown > 1200)
                continue

            if (movements.find(movement =>
                movement.kingdomID == kingdomID &&
                movement.targetAttack?.x == AI.x &&
                movement.targetAttack?.y == AI.y))
                continue

            areaCursor = (index + 1) % areaInfo.length
            return AI
        }
    }

    while (!quit) {
        await refreshCampAreas()

        const selectedCamp = pickReadyCamp()
        if (!selectedCamp) {
            await delay(1500)
            continue
        }

        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                let AI = selectedCamp

                try {
                    const refreshedArea = await getAreaCached(kingdomID, AI.x, AI.y, AI.x, AI.y)
                    const liveCamp = refreshedArea.areaInfo.find(area =>
                        area.type == type && area.x == AI.x && area.y == AI.y)

                    if (!liveCamp)
                        return

                    const cooldownSeconds = Number(liveCamp.extraData?.[2]) || 0
                    const requestTime = Number(liveCamp.timeSinceRequest) || Date.now()
                    const remainingCooldown = requestTime + cooldownSeconds * 1000 - Date.now()

                    if (remainingCooldown > 1200)
                        return

                    if (movements.find(movement =>
                        movement.kingdomID == kingdomID &&
                        movement.targetAttack?.x == liveCamp.x &&
                        movement.targetAttack?.y == liveCamp.y))
                        return

                    AI = liveCamp

                    const index = areaInfo.findIndex(area => area.x == AI.x && area.y == AI.y)
                    if (index != -1)
                        areaInfo[index] = AI
                } catch (e) {
                    console.debug(e)
                    return
                }

                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                const level = AI.extraData[1] + AI.extraData[6] == 100 ? 70 : 56

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if(unitInfo.wodID == 277)
                        continue
                    
                    else if (unitInfo.pointBonus && !pluginOptions.noEventTools) {
                        if (unitInfo.gateBonus)
                            attackerGateBerimondTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallBerimondTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldBerimondTools.push([unitInfo, unit.ammount])
                        else if (!pluginOptions.reputation)
                            attackerBerimondTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.reputationBonus && pluginOptions.reputation && !pluginOptions.noEventTools) {
                        attackerBerimondTools.push([unitInfo, unit.ammount])
                    }
                    else if (
                        unitInfo.toolCategory &&
                    unitInfo.usageEventID  == undefined &&
                    unitInfo.allowedToAttack  == undefined &&
                    unitInfo.typ == 'Attack' &&
                    unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus)
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, unit.ammount])
                    }
                }

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e[1])
                attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"
                if (pluginOptions.reputation) {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b[0].reputationBonus) - Number(a[0].reputationBonus))
                }
                else {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b[0].pointBonus) - Number(a[0].pointBonus))
                }
                attackerGateBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBerimondTools.reverse()
                    attackerGateBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }
                
                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)

                const commanderStats = getCommanderStats(commander)
                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerBerimondTools.length == 0 ? 20 : 10

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallBerimondTools :
                                i == 1 ? attackerGateBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        attackerMeleeTroops.sort((a, b) => Number(a[0].meleeAttack) - Number(b[0].meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a[0].rangeAttack) - Number(b[0].rangeAttack))
                    }
                    else if (!pluginOptions.noEventTools) {
                        const selectTool = i => {
                            let tools = attackerBerimondTools
                            if (tools.length == 0 || ((!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))) {
                                if (i == 0) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))
                                        tools = attackerShieldBerimondTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))
                                        tools = attackerWallBerimondTools
                                }
                                if (i == 2) {
                                    tools = attackerGateBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))
                                        tools = attackerWallBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))
                                        tools = attackerShieldBerimondTools
                                }
                                if ((!tools[0]?.[0]?.pointBonus && !tools[0]?.[0]?.reputationBonus))
                                    tools = []
                            }

                            return tools
                        }

                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    }
                })
                let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | commanderStats.attackUnitAmountReinforcementBonus)
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ? 
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) : 
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker,
                        Math.floor(maxTroops / 2) - 1)
                    })

                    await sendXT("cra", JSON.stringify(attackInfo))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })
                return { ...obj, result: r }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]


            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if(movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return
                        
                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                case "MISSING_UNITS":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})