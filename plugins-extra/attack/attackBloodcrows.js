/*
 * Extra plugin: bloodcrow event attack automation.
 * - Targeted for kingdom 0 event 103 with various difficulty levels.
 * - Uses event score shutoff and commander selection logic.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Select",
                key: "eventDifficulty",
                selection: [
                    "Classic",
                    "Easy",
                    "Easy+",
                    "Intermediate",
                    "Intermediate+",
                    "Hard",
                    "Hard+",
                    "Expert",
                    "Expert+",
                    "Master",
                    "Master+",
                    "Archmaster"
                ],
                default: "4"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                default: false
            },
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
                type: "Text",
                key: "scoreShutoff"
            }
        ]

    }
//cri={"OID":6,"CID":47,"SID":0,"KID":,"AID":}
const err = require("../../err.json")
const { spendSkip } = require("../../plugins/skips.js")
const { movementEvents, ClassTypes, getResourceCastleList, ClientCommands, AreaType, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("../../plugins/attack/attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../../plugins/commander.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { getCommanderStats } = require("../getCommanderStats.js")
const units = require("../../items/units.json")
const pretty = require('pretty-time')
const getAreaCached = require('../../getMap.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const kingdomID = KingdomID.greatEmpire
const type = AreaType.bloodcrowCastle
const minTroopCount = 1000
const eventID = 103
let eventPoints = 0

const skipTarget = async (AI) => {
    while (AI.extraData[2] > 0) {
        let skip = spendSkip(AI.extraData[2])

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        await sendXT("msd", JSON.stringify({ X: AI.x, Y: AI.y, MID: -1, NID: -1, MST: skip, KID: `${kingdomID}` }))
        let [obj, result] = await waitForResult("msd", 7000, (obj, result) => result != 0 ||
            new ClassTypes.GAAAreaInfo(obj.AI).type == type)

        if (Number(result) != 0)
            break

        Object.assign(AI, new ClassTypes.GAAAreaInfo(obj.AI))
    }
}

xtHandler.on("cat", (obj, result) => {
    if (result != 0)
        return

    let attackSource = obj.A.M.SA

    if (attackSource[0] != type)
        return

    skipTarget(new ClassTypes.GAAAreaInfo(attackSource))
})

let quit = false

if (parseInt(pluginOptions.eventScoreShutoff) <= 0)
    pluginOptions.eventScoreShutoff = Infinity

xtHandler.on("pep", obj => {
    if (obj.EID != eventID)
        return
    eventPoints = Number(obj.OP[0])
    if (eventPoints >= parseInt(pluginOptions.eventScoreShutoff)) {
        console.log("shuttingDownEvent", "scoreReached")
        quit = true
    }
})

events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (eventInfo.EDID == -1) {
        const eventDifficultyID =
            Number(eventsDifficulties.find(e =>
                ((pluginOptions.eventDifficulty)) == e.difficultyTypeID &&
                e.eventID == eventID)
                .difficultyID)

        await sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
        await waitForResult("sede", 1000 * 10)
        eventInfo.EDID = eventDifficultyID
    }
    let classic = false
    if(eventInfo.EDID == 0)
        classic = true

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.mainCastle == e.type);
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

    quit = false

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                const AI = areaInfo.shift()

                areaInfo.push(AI)
                
                await skipTarget(AI)
                const level = 70
                
                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerEventTools = []
                const attackerWallEventTools = []
                const attackerGateEventTools = []
                const attackerShieldEventTools = []
                const attackerMoatEventTools = []

                const attackerWallTools = []
                const attackerShieldTools = []
                const attackerGateTools = []
                const attackerMoatTools = []
                const attackerWallwagons = []
                
                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.wodID == 277)
                        continue

                    if(unitInfo.amountPerWave != undefined)
                        continue

                    if(unitInfo.clientUsageEventID && !unitInfo.clientUsageEventID.split(',').includes(`${eventID}`))
                        continue
                    // if(unitInfo.filter(e => e[0].slotTypes.split(',').find(e => e == 9)) &&
                    //     unitInfo.effects.split(',').find(e => e.split('&')[0] == 29))
                    //         attackerWallwagons.push([unitInfo, unit.ammount])
                    else if (unitInfo.fameBonus != undefined) {
                        if (unitInfo.gateBonus)
                            attackerGateEventTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.moatBonus)
                            attackerMoatEventTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallEventTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldEventTools.push([unitInfo, unit.ammount])
                        else
                            attackerEventTools.push([unitInfo, unit.ammount])
                    }
                    else if (
                        unitInfo.toolCategory &&
                        unitInfo.usageEventID == undefined &&
                        unitInfo.allowedToAttack == undefined &&
                        unitInfo.typ == 'Attack'
                    ) {
                        if (unitInfo.gateBonus)
                            attackerGateTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.moatBonus)
                            attackerMoatTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
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

                attackerEventTools.sort((a, b) =>
                    Number(b[0].fameBonus) - Number(a[0].fameBonus))
                attackerGateEventTools.sort((a, b) =>
                    Number(b[0].fameBonus) - Number(a[0].fameBonus))
                attackerWallEventTools.sort((a, b) =>
                    Number(b[0].fameBonus) - Number(a[0].fameBonus))
                attackerShieldEventTools.sort((a, b) =>
                    Number(b[0].fameBonus) - Number(a[0].fameBonus))
                attackerMoatEventTools.sort((a, b) =>
                    Number(b[0].fameBonus) - Number(a[0].fameBonus))
                // attackerWallwagons.sort((a,b) => {
                //     b.effects.split(',').find(e => e.split('&')[0] == 29).split('&')[1] -
                //     a.effects.split(',').find(e => e.split('&')[0] == 29).split('&')[1]
                // })
                if (pluginOptions.lowValueChests) {
                    attackerEventTools.reverse()
                    attackerGateEventTools.reverse()
                    attackerWallEventTools.reverse()
                    attackerShieldEventTools.reverse()
                    attackerMoatEventTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(b[0].wallBonus) - Number(a[0].wallBonus))
                attackerShieldTools.sort((a, b) =>
                    Number(b[0].defRangeBonus) - Number(a[0].defRangeBonus))
                attackerGateTools.sort((a, b) =>
                    Number(b[0].gateBonus) - Number(a[0].gateBonus))
                attackerMoatTools.sort((a, b) =>
                    Number(b[0].moatBonus) - Number(a[0].moatBonus))

                attackerWallEventTools.push(...attackerWallTools)
                attackerShieldEventTools.push(...attackerShieldTools)
                attackerGateEventTools.push(...attackerGateTools)
                attackerMoatEventTools.push(...attackerMoatTools)

                await sendXT("adi", JSON.stringify({
                    SX: sourceCastleArea.x,
                    SY: sourceCastleArea.y,
                    TX: AI.x,
                    TY: AI.y,
                    KID: kingdomID
                }))

                const [obj2,r2] = await waitForResult("adi", 1000 * 10)

                if(r2 != 0)
                    return

                const commanderStats = getCommanderStats(commander, obj2)

                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, commanderStats.additionalAttackToolAmountFlank)
                const maxToolsFront = getTotalAmountToolsFront(level)

                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallEventTools : attackerMoatEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallEventTools : attackerMoatEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 :
                                i == 1 ? 15 : 99
                            const tool = i == 0 ? attackerWallEventTools :
                                i == 1 ? attackerGateEventTools : attackerMoatEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

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
                        return
                    }
                    else if(index == 1) {
                        wave.L.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallEventTools : attackerShieldEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 15 : 99
                            const tool = i == 0 ? attackerWallEventTools : attackerShieldEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) => {
                            const desiredToolCount = i == 0 ? 10 :
                                i == 1 ? 10 : 99
                            const tool = i == 0 ? attackerWallEventTools :
                                i == 1 ? attackerGateEventTools : attackerShieldEventTools

                            maxTools -= assignUnit(unitSlot, tool, Math.min(maxTools, desiredToolCount))
                        })

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
                        return
                    }
                    else if (!pluginOptions.noChests) {
                        const selectTool = i => {
                            let tools = pluginOptions.eventWallToolsFirst ? [] : attackerEventTools
                            if (tools.length == 0) {
                                if (i == 0) {
                                    tools = attackerWallEventTools
                                    if (tools.length == 0)
                                        tools = attackerShieldEventTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldEventTools
                                    if (tools.length == 0)
                                        tools = attackerWallEventTools
                                }
                                if (i == 2) {
                                    tools = attackerGateEventTools
                                    if (tools.length == 0)
                                        tools = attackerWallEventTools
                                    if (tools.length == 0)
                                        tools = attackerShieldEventTools
                                }
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
                    }

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
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                });
                
                let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level) + 
                    Number(0 | commanderStats.attackUnitAmountReinforcementBonus) * 
                    (1 + Number(0 | commanderStats.attackUnitAmountReinforcementBoost) / 100)
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ?
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker, maxTroops)
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
            console.warn(e)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                case "NO_PLAYER_SPAWNED_YET":
                case "INVALID_POSITION":
                case "MISSING_UNITS":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})