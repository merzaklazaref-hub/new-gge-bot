/*
 * Plugin: automated nomad attacks.
 * - Supports configurable troop selection based on food/mead and target definitions.
 * - Optional cooldown skip automation and target coordinate override.
 */
const sideTroopTypeSelection = [
    { label: "Auto", value: "auto" },
    { label: "Range food", value: "rangeFood" },
    { label: "Melee food", value: "meleeFood" },
    { label: "Range mead", value: "rangeMead" },
    { label: "Melee mead", value: "meleeMead" }
]

if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99",
                placeholder: "e.g. 1-99 or 1,3,5-8"
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
                type: "Checkbox",
                key: "useFood",
                default: true
            },
            {
                type: "Checkbox",
                key: "noTools",
                default: false
            },
            {
                type: "Text",
                key: "targetCampCoordinates",
                default: "",
                placeholder: "e.g. 512:447, 517:442, 521:446"
            },
            {
                type: "Checkbox",
                key: "useCooldownSkips",
                default: false
            },
            {
                type: "Text",
                key: "attackWaves",
                default: "1",
                placeholder: "e.g. 1"
            },
            {
                type: "Checkbox",
                key: "attackLeft",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackMiddle",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackRight",
                default: true
            },
            {
                type: "Checkbox",
                key: "attackCourtyard",
                default: true
            },
            {
                type: "Text",
                key: "leftTroopCount",
                default: "",
                placeholder: "e.g. 250"
            },
            {
                type: "Text",
                key: "middleTroopCount",
                default: "",
                placeholder: "e.g. 300"
            },
            {
                type: "Text",
                key: "rightTroopCount",
                default: "",
                placeholder: "e.g. 250"
            },
            {
                type: "Select",
                key: "leftTroopType",
                selection: sideTroopTypeSelection,
                default: "auto"
            },
            {
                type: "Select",
                key: "middleTroopType",
                selection: sideTroopTypeSelection,
                default: "auto"
            },
            {
                type: "Select",
                key: "rightTroopType",
                selection: sideTroopTypeSelection,
                default: "auto"
            },
            {
                type: "Text",
                key: "scoreShutoff",
                placeholder: "e.g. 50000 (leave empty for no limit)"
            }
        ]

    }

const err = require("../../err.json")
const { spendSkip } = require("../skips.js")
const { movementEvents, ClassTypes, getResourceCastleList, ClientCommands, AreaType, KingdomID } = require('../../protocols.js')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { getCommanderStats } = require("../../getEquipment.js")
const eventAutoScalingCamps = require("../../items/eventAutoScalingCamps.json")
const nomadCampsClassic = require("../../items/nomadCamps.json")
const units = require("../../items/units.json")
const pretty = require('pretty-time')
const getAreaCached = require('../../getMap')
const pluginKey = require('path').basename(__filename).slice(0, -3)
const pluginOptions = {}
const syncPluginOptions = () => {
    Object.keys(pluginOptions).forEach(key => delete pluginOptions[key])
    Object.assign(pluginOptions
        , structuredClone(botConfig.plugins[pluginKey] ?? {})
        , botConfig.plugins["attack"] ?? {})
}
syncPluginOptions()
events.on("configModified", syncPluginOptions)

const kingdomID = KingdomID.greatEmpire
const type = AreaType.nomadCamp
const minTroopCount = 32
const eventID = 72
let nomadsPoints = 0

const hasExplicitCountValue = value => String(value ?? "").trim().length > 0

const parseConfiguredTroopCount = (value, maxCount, hasAnyExplicitCount) => {
    if (!hasExplicitCountValue(value))
        return hasAnyExplicitCount ? 0 : maxCount

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0)
        return 0

    return Math.min(maxCount, Math.floor(parsed))
}

const parseCampCoordinates = value => {
    const textValue = String(value ?? "").trim()
    if (!textValue)
        return []

    const pairMatches = textValue.match(/-?\d+\s*[,:\s]\s*-?\d+/g) ?? []
    const seen = new Set()
    const coordinates = []

    pairMatches.forEach(pair => {
        const [xRaw, yRaw] = pair.trim().split(/\s*[,:\s]\s*/)
        const x = Number(xRaw)
        const y = Number(yRaw)
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return

        const key = `${x}:${y}`
        if (seen.has(key))
            return

        seen.add(key)
        coordinates.push({ x, y })
    })

    return coordinates
}

const useCooldownSkips = () => Boolean(pluginOptions.useCooldownSkips)

const refreshCampAreaInfo = async AI => {
    try {
        const area = await getAreaCached(kingdomID, AI.x, AI.y, AI.x, AI.y)
        const liveCamp = area.areaInfo?.find(entry => entry.type == type && entry.x == AI.x && entry.y == AI.y)
        if (liveCamp)
            Object.assign(AI, liveCamp)
    }
    catch (e) {
        console.debug("failedToRefreshCampAreaInfo", e?.message ?? e)
    }
}

const skipTarget = async AI => {
    while (AI.extraData[2] > 0) {
        const skip = spendSkip(AI.extraData[2])

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

    if (!useCooldownSkips())
        return

    let attackSource = obj.A.M.SA

    if (attackSource[0] != type)
        return

    skipTarget(new ClassTypes.GAAAreaInfo(attackSource))
        .catch(e => console.warn(e?.message ?? e))
})

let quit = false

xtHandler.on("pep", obj => {
    if (obj.EID != eventID)
        return

    if (pluginOptions.nomadsScoreShutoff <= 0)
        pluginOptions.nomadsScoreShutoff = Infinity

    nomadsPoints = Number(obj.OP[0])
    if (nomadsPoints >= pluginOptions.nomadsScoreShutoff) {
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
    } while (error)

    const configuredCampCoordinates = parseCampCoordinates(pluginOptions.targetCampCoordinates)

    let areaInfo = gaa.areaInfo.filter(ai => ai.type == type)
        .sort((a, b) => 
            (Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
            (Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))
        .sort((a, b) => a.extraData[6] - b.extraData[6])

    if (configuredCampCoordinates.length > 0) {
        const indexedAreaInfo = new Map(areaInfo.map(ai => [`${ai.x}:${ai.y}`, ai]))
        const configuredAreaInfo = configuredCampCoordinates
            .map(coord => indexedAreaInfo.get(`${coord.x}:${coord.y}`))
            .filter(Boolean)

        const missingCoordinates = configuredCampCoordinates.length - configuredAreaInfo.length
        if (missingCoordinates > 0)
            console.warn("someCampCoordinatesNotFound", missingCoordinates)

        if (configuredAreaInfo.length == 0) {
            console.error("noValidCampCoordinates")
            return
        }

        areaInfo = configuredAreaInfo
    }

    quit = false

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                const AI = areaInfo.shift()
                if (!AI)
                    throw "NO_TARGET_CAMPS"

                areaInfo.push(AI)

                await refreshCampAreaInfo(AI)

                if (useCooldownSkips())
                    await skipTarget(AI)
                else if (AI.extraData[2] > 0)
                    throw "COOLING_DOWN"

                const campInfo = classic ? nomadCampsClassic.find(obj => AI.extraData[1] == obj.id) :
                    eventAutoScalingCamps.find(obj => AI.extraData[5] == obj.eventAutoScalingCampID)

                const level = Number(classic ? (80 + campInfo.countVictory) : campInfo.camplevel)

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerMeleeFoodTroops = []
                const attackerRangeFoodTroops = []
                const attackerMeleeMeadTroops = []
                const attackerRangeMeadTroops = []
                const attackerNomadTools = []
                const attackerWallNomadTools = []
                const attackerGateNomadTools = []
                const attackerShieldNomadTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.wodID == 277)
                        continue

                    else if (unitInfo.khanTabletBooster != undefined && unitInfo.ragePointBonus == undefined) {
                        if (unitInfo.gateBonus)
                            attackerGateNomadTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallNomadTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldNomadTools.push([unitInfo, unit.ammount])
                        else
                            attackerNomadTools.push([unitInfo, unit.ammount])
                    }
                    else if (
                        unitInfo.toolCategory &&
                        unitInfo.usageEventID == undefined &&
                        unitInfo.allowedToAttack == undefined &&
                        unitInfo.typ == 'Attack' &&
                        unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus)
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        const isMeadTroop = unitInfo.meadSupply != undefined
                        const isFoodTroop = unitInfo.foodSupply != undefined

                        if (isFoodTroop && !pluginOptions.useFood)
                            continue
                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, unit.ammount])

                        if (unitInfo.role == "melee") {
                            if (isMeadTroop)
                                attackerMeleeMeadTroops.push([unitInfo, unit.ammount])
                            else if (isFoodTroop)
                                attackerMeleeFoodTroops.push([unitInfo, unit.ammount])
                        }
                        else if (unitInfo.role == "ranged") {
                            if (isMeadTroop)
                                attackerRangeMeadTroops.push([unitInfo, unit.ammount])
                            else if (isFoodTroop)
                                attackerRangeFoodTroops.push([unitInfo, unit.ammount])
                        }
                    }
                }

                const prioritizeNonEventTroops = pool =>
                    pool.sort((a, b) => Number(a[0].name == "Eventunit") - Number(b[0].name == "Eventunit"))

                prioritizeNonEventTroops(attackerMeleeTroops)
                prioritizeNonEventTroops(attackerRangeTroops)
                prioritizeNonEventTroops(attackerMeleeFoodTroops)
                prioritizeNonEventTroops(attackerRangeFoodTroops)
                prioritizeNonEventTroops(attackerMeleeMeadTroops)
                prioritizeNonEventTroops(attackerRangeMeadTroops)

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e[1])
                attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"

                attackerNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerGateNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerWallNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))
                attackerShieldNomadTools.sort((a, b) =>
                    Number(b[0].khanTabletBooster) - Number(a[0].khanTabletBooster))

                if (pluginOptions.lowValueChests) {
                    attackerNomadTools.reverse()
                    attackerGateNomadTools.reverse()
                    attackerWallNomadTools.reverse()
                    attackerShieldNomadTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallNomadTools.push(...attackerWallTools)
                attackerShieldNomadTools.push(...attackerShieldTools)

                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const commanderStats = getCommanderStats(commander)
                const attackWaves = Number(pluginOptions.attackWaves)
                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, attackWaves, pluginOptions, commanderStats.additionalWaves)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerNomadTools.length == 0 ? 20 : 10
                const useNoTools = Boolean(pluginOptions.noTools)

                const sideEnabled = {
                    L: Boolean(pluginOptions.attackLeft ?? true),
                    M: Boolean(pluginOptions.attackMiddle ?? true),
                    R: Boolean(pluginOptions.attackRight ?? true)
                }

                if (!sideEnabled.L && !sideEnabled.M && !sideEnabled.R)
                    throw "NO_ACTIVE_SIDE"

                const sideType = {
                    L: String(pluginOptions.leftTroopType ?? "auto"),
                    M: String(pluginOptions.middleTroopType ?? "auto"),
                    R: String(pluginOptions.rightTroopType ?? "auto")
                }

                const hasExplicitSideCounts =
                    hasExplicitCountValue(pluginOptions.leftTroopCount) ||
                    hasExplicitCountValue(pluginOptions.middleTroopCount) ||
                    hasExplicitCountValue(pluginOptions.rightTroopCount)

                const sideCount = {
                    L: parseConfiguredTroopCount(pluginOptions.leftTroopCount, maxTroopFlank, hasExplicitSideCounts),
                    M: parseConfiguredTroopCount(pluginOptions.middleTroopCount, maxTroopFront, hasExplicitSideCounts),
                    R: parseConfiguredTroopCount(pluginOptions.rightTroopCount, maxTroopFlank, hasExplicitSideCounts)
                }

                const activeSide = {
                    L: sideEnabled.L && sideCount.L > 0,
                    M: sideEnabled.M && sideCount.M > 0,
                    R: sideEnabled.R && sideCount.R > 0
                }

                if (!activeSide.L && !activeSide.M && !activeSide.R)
                    throw "NO_ASSIGNABLE_TROOPS"

                const sidePoolList = side => {
                    switch (sideType[side]) {
                        case "rangeFood": return [attackerRangeFoodTroops]
                        case "meleeFood": return [attackerMeleeFoodTroops]
                        case "rangeMead": return [attackerRangeMeadTroops]
                        case "meleeMead": return [attackerMeleeMeadTroops]
                        default:
                            return [
                                attackerRangeTroops,
                                attackerMeleeTroops,
                                attackerRangeFoodTroops,
                                attackerMeleeFoodTroops,
                                attackerRangeMeadTroops,
                                attackerMeleeMeadTroops
                            ]
                    }
                }

                const assignSideTroops = (side, slots) => {
                    if (!activeSide[side])
                        return

                    let remaining = sideCount[side]
                    if (remaining <= 0)
                        return

                    const pools = sidePoolList(side)

                    for (let i = 0; i < slots.length; i++) {
                        const unitSlot = slots[i]
                        for (let j = 0; j < pools.length; j++) {
                            const assigned = assignUnit(unitSlot, pools[j], remaining)
                            remaining -= assigned
                            if (assigned > 0 || remaining <= 0)
                                break
                        }
                        if (remaining <= 0)
                            break
                    }
                }

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0 && !useNoTools) {
                        if (activeSide.L) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))
                        }

                        maxTools = maxToolsFlank
                        if (activeSide.R) {
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))
                        }

                        maxTools = maxToolsFront
                        if (activeSide.M) {
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallNomadTools :
                                i == 1 ? attackerGateNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))
                        }

                        assignSideTroops("L", wave.L.U)
                        assignSideTroops("R", wave.R.U)
                        assignSideTroops("M", wave.M.U)

                        attackerMeleeTroops.sort((a, b) => Number(a[0].meleeAttack) - Number(b[0].meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a[0].rangeAttack) - Number(b[0].rangeAttack))
                        return
                    }
                    else if (index == 0) {
                        assignSideTroops("L", wave.L.U)
                        assignSideTroops("R", wave.R.U)
                        assignSideTroops("M", wave.M.U)

                        attackerMeleeTroops.sort((a, b) => Number(a[0].meleeAttack) - Number(b[0].meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a[0].rangeAttack) - Number(b[0].rangeAttack))
                        return
                    }
                    else if (!pluginOptions.noChests && !useNoTools) {
                        const selectTool = i => {
                            let tools = attackerNomadTools
                            if (tools.length == 0 || !tools[0]?.[0]?.khanTabletBooster) {
                                if (i == 0) {
                                    tools = attackerWallNomadTools
                                    if (tools.length == 0 || !tools[0]?.[0]?.khanTabletBooster)
                                        tools = attackerShieldNomadTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldNomadTools
                                    if (tools.length == 0 || !tools[0]?.[0]?.khanTabletBooster)
                                        tools = attackerWallNomadTools
                                }
                                if (i == 2) {
                                    tools = attackerGateNomadTools
                                    if (tools.length == 0 || !tools[0]?.[0]?.khanTabletBooster)
                                        tools = attackerWallNomadTools
                                    if (tools.length == 0 || !tools[0]?.[0]?.khanTabletBooster)
                                        tools = attackerShieldNomadTools
                                }
                                if(!tools[0]?.[0]?.khanTabletBooster)
                                    tools = []
                            }

                            return tools
                        }

                        if (activeSide.L) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        }
                        maxTools = maxToolsFlank
                        if (activeSide.R) {
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        }
                        maxTools = maxToolsFront
                        if (activeSide.M) {
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                        }
                    }

                    let maxTroops = maxTroopFlank

                    if (activeSide.L) {
                    wave.L.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    maxTroops = maxTroopFlank
                    if (activeSide.R) {
                    wave.R.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    maxTroops = maxTroopFront
                    if (activeSide.M) {
                    wave.M.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                            attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    }
                })

                const hasFrontlineTroops = attackInfo.A.some(wave =>
                    [wave.L.U, wave.M.U, wave.R.U].some(slots =>
                        slots.some(slot => Number(slot[1]) > 0)))

                if (!hasFrontlineTroops)
                    throw "NO_ASSIGNABLE_TROOPS"

                const frontlineTroopCount = attackInfo.A.reduce((total, wave) => {
                    const waveCount = [wave.L.U, wave.M.U, wave.R.U]
                        .flat()
                        .reduce((sum, slot) => sum + Math.max(0, Number(slot[1]) || 0), 0)
                    return total + waveCount
                }, 0)

                if (frontlineTroopCount < minTroopCount) {
                    console.warn("frontlineTroopsBelowMinimum", frontlineTroopCount, minTroopCount)
                    throw "ATTACK_COUNT_TOO_LOW"
                }

                if (pluginOptions.attackCourtyard) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | commanderStats.attackUnitAmountReinforcementBonus)
                    attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ?
                            (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                            (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                        maxTroops -= assignUnit(unitSlot, attacker,
                            Math.floor(maxTroops / 2) - 1)
                    })
                }

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
                case "MISSING_UNITS":
                case "NO_ASSIGNABLE_TROOPS":
                case "ATTACK_COUNT_TOO_LOW":
                case "NO_ACTIVE_SIDE":
                case "NO_TARGET_CAMPS":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})