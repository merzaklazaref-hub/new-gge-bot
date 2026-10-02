/*
 * Extra plugin: enhanced commander stats helper for plugins requiring detailed buff calculations.
 * - Adds aura/equipment effects and legend skills into normalized active effect totals.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const effects = require("../items/effects.json")
const effectTypes = require("../items/effecttypes.json")
const effectCaps = require("../items/effectCaps.json")
const generalSkills = require("../items/generalSkills.json")
const legendSkills = require("../items/legendskills.json")
const relicEffects = require("../items/relicEffects.json")
const sceatSkills = require("../items/sceatSkills.json")
const equipmentEffects = require("../items/equipment_effects.json")
const { xtHandler, events, sendXT } = require("../ggeBot.js")

let generals = []

xtHandler.on("gie", obj => {
    generals = obj.G
})
events.on("load", () => sendXT("gie", JSON.stringify({})))
let skl
xtHandler.on("skl", o => skl = o)

function getCommanderStats(commander, aci, isNPC) {
    let ungroupedActiveEffects = {}

    aci?.AE.forEach(([effectID, effectValues, type]) => {
        let effect = effects.find(e => e.effectID == effectID)

        let maxCap = Number(effectCaps.find(e => e.capID == effect.capID)?.maxTotalBonus ?? Infinity)

        ungroupedActiveEffects[effectID] = Math.min(maxCap, (ungroupedActiveEffects[effectID] ?? 0) + Number(effectValues[0]))
    })

    generals.find(e => e.GID == commander.generalID)?.SIDS.forEach(skillID => {
        const generalSkill = generalSkills.find(e => e.skillID == skillID)
        if (!generalSkill)
            return
        const [effectID, value] = generalSkill.effects.split("&")
        let effect = effects.find(e => e.effectID == effectID)

        let maxCap = Number(effectCaps.find(e => e.capID == effect.capID)?.maxTotalBonus ?? Infinity)
        // ungroupedActiveEffects[generalSkill.name] = Math.min(maxCap, (ungroupedActiveEffects[generalSkill.name] ?? 0) + Number(value))

        ungroupedActiveEffects[effectID] = Math.min(maxCap, (ungroupedActiveEffects[effectID] ?? 0) + Number(value))
    })

    // generals.find(e => e.GID == commander.generalID)?.GASAIDS.forEach(([skillID]) => {
    //     const generalSkill = generalSkills.find(e => e.skillID == skillID)
    //     if (!generalSkill)
    //         return
    //     const [effectID, value] = generalSkill.effects.split("&")
    //     let effect = effects.find(e => e.effectID == effectID)

    //     let maxCap = Number(effectCaps.find(e => e.capID == effect.capID)?.maxTotalBonus ?? Infinity)
    //     // ungroupedActiveEffects[generalSkill.name] = Math.min(maxCap, (ungroupedActiveEffects[generalSkill.name] ?? 0) + Number(value))

    //     ungroupedActiveEffects[effectID] = Math.min(maxCap, (ungroupedActiveEffects[effectID] ?? 0) + Number(value))
    // })

    commander.EQ.forEach(equipment => {
        const isRelic = equipment[11] == 3
        equipment[5].forEach(([id, var1, var2]) => {
            let effectValues = isRelic ? var2 : var1
            let effectID = undefined
            if(isRelic) {
                effectID = relicEffects.find(e => e.id == id)?.effectID
            } else {
                effectID = equipmentEffects.find(e => e.equipmentEffectID == id)?.effectID
            }

            if(effectID == undefined)
                return
            
            let effect = effects.find(e => e.effectID == effectID)

            if (effect == undefined)
                return
            
            if(effect.areaTypeID && !effect.areaTypeID.split(',').map(Number).includes(aci?.gaa?.AI[0]))
                return

            let maxCap = Number(effectCaps.find(e => e.capID == effect.capID).maxTotalBonus ?? Infinity)

            ungroupedActiveEffects[effectID] = Math.min(maxCap, (ungroupedActiveEffects[effectID] ?? 0) + Number(effectValues[0]))
        })
        
        equipment[12]?.[3]?.[4]?.forEach(([id, _, effectValues]) => {
            let effectID = Array.isArray(effectValues) ? relicEffects.find(e => e.id == id)?.effectID :
                Array.isArray(_) ? (effectValues = _, equipmentEffects.find(e => e.effectID)) : undefined

            if(effectID == undefined)
                return
            
            let effect = effects.find(e => e.effectID == effectID)

            if (effect == undefined)
                return

            if(effect.areaTypeID && !effect.areaTypeID.split(',').map(Number).includes(aci?.gaa?.AI[0]))
                return

            let maxCap = Number(effectCaps.find(e => e.capID == effect.capID).maxTotalBonus ?? Infinity)

            ungroupedActiveEffects[effectID] = Math.min(maxCap, (ungroupedActiveEffects[effectID] ?? 0) + Number(effectValues[0]))
        })
    })
    let activeEffects = {}
    if(!isNPC)
    skl.SID.forEach(skillID => {
        const legendSkill = legendSkills.find(e => e.skillID == skillID)
        if (!legendSkill)
            return
        //FUCK OFF O___O BE CONSISTENT PLEASE
        const name = {
            additionalWave: "additionalWaves",
            additionalUnitAmountOnFlank: "attackUnitAmountFlank",
            additionalUnitAmountOnFront: "attackUnitAmountFront"
        }[legendSkill.effectType] ?? legendSkill.effectType
        activeEffects[name] ??= 0
        activeEffects[name] += Number(legendSkill.totalEffectValue)
    })//
    for (const key in ungroupedActiveEffects) {
        let effectTypeID = effects.find(e => e.effectID == key).effectTypeID
        let effectType = effectTypes.find(e => e.effectTypeID == effectTypeID)
        activeEffects[effectType.name] ??= 0
        activeEffects[effectType.name] += ungroupedActiveEffects[key]
    }
    // activeEffects.additionalWaves ??= 0
    //HACK:
    // commander.EQ[4][5].forEach(([id, effectarray]) =>
    //             id == 21 ? activeEffects.additionalWaves += effectarray[0] : void 0)

    return activeEffects
}

module.exports = { getCommanderStats }