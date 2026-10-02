/*
 * Plugin: misc automation routines.
 * - Auto-completes selected quests and message options.
 * - Triggers fortune teller during event 117 if rubies available.
 */
if (require('node:worker_threads').isMainThread) {
    return module.exports = {
        force: true,
        hidden: true
    }
}

const { xtHandler, sendXT, events, playerInfo } = require("../ggeBot")

const quests = [3000, 3002, 3019, 3490, 84, 186, 30]
const messageIds = [67]

xtHandler.on("sne", obj => obj.MSG.forEach(([messageID, messageType]) => {
    if(messageIds.includes(messageType))
        sendXT("dms", JSON.stringify({ MID: messageID })) 
}))

xtHandler.on("qli", obj => obj.QL.forEach(({ QID }) => {
    if(quests.includes(QID))
        sendXT("qsc", JSON.stringify({ QID }))
}))
events.on("eventStart", eventInfo => {
    if (eventInfo?.EID != 117)
        return
    if (eventInfo?.FTDC != 1)
        return
    if (Number(playerInfo?.rubies ?? 0) < 100)
        return

    console.log("grabbedFortuneTellerFortune")
    sendXT("ftl", JSON.stringify({}))
})