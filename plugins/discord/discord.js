// Discord integration plugin: registers bot commands & interaction events with Discord API.
// Not running in main thread (worker-only module).
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const { Client, Events, GatewayIntentBits, Collection, REST, Routes } = require('discord.js')
const ggeConfig = require("../../ggeConfig.json")
const { events, botConfig } = require('../../ggeBot')

let clientOptions = { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildIntegrations, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] }
let client = new Client(clientOptions)

client.on(Events.ClientReady, () => client.user.setActivity(ggeConfig.discordBanner ? ggeConfig.discordBanner : 'https://github.com/darrenthebozz/GGE-BOT'))
client.login(ggeConfig.discordToken)

/** @type {Promise<Client>} */
let clientPromise =  new Promise((resolve, reject) => {
    client.once(Events.Error, reject)
    client.once(Events.ClientReady, () => {
        client.off(Events.Error, reject)
        resolve(client)
    })
})

const commands = new Collection()

client.on(Events.InteractionCreate, async interaction => {
    const command = commands.get(interaction.commandName)

    if (!command) 
        return console.debug("noMatchingCommandWasFound", interaction.commandName)

    if (interaction.isAutocomplete()) {
        try {
            await command.autoComplete(interaction)
        } catch (error) {
            console.error(error)
        }
        return
    }
    if (!interaction.isChatInputCommand())
        return

    try {
        await command.execute(interaction)
    } catch (error) {
        console.error(error)
        if (interaction.replied || interaction.deferred)
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
        else
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
    }
})
async function refreshCommands() {
    await clientPromise
    const rest = new REST().setToken(ggeConfig.discordToken)
    if (commands.size == 0)
        return console.warn("noCommands")
    
    await rest.put(
        Routes.applicationGuildCommands(
            ggeConfig.discordClientId, 
            botConfig.discordData.discordGuildId),
            { body: commands.map(command => command.data.toJSON()) },
    )
}

events.on("load", () => {
    refreshCommands.bind(this)()
})

module.exports = { client, clientReady: clientPromise, commands }
