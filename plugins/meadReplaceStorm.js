// Plugin: automatic mead replacement in storm kingdom.
// - Monitors mead consumption of storm island castle
// - Triggers ms3 time-skip and mead transfer when threshold hit
// This module is worker-only (main thread just exports hidden stub).
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden : true }

const {
    ClientCommands,
    KingdomSkipType,
    KingdomID,
    AreaType,
    getResourceCastleList,
    getKingdomInfoList
} = require("../protocols.js")

const { events } = require("../ggeBot.js")

let hoursLeftTillRefilMandatory = 2.1
let hoursLeftTillRefilWarning = 3.1
let sendResTimeout = 29 * 30 * 1000
let targetKingdomID = KingdomID.stormIslands

events.once("load", async () => {
    let kingdomInfoList = await getKingdomInfoList()
    let resourceCastleList = await getResourceCastleList()

    if (!kingdomInfoList.unlockInfo.find(e => e.kingdomID == KingdomID.stormIslands)?.isUnlocked)
        return console.warn("wontRunWithoutStormUnlocked")

    let checkMead = async () => {
        let dcl = await ClientCommands.getDetailedCastleList()
        let stormAreaID = resourceCastleList.castles.find(e => e.kingdomID == targetKingdomID)
            .areaInfo.find(e => e.type == AreaType.externalKingdom)
            .extraData[0] // AreaID

        let resource = kingdomInfoList.resourceTransferList.find(e => e.kingdomID == targetKingdomID)
        let stormAreaInfo = dcl.castles.find(e => e.kingdomID == targetKingdomID).areaInfo.find(ai => ai.areaID == stormAreaID)

        let resourceMead = resource?.resources?.find(e => e.type == "MEAD")
        if (resourceMead)
            stormAreaInfo.mead += resourceMead.count

        let meadLossPerHour = stormAreaInfo.mead / stormAreaInfo.getProductionData.MeadConsumptionRate
        let hoursTillRefill = Math.max(0, meadLossPerHour - hoursLeftTillRefilMandatory)

        if (meadLossPerHour == Infinity || isNaN(meadLossPerHour))
            return console.log("dontNeedToSendMead")

        if (stormAreaInfo.getProductionData.maxAmmountMead / stormAreaInfo.getProductionData.MeadConsumptionRate < hoursLeftTillRefilWarning)
            console.warn("notEnoughTimeForMeadReplace", hoursLeftTillRefilWarning, "hoursForFoodMeadReplace")

        if (resource?.remainingTime >= (stormAreaInfo.mead - (resourceMead ? resourceMead.count : 0)) / stormAreaInfo.getProductionData.MeadConsumptionRate / 60 / 60) { //TODO: Partial Skipping
            for (let i = 0; i < resource.remainingTime / 60 / 30; i++) {
                await ClientCommands.getMinuteSkipKingdom("MS3", targetKingdomID, KingdomSkipType.sendResource)()
            }
            resource.remainingTime = 0
        }
        else
            console.log("dontNeedMeadForAnother", Math.round(hoursTillRefill), "hoursMeadReplace")

        setTimeout(async () => {
            let dcl = await ClientCommands.getDetailedCastleList()
            let stormAreaID = resourceCastleList.castles.find(e => e.kingdomID == targetKingdomID)
                .areaInfo.find(e => e.type == AreaType.externalKingdom)
                .extraData[0] // AreaID

            let stormAreaInfo = dcl.castles.find(e => e.kingdomID == targetKingdomID).areaInfo.find(ai => ai.areaID == stormAreaID)

            let ammount = Math.floor((stormAreaInfo.getProductionData.maxAmmountMead - stormAreaInfo.mead))
            let mainCastleAreaID = resourceCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
                .areaInfo.find(e => e.type == AreaType.mainCastle).extraData[0]

            let info = await ClientCommands.getKingdomInfo(
                mainCastleAreaID,
                KingdomID.greatEmpire,
                targetKingdomID,
                [["MEAD", ammount]]
            )()
            if (info.result == 0)
                console.log("sentMeadReplace", ammount, "meadToMeadReplace", KingdomID[targetKingdomID])
            else
                console.log("failedToSendMead", KingdomID[targetKingdomID])
            
            setTimeout(checkMead, sendResTimeout)

        }, Math.min(hoursTillRefill * 60 * 60 * 1000, 2147483647))
    }
    checkMead()
})