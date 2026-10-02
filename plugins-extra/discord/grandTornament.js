/*
 * Extra Discord plugin: grand tournament dashboard + reroll helper.
 * - Reads alliance quests data and publishes event status to a dedicated channel.
 * - Supports auto reroll selector with timer based on plugin table settings.
 */
const fs = require("fs")
const getQuestData = () => {
    try {
        return JSON.parse(fs.readFileSync("./items/allianceQuests.json").toString()).map(item => ([
            {
                type: "Label",
                key: `${item.rewardPoints}`
            },
            {
                type: "Label",
                key: `popup_ame_quest_title_${item.allianceQuestID}`
            },
            {
                type: "Label",
                key: `popup_ame_quest_requirement_${item.allianceQuestID}`
            },
            {
                type: "Text",
                default: "0",
                key: `rerollTime`
            },
            {
                type: "Checkbox",
                default: false,
                key: `checkbox`,
                hideText: true
            }
        ])).flat()
    }
    catch (e) {
        console.error(e)
    }
}

if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID",
                xs: 9999, sm: 9999, md: 9999, lg: 9999
            },
            {
                type: "Table",
                row: [
                    "points",
                    "title",
                    "description",
                    "rerollTime",
                    ""
                ],
                key: "grandTornament",
                data: getQuestData(),
                xs: 9999, sm: 9999, md: 9999, lg: 9999
            }
        ]
    };

const { events, botConfig, sendXT, i18n } = require("../../ggeBot.js")
const { clientReady } = require("../../plugins/discord/discord.js")
const pretty = require('pretty-time')
const { ClientCommands } = require("../../protocols.js")

const lang = fs.readFileSync(`./lang/${i18n.getLocale()}.json`)

let questItem
try {
    questItem = JSON.parse(fs.readFileSync("./items/allianceQuests.json").toString())
}
catch(e) {
    console.error(e)
    return
}

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const questTable = pluginOptions["grandT"]
let rerollTimers = {}
events.on("configModified", () => {
    Object.entries(rerollTimers).forEach(([_,value], index) => {
        if(!value)
            return
        const pluginQuest = questTable["grandTornament"]?.[index]
        if (pluginQuest?.[`checkbox`])
            return

        clearTimeout(value)
        value = undefined
    })
})
events.once("load", async () => {
    setInterval(async () => {
        let msg = "Points Event Time\n"
        let quests = await ClientCommands.activeQuestList()()

        for (let i = 0; i < quests.activeQuests.length; i++) {
            const quest = quests.activeQuests[i];
            if (quest.playerID != -1)
                continue
            const pluginQuest = questTable["grandTornament"]?.[i]
            if (pluginQuest?.[`checkbox`]) {
                let num = Number(pluginQuest?.['rerollTime'])
                const questTimerEntry = rerollTimers[quest.questID]
                if (!isNaN(num) && questTimerEntry['timerID'] == undefined) {
                    questTimerEntry['timerID'] = setTimeout(() => {
                        sendXT("raq", JSON.stringify({S:i, QID: quest.questID}))
                        questTimerEntry['timerID'] = undefined
                    }, num * 1000)
                }

            }
        }
        
        quests.activeQuests.sort((a, b) => a.timeLeft - b.timeLeft)
        const payToPlayList = [
            45,
            57,
            59,
            61,
            41,
            58,
            60,
            66,
            62,
            63,
            64,
            65,

        ]
        for (let i = 0; i < quests.activeQuests.length; i++) {
            const quest = quests.activeQuests[i];
            if (quest.playerID != -1)
                continue

            let questRequirement = lang[`popup_ame_quest_requirement_${quest.questID}`]
            let rewardPoints = questItem.find(e => e.allianceQuestID == quest.questID).rewardPoints
            let color = 
                rewardPoints <= 110 ? "\u001b[2;32m" : 
                rewardPoints <= 300 ? "\u001b[2;34m" : 
                "\u001b[2;33m"
                
            if(payToPlayList.includes(quest.questID))
                color = "\u001b[2;31m"

            msg += `${color}${rewardPoints}${rewardPoints >= 100 ? "":" "} ${questRequirement} ${pretty(Math.round(1000000000 * Math.abs(Math.max(0, quest.timeLeft))))}\n`
        }
        msg = "```ansi\n" + msg

        while (msg.length >= 2000 - 3)
            msg = msg.replace(/\n.*$/, '')

        msg += "```"

        let channel = undefined
        try {
            channel = await (await clientReady).channels.fetch(pluginOptions.channelID)
        }
        catch (e) {
            console.warn(`${e}`)
        }

        let message = ((await channel?.messages.fetch({ limit: 1 })).first())
        if (!message || message.author.id != (await clientReady).user.id) {
            message = await channel?.send({ content: "```"+ "loading" + "```", flags: [4096] })
            return true
        }

        message.edit(msg)
        return true
    }, 6 * 1000).unref()
})