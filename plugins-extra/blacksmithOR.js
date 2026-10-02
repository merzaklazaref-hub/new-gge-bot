/*
 * Extra plugin: Blacksmith Order Resource (OR) package auto-buying logic.
 * - Provides a shop configuration table and eventStart auto-purchase flow.
 * - Hidden module exports in main thread, real behavior in worker thread.
 */
return module.exports = { hidden : true }
const packageIDs = [ 4992,4986,4985,4983,4980,4979,4962,4961,4960,4959,4958,4957,4956,4955,4954,4953,4952,4951,4946,4943,4942,4941,4939,4938,4937,4936,4935,4934,4933,4932,4929,4928,4927,4926,4925,4924,4923,4922,4921,4920,4919,4918,4917,4916,4915,4914,4913,4912,4911,4910,4909,4908,4907,4906,4905,4904,4903,4902,4901,4900,4899,4898,4897,4896,4895,4894,4893,4892,4891,4890,4889,4888,4887,4886,4885,4884,4883,4882,4881,4880,4879,4878,4877,4876,4875,4874,4873,4872,4871,4870,4868,4867,4866,4865,4864,4863,4862,4861,4860,4859,4858,4857,4856,4855,4854,4853,4852,4851,4850,4849,4848,4847,4846,4844 ]
const packages = require("../items/packages.json")
const constructionItems = require("../items/constructionItems.json")
const equipmentTypes = require("../items/equipment_sets.json")
const equipments = require("../items/equipments.json")
const units = require("../items/units.json")
const buildings = require("../items/buildings.json")

units.find(e => e.name)
function packagesData() {
    return packageIDs.map(id => {
        const package = packages.find(e => e.packageID == id)
        let name = undefined
        let amount = 1
        switch(package.packageType) {
            case "constructionItem":
                const constructionItem = constructionItems.find(e=> e.constructionItemID)
                name = constructionItem.name
                amount = package.constructionItemAmount
                break
            case "item":
                name = `equipment_unique_${package.equipmentIDs}`
                break
            case "soldier":
                name = units.find(e => e.wodID == package.unitID).name
                amount = package.unitAmount
                break
            case "deco":
                name = buildings.find(e => e.wodID == package.buildingID).name
                amount = package.buildingAmount
                break
            case "":
                
        }
        return {
            
        }
    })
}

if(require('node:worker_threads').isMainThread)
{
    module.exports = {
        pluginOptions: [
            {
                type: "Table",
                row: [
                    "Item",
                    "Ammount",
                    ""
                ],
                key: "packages",
                data: packagesData(),
                xs: 9999, sm: 9999, md: 9999, lg: 9999
            }
        ]
    }
    return
}
const { events, sendXT, waitForResult, xtHandler, botConfig } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

events.on("eventStart", async event => {
    if(event.EID != 116)
        return
    
    await sendXT("gbc", JSON.stringify({ CID: 250, KID: 0 }))

    const gbc = (await waitForResult("gbc", 1000 * 10))[0]

    let packagesToBuy = []

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