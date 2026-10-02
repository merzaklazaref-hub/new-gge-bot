/*
 * Extra plugin: auto spends affluence event tickets (affluence event ID 89).
 * - Uses 'lws' command when tickets are available during eventStart.
 */
if(require('node:worker_threads').isMainThread)
{
    module.exports = {
        pluginOptions : [
            {
                type: "Text",
                key: "ticketAmmount"
            }
        ]
    }
    return
}
const { events, sendXT, xtHandler, waitForResult, botConfig } = require('../ggeBot')

const eventID = 89

let tix = 0

xtHandler.on("sce", o => {
    o.every(e => {
        let type = e[0]
        let ammount = e[1]
        if (type != 'SLWT')
            return true

        tix = ammount
        return false
    })
})

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

const spendTix =  async eventInfo => {
    if(eventInfo.EID != eventID)
        return

    events.off("eventStart", spendTix)
    
    let ticketAmmount = parseInt(pluginOptions.ticketAmmount)
    if (ticketAmmount == undefined || isNaN(ticketAmmount))
        ticketAmmount = Infinity

    while (tix != 0 && 0 < ticketAmmount--) {
        await sendXT("lws", JSON.stringify({LWET:1}))
        await waitForResult("sce", 1000 * 8)
    }
    console.log("affluenceTicketsSpent")
}
events.on("eventStart", spendTix)