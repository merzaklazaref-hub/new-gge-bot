/*
 * Discord plugin: outgoing attack notifier for alliance members.
 * - Posts outgoing attack events to a single channel.
 * - Tracks movement IDs to avoid duplicate notifications.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID",
            }
        ]
    }

const { xtHandler, botConfig, playerInfo, i18n } = require("../../ggeBot.js")
const { clientReady, client } = require('./discord')
const path = require('path')
const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}

let movements = []

xtHandler.addListener("gam", async obj => {
    await clientReady
    obj.M.forEach(async movement => {
        var movementType = {
            attack: 0,
            defence: 1
        }

        if (movements.find(e => e == movement.M.MID))
            return

        if (movement.M.T != movementType.attack)
            return

        if (!([0, 1, 2, 3].includes(movement.M.KID)))
            return
        
        if(movement.M.SID <= 0)
            return

        if(movement.M.TID <= 0)
            return

        let attacker = obj.O.find(e => e.OID == movement.M.SID)
        let victim = obj.O.find(e => e.OID == movement.M.TID)

        if (attacker.AID != playerInfo.alliance.id) //if victim is outside of our alliance then ignore it for alerts
            return

        let attackerName = attacker.N
        let attackerArea = movement.M.SA[10]
        let attackerAlliance = attacker.AN

        let victimName = victim.N
        let victimArea = movement.M.TA[10]
        let victimAlliance = victim.AN

        var timetaken = movement.M.TT
        var timespent = movement.M.PT

        let x1 = movement.M.TA[1]
        let y1 = movement.M.TA[2]
        let x2 = movement.M.SA[1]
        let y2 = movement.M.SA[2]

        let kidName = [
            "\u001b[2;32mThe Great Empire\u001b[0m",
            "\u001b[2;33mBurning Sands\u001b[0m",
            "\u001b[2;34mEverwinter Glacier\u001b[0m",
            "\u001b[2;31mFire peaks\u001b[0m",
            "\u001b[2;36mThe Storm Islands\u001b[0m"
        ]
        let clicks = Math.round(Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) * 10) / 10

        let time = timetaken - timespent
        const remainingSeconds = Math.max(0, Number.isFinite(time) ? time : 0)
        const remainingMs = Math.round(remainingSeconds * 1000)

        movements.push(movement.M.MID)

        const channel = await client.channels.fetch(pluginOptions.channelID)
        channel.send( //<-- asyncronous bastard causing my fucking hack
            "```ansi\n" +
            `${attackerName} (${attackerArea})${i18n.__("incomingFrom")}${attackerAlliance}${i18n.__("incomingIsAttacking")}${victimName} (${victimArea}) ${victimAlliance} ${i18n.__("incomingIn")}${kidName[movement.M.KID]} ${clicks}${i18n.__("incomingClicks")}` +
            "```" +
            `<t:${Math.round(Date.now() / 1000 + remainingSeconds)}:R>`)

        if (remainingMs > 0)
            setTimeout(() => {
                movements = movements.filter(item => item !== movement.M.MID)
            }, remainingMs).unref()
        else
            movements = movements.filter(item => item !== movement.M.MID)
    })
})