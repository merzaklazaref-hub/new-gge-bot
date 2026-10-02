/*
 * Extra plugin: storm cargo upgrade automation.
 * - Auto-upgrades or skips storm cargo buildings based on aqua availability.
 * - Uses shared skip logic from plugin `skips`.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const buildings = require("../items/buildings.json")
const { waitForResult, xtHandler, sendXT, events } = require("../ggeBot")
const { ClassTypes, ClientCommands, KingdomID,
    kingdomLock, getResourceCastleList } = require("../protocols")
const { MinuteSkipType, spendSkip } = require("../plugins/skips")

const list = []

for (let start = 35; true;) {
    let item = buildings.find(building => building.wodID == start)
    if (!item.upgradeWodID)
        break

    list.push(item.wodID)

    if (start == item.upgradeWodID)
        throw Error("RECURSION")

    start = item.upgradeWodID
}

let lastMinimumAquaLevel = 1
/**
 * @param {import("../protocols").ClassTypes.JoinArea} castle 
 * @param {Number} ownerID 
 */
async function skipBuilding(castle, ownerID) {
    const building = castle.getCastleArea.buildings.find(e => e.ownerID == ownerID)
    if (!building)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == buildings.find(e => e?.wodID == building.wodID).upgradeWodID)
    if (buildingInfo == undefined)
        throw new Error("BUILDING_INFO_NOT_FOUND")
    
    let timeToSkip = Number(buildingInfo.buildDuration) / building.constructionBoost - building.buildTime
    let fastSkip = false
    do {
        if (fastSkip) {
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
    return waitForResult("ego", 1000 * 10, obj => obj?.O.find(e => e[1] == ownerID))
}
/**
 * @param {import("../protocols").ClassTypes.JoinArea} castle 
 * @param {Number} ownerID 
 */
async function upgradeBuilding(castle, ownerID) {
    if (castle.getCastleArea.buildingSlots.find(e => e == -1) == undefined)
        throw new Error("NO_FREE_BUILDING_SLOTS")

    let currentBuilding = castle.getCastleArea.buildings?.find(e => e.ownerID == ownerID)
    if (currentBuilding == undefined)
        throw new Error("BUILDING_NOT_FOUND")

    let buildingInfo = buildings.find(e => e?.wodID == currentBuilding.wodID)
    if (buildingInfo == undefined)
        throw new Error("BUILDING_INFO_NOT_FOUND")

    if (!buildingInfo.upgradeWodID)
        throw new Error("BUILDING_FULLY_UPGRADED")

    let newBuildingInfo = buildings.find(e => e?.wodID == buildingInfo.upgradeWodID)

    if (newBuildingInfo.costAquamarine > castle.areaInfo.aqua)
        throw new Error("NOT_ENOUGH_AQUAMARINE")

    await sendXT("eup", JSON.stringify({ OID: ownerID, PWR: 0, PO: -1 }))
    let [obj] = await waitForResult("eup", 1000 * 10, obj => obj?.O?.find(e => e[1] == ownerID))

    let timeToSkip = Number(newBuildingInfo.buildDuration) / castle.areaInfo.getProductionData.buildSpeedBoost - obj.O[0][5]

    do {
        if (timeToSkip <= 4 * 60) {
            await sendXT("fco", JSON.stringify({ OID: ownerID, FS: 1 }))
            await waitForResult("fco", 1000 * 10, (obj,r) => r != 0 || obj?.O.find(e => e[1] == ownerID))
            break
        }

        const skip = spendSkip(timeToSkip - 4 * 60)
        if (!skip)
            throw new Error("FAILED_TO_SKIP")

        await sendXT("msb", JSON.stringify({ OID: ownerID, MST: skip }))
        timeToSkip -= MinuteSkipType[skip] * 60
    } while (timeToSkip > 0)
    await new Promise(r => setTimeout(r, 1000)) //TODO: NOT THIS
    // return waitForResult("ego", 1000 * 10, obj => obj?.O.find(e => e[1] == ownerID))
}

events.once("load", async () => {
    const resourceCastleList = await getResourceCastleList()
    let isRunning = false
    xtHandler.on("dcl", async obj => {
        if (isRunning == true)
            return

        isRunning = true

        try {
            const castleProd = ClassTypes.DetailedCastleList(obj)
                .castles.find(a => a.kingdomID == KingdomID.stormIslands)?.areaInfo[0]

            if (castleProd.aqua <= Number(list[lastMinimumAquaLevel - 1].costAquamarine))
                return

            const areaInfo = resourceCastleList.castles.find(e => e.kingdomID == KingdomID.stormIslands).areaInfo[0]
            kingdomLock(async () => {
                let castle = await ClientCommands.joinCastle(areaInfo.extraData[0], KingdomID.stormIslands)()

                const ownerID = castle.getCastleArea.buildingSlots.find(ownerID => ownerID >= 0)
                if (ownerID)
                    return skipBuilding(castle, ownerID)

                let listOfCargo = castle.getCastleArea.buildings.reduce((accumulator, object) => {
                    let building = buildings.find(e => e?.wodID == list.find(wodID => wodID == object.wodID))
                    if (building)
                        accumulator.push({ ownerID: object.ownerID, building })
                    return accumulator
                }, [])

                listOfCargo.sort((a, b) => a.building.level - b.building.level)

                for (let i = 0; i < listOfCargo.length; i++) {
                    const cargo = listOfCargo[i]
                    if (Number(cargo.building.costAquamarine) > castle.areaInfo.aqua)
                        break

                    try {
                        await upgradeBuilding(castle, cargo.ownerID)
                        console.log("Upgraded aqua building")
                    }
                    catch (e) {
                        switch (e.message) {
                            case "NOT_ENOUGH_AQUAMARINE":
                                break
                            default:
                                console.debug(e)
                        }
                        break
                    }
                }
            })
        }
        catch (e) {
            console.error(e)
        }
        isRunning = false
    })
})