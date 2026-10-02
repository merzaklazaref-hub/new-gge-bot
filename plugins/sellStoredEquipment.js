/*
 * Plugin: equipment sell automation.
 * - Sells non-unique, non-relic, non-set equipment and gem combinations.
 * - Subscribes to ggm/gei result events to inventory scan + execute sell calls.
 */
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Label", key: "equipmentRarityToSell" },
            {
                type: "Checkbox",
                key: "sellCommon",
                label: "Common",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellRare",
                label: "Rare",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellEpic",
                label: "Epic",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellLegendary",
                label: "Legendary",
                default: false
            },
            {
                type: "Checkbox",
                key: "sellRelic",
                label: "Relic",
                default: false
            },
            {
                type: "Checkbox",
                key: "sellUnique",
                label: "Unique",
                default: false
            }
        ]
    }

const { events, xtHandler, sendXT, botConfig } = require('../ggeBot')

const getOptions = () => botConfig.plugins.sellStoredEquipment || {}

const equipmentType = {
    unique : 0,
    common : 1,
    rare : 2,
    epic : 3,
    legendary : 4,
    relic : 5,
    heroUnique : 10, 
    heroCommon : 11,
    heroRare : 12,
    heroEpic : 13,
    heroLegendary : 14,
    heroRelic : 15
}
class Equipment {
    constructor(e) {
        this.id = e[0]
        this.slotType = e[1]
        this.lordType = e[2]
        this.rarity = e[3]
        this.name = e[4]
        this.objectID = e[6]
        this.setID = e[7]
        this.enchantmentLevel = e[8]
        this.timeLeft = e[9] + Date.now() //TODO Verify
        this.temporary = e[9] > 0
        this.gemID = e[10]
    }
}

const sellEquipment = e => {
    const options = getOptions()
    const allowedRarities = []
    if (options.sellCommon) allowedRarities.push(equipmentType.common, equipmentType.heroCommon)
    if (options.sellRare) allowedRarities.push(equipmentType.rare, equipmentType.heroRare)
    if (options.sellEpic) allowedRarities.push(equipmentType.epic, equipmentType.heroEpic)
    if (options.sellLegendary) allowedRarities.push(equipmentType.legendary, equipmentType.heroLegendary)
    if (options.sellRelic) allowedRarities.push(equipmentType.relic, equipmentType.heroRelic)
    if (options.sellUnique) allowedRarities.push(equipmentType.unique, equipmentType.heroUnique)

    const soldCount = {
        common: 0,
        rare: 0,
        epic: 0,
        legendary: 0,
        relic: 0,
        unique: 0
    }

    Array.from(e.I).map(item => new Equipment(item)).forEach(equipment => {
        if (!allowedRarities.includes(equipment.rarity))
            return

        if(equipment.setID != -1)
            return

        sendXT("seq", JSON.stringify({EID:equipment.id, LID:-1, EX:0, LFID:-1}))
        
        if ([equipmentType.common, equipmentType.heroCommon].includes(equipment.rarity)) soldCount.common++
        else if ([equipmentType.rare, equipmentType.heroRare].includes(equipment.rarity)) soldCount.rare++
        else if ([equipmentType.epic, equipmentType.heroEpic].includes(equipment.rarity)) soldCount.epic++
        else if ([equipmentType.legendary, equipmentType.heroLegendary].includes(equipment.rarity)) soldCount.legendary++
        else if ([equipmentType.relic, equipmentType.heroRelic].includes(equipment.rarity)) soldCount.relic++
        else if ([equipmentType.unique, equipmentType.heroUnique].includes(equipment.rarity)) soldCount.unique++
    })
    
    const logParts = Object.entries(soldCount)
        .filter(([_, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}`)

    if (logParts.length > 0) {
        console.log(`Sold equipment: ${logParts.join(", ")}`)
    } else {
        console.log("No equipment sold")
    }
}

events.on("load", () => {
    sendXT("gei", JSON.stringify({}))
    xtHandler.once("gei", sellEquipment)
    
    setInterval(() => {
        sendXT("gei", JSON.stringify({}))
        xtHandler.once("gei", sellEquipment)
    }, 1000 * 10 * 30)
})