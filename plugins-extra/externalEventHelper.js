/*
 * Extra plugin: helper for external event mode (automatic buying and tax collect flow).
 * - Hooks sce event, performs resource buy and periodic tax collection.
 * - Exposes recruitTroops helper for shared code under `plugins/attack`.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { xtHandler, sendXT, waitForResult, events, botConfig } = require("../ggeBot.js")
const { resources, KingdomID } = require('../protocols.js')

if(!botConfig.externalEvent)
    return

async function buyFromBlacksmith(productID, kingdomID, amount) {
    await sendXT("sbp", JSON.stringify({PID:productID,BT:0,TID:116,AMT:amount,KID:kingdomID,AID:-1,PC2:-1,BA:0,PWR:0,_PO:-1}))
    
    return waitForResult("sbp", 1000 * 10, (obj, r) => {
        if(r != 0)
            return true
        if(obj.PID == productID && obj.AMT == amount)
            return true
        return false
    })
}

const collectTaxes = async obj => {
    while(true) {
        await new Promise(r => setTimeout(r, obj?.TX?.RT * 1000 + 1))
        sendXT("txc", JSON.stringify({ TR: 29 }))
        await waitForResult("txc", 1000 * 10)
        sendXT("txs", JSON.stringify({ TT: 0, TX: 3 }))
        let [obj2, r] = await waitForResult("txs", 1000 * 10)
        obj = obj2.txi

    }
}


xtHandler.once("txi", collectTaxes)

const checkResources = async () => {
    if (!resources.pegasusTicket || resources.pegasusTicket <= 10 && resources.coins > 100) {
        resources.coins -= 100
        await buyFromBlacksmith(4851, KingdomID.greatEmpire, 1)
        console.log("buyingFeathers")
    }
    if ((!resources['5MinSkip'] || resources['5MinSkip'] <= 36) && resources.coins > 1000) {
        resources.coins -= 1000
        await buyFromBlacksmith(4855, KingdomID.greatEmpire, 1)
        console.log("buying5MinuteSkips")
    }
}
events.on("load", () => {
    xtHandler.on("sce", checkResources)
    checkResources()
})

const recruitTroops = async () => {
    if (resources.coins >= 10000) {
        let [_, result] = await buyFromBlacksmith(4902, KingdomID.greatEmpire, 1)
        if (result != 0)
            throw new Error("couldntRecruitMoreTroops")
    }
    else
        throw new Error("couldntRecruitMoreTroops")

    console.info(`Recruited Troops`)
}

module.exports = { recruitTroops }