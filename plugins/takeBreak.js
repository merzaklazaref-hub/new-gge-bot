/*
 * Plugin: Take a Break
 * - Takes a break every `intervalMin` minutes for `durationSec` seconds.
 */
const { isMainThread, parentPort } = require('node:worker_threads')

if (isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "intervalMin",
                label: "Interval (minutes)",
                default: "90"
            },
            {
                type: "Text",
                key: "durationSec",
                label: "Duration (seconds)",
                default: "300"
            }
        ]
    }
    
    return
}

const ActionType = require("../actions.json")
const { botConfig, events } = require("../ggeBot.js")
const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

const intervalMin = Number(pluginOptions.intervalMin);
const durationSec = Number(pluginOptions.durationSec);

if (isNaN(intervalMin) || isNaN(durationSec)) {
    console.error("Take a Break Plugin: intervalMin or durationSec is not a number");
    return;
}

events.once("load", () => {
    setTimeout(() => {
        parentPort.postMessage([ActionType.TakeBreak, durationSec]);
    }, intervalMin * 1000 * 60)
})