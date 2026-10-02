/*
 * Plugin: skip management helper.
 * - Provides `haveEnoughSkips` and `spendSkip` abstractions for event time skipping.
 * - Works with optional `bypassSkipTypeFilter` override for greedy skip usage.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "bypassSkipTypeFilter",
                default: false
            },
            { type: "Label", key: "skipTypes" },
            {
                type: "Checkbox",
                key: "1Minute",
                label: "1 Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Minute",
                label: "5 Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "10Minute",
                label: "10 Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "30Minute",
                label: "30 Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "1Hour",
                label: "1 Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Hour",
                label: "5 Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "24Hour",
                label: "24 Hour",
                default: true
            },
        ],
        force: true
    }

const { botConfig } = require("../ggeBot")
const { resources } = require('../protocols')

const MinuteSkipType = Object.freeze({
    MS1: 1,
    MS2: 5,
    MS3: 10,
    MS4: 30,
    MS5: 60,
    MS6: 60 * 5,
    MS7: 60 * 24
})

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

function haveEnoughSkips(time) {
    const skips = {
        MS1: pluginOptions["1Minute"] ? structuredClone(resources['1MinSkip']) : 0,
        MS2: pluginOptions["5Minute"] ? structuredClone(resources['5MinSkip']) : 0,
        MS3: pluginOptions["10Minute"] ? structuredClone(resources['10MinSkip']) : 0,
        MS4: pluginOptions["30Minute"] ? structuredClone(resources['30MinSkip']) : 0,
        MS5: pluginOptions["1Hour"] ? structuredClone(resources['60MinSkip']) : 0,
        MS6: pluginOptions["5Hour"] ? structuredClone(resources['5HourSkip']) : 0,
        MS7: pluginOptions["24Hour"] ? structuredClone(resources['24HourSkip']) : 0
    }
    time = Math.ceil(time / 60)
    
    while (time > 0) {
        const skip = Object.entries(skips)
            .filter(e => e[1] > 0)
            .filter(e => pluginOptions.bypassSkipTypeFilter || MinuteSkipType[e[0]] <= time * 4)
            .sort((a, b) => (time > MinuteSkipType[a[0]]) - (time > MinuteSkipType[b[0]]))
            .sort((a, b) => Math.min(Math.max(b[1], 950), 951) - Math.min(Math.max(a[1], 950), 951))

        if (skip[0] == undefined)
            return false

        skips[skip[0][0]]--
        time -= MinuteSkipType[skip[0][0]]
    }
    return true 
}

function spendSkip(time) {
    const skips = {
        MS1: pluginOptions["1Minute"] ? resources['1MinSkip'] : 0,
        MS2: pluginOptions["5Minute"] ? resources['5MinSkip'] : 0,
        MS3: pluginOptions["10Minute"] ? resources['10MinSkip'] : 0,
        MS4: pluginOptions["30Minute"] ? resources['30MinSkip'] : 0,
        MS5: pluginOptions["1Hour"] ? resources['60MinSkip'] : 0,
        MS6: pluginOptions["5Hour"] ? resources['5HourSkip'] : 0,
        MS7: pluginOptions["24Hour"] ? resources['24HourSkip'] : 0
    }
    time = Math.ceil(time / 60)
    const skip = Object.entries(skips)
        .filter(e => e[1] > 0)
        .filter(e => pluginOptions.bypassSkipTypeFilter || MinuteSkipType[e[0]] <= time * 4)
        .sort((a, b) => (time > MinuteSkipType[a[0]]) - (time > MinuteSkipType[b[0]]))
        .sort((a, b) => Math.min(Math.max(b[1], 950), 951) - Math.min(Math.max(a[1], 950), 951))

    if (skip[0] == undefined)
        return console.warn("noMoreSkips")

    console.debug("usingSkip", skip[0][0])

    return skip[0][0]
}

module.exports = { spendSkip, haveEnoughSkips, MinuteSkipType }