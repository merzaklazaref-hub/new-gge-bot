/*
 * Extra plugin: station on hit routine.
 * - Watches outgoing movement and sends units to a station target if condition is met.
 * - Includes configurable thresholds for might, troop counts, target player, and commander whitelist.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "minMightPoints",
                default: "10000000"
            },
            {
                type: "Text",
                key: "minCastleTroopCount",
                default: "1000"
            },
            {
                type: "Text",
                key: "minHitTroopCount",
                default: "1000"
            },
            {
                type: "Text",
                key: "stationPlayerName"
            },
            {
                type: "Text",
                key: "stationTime",
                default: "1"
            },
            {
                type: "Text",
                key: "minTroopSendCount",
                default: "0"
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
        ]
    }

const { botConfig, sendXT, waitForResult, playerInfo } = require('../ggeBot.js')
const { ClientCommands, KingdomID, AreaType, movementEvents } = require('../protocols')
const { waitForCommanderAvailable } = require('../plugins/commander')
const units = require('../items/units.json')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

movementEvents.on("outgoing", async (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (![0, 25, 31, 24, 29].includes(movement.type))
        return
    if (movement.targetOwner?.ownerID != playerInfo.playerID)
        return
    if (movement.targetOwner.remainingPeaceTime > 0)
        return console.info("notFleeing", "underBird")
    if (movement.targetOwner.remainingNoobTime > 0)
        return console.info("notFleeing", "noobProtection")
    if (!movement.canSeeArmy)
        return console.info("notFleeing", "cantSeeArmy")

    let unitCount = 0
    movement.left.forEach(e => unitCount += e.ammount)
    movement.right.forEach(e => unitCount += e.ammount)
    movement.middle.forEach(e => unitCount += e.ammount)
    movement.courtyard.forEach(e => unitCount += e.ammount)

    if (unitCount < parseInt(pluginOptions.minHitTroopCount))
        return console.info("notFleeing", "troopCountTooSmall")

    let dcl = await ClientCommands.getDetailedCastleList()
    let sourceCastle = dcl.castles.find(a => a.kingdomID == movement.kingdomID)
        .areaInfo.find(a => a.areaID == movement.targetAttack.extraData[0])

    unitCount = 0
    sourceCastle.unitInventory.forEach(e => unitCount += e.ammount)

    if (unitCount < parseInt(pluginOptions.minCastleTroopCount))
        return console.info("notFleeing", "tooLittleTroopsInCastle")

    const searchedPlayer = await ClientCommands.searchPlayerName(pluginOptions.stationPlayerName)()

    let targetCastle = searchedPlayer.ownerInfo[0].castlePositionList.find(a =>
        movement.kingdomID == a.kingdomID && a.areaType == AreaType.outpost)

    targetCastle ??= searchedPlayer.ownerInfo[0].castlePositionList.find(a =>
        movement.kingdomID == a.kingdomID && [AreaType.mainCastle, AreaType.externalKingdom].includes(a.areaType))

    if (targetCastle == undefined)
        return console.warn("noValidCastleChoice")

    let troops = []
    for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
        const unit = sourceCastle.unitInventory[i];

        let unitInfo = units.find(obj => unit.unitID == obj.wodID)
        if (unitInfo.fightType && unitInfo.role) {
            if (unit.ammount >= parseInt(pluginOptions.minTroopSendCount))
                troops.push([unit.unitID, unit.ammount])
        }
    }
    const chunkSize = 10
    for (let i = 0; i < troops.length; i += chunkSize) {
        const chunk = troops.slice(i, i + chunkSize)

        let lord = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)

        console.log("tryingToSend", `${movement.targetAttack.x}:${movement.targetAttack.y}`, "tryingToSendTo",
            `${targetCastle.X}:${targetCastle.Y} ${KingdomID[movement.kingdomID] ?? movement.kingdomID}`)

        console.debug(`${JSON.stringify({
            SID: sourceCastle.areaID,
            TX: targetCastle.X,
            TY: targetCastle.Y,
            LID: lord.lordID,
            WT: parseInt(pluginOptions.stationTime),
            HBW: -1,
            BPC: 0,
            PTT: 0,
            SD: 0,
            A: chunk
        })}`)
        await sendXT("cds", JSON.stringify({
            SID: sourceCastle.areaID,
            TX: targetCastle.X,
            TY: targetCastle.Y,
            LID: lord.lordID,
            WT: parseInt(pluginOptions.stationTime),
            HBW: -1,
            BPC: 0,
            PTT: 0,
            SD: 0,
            A: chunk
        }))

        await waitForResult("cds", 1000 * 10)
    }
})