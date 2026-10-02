// Commander allocator plugin helper.
// Tracks commanders and their busy/free state by monitoring offensive/return movement events.
// Exposes helper functions for other plugins to request an available commander.
if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { xtHandler, playerInfo } = require('../ggeBot.js')
const { ClassTypes, movementEvents } = require('../protocols.js')

const event = new EventTarget()
let usedCommanders = []
let commanders = []

xtHandler.on("aci", (obj, r) => !r ? commanders = obj.gli.C : undefined)
xtHandler.on("adi", (obj, r) => !r ? commanders = obj.gli.C : undefined)
xtHandler.on("gli", (obj, r) => !r ? commanders = obj.C : undefined)

function freeCommander(lordID) {
    const index = usedCommanders.findIndex(e => e == lordID)
    if (index == -1)
        return

    usedCommanders.splice(index, 1)
    event.dispatchEvent(new CustomEvent('freedCommander', { detail: lordID }))
}
function useCommander(lordID) {
    if (!usedCommanders.includes(lordID))
        usedCommanders.push(lordID)

    return lordID
}

movementEvents.on("outgoing", async (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if(movement.owner?.ownerID != playerInfo.playerID)
        return
    
    useCommander(movement.lord.lordID)
})

movementEvents.on("return", async (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner?.ownerID != playerInfo.playerID)
        return

    freeCommander(movement.lord.lordID)
})

const waitForCommanderAvailable = async (commanderWhitelist, filterCallback, sortCallback) => {
    if (![, 0, ""].includes(commanderWhitelist) &&
        !Array.isArray(commanderWhitelist)) {
        commanderWhitelist = commanderWhitelist.split(",").map(e => {
            let [start, end] = e.split("-").map(Number)
            
            return Array.from({ length: (end ?? start) - start + 1 }, (_, i) => start + i - 1)
        }).flat()
    }

    if (commanders.length == 0)
        commanders = (await waitForResult("gli", 1000 * 10))[0].C

    let usableCommanders = commanders.map(e => new ClassTypes.Lord(e))
        .filter(e => ((!commanderWhitelist || commanderWhitelist.includes(e.lordPosition)) &&
            !usedCommanders.includes(e.lordID)))

    if (sortCallback)
        usableCommanders.sort(sortCallback)
    if (filterCallback)
        usableCommanders = usableCommanders.filter(filterCallback)

    let lordID = usableCommanders[0]?.lordID

    lordID ??= await new Promise(resolve => {
        const checkForCommander = currentEvent => {
            const com = commanders.find(e => e.ID == currentEvent.detail)
            if (!commanderWhitelist) {
                event.removeEventListener("freedCommander", checkForCommander)
                currentEvent.stopImmediatePropagation()
                return resolve(currentEvent.detail)
            }
            if(!commanderWhitelist.includes(com.VIS))
                return
            if(!(!filterCallback || filterCallback(new ClassTypes.Lord(com))))
                return

            event.removeEventListener("freedCommander", checkForCommander)
            currentEvent.stopImmediatePropagation()
            resolve(currentEvent.detail)
        }
        event.addEventListener("freedCommander", checkForCommander)
    })

    useCommander(lordID)
    return new ClassTypes.Lord(commanders.find(e => e.ID == lordID))
}

module.exports = {
    movementEvents,
    waitForCommanderAvailable,
    useCommander,
    freeCommander
}