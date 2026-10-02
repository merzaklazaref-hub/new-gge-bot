/*
 * Extra Discord plugin: additional slash commands for alliance data.
 * - Provides /birded command for displayed birded players with remaining peace time.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden : true }

const { playerInfo } = require('../../ggeBot')
const prettyTime = require('pretty-time')
const { commands } = require('../../plugins/discord/discord')
const { genericAutoComplete } = require('../../plugins/discord/slashCommands')
const { ClientCommands } = require('../../protocols')
const { SlashCommandBuilder } = require('discord.js')
async function getBirded(interaction) {
    await interaction.deferReply()
    let allianceName = interaction.options.getString('name')
    let AID = playerInfo.alliance.id
    try {
        var alliance = !allianceName ?
            await ClientCommands.getAllianceByID(AID)() :
            await ClientCommands.getAllianceByName(allianceName)()
    }
    catch {
        await interaction.editReply('Could not find the alliance specified')
        return
    }
    const scoreTable = []

    alliance.members.forEach(e => e.remainingPeaceTime > 0 ? 
            scoreTable.push([e.name, e.remainingPeaceTime]) : undefined)

    scoreTable.sort((a, b) => b[1] - a[1])

    let msg = ""

    for (let i = 0; i < scoreTable.length; i++) {
        const element = scoreTable[i]
        msg += `${element[0]} ${prettyTime(1000000000 * element[1])}\n`
    }

    await interaction.editReply("```" + msg + "```")
}

([
    {
        data: new SlashCommandBuilder()
            .setName('birded')
            .setDescription('grabs birded players from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getBirded(interaction)
        },
        autoComplete: genericAutoComplete
    }
]).forEach(e => commands.set(e.data.name, e))