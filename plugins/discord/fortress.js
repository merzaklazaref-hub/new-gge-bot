/*
 * Discord plugin: fortress timer board.
 * - Scans fortress coordinates for all kingdoms and posts countdowns to Discord.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID"
            }
        ]
    }

const pretty = require('pretty-time')
const { events, botConfig } = require("../../ggeBot.js")
const { ClientCommands: { preSpyInfo }, spiralCoordinates, ClientCommands, getResourceCastleList, AreaType } = require("../../protocols")
const getAreaCached = require('../../getMap.js')
const { client } = require("./discord.js")

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const type = 11

events.once("load", async () => {
    /** @type {Array<import('../../protocols.js').Types.GAAAreaInfo>} */
    const areas = []


    for (let kingdomID = 1; kingdomID < 4; kingdomID++) {
        const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kingdomID)
            .areaInfo.find(e => [AreaType.externalKingdom, AreaType.mainCastle].includes(e.type))
        done:
        for (let i = 0, j = 0; i < 13 * 13; i++) {
            let rX, rY
            let rect
            do {
                ({ x: rX, y: rY } = spiralCoordinates(j++))
                rX *= 100
                rY *= 100

                rect = {
                    x: sourceCastleArea.x + rX - 50,
                    y: sourceCastleArea.y + rY - 50,
                    w: sourceCastleArea.x + rX + 50,
                    h: sourceCastleArea.y + rY + 50
                }
                if (j > Math.pow(13 * 13, 2))
                    break done
            } while ((sourceCastleArea.x + rX) <= -50 || (sourceCastleArea.y + rY) <= -50 || (sourceCastleArea.x + rX) >= (1286 + 50) || (sourceCastleArea.y + rY) >= (1286 + 50))
            rect.x = rect.x < 0 ? 0 : rect.x
            rect.y = rect.y < 0 ? 0 : rect.y
            rect.w = rect.w < 0 ? 0 : rect.w
            rect.h = rect.h < 0 ? 0 : rect.h
            rect.x = rect.x > 1286 ? 1286 : rect.x
            rect.y = rect.y > 1286 ? 1286 : rect.y
            rect.w = rect.w > 1286 ? 1286 : rect.w
            rect.h = rect.h > 1286 ? 1286 : rect.h
            let gaa
            let attemptsLeft = 5
            do {
                try {
                    gaa = await getAreaCached(kingdomID, rect.x, rect.y, rect.w, rect.h)
                }
                catch { attemptsLeft-- }
                if (attemptsLeft <= 0)
                    continue done
            } while (!gaa)

            areas.push(...gaa.areaInfo.filter(e => e.type == type))
        }
    }

    const sortData = () => {
        const KIDPOW = [, 1, 0, 3]

        areas.sort((a, b) => KIDPOW[a.extraData[4]] - KIDPOW[b.extraData[4]]).sort((a, b) =>
            a.extraData[2] - b.extraData[2])
    }

    sortData()

    const KIDNames = [,
        "\u001b[2;33mBurning Sands\u001b[0m     ",
        "\u001b[2;34mEverwinter Glacier\u001b[0m",
        "\u001b[2;31mFire peaks\u001b[0m        "
    ]

    setInterval(async () => {
        const date = Date.now()
        let msg = "```ansi\nLocation           Coords  Time\n"
        let everwinterGlacier = 0

        areas.every(area => {
            const kingdomID = area.extraData[4]
            const deltaTime = area.extraData[2] - (date - area.timeSinceRequest) / 1000

            if (kingdomID == 2 && everwinterGlacier++ >= 15)
                return true

            if (deltaTime <= 0)
                preSpyInfo(area.x, area.y, kingdomID)().then(({ areaInfo: area }) =>
                    area.extraData[2] > 0 && sortData())

            msg += `${KIDNames[kingdomID]} ${area.x}\:${area.y} ${pretty(Math.max(0, Math.round(1000000000 * deltaTime)), 's')}\n`

            if (msg.length > 2000 - 3)
                return (msg = msg.replace(/\n.*\n$/, ''), false)

            return true
        })

        msg += "```"

        const channel = await client.channels.fetch(pluginOptions.channelID)

        let message = (await channel.messages.fetch({ limit: 1 })).first()
        if (!message?.editable || message.author.id != client.user.id)
            message = await channel.send({ content: "```Loading...```", flags: [4096] })

        if (message.content == msg)
            return

        message.edit(msg)
    }, 6 * 1000).unref()
})