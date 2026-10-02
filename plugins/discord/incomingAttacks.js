/*
 * Discord plugin: incoming attack notifier.
 * - Sends decorated messages when incoming movement is detected.
 * - Supports additional storm channel and optional layout attachments.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID",
            },            {
                type: "Channel",
                key: "StormChannelID",
            }
        ]
    }

const { PresenceUpdateStatus, AttachmentBuilder } = require("discord.js")

const { xtHandler, botConfig, playerInfo, events, i18n } = require("../../ggeBot.js")
const { clientReady, client } = require('./discord.js')
const { createLayout } = require("../../imageGen.js")
const path = require('path')
const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}

let movements = []

xtHandler.on("gam", func = async obj => {
    await clientReady
    obj.M.forEach(async movement => {
        if (![0, 25, 31, 24, 29].includes(movement.M.T))
            return

        if(movement.M.SID <= 0)
            return

        if(movement.M.TID <= 0)
            return

        let attacker = obj.O.find((e) => e.OID == movement.M.SID)
        let victim = obj.O.find((e) => e.OID == movement.M.TID)

        if (attacker.AID == playerInfo.alliance.id)
            return

        let e = movements.find((e) => e.M.MID == movement.M.MID)

        if (e) {
            if (movement.GA && movement.M.KID != 4 && (await e.message)?.attachments.size == 0) {
                let stream = await createLayout(movement.GA)
                stream.on("error", console.warn)
                const file = new AttachmentBuilder(stream)
                await (await e.message).edit({ content: (await e.message).content, files: [file] })
            }
            return
        }

        let timetaken = movement.M.TT
        let timespent = movement.M.PT
        let time = timetaken - timespent
        const remainingSeconds = Math.max(0, Number.isFinite(time) ? time : 0)
        const remainingMs = Math.round(remainingSeconds * 1000)

        let attackerName = attacker.N
        let attackerAlliance = attacker.AN
        let attackerArea = movement.M.SA[10]

        let victimName = victim.N
        let victimArea = movement.M.TA[10]

        if (botConfig.externalEvent) {
            victimName = victimName.replace(/_[^_]+$/, '')
        }

        let channelAlert
        try {
            channelAlert = await client.channels.fetch(pluginOptions.channelID)
        }
        catch (e) {
            console.warn(e)
        }
        let channelAquaAlert
        try {
            if (pluginOptions.channelAquaAlert)
                channelAquaAlert = await client.channels.fetch(pluginOptions.stormChannelID)
        }
        catch (e) {
            console.warn(e)
        }
        
        let member = channelAlert.members.find((e) => e.displayName == victimName)
        let mention = member?.displayName ? `<@${member.id}> ` : ``

        let kidName = [
            "\u001b[2;32mThe Great Empire\u001b[0m",
            "\u001b[2;33mBurning Sands\u001b[0m",
            "\u001b[2;34mEverwinter Glacier\u001b[0m",
            "\u001b[2;31mFire peaks\u001b[0m",
            "\u001b[2;36mThe Storm Islands\u001b[0m"
        ]

        if (kidName[movement.M.KID] == undefined)
            return

        if (victimArea == undefined && movement.M.KID == 4)
            victimArea = "Storm island"

        let x1 = movement.M.TA[1]
        let y1 = movement.M.TA[2]
        let x2 = movement.M.SA[1]
        let y2 = movement.M.SA[2]

        let clicks = Math.round(Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) * 10) / 10

        let channel = ((movement.M.KID != 4) ? channelAlert : channelAquaAlert)
        if (channel == undefined)
            return
        let content = `${mention}` +
            "```ansi\n" +
            `${attackerName} (${attackerArea})${i18n.__("incomingFrom")}${attackerAlliance}${i18n.__("incomingIsAttacking")}${victimName} (${victimArea})${i18n.__("incomingIn")}${kidName[movement.M.KID]} ${clicks}${i18n.__("incomingClicks")}` +
            "```" +
            `<t:${Math.round(Date.now() / 1000 + remainingSeconds)}:R>`
        let data = {}
        data.content = content
        movements.push(movement)

        if (movement.GA != undefined) {
            const file = new AttachmentBuilder(await createLayout(movement.GA))
            data.files = [file]
        }
        let message = channel.send(data)

        if (member != undefined) {
            let shouldAlertMember = () => member?.presence?.status == undefined || (member?.presence?.status !== PresenceUpdateStatus.Online && member?.presence?.status !== PresenceUpdateStatus.DoNotDisturb)
            if (movement.M.KID != 4 && shouldAlertMember() && remainingMs > 0) {
                let spreadAlert = async () => shouldAlertMember() ? await channelAlert.send(mention) : void 0
                setTimeout(spreadAlert, Math.max(1, remainingMs / 4)).unref()
                setTimeout(spreadAlert, Math.max(1, remainingMs / 3)).unref()
                setTimeout(spreadAlert, Math.max(1, remainingMs / 2)).unref()
                setTimeout(spreadAlert, Math.max(1, remainingMs / 1.5)).unref()
            }
        }
        if (movement?.GA == undefined)
            movement.message = message

        if (remainingMs > 0)
            setTimeout(() => {
                movements = movements.filter(item => item.M.MID !== movement.M.MID)
            }, remainingMs).unref()
        else
            movements = movements.filter(item => item.M.MID !== movement.M.MID)
        await message
    })
})