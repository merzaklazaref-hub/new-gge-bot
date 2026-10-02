/*
 * Extra plugin: Khan defense configuration builder.
 * - Auto-allocates gate/wall/moat/keep defense units from inventory.
 * - Intended to be run as worker plugin in battle event contexts.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: false }

const units = require("../items/units.json")

const { xtHandler, events, sendXT, waitForResult } = require('../ggeBot')
const { Types: { GAAAreaInfo, Lord, UnitInventory }, KingdomID, kingdomLock, getResourceCastleList, AreaType } = require("../protocols")
const { assignUnit } = require('../plugins/attack/attack')

class DefenceView {
    constructor(obj) {
        this.areaInfo = new GAAAreaInfo(obj.A)

        this.wallTools = {
            left: {
                slot: Array.from(obj.dfw.L.S).map(([type, ammount]) =>
                    ([ units.find(obj => obj.wodID == type), ammount ])),
                unitPercentage: Number(obj.dfw.L.UP),
                unitComposition: Number(obj.dfw.L.UC)
            },
            right: {
                slot: Array.from(obj.dfw.R.S).map(([type, ammount]) =>
                    ([ units.find(obj => obj.wodID == type), ammount ])),
                unitPercentage: Number(obj.dfw.R.UP),
                unitComposition: Number(obj.dfw.R.UC)
            },
            middle: {
                slot: Array.from(obj.dfw.M.S).map(([type, ammount]) =>
                    ([ units.find(obj => obj.wodID == type), ammount ])),
                unitPercentage: Number(obj.dfw.M.UP),
                unitComposition: Number(obj.dfw.M.UC)
            },
        }
        this.keepTools = {
            spaceInKeepSlot: Array.from(obj.dfk.S).map(([type, ammount]) => 
                ([ units.find(obj => obj.wodID == type), ammount ])),
            supportTools: Array.from(obj.dfk.STS).map(([type, ammount]) => 
                ([ units.find(obj => obj.wodID == type), ammount ])),
            unitComposition: Number(obj.dfk.UC)
        }
        this.moatTools = {
            left: {
                slot: [
                    units.find(o => o.wodID == obj.dfm.LS[0]), 
                    obj.dfm.LS[0]
                ]
            },
            right: {
                slot: [
                    units.find(o => o.wodID == obj.dfm.RS[0]), 
                    obj.dfm.RS[0]
                ]
            },
            middle: {
                slot: [
                    units.find(o => o.wodID == obj.dfm.MS[0]), 
                    obj.dfm.MS[0]
                ]
            },
        }
        this.lord = new Lord(obj.L)
        this.inventory = UnitInventory(obj.gui)

        this.wallTools.left.slot.forEach(e => {
            if(e[0] == undefined)
                return
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == e[0].wodID)
            if(unitInfo)
                unitInfo.ammount += Number(e[1])
            else
                this.inventory.unitInventory.push({unitID: e[0].wodID, ammount : Number(e[1])})
        })
        this.wallTools.right.slot.forEach(e => {
            if(e[0] == undefined)
                return
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == e[0].wodID)
            if(unitInfo)
                unitInfo.ammount += Number(e[1])
            else
                this.inventory.unitInventory.push({unitID: e[0].wodID, ammount : Number(e[1])})
        })
        this.wallTools.middle.slot.forEach(e => {
            if(e[0] == undefined)
                return
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == e[0].wodID)
            if(unitInfo)
                unitInfo.ammount += Number(e[1])
            else
                this.inventory.unitInventory.push({unitID: e[0].wodID, ammount : Number(e[1])})
        })
        if(this.moatTools.left[0] != undefined) {
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == this.moatTools.left[0])
            if(unitInfo)
                unitInfo.ammount += this.moatTools.left[1]
            else
                this.inventory.unitInventory.push({unitID: this.moatTools.left[0].wodID, ammount: this.moatTools.left[1]})
        }
        if(this.moatTools.right[0] != undefined) {
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == this.moatTools.right[0])
            if(unitInfo)
                unitInfo.ammount += this.moatTools.right[1]
            else
                this.inventory.unitInventory.push({unitID: this.moatTools.right[0].wodID, ammount: this.moatTools.right[1]})
        }
        if(this.moatTools.middle[0] != undefined) {
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == this.moatTools.middle[0])
            if(unitInfo)
                unitInfo.ammount += this.moatTools.middle[1]
            else
                this.inventory.unitInventory.push({unitID: this.moatTools.middle[0].wodID, ammount: this.moatTools.middle[1]})
        }
        this.keepTools.spaceInKeepSlot.forEach(e => {
            if(e[0] == undefined)
                return
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == e[0].wodID)
            if(unitInfo)
                unitInfo.ammount += Number(e[1])
            else
                this.inventory.unitInventory.push({unitID: e[0].wodID, ammount : Number(e[1])})
        })
        this.keepTools.supportTools.forEach(e => {
            if(e[0] == undefined)
                return
            let unitInfo = this.inventory.unitInventory.find(a => a.unitID == e[0].wodID)
            if(unitInfo)
                unitInfo.ammount += Number(e[1])
            else
                this.inventory.unitInventory.push({unitID: e[0].wodID, ammount : Number(e[1])})
        })
        this.toolTriggerLimit = Number(obj.dfk.MAUCT)
    }
}

const kingdomID = KingdomID.greatEmpire

async function setupDefencesForKhan() {
    const areaInfo = (await getResourceCastleList())
        .castles.find(e => e.kingdomID == kingdomID)
        .areaInfo.find(e => e.type == AreaType.mainCastle)
    const areaID = areaInfo.extraData[0]
    await sendXT("dfc", JSON.stringify({ CX: areaInfo.x, CY: areaInfo.y, AID: areaID, KID: kingdomID }))

    const [obj] = await waitForResult("dfc", 1000 * 10, obj => {
        const { x, y, extraData } = new GAAAreaInfo(obj.A)
        return areaInfo.x == x && areaInfo.y == y &&
            areaID == extraData[0]
    })
    const defenceView = new DefenceView(obj)

    let tools = defenceView.inventory.unitInventory.map(unitInfo => ([
        units.find(obj => unitInfo.unitID == obj.wodID),
        unitInfo.ammount
    ])).filter(unitInfo =>
        unitInfo[0].typ == "Defence")
        .sort((a, b) => (b[0].gateBonus ?? 0) - (a[0].gateBonus ?? 0))
        .sort((a, b) => (b[0].wallBonus ?? 0) - (a[0].gateBonus ?? 0))
        .sort((a, b) => (b[0].defRangeBonus ?? 0) - (a[0].defRangeBonus ?? 0))
        .sort((a, b) => (b[0].moatBonus ?? 0) - (a[0].moatBonus ?? 0))
        .sort((a, b) => (b[0].khanMedalBooster ?? 0) - (a[0].khanMedalBooster ?? 0))

    const gateTools = tools.filter(e => e[0].slotTypes.split(',').find(e => e == 2))
    const wallTools = tools.filter(e => e[0].slotTypes.split(',').find(e => e == 1))
    const moatTools = tools.filter(e => e[0].slotTypes.split(',').find(e => e == 4))
    const keepTools = tools.filter(e => e[0].slotTypes.split(',').find(e => e == 5))
        .filter(e => e[0].khanMedalBooster != undefined)

    const moatleftSide = [-1, 0]
    assignUnit(moatleftSide, moatTools, 999)
    const moatRightSide = [-1, 0]
    assignUnit(moatRightSide, moatTools, 999)
    const moatMiddleSide = [-1, 0]
    assignUnit(moatMiddleSide, moatTools, 999)

    sendXT("dfm", JSON.stringify({
        CX: areaInfo.x,
        CY: areaInfo.y,
        AID: areaID,
        LS: [moatleftSide],
        MS: [moatMiddleSide],
        RS: [moatRightSide]
    }))
    const spaceInKeep = []

    for (let i = 0; i < 3; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, keepTools, Math.ceil(keepTools[0] /3))
        spaceInKeep.push(unitSlot)
    }
    sendXT("dfk", JSON.stringify({
        CX: areaInfo.x,
        CY: areaInfo.y,
        AID: areaID,
        MAUCT: defenceView.toolTriggerLimit,
        UC: defenceView.keepTools.unitComposition,
        S: spaceInKeep,
        STS: [[-1, 0], [-1, 0], [-1, 0]]
    }))

    const wallLeft = []
    const wallRight = []

    for (let i = 0; i < 4; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, wallTools, 999)
        wallLeft.push(unitSlot)
    }
    for (let i = 0; i < 4; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, wallTools, 999)
        wallRight.push(unitSlot)
    }
    const wallMiddle = []
    for (let i = 0; i < 6; i++) {
        const unitSlot = [-1, 0]
        assignUnit(unitSlot, (i == 1 || i == 4) ? gateTools : wallTools, 999)
        wallMiddle.push(unitSlot)
    }

    sendXT("dfw", JSON.stringify({
        CX: areaInfo.x,
        CY: areaInfo.y,
        AID: areaID,
        L: {
            S: wallLeft,
            UP: 37,
            UC: 0
        },
        M: {
            S: wallMiddle,
            UP: 26,
            UC: 0
        },
        R: {
            S: wallRight,
            UP: 37,
            UC: 0
        }
    }))
    console.log("setup wall/moat/gate/keep")
}
const eventID = 72
xtHandler.on("rpr", obj => {
    if (obj.EID != eventID)
        return
    setupDefencesForKhan()
})
events.on("load", setupDefencesForKhan)
xtHandler.on("dfw", (_,r) => r != 0 ? setupDefencesForKhan : void 0)
xtHandler.on("dfk", (_,r) => r != 0 ? setupDefencesForKhan : void 0)
xtHandler.on("dfm", (_,r) => r != 0 ? setupDefencesForKhan : void 0)