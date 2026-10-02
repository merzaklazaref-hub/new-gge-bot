/*
 * Plugin: automated help requests for alliance economy.
 * - Sends AHAs on cooldown with optional fast mode.
 */
if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "fastHelp",
                default: false
            }
        ]
    }
    return
}

const { xtHandler, sendXT, events, botConfig } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

const randomIntFromInterval = (min, max) => 
    Math.floor(Math.random() * (max - min + 1) + min)

let sentRequest = false
xtHandler.on("ahh", () => {
    let rndInt = 1
    if (sentRequest)
        return

    sentRequest = true

    if (pluginOptions.fastHelp)
        rndInt = randomIntFromInterval(1, 5)
    else
        rndInt = randomIntFromInterval(60, 60 * 2)

    setTimeout(async () => {
        sendXT("aha", JSON.stringify({ KID: 15 }))
        sentRequest = false
    }, rndInt * 1000)
})