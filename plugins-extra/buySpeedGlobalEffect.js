/*
 * Extra plugin: spend battle reward to buy speed global effect (GE ID 2) when missing.
 */
if(require('node:worker_threads').isMainThread)
    return module.exports = {}

const { xtHandler, sendXT, waitForResult } = require("../ggeBot")

xtHandler.on("bie", async obj => {
    if (obj.GE?.find(e => e == 2) != undefined)
        return
    
    await sendXT("usg", JSON.stringify({}))
    let [obj2] = await waitForResult("usg", 1000 * 8)

    if (obj2?.SGE?.find(e => e == 2)) {
        console.log("gettingSpeedGlobalEffect")
        sendXT("agb", JSON.stringify({ GEID: 2 }))
    }
})