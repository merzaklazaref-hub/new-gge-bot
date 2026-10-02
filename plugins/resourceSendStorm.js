/*
 * Plugin: storm resource sender to move wood/stone to storm island automatically.
 * - Runs at load and every 30 minutes.
 * - Skips kingdoms if transfer cooldown active.
 */
if(require('node:worker_threads').isMainThread)
    return module.exports = { hidden : true}

const { events } = require("../ggeBot.js")

const {
    ClientCommands,
    KingdomID,
    AreaType,
    getResourceCastleList,
    getKingdomInfoList
} = require("../protocols.js")

events.once("load", async () => {
    let trySendRes = async () => {
        let dcl = await ClientCommands.getDetailedCastleList()
        let stormAreaInfo = dcl.castles.find(e => e.kingdomID == KingdomID.stormIslands).areaInfo[0]
        let gcl = await getResourceCastleList()
        let allowedAIDS = gcl.castles.filter(e => e.kingdomID != KingdomID.stormIslands).map(e => e.areaInfo.filter(e => [AreaType.mainCastle, AreaType.externalKingdom].includes(e.type)).map(e => Number(e.extraData[0]))).flat()

        let kingdomInfoList = await getKingdomInfoList()
        if (!kingdomInfoList.unlockInfo.find(e => e.kingdomID == KingdomID.stormIslands)?.isUnlocked)
            return console.warn("wontRunWithoutStormUnlocked")

        kingdoms:
        for (let i = 0; i < dcl.castles.length; i++) {
            const kingdom = dcl.castles[i];
            
            if(kingdom.kingdomID == KingdomID.berimond)
                continue
            if(kingdom.kingdomID == KingdomID.stormIslands)
                continue
            for (let j = 0; j < kingdom.areaInfo.length; j++) {
                const areaInfo = kingdom.areaInfo[j];

                if (stormAreaInfo.wood <= 0 && stormAreaInfo.stone <= 0)
                    break kingdoms
                
                if(!allowedAIDS.includes(areaInfo.areaID))
                    continue

                if(kingdomInfoList.resourceTransferList.find(e => e.kingdomID == kingdom.kingdomID)?.remainingTime > 0)
                    continue

                let maxWoodToSend = Math.min(areaInfo.getProductionData.maxAmmountWood - areaInfo.wood, stormAreaInfo.wood)
                let maxStoneToSend = Math.min(areaInfo.getProductionData.maxAmmountStone  - areaInfo.stone, stormAreaInfo.stone)

                const G = [
                    ["W", maxWoodToSend],
                    ["S", maxStoneToSend] 
                ].filter(e => e[1] > 0)

                if(G.length == 0)
                    continue

                let kingdomInfo = await ClientCommands.getKingdomInfo(stormAreaInfo.areaID, KingdomID.stormIslands, kingdom.kingdomID, G)()

                if (kingdomInfo.result != 0)
                    continue

                stormAreaInfo.wood -= maxWoodToSend
                stormAreaInfo.stone -= maxStoneToSend
                console.log("sentResSend", JSON.stringify(G), "toResSend", KingdomID[kingdom.kingdomID])
            }            
        }
    }
    trySendRes()
    setInterval(trySendRes, 1000 * 60 * 30)
})