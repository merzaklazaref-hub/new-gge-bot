/*
 * Discord plugin: slash command handlers.
 * - Implements storm ranking, alliance ranking and other game data queries.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {}

const { SlashCommandBuilder, Interaction } = require('discord.js')
const { commands } = require('./discord.js')
const { xtHandler, sendXT, waitForResult, events, botConfig, playerInfo } = require("../../ggeBot.js")
const { ClientCommands, HighscoreType, AreaType } = require('../../protocols.js')
const ggeConfig = require("../../ggeConfig.json")

let playerids = []
async function getStormRanks(i) {
    await i.deferReply()
    if (playerids.length == 0) {
        try {
            await sendXT("hgh", JSON.stringify({ LT: 2, SV: `` }))
            let [obj2, _2] = await waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
                if (result != 0)
                    return false

                if (obj.LT != 2 || obj.SV != ``)
                    return false
                return true
            })
            let promises = []
            for (let j = 1; j + 1 <= 3000; j += 8) {
                promises.push((async () => {
                    try {
                    await sendXT("hgh", JSON.stringify({ LT: 2, SV: `${j}` }))
                    let [obj, _2] = await waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
                        if (result != 0)
                            return false

                        if (obj.LT != 2 || obj.SV != `${j}`)
                            return false
                        return true
                    })

                    obj.L.forEach(e => {
                        if(e[2].R)
                            return
                        if (!playerids.every(a => a != e[2].OID))
                            return
                        
                        playerids.push(e[2].OID)
                    })
                    }
                    catch(e) {
                        console.warn(j)
                    } 
                })())

                await Promise.all(promises)
            }
        }
        catch (e) {
            console.error(e)
        }
    }
    let lootTable = []
    await Promise.all(playerids.map(async (pid) => {
        try {
        await sendXT("gpe", JSON.stringify({ PID: pid, EID: 102 }))
        let [obj, _2] = await waitForResult("gpe", 1000 * 60, (obj, result) => {
            if (result != 0)
                return false

            if (obj.PID != pid || obj.EID != 102)
                return false
            return true
        })

        lootTable.push([obj.NOM, obj.AMT])
        }
        catch(e) {
            console.error(e)
        }
    }))
    lootTable.sort((a, b) => b[1] - a[1])

    let msg = ""

    for (let i = 0; i < lootTable.length; i++) {
        const element = lootTable[i]
        msg += `${i + 1}. ${element[0]} ${element[1].toLocaleString()}\n`
        if (i > 50)
            break
    }
    while (msg.length >= 2000 - 6)
        msg = msg.replace(/\n.*$/, '')
    await i.editReply("```" + msg + "```")
}

async function getAllianceEventRank(interaction, LT) {
    let getAllianceByName = (name) => new Promise(async (resolve, reject) => {
        try {
            await sendXT("hgh", JSON.stringify({ "LT": 11, "SV": name }))
            let [obj, _2] = await waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
                if (result != 0)
                    return false

                if (obj.LT != 11 || obj.SV.toLowerCase() != name.toLowerCase())
                    return false
                return true
            })
            
            let item = obj.L?.find(e => e[2][1].toLowerCase() == name.toLowerCase())
            if (item == undefined) {
                return reject("Could not find alliance name")
            }
            resolve(item[2][0])
        }
        catch (e) {
            return reject("Could not find alliance name")
        }
    })
    let getAllianceMembers = (AID) => new Promise((resolve, reject) => {
        sendXT("ain", JSON.stringify({ AID: AID }))
        let listener = (obj, result) => {
            if (result == 114) {
                xtHandler.removeListener("ain", listener)
                reject("Could not find player")
            }
            else if (result != 0) {
                xtHandler.removeListener("ain", listener)
                reject("unknown error")
            }

            if (obj.A.AID != AID)
                return

            let members = obj.A.M.map((e) => e)
            resolve(members)
            xtHandler.removeListener("ain", listener)
        }
        xtHandler.addListener("ain", listener)
    })
    let getAlliancePlayerID = (AID) => new Promise((resolve, reject) => {
        sendXT("ain", JSON.stringify({ AID: AID }))
        let listener = (obj, result) => {
            if (result == 114) {
                xtHandler.removeListener("ain", listener)
                reject("Could not find player")
            }
            else if (result != 0) {
                xtHandler.removeListener("ain", listener)
                reject("unknown error")
            }
            if (obj.A.AID != AID)
                return

            let members = obj.A.M.map((e) => e.OID)
            resolve(members)
            xtHandler.removeListener("ain", listener)
        }
        xtHandler.addListener("ain", listener)
    })
    await interaction.deferReply()
    let allianceName = interaction.options.getString('name')
    let AID = playerInfo.alliance.id
    try {
        if(allianceName)
            AID = await getAllianceByName(allianceName)
    }
    catch {
        await interaction.editReply("Could not find the alliance specified")
        return
    }
    let members = await getAllianceMembers(AID)

    let commonGetFunc = async (j) => {
        for (let i = 1; i <= j; i++) {
            await sendXT("hgh", JSON.stringify({ LT: LT, LID: i, SV: LT == 30 ? `1` : `` }))
            let [obj, _2] = await waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
                if (result != 0)
                    return false

                if (obj.LT != LT || obj.LID != i || obj.SV != ``)
                    return false
                return true
            })
            let promises = []
            for (let j = 1; j + 1 <= obj.LR; j += 8) {
                promises.push((async () => {
                    try {
                        await sendXT("hgh", JSON.stringify({ LT: LT, LID: i, SV: `${j}` }))
                        let [obj, _2] = await waitForResult("hgh", 1000 * 10, (obj, result) => {
                            if (result != 0)
                                return false

                            if (obj.LT != LT || obj.LID != i || obj.SV != `${j}`)
                                return false
                            return true
                        })

                        obj.L.forEach(e => {
                            try {
                            if (e[2].AID != AID)
                                return
                            if (!lootTable.every(a => a[0] != e[2].N))
                                return
                            }
                            catch(e2) {
                                console.error(JSON.stringify(e))
                                console.error(e2)
                            }
                            lootTable.push([e[2].N, e[1]])
                        })
                    }
                    catch (e) {
                        console.warn(e)
                    }
                })())
            }
            await Promise.all(promises)
        }
    }
    let lootTable = []
    if (LT == 30) {
        for (let i = 0; i < members.length; i++) {
            const member = members[i];

            if (member.R) {
                if (!lootTable.every(a => a[0] != member.N))
                    return
                lootTable.push([member.N, -1])
                return
            }
            await sendXT("hgh", JSON.stringify({ LT: LT, SV: `${member.N}` }))
            let [obj, ret] = await waitForResult("hgh", 1000 * 30, (obj, result) => { //TODO: LOCK
                if (result != 0)
                    return true

                if (obj.LT != LT || obj.SV != `${member.N}`)
                    return false
                return true
            })
            if(ret != 0) {
                if (!lootTable.every(a => a[0] != member.N))
                    return
                lootTable.push([member.N, 0])
            }
            else {
                obj.L.forEach(e => {
                    if (e[2].AID != AID)
                        return
                    if (!lootTable.every(a => a[0] != e[2].N))
                        return
                    lootTable.push([e[2].N, e[1]])
                })
            }
        }
    }
    else if (LT == 2) {
        let promises = members.map(async e => {
            if (e.R) {
                if (!lootTable.every(a => a[0] != e.N))
                    return
                lootTable.push([e.N, -1])
                return
            }
            await sendXT("hgh", JSON.stringify({ LT: LT, SV: `${e.N}` }))
            try {
                let [obj, _2] = await waitForResult("hgh", 1000 * 30, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.LT != LT || obj.SV != `${e.N}`)
                        return false
                    return true
                })

                obj.L.forEach(e => {
                    if (e[2].AID != AID)
                        return
                    if (!lootTable.every(a => a[0] != e[2].N))
                        return
                    lootTable.push([e[2].N, e[1]])
                })
            } catch (a) {
                if (!lootTable.every(a => a[0] != e.N))
                    return
                lootTable.push([e.N, -1])
            }
        })

        await Promise.all(promises)
    }
    else if (LT == "Storm") {
        let playerids = await getAlliancePlayerID(AID)
        await Promise.all(playerids.map(async pid => {
            await sendXT("gpe", JSON.stringify({ PID: pid, EID: 102 }))
            let [obj, _2] = await waitForResult("gpe", 1000 * 60 * 5, (obj, result) => {
                if (result != 0)
                    return false

                if (obj.PID != pid || obj.EID != 102)
                    return false
                return true
            })
            lootTable.push([obj.NOM, obj.AMT])
        }))
    }
    else if (LT == 54 || LT == 55) {
        let promises = members.map(async e => {
            if (e.R) {
                if (!lootTable.every(a => a[0] != e.N))
                    return
                lootTable.push([e.N, -1])
                return
            }
            LT = 54
            await sendXT("hgh", JSON.stringify({ LT: LT, LID : 1, SV: `${e.N}` }))
            try {
                let [obj, _2] = await waitForResult("hgh", 1000 * 30, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.LT != LT || obj.SV != `${e.N}`)
                        return false
                    return true
                })
                lootTable.push([e.N, obj.FR])
            } catch (a) {
                console.warn(a)
                if (!lootTable.every(a => a[0] != e.N))
                    return
                lootTable.push([e.N, -1])
            }
            LT == 55
            await sendXT("hgh", JSON.stringify({ LT: LT, LID : 2, SV: `${e.N}` }))
            try {
                let [obj, _2] = await waitForResult("hgh", 1000 * 30, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.LT != LT || obj.SV != `${e.N}`)
                        return false
                    return true
                })
                let loot = lootTable.find(a => a[0] != e.N)
                if (loot) {
                    loot[1] += obj.FR
                    return
                }
                lootTable.push([e.N, obj.LR])
            } catch (a) {
                console.warn(a)
                if (!lootTable.every(a => a[0] != e.N))
                    return
                lootTable.push([e.N, -1])
            }
        })

        await Promise.all(promises)
    }
    else {
        await commonGetFunc(5)
    }

    members.forEach(e => {
        if (lootTable.every(a => a[0] != e.N))
            lootTable.push([e.N, 0])
    })

    lootTable.sort((a, b) => b[1] - a[1])

    let msg = ""

    for (let i = 0; i < lootTable.length; i++) {
        const element = lootTable[i]
        msg += `${i + 1}. ${element[0]} ${element[1].toLocaleString()}\n`
    }

    await interaction.editReply("```" + msg + "```")
}

let alliances = []
events.once("load", async () => {
    let canFuckingWork = false
    while (!canFuckingWork) {
        try {
            await sendXT("hgh", JSON.stringify({ LT: 11, LID: 6, SV: `${1}` }))
            await waitForResult("hgh", 1000 * 5)
            canFuckingWork = true
        }
        catch(e) {
            console.warn(e)
        }
    }
    if (alliances.length == 0) {
        for (let j = 1; j < 32000; j += 8) {
            try {
                await sendXT("hgh", JSON.stringify({ LT: 11, LID:6, SV: `${j}` }))
                let [obj, _2] = await waitForResult("hgh", 1000 * 60 * 5, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.LT != 11 || obj.SV != `${j}`)
                        return false
                    return true
                })

                obj.L.forEach(e => {
                    if (!alliances.includes(e[2][1]))
                        alliances.push(e[2][1])
                })
                if ((j + 1) > obj.LR)
                    break

            }

            catch (e) {
                console.warn(e)
            }
        }
    }
})

let genericAutoComplete = async (interaction) => {
    const focusedValue = interaction.options.getFocused()
    const filtered = alliances.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase()))
    filtered.splice(25, Infinity)

    await interaction.respond(
        filtered.map(choice => ({ name: choice, value: choice })),
    )
}
let getHonourRanking = async (interaction) => {
    await interaction.deferReply()
    let getHonourList = async function*() {
        fullout:
        for (let j = 1; j + 1 <= 3000; j += 8) {
            let highScoreData = await ClientCommands.getHighScore(HighscoreType.honour, 6, j)()
            for (let i = 0; i < highScoreData.list.length; i++) {
                const e = highScoreData.list[i]
                if (e.playerData.isRuin && !e.playerData.castlePositionList.every(e => e.areaType == AreaType.outpost))
                    continue
                if (e.playerData.remainingNoobTime)
                    continue
                if (e.playerData.remainingPeaceTime)
                    continue
                if (e.ammount == 0)
                    break fullout
                if(ggeConfig.blackListedAlliances?.includes(e.playerData.allianceName))
                    continue
                
                yield e.playerData
            }
        }
    }
    let playerList = []
    for await (const player of getHonourList()) {
        if(!playerList.find(e => e[0] == player.name))
            playerList.push([player.name, `${Math.round(player.mightPoints / 1000000)}M`, player.honour])
    }
    playerList.sort((a,b) => b[2] - a[2])
    let msg = "```"
    for (let i = 0; i < playerList.length; i++) {
        const playerData = playerList[i]
        msg += `${playerData[0]} ${playerData[1]} ${playerData[2]}\n`
    }

    while (msg.length >= 2000 - 3)
        msg = msg.replace(/\n.*$/, '')

    msg += "```"
    await interaction.editReply(msg)
}

let getAllianceQuestPointCount = async (interaction) => {
    await interaction.deferReply()
    let allianceQuestsScore = await ClientCommands.allianceQuestPointCount()()
    allianceQuestsScore.list.sort((a,b) => a.points - b.points)
    let msg = "```"
    
    allianceQuestsScore.list.forEach((e, i) => msg += `${i + 1}. ${e.playerName} ${e.points}\n`)

    while (msg.length >= 2000 - 3)
        msg = msg.replace(/\n.*$/, '')

    msg += "```"
    await interaction.editReply(msg)
}
([
    {
        data: new SlashCommandBuilder()
            .setName('nomads')
            .setDescription('grabs Nomad rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 46)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('warofrealms')
            .setDescription('grabs War of the Realms rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 44)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('samurai')
            .setDescription('grabs Samurai rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 51)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('bloodcrows')
            .setDescription('grabs Bloodcrows rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 58)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('honour')
            .setDescription('grabs honour from useful targets')
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getHonourRanking(interaction)
        },
    },
    // {
    //     data: new SlashCommandBuilder()
    //         .setName('berimond-invasion')
    //         .setDescription('grabs Berimond rankings from selected alliance')
    //         .addStringOption(option =>
    //             option.setName("name")
    //                 .setDescription("Alliance that you want to see the rankings of")
    //                 .setAutocomplete(true),
    //         )
    //     ,
    //     async execute(/**@type {Interaction}*/interaction) {
    //         await getAllianceEventRank(interaction, 54)
    //     },
    //     autoComplete: genericAutoComplete
    // },
    {
        data: new SlashCommandBuilder()
            .setName('battle-for-berimond')
            .setDescription('grabs Berimond rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 30)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('storm')
            .setDescription('grabs Storm rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            )
        ,
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, "Storm")
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName(botConfig.externalEvent ? "external_loot" : 'loot')
            .setDescription('grabs loot rankings from selected alliance')
            .addStringOption(option =>
                option.setName("name")
                    .setDescription("Alliance that you want to see the rankings of")
                    .setAutocomplete(true),
            ),
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceEventRank(interaction, 2)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('storm-top-players')
            .setDescription('grabs storm rankings'),
        async execute(/**@type {Interaction}*/interaction) {
            await getStormRanks(interaction)
        },
        autoComplete: genericAutoComplete
    },
    {
        data: new SlashCommandBuilder()
            .setName('grandtournament')
            .setDescription('grabs grand tournament scores'),
        async execute(/**@type {Interaction}*/interaction) {
            await getAllianceQuestPointCount(interaction)
        },
    }
]).forEach(e => { 
    if(botConfig.externalEvent && !e.data.name.includes("external_"))
        return
    commands.set(e.data.name, e)
})

module.exports = { genericAutoComplete }

try {
    require('../../plugins-extra/discord/extraSlashCommands.js')
}
catch(e) {
    console.debug(e)
}