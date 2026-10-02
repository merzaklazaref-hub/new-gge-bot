/*
 * Shared fortress attack helper for plugins targeting multiple kingdom fortress content.
 * - Implements scanning and strategic attack selection for safe fortress hits.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { movements, movementEvents, getResourceCastleList, ClientCommands, AreaType, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getMaxUnitsInReinforcementWave } = require("./attack")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, playerInfo } = require("../../ggeBot.js")
const err = require('../../err.json')
const units = require("../../items/units.json")
const pretty = require('pretty-time')
const { getCommanderStats } = require('../../getEquipment.js')
const getAreaCached = require('../../getMap.js')

const minTroopCount = 100
const minTroopCountCY = 500
const type = AreaType.fortress

function spiralCoordinates(n) {
    if (n === 0) return { x: 0, y: 0 }

    const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2)
    const layerStart = (2 * (k - 1) + 1) ** 2
    const offset = n - layerStart
    const sideLength = 2 * k
    const side = Math.floor(offset / sideLength)
    const posInSide = offset % sideLength

    let x, y

    switch (side) {
        case 0:
            x = k
            y = -k + 1 + posInSide
            break
        case 1:
            x = k - 1 - posInSide
            y = k
            break
        case 2:
            x = -k
            y = k - 1 - posInSide
            break
        case 3:
            x = -k + 1 + posInSide
            y = -k
            break
    }

    return { x, y }
}

async function fortressHit(kingdomID, level, options) {
    options.useCoin = true
    options.useFeather = true

    const areas = []
    
    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => AreaType.externalKingdom == e.type)

    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(options.commanderWhiteList,
            undefined,
            (a, b) => getCommanderStats(b).speedBonus - getCommanderStats(a).speedBonus)

        const hasShieldMadiens = !(((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true)
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]

                    if (movements.find(movement =>
                    movement.kingdomID == kingdomID &&
                    movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                        continue

                    let time = (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - timeSinceEpoch
                    if (time > 0)
                        continue

                    await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID)()
                    if ((areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - Date.now() > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                const sourceCastle = (await ClientCommands.getDetailedCastleList())
                    .castles.find(a => a.kingdomID == kingdomID)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                let AI = areas[index]

                const attackInfo = getAttackInfo(kingdomID, sourceCastleArea, AI, commander, level, undefined, options)

                const attackerTroops = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue

                    if (unitInfo.fightType == 0) {
                        if (kingdomID == KingdomID.firePeaks &&
                            unitInfo.wodID == 277 && !hasShieldMadiens)
                            continue

                        if (!unitInfo.role)
                            continue

                        attackerTroops.push([unitInfo, unit.ammount])
                    }
                }

                attackerTroops.sort((a, b) => Number(b[0].speed) - Number(a[0].speed))

                let allTroopCount = 0

                attackerTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount + (hasShieldMadiens ? 0 : minTroopCountCY))
                    throw "NO_MORE_TROOPS"

                attackInfo.A.forEach((wave, i) => {
                    if (i > 2 && kingdomID != KingdomID.firePeaks)
                        return
                    if (i > 4 && kingdomID == KingdomID.firePeaks)
                        return

                    const maxTroopFlank = getAmountSoldiersFlank(level)

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                })

                if (!hasShieldMadiens) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                    attackInfo.RW.forEach((unitSlot, i) =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
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
                return false
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]

            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").Types.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                case "MISSING_UNITS":
                    return true
                default:
                    throw e
            }
        }
    }

    done:
    for (let i = 0, j = 0; i < 13 * 13; i++) {
        let rX, rY
        let rect
        do {

            ({ x: rX, y: rY } = spiralCoordinates(j++))
            rX *= 100
            rY *= 100

            rect = {
                x: sourceCastleArea.x + rX - 50,
                y: sourceCastleArea.y + rY - 50,
                w: sourceCastleArea.x + rX + 50,
                h: sourceCastleArea.y + rY + 50
            }
            if (j > Math.pow(13 * 13, 2))
                break done
        } while ((sourceCastleArea.x + rX) <= -50 || (sourceCastleArea.y + rY) <= -50 || (sourceCastleArea.x + rX) >= (1286 + 50) || (sourceCastleArea.y + rY) >= (1286 + 50))
        rect.x = rect.x < 0 ? 0 : rect.x
        rect.y = rect.y < 0 ? 0 : rect.y
        rect.w = rect.w < 0 ? 0 : rect.w
        rect.h = rect.h < 0 ? 0 : rect.h
        rect.x = rect.x > 1286 ? 1286 : rect.x
        rect.y = rect.y > 1286 ? 1286 : rect.y
        rect.w = rect.w > 1286 ? 1286 : rect.w
        rect.h = rect.h > 1286 ? 1286 : rect.h
        let gaa
        let attemptsLeft = 5
        do {
            try {
                gaa = await getAreaCached(kingdomID, rect.x, rect.y, rect.w, rect.h)
            }
            catch { attemptsLeft-- }
            if (attemptsLeft <= 0)
                continue done
        } while (!gaa)

        areas.push(...gaa.areaInfo.filter(e => e.type == type))

        areas.sort((a, b) =>
            (Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
            (Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))
        while (await sendHit());
    }

    while (true) {
        let minimumTimeTillHit = Infinity
        areas.forEach(areaInfo => {
            if (movements.find(movement =>
                    movement.kingdomID == kingdomID &&
                    movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                return
            minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000))
        })
        const time = (Math.max(0, minimumTimeTillHit - Date.now()))
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
}

module.exports = fortressHit