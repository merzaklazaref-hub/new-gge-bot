/*
 * Discord plugin: chat bridge between game chat and Discord channel.
 * - Sanitizes message tags and emoji for in-game format.
 * - Sends in-game chat commands via sendXT for user messages.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID",
            },

            {
                type: "Checkbox",
                key: "hideDiscordName",
                default: false
            }
        ]
    }

const turl = require('turl')
const emoji = require("emoji-dictionary")
const { xtHandler, sendXT, botConfig } = require("../../ggeBot.js")
const { clientReady } = require('./discord')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

function parseMessage(e) {
    if (!e)
        return ""
    return e = e.replace(/&percnt;/g, "%").replace(/&quot;/g, '"').replace(/&145;/g, "'").replace(/<br \/>/g, "\n").replace(/%5C/g, "\\").replace(/(\[|\])/g, " ")
}
function cleanUnmatchedTags(t) {
    return t.replace(/<(?![^<>]*>)/g, '').replace(/(?<!<[^<>]*)>/g, '')
}
function unparseMessage(e) {
    if (!e)
        return ""

    e = cleanUnmatchedTags(e)

    e = e.replace(/<.*?>/g, (m) => {
        if (m.match(/<\/?color.*?>/))
            return m
        if (m.match(/<\/?b>/))
            return m
        if (m.match(/<\/?br>/))
            return m
        if (m.match(/<\/?a.*?>/))
            return m

        return ""
    })

    return e = e.replaceAll("%", "&percnt;").replaceAll('"', "&quot;").replaceAll("'", "&145;").replaceAll("\n", "<br>").replaceAll("\\", "%5C").replaceAll(/(\[|\])/g, " ")
}
clientReady.then(async client => {
    let channel = await client.channels.fetch(pluginOptions.channelID)
    xtHandler.on("acm", (obj) => {
        if (obj.CM.PN.toLowerCase() == botConfig.name.toLowerCase())
            return

        var msg = parseMessage(obj.CM.MT)

        channel.send(obj.CM.PN + ": " + msg)
    })
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return

        if(message.channel.id != pluginOptions.channelID) return

        var name = "<color=" + message.member.displayHexColor + ">" + ((message.member.nickname != null) ? message.member.nickname : message.author.displayName) + "<color>"

        let msg = message.content
        msg = msg.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
        msg.match(/\p{Emoji_Presentation}/gu)?.forEach(element => {
            if (emoji.getName(element) == "slightly_smiling_face")
                msg = msg.replace(element, ":)")
            else if (emoji.getName(element) == "smile")
                msg = msg.replace(element, ":D")
            else if (emoji.getName(element) == "frowning")
                msg = msg.replace(element, ":(")
            else if (emoji.getName(element) == "sob")
                msg = msg.replace(element, ";(")
            else if (emoji.getName(element) == "wink")
                msg = msg.replace(element, ";)")
            else if (emoji.getName(element) == undefined)
                msg = msg.replace(element, "")
            else
                msg = msg.replace(element, ":" + emoji.getName(element) + ":")
        })

        if (msg != "" && message.attachments.size > 0)
            msg += "<br>"
        if (message.attachments.size > 0)
            msg += "attached: "
        let i = 0
        for await (const [_, attachment] of message.attachments.entries()) {
            const url = await turl.shorten(attachment.proxyURL)
            msg += `<a href="${url}">${i++}</a> `
        }
        msg = unparseMessage(msg)

        if (msg == "")
            return
        
        sendXT("acm", JSON.stringify({ 
            M:`${!pluginOptions.hideDiscordName ? unparseMessage(name) + ": " : ""} ${msg}`
        }))

        sendXT("acm", "{ \"M\" : \"" +  + "\"}", "str")
    })
})