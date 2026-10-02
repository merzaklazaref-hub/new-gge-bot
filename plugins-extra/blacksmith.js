/*
 * Extra plugin: Buy items and repeat shop actions during event 116.
 * - Configurable options include nomad/beri/sam package purchase and tool buying.
 */
if(require('node:worker_threads').isMainThread)
{
    module.exports = {
        pluginOptions: [
            { type: "Checkbox", key: "grabNomads", default: false },
            { type: "Checkbox", key: "grabBeri", default: false },
            { type: "Checkbox", key: "grabSams", default: false },
            { type: "Checkbox", key: "grabGloryTools", default: false },
            { type: "Checkbox", key: "grabGlory", default: false },
            { type: "Checkbox", key: "arrowSlits", default: false },
            { type: "Checkbox", key: "gate", default: false },
            { type: "Checkbox", key: "foodTroops", default: false },
            { type: "Checkbox", key: "meadTroops", default: false },
            { type: "Checkbox", key: "skips", default: false },
            { type: "Checkbox", key: "grabTickets", default: false },
            
        ]
    }
    return
}
const packages = require("../items/packages.json")
const { events, sendXT, waitForResult, xtHandler, botConfig } = require("../ggeBot.js")

let silverTokens = 0
xtHandler.on("sce", o => {
    o.every(e => {
        let type = e[0]
        let ammount = e[1]
        if (type != 'STO')
            return true

        silverTokens = ammount
        return false
    })
})

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

events.on("eventStart", async event => {
    if(event.EID != 116)
        return
    
    await sendXT("gbc", JSON.stringify({ CID: 3760167, KID: 0 }))

    const gbc = (await waitForResult("gbc", 1000 * 10))[0]

    let packagesToBuy = []
    if (pluginOptions.arrowSlits) {
        packagesToBuy.push(2574)
    }
    if (pluginOptions.gate) {
        packagesToBuy.push(2573)
    }
    if (pluginOptions.foodTroops) {
        packagesToBuy = packagesToBuy.concat([
            1964,
            1968,
            1963,
            1967,
            2005,
            2006
        ])
    }
    if (pluginOptions.meadTroops) {
        packagesToBuy = packagesToBuy.concat([
            3068,
            3069,
            3070,
            3071
        ])
    }
    if (pluginOptions.skips) {
        packagesToBuy = packagesToBuy.concat([
            1708,
            1709,
            2129,
            2130
        ])
    }
    if (pluginOptions.grabNomads) {
        packagesToBuy = packagesToBuy.concat([
            1971,
            1969,
            1973,
            3011,
            3019,
            3017,
            3003,
            1974,
            1972
        ])
    }
    if (pluginOptions.grabBeri) {
        packagesToBuy = packagesToBuy.concat([
            1988,
            1987,
            1980,
            3014,
            3002,
            1989,
            1990,
            1979,
            1981,
        ])
    }
    if (pluginOptions.grabSams) {
        packagesToBuy = packagesToBuy.concat([1977,
            1975,
            1978,
            3012,
            3020,
            3018,
            3004,
        ])
    }
    if (pluginOptions.grabGlory) {
        packagesToBuy = packagesToBuy.concat([
            3013,
            3000,
            3016,
            3001,
        ])
    }

    if (pluginOptions.grabGloryTools) {
        packagesToBuy = packagesToBuy.concat([
            1982,
            1985,
            1984
        ])
    }
    if(pluginOptions.grabTickets) {
        packagesToBuy.push(3015)
    }
    function tryAndBuyPackage(packageID, index) {
        const packageInfo = packages.find(e => e.packageID == packageID)
        let package = gbc.PL.find(e => Number(e.PID) == packageID)
        if(!package)
        {
            package = {PID: packageID, AMT: 0}
            gbc.PL.push(package)
        }
        const packagesLeft = Number(packageInfo.stock) - package.AMT
        const buyAmmount = Math.min(packagesLeft, Math.floor(silverTokens / packageInfo.costSilverToken))
        if(buyAmmount <= 0)
            return

        silverTokens -= buyAmmount * packageInfo.costSilverToken
        
        package.AMT += buyAmmount
        
        sendXT("sbp", JSON.stringify({ 
            PID: packageID, BT: 0, TID: 116, 
            AMT: buyAmmount, 
            KID: 0, AID: -1, PC2: -1, 
            BA: 0, PWR: 0, _PO: -1 
        }))

        console.log("shopBuying", packageInfo.comment2, ` x${buyAmmount}`)
        if((Number(packageInfo.stock) - package.AMT) <= 0)
           packagesToBuy.splice(index, 1)

        return
    }
    const checkForBuyAblePackages = () => {
        packagesToBuy.forEach((id,i) => tryAndBuyPackage(id, i))
        if (packagesToBuy.length == 0) {
            console.log("broughtShop")
            clearInterval(timer)
        }
    }
    const timer = setInterval(checkForBuyAblePackages, 1000 * 60)
    checkForBuyAblePackages()
})