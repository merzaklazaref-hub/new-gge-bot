/*
 * Extra plugin: Berimond kingdom attack automation.
 * - Handles targeting, recruiting and defending against event 3 forces.
 * - Recruits troops and sends attack waves based on configured preferences.
 */
const units = require("../../items/units.json")
const fs = require("node:fs")
const path = require("node:path")

const gameLang = (() => {
    try {
        const langPath = path.join(__dirname, "../../lang/en.json")
        return JSON.parse(fs.readFileSync(langPath, "utf8"))
    } catch {
        return {}
    }
})()

const toKeyCandidates = (value) => {
    if (!value)
        return []

    const str = String(value)
    const lowerFirst = str[0].toLowerCase() + str.slice(1)
    return Array.from(new Set([str, lowerFirst, str.toLowerCase()]))
}

const getToolDisplayName = (unit) => {
    const candidates = [
        ...toKeyCandidates(unit?.type),
        ...toKeyCandidates(unit?.comment2),
        ...toKeyCandidates(unit?.name)
    ]

    for (const key of candidates) {
        const localized = gameLang[`${key}_name`]
        if (localized)
            return localized
    }

    return unit?.type || unit?.comment2 || unit?.name || "Unknown Tool"
}

const buildToolSelection = (predicate) => {
    const options = units
        .filter(predicate)
        .sort((a, b) => Number(a.wodID) - Number(b.wodID))
        .map(unit => ({
            label: `${getToolDisplayName(unit)} (${unit.wodID})`,
            value: String(unit.wodID)
        }))

    options.unshift({
        label: "Any (No Preference)",
        value: ""
    })
    return options
}

if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhiteList",
                label: "Commander Whitelist",
                default: "1-99"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                label: "Low-value chests first",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                label: "Use feather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                label: "Use coin",
                default: true
            },
            {
                type: "Checkbox",
                key: "buyTools",
                label: "Buy tools",
                default: true
            },
            {
                type: "Checkbox",
                key: "sendTroopsOver",
                label: "Send troops over",
                default: true
            },
            {
                type: "Checkbox",
                key: "noEventTools",
                label: "No event tools",
                default: true
            },
            {
                type: "Checkbox",
                key: "enableRecruitment",
                label: "Enable recruitment",
                default: true
            },
            {
                type: "Checkbox",
                key: "skipMeleeUnits",
                label: "Skip melee units",
                default: true
            },
            {
                type: "Checkbox",
                key: "skipAuxiliary",
                label: "Skip Auxiliary",
                default: false
            },
            {
                type: "Checkbox",
                key: "upgradeTents",
                label: "Upgrade tents",
                default: false
            },
            {
                type: "Text",
                key: "troopCount",
                label: "Troop count",
                default: "32"
            },
            {
                type: "Text",
                key: "wallTools",
                label: "Wall tool count",
                default: "5"
            },
            {
                type: "Text",
                key: "shieldTools",
                label: "Shield tool count",
                default: "25"
            },
            {
                type: "Select",
                key: "preferredPointToolIDs",
                label: "Preferred point tool",
                selection: buildToolSelection(unit =>
                    unit.typ == 'Attack' &&
                    unit.pointBonus != undefined),
                default: ""
            },
            {
                type: "Select",
                key: "preferredWallToolIDs",
                label: "Preferred wall tool",
                selection: buildToolSelection(unit =>
                    unit.typ == 'Attack' &&
                    unit.wallBonus != undefined),
                default: "614"
            },
            {
                type: "Select",
                key: "preferredShieldToolIDs",
                label: "Preferred shield tool",
                selection: buildToolSelection(unit =>
                    unit.typ == 'Attack' &&
                    unit.defRangeBonus != undefined),
                default: "620"
            },

        ]
    }

const pretty = require('pretty-time')
const { MinuteSkipType, spendSkip } = require("../../plugins/skips.js")
const { movementEvents, ClassTypes, getResourceCastleList, ClientCommands, AreaType, KingdomID, getKingdomInfoList, KingdomSkipType, kingdomLock } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank } = require("../../plugins/attack/attack")
const { waitForCommanderAvailable, useCommander, freeCommander } = require("../../plugins/commander")
const { sendXT, waitForResult, events, botConfig } = require("../../ggeBot.js")
const err = require('../../err.json')
const buildings = require("../../items/buildings.json")
const { getCommanderStats } = require("../../getEquipment.js")

//627 recruit beri
//623 recruit storage

const troopBlackList = [277]
const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

const parsePreferredIDs = (value, key) => {
    const raw = String(value ?? "").trim()
    if (!raw)
        return null

    const ids = new Set()
    raw.split(",").forEach(part => {
        const token = part.trim()
        if (!token)
            return

        const [startRaw, endRaw] = token.split("-")
        if (endRaw != undefined) {
            const start = Number(startRaw)
            const end = Number(endRaw)
            if (!Number.isFinite(start) || !Number.isFinite(end))
                return

            const min = Math.min(start, end)
            const max = Math.max(start, end)
            for (let i = min; i <= max; i++)
                ids.add(i)
            return
        }

        const id = Number(token)
        if (Number.isFinite(id))
            ids.add(id)
    })

    if (ids.size == 0) {
        console.warn("invalidToolPreference", key, raw)
        return null
    }

    return ids
}

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback

    return Math.max(1, Math.floor(parsed))
}

const sortTroopPoolByAmount = (troopPool) =>
    troopPool.slice().sort((a, b) => Number(b[1]) - Number(a[1]))

const getTroopPoolCount = (troopPool, slotCount) =>
    sortTroopPoolByAmount(troopPool)
        .slice(0, slotCount)
        .reduce((total, troop) => total + Number(troop[1] ?? 0), 0)

const hasPreferredToolID = (preferredIDs, unitInfo) =>
    !preferredIDs || preferredIDs.has(Number(unitInfo.wodID))

const kingdomID = KingdomID.berimond
const type = AreaType.watchTower
const eventID = 3

let quit = false

let foundAllBeri = false
let list = []
let startBeri = 627

while(!foundAllBeri) {
    let item = buildings.find(e => e?.wodID == startBeri)
    list.push(item.wodID)
    if(!item.upgradeWodID)
        foundAllBeri = true
    if(startBeri == item.upgradeWodID)
        throw Error("Recursion")
    startBeri = item.upgradeWodID
}

let foundAllTents = false
let tentList = []
let startTent = 242

while(!foundAllTents) {
    let item = buildings.find(e => e?.wodID == startTent)
    if (!item) break
    tentList.push(item.wodID)
    if(!item.upgradeWodID)
        foundAllTents = true
    if(startTent == item.upgradeWodID)
        throw Error("Recursion")
    startTent = item.upgradeWodID
}

/**
 * @param {import("../../protocols").ClassTypes.JoinArea} castle 
 * @param {Number} ownerID 
 */
async function skipTentBuilding(castle, ownerID) {
    const building = castle.getCastleArea.buildings.find(e => e.ownerID == ownerID)
    if (!building)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == buildings.find(e => e?.wodID == building.wodID)?.upgradeWodID)
    if (!buildingInfo)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    let timeToSkip = Number(buildingInfo.buildDuration) / building.constructionBoost - building.buildTime
    do {
        if (timeToSkip <= 4 * 60) {
            await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
            await waitForResult("fco", 1000 * 10, (obj, r) =>
                r != 0 || obj?.O[1] == ownerID)
            break
        }

        const skip = spendSkip(timeToSkip - 4 * 60)
        if (!skip)
            throw new Error("FAILED_TO_SKIP")

        await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
        timeToSkip -= MinuteSkipType[skip] * 60
    } while (timeToSkip > 0)
    
    await new Promise(r => setTimeout(r, 1000))
    return buildingInfo.level
}

/**
 * @param {import("../../protocols").ClassTypes.JoinArea} castle 
 * @param {Number} ownerID 
 */
async function upgradeBuilding(castle, ownerID) {
    if (castle.getCastleArea.buildingSlots.find(e => e == -1) == undefined)
        throw new Error("NO_FREE_BUILDING_SLOTS")

    let currentBuilding = castle.getCastleArea.buildings?.find(e => e.ownerID == ownerID)
    if (currentBuilding == undefined)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == currentBuilding.wodID)
    if (buildingInfo == undefined || !buildingInfo.upgradeWodID)
        throw new Error("BUILDING_FULLY_UPGRADED")

    let newBuildingInfo = buildings.find(e => e?.wodID == buildingInfo.upgradeWodID)
    if (newBuildingInfo == undefined)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    if (Number(newBuildingInfo.costWood) > castle.areaInfo.wood || Number(newBuildingInfo.costStone) > castle.areaInfo.stone)
        throw new Error("NOT_ENOUGH_RESOURCES")

    castle.areaInfo.wood -= Number(newBuildingInfo.costWood)
    castle.areaInfo.stone -= Number(newBuildingInfo.costStone)

    await sendXT("eup", JSON.stringify({ OID: ownerID, PWR: 0, PO: -1 }))
    let [obj] = await waitForResult("eup", 1000 * 10, obj => obj?.O?.find(e => e[1] == ownerID))

    let timeToSkip = Number(newBuildingInfo.buildDuration) / castle.areaInfo.getProductionData.buildSpeedBoost - obj.O[0][5]

    do {
        if (timeToSkip <= 4 * 60) {
            await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
            await waitForResult("fco", 1000 * 10, (obj, r) => r != 0 || obj?.O[1] == ownerID)
            break
        }

        const skip = spendSkip(timeToSkip - 4 * 60)
        if (!skip)
            throw new Error("FAILED_TO_SKIP")

        await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
        timeToSkip -= MinuteSkipType[skip] * 60
    } while (timeToSkip > 0)
    
    await new Promise(r => setTimeout(r, 1000))
    return newBuildingInfo.level
}

async function upgradeTents(areaID) {
    let castle = await ClientCommands.joinCastle(areaID, kingdomID)()

    const ownerID = castle.getCastleArea.buildingSlots.find(ownerID => ownerID >= 0)
    if (ownerID) {
        const building = castle.getCastleArea.buildings.find(e => e.ownerID == ownerID)
        if (building && tentList.includes(Number(building.wodID))) {
            try {
                let lvl = await skipTentBuilding(castle, ownerID)
                console.log(`Upgraded tent to lvl ${lvl}`)
            } catch (e) {
                console.debug("Failed skipTentBuilding:", String(e))
            }
        }
        return
    }

    const listOfTents = castle.getCastleArea.buildings.reduce((accumulator, object) => {
        let wodID = tentList.find(wodID => wodID == object.wodID)
        if (wodID && wodID != 12) { // 12 is max level tent
            let building = buildings.find(e => e?.wodID == wodID)
            if (building)
                accumulator.push({ ownerID: object.ownerID, building })
        }
        return accumulator
    }, [])

    listOfTents.sort((a, b) => a.building.level - b.building.level)

    for (let i = 0; i < listOfTents.length; i++) {
        const tent = listOfTents[i]
        
        let newBuildingInfo = buildings.find(e => e?.wodID == tent.building.upgradeWodID)
        if (!newBuildingInfo || Number(newBuildingInfo.costWood) > castle.areaInfo.wood || Number(newBuildingInfo.costStone) > castle.areaInfo.stone) {
            console.warn("NOT_ENOUGH_RESOURCES")
            break
        }

        try {
            let result = await upgradeBuilding(castle, tent.ownerID)
            console.log(`Upgraded tent to lvl ${result}`)
        }
        catch (e) {
            switch (e.message) {
                case "NOT_ENOUGH_RESOURCES":
                    console.warn("NOT_ENOUGH_RESOURCES")
                    break
                case "NO_FREE_BUILDING_SLOTS":
                case "BUILDING_FULLY_UPGRADED":
                    break
                default:
                    if (String(e).includes("NOT_ENOUGH_RESOURCES"))
                        console.warn("NOT_ENOUGH_RESOURCES")
                    else
                        console.debug(e)
            }
            break
        }
    }
}

/**
 * @param {import("../../protocols").ClassTypes.JoinArea} castle 
 * @param {Number} ownerID 
 */
const recruitTroops = () => kingdomLock(async () => {
    if(quit)
        return
    if (!pluginOptions.enableRecruitment) {
        return setTimeout(recruitTroops, 60 * 5 * 1000)
    }
    const resourceCastleList = await getResourceCastleList()
    const sourceCastleArea = resourceCastleList.castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.beriCastle == e.type)
    const areaID = sourceCastleArea.extraData[0]
    const sourceCastle = (await ClientCommands.getDetailedCastleList())
        .castles.find(a => a.kingdomID == kingdomID)
        .areaInfo.find(a => a.areaID == areaID)

    await sendXT("jca", JSON.stringify({ CID: areaID, KID: kingdomID }))
    let [obj, _] = await waitForResult("jaa", 1000 * 10, o => o.grc.KID == kingdomID && o.grc.AID == areaID)

    const buildingObject = obj.gca.BD.find(e => list.includes(e[0]))
    const wodID = buildingObject[0]

    await sendXT("spl", JSON.stringify({ LID: 3 }))
    const obj2 = (await waitForResult("spl", 1000 * 10))[0]
    let troopsRecruited = 0

    for (let i = 0; i < obj2.QS.length; i++) {
        const obj4 = obj2.QS[i]

        if (obj4.P)
            continue
        if (obj4.SI.RUT == 0)
            continue

        let troopLimit = sourceCastle.getProductionData.maxAuxilariesTroops
        
        troopLimit -= troopsRecruited
        troopLimit -= sourceCastle.unitInventory.reduce((lastReturn, object) =>
            units.find(obj => object.unitID == obj?.wodID)?.isAuxiliary ?
                lastReturn + Number(object.ammount) : lastReturn, 0)

        troopLimit -= obj2.QS.reduce((lastReturn, object) =>
            object.P?.TUA ? lastReturn + object.P.TUA : lastReturn, 0)

        const stackSize = Math.min(troopLimit, Number(buildings.find(e => e?.wodID == wodID)?.stackSize))

        if (stackSize <= 0) {
            console.log("couldNotRecruitReason", "couldNotRecruitReasonTroopLimitReached")
            return setTimeout(recruitTroops, 60 * 5 * 1000)
        }

        await sendXT("bup", JSON.stringify({
            LID: 3,
            WID: 14,
            AMT: stackSize,
            PO: -1,
            PWR: 0,
            SK: 73,
            SID: 10,
            AID: areaID
        }))

        if ((await waitForResult("bup", 1000 * 10))[1] != 0) {
            console.warn("failedToRecruitTroops", `KID:${kingdomID} AID:${areaID}`)
            return setTimeout(recruitTroops, 60 * 5 * 1000)
        }
        troopsRecruited += stackSize
    }

    console.log(troopsRecruited, "recruitedTroops")

    await sendXT("spl", JSON.stringify({ LID: 3 }))

    setTimeout(recruitTroops, 60 * 5 * 1000)
    // setTimeout(recruitTroops, (await waitForResult("spl", 1000 * 10))[0].TCT * 1000) likely broke
})

const upgradeTentsLoop = () => kingdomLock(async () => {
    if (quit)
        return
    if (!pluginOptions.upgradeTents) {
        return setTimeout(upgradeTentsLoop, 60 * 15 * 1000)
    }

    try {
        const resourceCastleList = await getResourceCastleList()
        const sourceCastleArea = resourceCastleList.castles.find(e => e.kingdomID == kingdomID)
            .areaInfo.find(e => AreaType.beriCastle == e.type)
        const areaID = sourceCastleArea.extraData[0]

        await upgradeTents(areaID)
    } catch (e) {
        console.error("upgradeTentsLoop error", e)
    }

    setTimeout(upgradeTentsLoop, 60 * 15 * 1000)
})

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
    
    const kingdomInfoList = await getKingdomInfoList()
    const resourceCastleList = await getResourceCastleList()
    const mainCastleAreaID = Number(resourceCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
        .areaInfo.find(e => e.type == AreaType.mainCastle)
        .extraData[0])

    if (!kingdomInfoList.unlockInfo.find(e => e.kingdomID == KingdomID.berimond)?.isUnlocked) {
        const dcl = await ClientCommands.getDetailedCastleList()
        const mainCastleResources = dcl.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
            .areaInfo.find(e => e.areaID == mainCastleAreaID)

        if (mainCastleResources.wood < 9000 || mainCastleResources.stone < 9000)
            return console.warn("couldNotOpenBerimond")

        await sendXT("fsc", JSON.stringify({ ID: 2, PWR: 0, OC2: 0, SID: 10 }))
        await waitForResult("fjf", 1000 * 10)
    }
    else if(pluginOptions.sendTroopsOver) {
        let remainingTime = kingdomInfoList.troopTransferList.find(e =>
            e.kingdomID == KingdomID.berimond)?.remainingTime

        while (remainingTime > 0) {
            remainingTime = (await ClientCommands.getMinuteSkipKingdom(spendSkip(remainingTime), kingdomID, KingdomSkipType.sendTroops)())
                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
        }
    }

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => e.type == AreaType.beriCastle);

    quit = false

    recruitTroops()
    upgradeTentsLoop()

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList,
            commander =>
                !((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true,
                (a, b) => getCommanderStats(b).speedBonus - getCommanderStats(a).speedBonus)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                await sendXT("fnm", JSON.stringify({ T: type, KID: kingdomID, LMIN: -1, LMAX: -1, NID: -801 }))

                const AI = (await waitForResult("fnm", 8500, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.gaa.KID != kingdomID)
                        return false

                    if (obj.gaa.AI[0][0] != type)
                        return false

                    return true
                }))[0].gaa.AI[0];
                
                const level = AI[7]

                const commanderStats = getCommanderStats(commander)
                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, new ClassTypes.GAAAreaInfo(AI), commander, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const preferredPointToolIDs = parsePreferredIDs(pluginOptions.preferredPointToolIDs, "preferredPointToolIDs")
                const preferredWallToolIDs = parsePreferredIDs(pluginOptions.preferredWallToolIDs, "preferredWallToolIDs")
                const preferredShieldToolIDs = parsePreferredIDs(pluginOptions.preferredShieldToolIDs, "preferredShieldToolIDs")
                const troopCount = parsePositiveInteger(pluginOptions.troopCount, 32)
                const skipMeleeUnits = !!pluginOptions.skipMeleeUnits
                const skipAuxiliary = !!pluginOptions.skipAuxiliary

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerBannerKhanTools = []

                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i];
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue
                    
                    if (skipAuxiliary && (unitInfo.wodID == 13 || unitInfo.wodID == 14))
                        continue

                    if(unitInfo.wodID == 277)
                        continue

                    else if (unitInfo.pointBonus != undefined && !pluginOptions.noEventTools) {
                        if (unitInfo.wallBonus && hasPreferredToolID(preferredWallToolIDs, unitInfo))
                            attackerWallBerimondTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus && hasPreferredToolID(preferredShieldToolIDs, unitInfo))
                            attackerShieldBerimondTools.push([unitInfo, unit.ammount])
                        else if (hasPreferredToolID(preferredPointToolIDs, unitInfo))
                            attackerBerimondTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.pointBonus == undefined && 
                        unitInfo.toolCategory &&
                    unitInfo.usageEventID  == undefined &&
                    unitInfo.allowedToAttack  == undefined &&
                    unitInfo.typ == 'Attack' &&
                    unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus && hasPreferredToolID(preferredWallToolIDs, unitInfo))
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus && hasPreferredToolID(preferredShieldToolIDs, unitInfo))
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, unit.ammount])
                    }
                }

                const requiredTroopCount = troopCount
                const selectTroopPool = () =>
                    (skipMeleeUnits || attackerRangeTroops.length > 0) ? attackerRangeTroops : attackerMeleeTroops
                const firstWaveTroopSlots = attackInfo.A[0]?.L?.U?.length ?? 0
                const firstWaveTroopPool = sortTroopPoolByAmount(
                    skipMeleeUnits
                        ? attackerRangeTroops
                        : [
                            ...attackerRangeTroops,
                            ...attackerMeleeTroops
                        ])
                const activeTroopCount = getTroopPoolCount(firstWaveTroopPool, firstWaveTroopSlots)

                if (activeTroopCount < requiredTroopCount) {
                    if(!pluginOptions.sendTroopsOver)
                        throw "NO_MORE_TROOPS"

                    await sendXT("fuc", JSON.stringify({CID: sourceCastleArea.extraData[0]}))
                    let troopSendLimit = Number((await waitForResult("fuc", 1000 * 10))[0].FUC)
                    let troopSendLimitRemaining = troopSendLimit
                    if (troopSendLimitRemaining > 80) {
                        const detailedCastleList = await ClientCommands.getDetailedCastleList()

                        const dcl = await ClientCommands.getDetailedCastleList()
                        const mainCastleResources = dcl.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
                            .areaInfo.find(e => e.areaID == mainCastleAreaID)
                        detailedCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire).areaInfo
                            .find(e => e.areaInfo)

                        const attackerMeleeTroops = []
                        const attackerRangeTroops = []
                        for (let i = 0; i < mainCastleResources.unitInventory.length; i++) {
                            const unit = mainCastleResources.unitInventory[i]
                            const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                            if (unitInfo == undefined)
                                continue

                            if (troopBlackList.includes(unitInfo.wodID))
                                continue

                            if (skipAuxiliary && (unitInfo.wodID == 13 || unitInfo.wodID == 14))
                                continue

                            const troopStackMinimum = 1

                            if (unitInfo.fightType == 0 && 
                                unitInfo.meadSupply == undefined && 
                                unitInfo.beefSupply == undefined &&
                                unit.ammount >= troopStackMinimum) {
                                if (unitInfo.role == "melee")
                                    attackerMeleeTroops.push([unitInfo, unit.ammount])
                                else if (unitInfo.role == "ranged")
                                    attackerRangeTroops.push([unitInfo, unit.ammount])
                            }
                        }
                        const sendTroopPool = sortTroopPoolByAmount(
                            skipMeleeUnits
                                ? attackerRangeTroops
                                : [
                                    ...attackerRangeTroops,
                                    ...attackerMeleeTroops
                                ])
                        let sendTroops = []
                        for (let i = 0; i < 10; i++) {
                            const unitSlot = [-1, 0]
                            troopSendLimitRemaining -= assignUnit(unitSlot, 
                                sendTroopPool, 
                                troopSendLimitRemaining)
                            
                            sendTroops.push(unitSlot)
                                
                            if(troopSendLimitRemaining == 0)
                                break
                        }
                        if (!sendTroops.every(e => e[0] == -1)) {
                            await sendXT("kut", JSON.stringify({ 
                                SCID: mainCastleAreaID, 
                                SKID: 0, 
                                TKID: 10, 
                                CID: -1, 
                                A: sendTroops
                            }))
                            let [obj, r] = await waitForResult("kut", 1000 * 10) //TODO: LOCK
                            if(r) {
                                console.log("failedToSendTroopsOver")
                                return
                            }
                            let remainingTime = ClassTypes.KingdomInfo(obj.kpi)
                                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
                            while(remainingTime > 0) {
                                remainingTime = (await ClientCommands.getMinuteSkipKingdom(spendSkip(remainingTime), kingdomID, KingdomSkipType.sendTroops)())
                                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
                            }
                            
                            await new Promise(r => setTimeout(r, 1000)) //HACK:

                            console.log(troopSendLimit - troopSendLimitRemaining, "troopsMovedOver")
                            return
                        }
                    }
                    throw "NO_MORE_TROOPS"
                }

                attackerBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBannerKhanTools.reverse()
                    attackerBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }
                
                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)
                if (pluginOptions.buyTools) {
                    await kingdomLock(async () => {
                        await sendXT("jca", JSON.stringify({ "CID": sourceCastleArea.extraData[0], "KID": kingdomID }))
                        await waitForResult("jaa", 1000 * 10, o => o.grc.KID == kingdomID && o.grc.AID == sourceCastleArea.extraData[0])
                        if (attackerWallBerimondTools.length == 0) {
                            //%xt%EmpireEx_19%sbp%1%{"PID":28,"BT":0,"TID":27,"AMT":1,"KID":10,"AID":-1,"PC2":-1,"BA":0,"PWR":0,"_PO":-1}%
                            await sendXT("sbp", JSON.stringify({ PID: 28, BT: 0, TID: 27, AMT: 300, KID: 10, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }))
                            let [_, r] = await waitForResult("sbp", 1000 * 10, (obj, r) => {
                                if (r != 0)
                                    return true
                                if (obj.PID == 28 &&
                                    obj.AMT == 300)
                                    return true
                            })

                            if (r != 0)
                                throw "couldntGatherTools"
                            console.log(300, "laddersBrought")
                        }
                        if (attackerShieldBerimondTools.length == 0) {
                            await sendXT("sbp", JSON.stringify({ PID: 36, BT: 0, TID: 27, AMT: 300, KID: 10, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }))
                            let [_, r] = await waitForResult("sbp", 1000 * 10, (obj, r) => {
                                if (r != 0)
                                    return true
                                if (obj.PID == 36 &&
                                    obj.AMT == 300)
                                    return true
                            })

                            if (r != 0)
                                throw "couldntGatherTools"
                            console.log(300, "shieldsBrought")
                        }
                    })
                }
                if (attackerWallBerimondTools.length == 0 || attackerShieldBerimondTools.length == 0) {
                    if(!pluginOptions.buyTools)
                        throw "NO_MORE_TOOLS"
                    return
                }

                const checkIfNeeded = (unitSlot, tool, toolCount) => {
                    if (tool[0] && !tool[0][0]?.pointBonus) {
                        return 0
                    }
                    return assignUnit(unitSlot, tool, toolCount)
                }
                const checkIfNeededLeftFlank = (unitSlot, tool, i, toolCount) => {
                    if (tool[0] && !tool[0][0]?.pointBonus) {
                        
                        toolCount = Math.min(toolCount, i == 0 ?  Number(pluginOptions.wallTools) : Number(pluginOptions.shieldTools))
                    }
                    else {
                        toolCount = Math.min(toolCount, i == 0 ? 10 : 20)
                    }
                    return assignUnit(unitSlot, tool, toolCount)
                }
                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)

                    const desiredToolCount = attackerBerimondTools.length == 0 ? 20 : 10

                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeededLeftFlank(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, i,  maxTools))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeeded(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeededLeftFlank(unitSlot, i == 0 ? attackerWallBerimondTools :
                                attackerShieldBerimondTools, i,  maxTools))

                        let maxTroops = requiredTroopCount

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, firstWaveTroopPool, maxTroops))

                        const firstWaveTroopCount = [wave.L.U]
                            .reduce((total, slots) => total + slots.reduce((sum, slot) =>
                                sum + Math.max(0, Number(slot[1]) || 0), 0), 0)

                        if (firstWaveTroopCount < requiredTroopCount)
                            throw "NO_MORE_TROOPS"
                    }
                    else {
                        const selectTool = i => {
                            let tools = attackerBerimondTools
                            if (tools.length == 0) {
                                if (i == 0) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerShieldBerimondTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerWallBerimondTools
                                }
                                if (i == 2) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerShieldBerimondTools
                                }
                            }
                            return tools
                        }

                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeeded(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeeded(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= checkIfNeeded(unitSlot, selectTool(2), maxTools))

                        if (!(wave.L.T[0][0] == -1 && wave.M.T[0][0] == -1 && wave.R.T[0][0] == -1)) {
                            wave.L.U.forEach((unitSlot, i) =>
                                assignUnit(unitSlot, selectTroopPool(), 1))
                        }
                    }
                });

                await sendXT("cra", JSON.stringify(attackInfo))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[0] != type)
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
                    await Promise.race([
                        new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                            if (movement.kingdomID != kingdomID)
                                return

                            movementEvents.off("return", self)
                            resolve()
                        })),
                        new Promise(resolve => setTimeout(resolve, 60 * 1000))
                    ])
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
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