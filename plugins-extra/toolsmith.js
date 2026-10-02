/*
 * Extra plugin: toolsmith crafting automation.
 * - Prioritizes crafting resource products and drives craft queue for toolsmith.
 * - Uses crafting recipe unlock and event-based thresholds.
 */

// Formats large numbers into readable strings with k/m suffixes or comma separators.
// Note: This matches the central formatter in ggeBot.js for consistency.
function formatNumber(num) {
  if (typeof num !== "number" || !Number.isFinite(num)) return num;
  const abs = Math.abs(num);
  if (abs >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "m";
  if (abs >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(num).toLocaleString();
}

const MANUAL_OPTIONS = [
  { label: "Short manual", value: "short" },
  { label: "Long manual", value: "long" }
]

const REFINERY_CONFIG = [
  {
    resourceKey: "refinedLumber",
    label: "Refined Wood",
    recipeGroupID: 1,
    useKey: "refineryUseRefinedLumber",
    manualKey: "refineryRefinedLumberManual"
  },
  {
    resourceKey: "refinedStone",
    label: "Refined Stone",
    recipeGroupID: 2,
    useKey: "refineryUseRefinedStone",
    manualKey: "refineryRefinedStoneManual"
  },
  {
    resourceKey: "steel",
    label: "Steel",
    recipeGroupID: 13,
    useKey: "refineryUseSteel",
    manualKey: "refinerySteelManual"
  },
  {
    resourceKey: "dragonGlass",
    label: "Dragon Glass",
    recipeGroupID: 14,
    useKey: "refineryUseDragonGlass",
    manualKey: "refineryDragonGlassManual"
  }
]

const TOOLSMITH_CONFIG = [
  {
    resourceKey: "screws",
    label: "Screws",
    recipeGroupID: 3,
    useKey: "toolsmithUseScrews",
    manualKey: "toolsmithScrewsManual"
  },
  {
    resourceKey: "blackPowder",
    label: "Black powder",
    recipeGroupID: 4,
    useKey: "toolsmithUseBlackPowder",
    manualKey: "toolsmithBlackPowderManual"
  },
  {
    resourceKey: "saws",
    label: "Saws",
    recipeGroupID: 5,
    useKey: "toolsmithUseSaws",
    manualKey: "toolsmithSawsManual"
  },
  {
    resourceKey: "drills",
    label: "Drills",
    recipeGroupID: 6,
    useKey: "toolsmithUseDrills",
    manualKey: "toolsmithDrillsManual"
  },
  {
    resourceKey: "crowbars",
    label: "Crowbars",
    recipeGroupID: 7,
    useKey: "toolsmithUseCrowbars",
    manualKey: "toolsmithCrowbarsManual"
  },
  {
    resourceKey: "leatherStrips",
    label: "Leather strips",
    recipeGroupID: 8,
    useKey: "toolsmithUseLeatherStrips",
    manualKey: "toolsmithLeatherStripsManual"
  },
  {
    resourceKey: "chains",
    label: "Chains",
    recipeGroupID: 9,
    useKey: "toolsmithUseChains",
    manualKey: "toolsmithChainsManual"
  },
  {
    resourceKey: "metalPlates",
    label: "Metal plates",
    recipeGroupID: 10,
    useKey: "toolsmithUseMetalPlates",
    manualKey: "toolsmithMetalPlatesManual"
  }
]

const CYCLE_BASE_INTERVAL_MS = 1000 * 60 * 60 // 1 hour
const CYCLE_RANDOM_OFFSET_MS = 1000 * 60 * 5 // +/- 5 minutes
const CYCLE_MIN_INTERVAL_MS = 1000 * 60 * 30 // 30 minutes

const refineryResourceSelection = REFINERY_CONFIG.map(resource => ({
  label: resource.label,
  value: resource.resourceKey
}))

const toolsmithResourceSelection = TOOLSMITH_CONFIG.map(resource => ({
  label: resource.label,
  value: resource.resourceKey
}))

const allRefineryResourceKeys = REFINERY_CONFIG.map(resource => resource.resourceKey)
const allToolsmithResourceKeys = TOOLSMITH_CONFIG.map(resource => resource.resourceKey)
const craftingCursor = {
  refinery: 0,
  toolsmith: 0
}

function formatResourceName(resourceKey) {
  const replacements = {
    refinedLumber: "Refined Wood",
    refinedStone: "Refined Stone",
    dragonGlass: "Dragon Glass",
    steel: "Steel",
    screws: "Screws",
    blackPowder: "Black Powder",
    saws: "Saws",
    drills: "Drills",
    crowbars: "Crowbars",
    chains: "Chains",
    metalPlates: "Metal Plates",
    leatherStrips: "Leather Strips"
  }

  if (replacements[resourceKey]) return replacements[resourceKey]

  return String(resourceKey)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

if (require('node:worker_threads').isMainThread)
  return module.exports = {
    pluginOptions: [
      {
        type: "Label",
        key: "refineryProduction",
        label: "Refinery"
      },
      {
        type: "MultiSelect",
        key: "refineryEnabledResources",
        label: "Resources To Produce",
        selection: refineryResourceSelection,
        default: allRefineryResourceKeys
      },
      {
        type: "Checkbox",
        key: "refineryUseLongManual",
        label: "Long Manual",
        default: false,
        inlineWithPrevious: true
      },
      {
        type: "Label",
        key: "toolsmithProduction",
        label: "Toolsmith"
      },
      {
        type: "MultiSelect",
        key: "toolsmithEnabledResources",
        label: "Resources To Produce",
        selection: toolsmithResourceSelection,
        default: allToolsmithResourceKeys
      },
      {
        type: "Checkbox",
        key: "toolsmithUseLongManual",
        label: "Long Manual",
        default: false,
        inlineWithPrevious: true
      }
    ]
  }

const { sendXT, events, waitForResult, botConfig } = require("../ggeBot")
const { ClientCommands, resources } = require("../protocols")
const craftingRecipes = require("../items/craftingRecipes.json")
const effects = require("../items/effects.json")
const effectTypes = require("../items/effecttypes.json")

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
//%xt%EmpireEx_19%crun%1%{"KID":0,"AID":3750279,"OID":1968,"S":[1],"ST":"production"}%
//%xt%EmpireEx_19%crun%1%{"KID":0,"AID":3750279,"OID":1968,"S":[1],"ST":"queue"}%

const CASTLE_COST_KEYS = {
  costWood: "wood",
  costStone: "stone",
  costFood: "food",
  costCoal: "coal",
  costOil: "oil",
  costGlass: "glass",
  costIron: "iron",
  costHoney: "honey",
  costMead: "mead",
  costAqua: "aqua"
}

const GLOBAL_COST_KEYS = {
  costRefinedLumber: "refinedLumber",
  costRefinedStone: "refinedStone",
  costSteel: "steel",
  costDragonGlass: "dragonGlass"
}

const byLevelDesc = (a, b) => Number(b.level) - Number(a.level)

const getManualType = (manualSetting) =>
  String(manualSetting).toLowerCase() == "long" ? "Long" : "Short"

function getSlotsAvailable(building) {
  return 2 + building.PS.RUT.length - building.PS.CRID.length +
    building.QS.RUT.length - building.QS.CRID.length
}

function getSelectedRecipe(groupRecipes, manualType) {
  return groupRecipes
    .filter(recipe => String(recipe.type).toLowerCase() == manualType.toLowerCase())
    .sort(byLevelDesc)[0]
}

function getHighestRecipe(groupRecipes) {
  return groupRecipes.sort(byLevelDesc)[0]
}

function getRecipeCost(recipe, costKey) {
  return Number(recipe[costKey] ?? 0)
}

function getMissingCosts(recipe, castleProd) {
  const missing = []

  for (const [costKey, stockKey] of Object.entries(CASTLE_COST_KEYS)) {
    const needed = getRecipeCost(recipe, costKey)
    if (needed <= 0) continue

    const have = Number(castleProd[stockKey] ?? 0)
    if (have < needed) {
      missing.push(`${stockKey}:${formatNumber(have)}/${formatNumber(needed)}`)
    }
  }

  for (const [costKey, stockKey] of Object.entries(GLOBAL_COST_KEYS)) {
    const needed = getRecipeCost(recipe, costKey)
    if (needed <= 0) continue

    const have = Number(resources[stockKey] ?? 0)
    if (have < needed) {
      missing.push(`${stockKey}:${formatNumber(have)}/${formatNumber(needed)}`)
    }
  }

  return missing
}

function canAffordRecipe(recipe, castleProd) {
  return getMissingCosts(recipe, castleProd).length == 0
}

function applyRecipeCosts(recipe, castleProd) {
  for (const [costKey, stockKey] of Object.entries(CASTLE_COST_KEYS)) {
    const needed = getRecipeCost(recipe, costKey)
    if (needed <= 0) continue
    castleProd[stockKey] = Number(castleProd[stockKey] ?? 0) - needed
  }

  for (const [costKey, stockKey] of Object.entries(GLOBAL_COST_KEYS)) {
    const needed = getRecipeCost(recipe, costKey)
    if (needed <= 0) continue
    resources[stockKey] = Number(resources[stockKey] ?? 0) - needed
  }
}

function getCurrentResourceCount(resourceKey) {
  const value = Number(resources[resourceKey])
  return Number.isFinite(value) ? value : 0
}

function getOptionList(optionKey, fallbackValues) {
  const optionValue = pluginOptions[optionKey]
  if (!Array.isArray(optionValue))
    return fallbackValues

  return optionValue.map(value => String(value))
}

function getBuildingOptionState(buildingLabel) {
  if (buildingLabel == "refinery") {
    return {
      enabledResources: new Set(getOptionList("refineryEnabledResources", allRefineryResourceKeys)),
      useLongManual: Boolean(pluginOptions.refineryUseLongManual)
    }
  }

  if (buildingLabel == "toolsmith") {
    return {
      enabledResources: new Set(getOptionList("toolsmithEnabledResources", allToolsmithResourceKeys)),
      useLongManual: Boolean(pluginOptions.toolsmithUseLongManual)
    }
  }

  return {
    enabledResources: new Set(),
    useLongManual: false
  }
}

function getCraftingResources(CE) {
  const ungroupedActiveEffects = {}

  CE.forEach(([effectID, effectValues]) =>
    (ungroupedActiveEffects[effectID] ??= []).push(...effectValues))

  const activeEffects = {}
  for (const key in ungroupedActiveEffects) {
    let effectTypeID = effects.find(e => e.effectID == key).effectTypeID
    let effectType = effectTypes.find(e => e.effectTypeID == effectTypeID)
    activeEffects[effectType.name] ??= []
    activeEffects[effectType.name].push(...ungroupedActiveEffects[key])
  }

  const useableRecipes = (activeEffects.enableCraftingRecipes ?? []).map(recipeID => {
    const recipe = craftingRecipes.find(e => e.craftingRecipeId == recipeID)
    if (!recipe)
      return

    if (!activeEffects.enableCraftingRecipeGroups?.find(craftingRecipeGroupID => craftingRecipeGroupID == recipe.recipeGroupID)) {
      return // console.warn("group not enabled")
    }
    return recipe

  }).filter(e => e !== undefined)
    .filter(e => (e.costC2 ?? 0) == 0)

  const unlockedRecipes = {}
  for (const recipe of useableRecipes) {
    unlockedRecipes[recipe.recipeGroupID] ??= []
    unlockedRecipes[recipe.recipeGroupID].push(recipe)
  }

  return unlockedRecipes
}

async function craftingAreas() {
  async function craftForBuilding(building, craftingResourcesByGroup, resourceConfig, buildingLabel) {
    const displayLabel = buildingLabel == "toolsmith" ? "Toolsmith" : "Refinery"
    const slotsAvailable = getSlotsAvailable(building)
    if (slotsAvailable == 0) {
      console.warn(`[${displayLabel}] no slots available`)
      return
    }
    if (slotsAvailable < 0) {
      console.error(`[${displayLabel}] invalid slotsAvailable (${slotsAvailable})`)
      console.error(JSON.stringify(building))
      return
    }

    const castleProductionList = await ClientCommands.getDetailedCastleList()
    const castleProd = castleProductionList
      .castles.find(a => a.kingdomID == building.KID)?.areaInfo.find(e => e.areaID == building.AID)

    if (!castleProd) {
        console.warn(`[${displayLabel}] missing production data for KID=${building.KID} AID=${building.AID}`)
      return
    }

    const optionState = getBuildingOptionState(buildingLabel)

    const configuredResources = resourceConfig
      .filter(resource => optionState.enabledResources.has(resource.resourceKey))
      .map(resource => {
        const groupRecipes = craftingResourcesByGroup[resource.recipeGroupID] ?? []
        const manualType = optionState.useLongManual ? "Long" : "Short"
        const selectedRecipe = getSelectedRecipe(groupRecipes, manualType)

        if (!selectedRecipe) {
          const highestRecipe = getHighestRecipe([...groupRecipes])

          if (!highestRecipe)
              console.error(`[${displayLabel}] selected resource ${resource.resourceKey} is not unlocked yet (group ${resource.recipeGroupID})`)
          else
              console.error(`[${displayLabel}] selected ${manualType} manual for ${resource.resourceKey} is not unlocked yet (highest unlocked: ${highestRecipe.type} lvl ${highestRecipe.level})`)

          return undefined
        }

        return {
          ...resource,
          recipe: selectedRecipe
        }
      })
      .filter(e => e !== undefined)

    if (configuredResources.length == 0) {
      console.warn(`[${displayLabel}] no valid resources configured for this building`)
      return
    }

    const cursorKey = buildingLabel == "toolsmith" ? "toolsmith" : "refinery"

    for (let index = 0; index < slotsAvailable; index++) {
      const startIndex = craftingCursor[cursorKey] % configuredResources.length
      let preferredResource

      for (let offset = 0; offset < configuredResources.length; offset++) {
        const resource = configuredResources[(startIndex + offset) % configuredResources.length]
        if (canAffordRecipe(resource.recipe, castleProd)) {
          preferredResource = resource
          craftingCursor[cursorKey] = (startIndex + offset + 1) % configuredResources.length
          break
        }

        const missingCostText = getMissingCosts(resource.recipe, castleProd).join(", ")
        console.warn(`[${displayLabel}] not enough resources to craft ${resource.resourceKey} (${resource.recipe.type} lvl ${resource.recipe.level}) - missing ${missingCostText}`)
      }

      if (!preferredResource) {
        console.warn(`[${displayLabel}] none of the configured resources can be crafted with current stock`)
        return
      }

      applyRecipeCosts(preferredResource.recipe, castleProd)

      console.log(`[${displayLabel}] crafting ${formatResourceName(preferredResource.resourceKey)} (${preferredResource.recipe.type} lvl ${preferredResource.recipe.level})`)

      sendXT("crst", JSON.stringify({
        KID: building.KID,
        AID: building.AID,
        OID: building.OID,
        PWR: 0,
        CRID: preferredResource.recipe.craftingRecipeId
      }))
    }
  }

  async function toolsmith(building, craftingResources) {
    if(building.PS.RUT.length == 0) {
      await sendXT("crun", JSON.stringify({KID: building.KID, AID: building.AID, OID: building.OID, S:[1], ST:"production"}))
      const [obj, r] = await waitForResult("crun", 1000 * 10, (o, r) => 
        r != 0 ? true : (o.OID == building.OID && o.KID == building.KID && o.AID == building.AID))
      if(r == 0)
        building = obj
    }
    await craftForBuilding(building, craftingResources, TOOLSMITH_CONFIG, "toolsmith")
  }
  async function dragonHoard() {
    console.log("dragonHoard")
  }
  async function refinery(building, craftingResources) {
    await craftForBuilding(building, craftingResources, REFINERY_CONFIG, "refinery")
  }
  await sendXT("crin", JSON.stringify({}))
  let [obj] = await waitForResult("crin", 1000 * 10)
  for (const e of obj.CAI) {
    const craftingResources = getCraftingResources(e.CE)
    for (const building of e.CBI) {
      if (building.CQID == 1)
        await refinery(building, craftingResources)
      else if (building.CQID == 2)
        await toolsmith(building, craftingResources)
      else if (building.CQID == 3)
        await dragonHoard(building, craftingResources)
      else
        console.warn(`Unknown recipe crafter: ${building.CQID}`)
    }
  }
}


function getRandomizedCycleDelayMs() {
  const offset = Math.round((Math.random() * 2 - 1) * CYCLE_RANDOM_OFFSET_MS)
  return Math.max(CYCLE_MIN_INTERVAL_MS, CYCLE_BASE_INTERVAL_MS + offset)
}


events.once("load", () => {
  const runCraftingAreas = () => {
    craftingAreas().catch(error =>
      console.warn("toolsmithCycleFailed", error))
  }

  const scheduleNextCycle = () => {
    const nextRunDelay = getRandomizedCycleDelayMs()
    setTimeout(() => {
      runCraftingAreas()
      scheduleNextCycle()
    }, nextRunDelay)
  }

  runCraftingAreas()
  scheduleNextCycle()
})

module.exports = craftingAreas