/*
 * Plugin: automated barron runs in Great Empire.
 * - Uses shared attack logic with adjustable limits.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Label", key: "horseSettings" },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: true
            },
            {
                type: "Checkbox",
                key: "useTimeSkips",
                default: false
            },
            {
                type: "Checkbox",
                key: "upgradeTowers",
                label: "Upgrade Towers",
                default: false
            },
            {
                type: "Checkbox",
                key: "useWallTools",
                label: "Use Wall Tools",
                default: false
            },
            {
                type: "Checkbox",
                key: "useShields",
                label: "Use Shields",
                default: false
            },
            { type: "Label", key: "attackSettings" },
            {
                type: "Checkbox",
                key: "attackLeft",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackMiddle",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackRight",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackCourtyard",
                default: false
            },
            {
                type: "Select",
                key: "attackTroopType",
                label: "Troop Type",
                selection: [
                    { label: "Auto", value: "auto" },
                    { label: "Range food", value: "rangeFood" },
                    { label: "Melee food", value: "meleeFood" },
                    { label: "Range mead", value: "rangeMead" },
                    { label: "Melee mead", value: "meleeMead" }
                ],
                default: "auto"
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
            {
                type: "Text",
                key: "attackWaves",
                default: "2"
            }
        ]
    }
const { KingdomID, AreaType } = require('../../protocols.js')
const { botConfig, events } = require("../../ggeBot.js")
const commonAttack = require('./sharedBarronAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

events.on("load", () => {
    commonAttack(AreaType.barron, KingdomID.greatEmpire, pluginOptions, 81)
        .catch(error => console.warn("barronAttackLoopFailed", error))
})