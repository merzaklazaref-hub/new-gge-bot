/*
 * Extra plugin: bulk purchase of trade tools (ladders/shields/rams/bundles).
 * - Loads options as plugin settings and executes on load with buy by chunks.
 */
if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Select",
                key: "kingdomID",
                selection: [
                        "Great Empire",
                        "Burning Sands",
                        "EverWinter Glacier",
                        "Fire Peaks",
                        "Storm Islands",
                ],
                default : "0"
            },
            { type: "Text", key: "ladderAmount", default: "5000" },
            { type: "Text", key: "shieldAmount", default: "5000" },
            { type: "Text", key: "bundleAmount", default: "5000" },
            { type: "Text", key: "ramAmount", default: "5000" }
        ]
    }
    return
}

const { botConfig, events, sendXT } = require("../ggeBot.js")

const pluginOptions =
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

events.on("load", () => {
    const buyInChunks = (productID, total, label) => {
        let remaining = total
        while (remaining > 0) {
            const amount = Math.min(remaining, 1000)
            
            sendXT("sbp", JSON.stringify({
                PID: productID,
                BT: 0,
                TID: 27,
                AMT: amount,
                KID: pluginOptions.kingdomID,
                AID: -1,
                PC2: -1,
                BA: 0,
                PWR: 0,
                _PO: -1
            }))
            remaining -= amount
        }
        console.log(total - remaining, label)
    }

    buyInChunks(28, pluginOptions.ladderAmount, "laddersBrought")
    buyInChunks(36, pluginOptions.shieldAmount, "shieldsBrought")
    buyInChunks(32, pluginOptions.ramAmount, "ramsBrought")
    buyInChunks(40, pluginOptions.bundleAmount, "bundlesBrought")
})