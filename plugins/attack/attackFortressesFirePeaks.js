/*
 * Plugin: automated fortress attacks in Fire Peaks kingdom.
 * - Uses shared fortress attack logic with FP-specific parameters.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            }
        ]
    }

const { KingdomID } = require('../../protocols.js')
const { botConfig, events } = require('../../ggeBot.js')
const fortressHit = require('./sharedFortressAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const kid = KingdomID.firePeaks
const level = 51

events.on("load", () => 
    fortressHit(kid, level, pluginOptions))