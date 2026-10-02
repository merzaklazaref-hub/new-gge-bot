if (require("node:worker_threads").isMainThread) {
  const feastCastleSelection = [
    { label: "Great Empire", value: "greatEmpireMainCastle" },
    { label: "Outpost 1", value: "greatEmpireOutpost1" },
    { label: "Outpost 2", value: "greatEmpireOutpost2" },
    { label: "Outpost 3", value: "greatEmpireOutpost3" },
    { label: "Burning Sands", value: "burningSandsCastle" },
    { label: "EverWinter Glacier", value: "everWinterGlacierCastle" },
    { label: "Fire Peaks", value: "firePeaksCastle" },
  ];

  module.exports = {
    pluginOptions: [
      {
        type: "Text",
        key: "feastFoodReduction",
        default: "150000",
      },
      {
        type: "Text",
        key: "minimumFood",
        default: "150000",
      },
      {
        type: "Text",
        key: "minimumFoodRate",
        default: "0",
      },
      {
        type: "MultiSelect",
        key: "feastCastles",
        label: "Castles to feast",
        selection: feastCastleSelection,
        default: feastCastleSelection.map((option) => option.value),
      },
    ],
  };
  return;
}

const FEAST_INTERVAL_MS = 1000 * 60 * 60 * 3; // 3 hours

const {
  ClientCommands,
  KingdomID,
  AreaType,
  getResourceCastleList,
} = require("../protocols.js");
const { events, botConfig } = require("../ggeBot.js");
const pluginOptions =
  botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {};
const feastFoodReduction = pluginOptions.feastFoodReduction
  ? Number(pluginOptions.feastFoodReduction)
  : 150000;
const minimumFood = pluginOptions.minimumFood
  ? Number(pluginOptions.minimumFood)
  : 150000;
const minimumFoodRate = pluginOptions.minimumFoodRate
  ? Number(pluginOptions.minimumFoodRate)
  : 0;
const selectedFeastCastles = new Set(
  Array.isArray(pluginOptions.feastCastles)
    ? pluginOptions.feastCastles
    : pluginOptions.feastCastles
      ? [pluginOptions.feastCastles]
      : [
          "greatEmpireMainCastle",
          "greatEmpireOutpost1",
          "greatEmpireOutpost2",
          "greatEmpireOutpost3",
          "burningSandsCastle",
          "everWinterGlacierCastle",
          "firePeaksCastle",
        ],
);

const getSelectedCastleTargets = (kingdomResourceArea, kingdomDetailedArea) => {
  const targets = [];
  const resourceAreaInfoList = Array.isArray(kingdomResourceArea?.areaInfo)
    ? kingdomResourceArea.areaInfo
    : [];
  const detailedAreaInfoList = Array.isArray(kingdomDetailedArea?.areaInfo)
    ? kingdomDetailedArea.areaInfo
    : [];

  const getDetailedArea = (areaID) =>
    detailedAreaInfoList.find((a) => a.areaID == areaID);

  if (kingdomResourceArea.kingdomID == KingdomID.greatEmpire) {
    const mainCastleResource = resourceAreaInfoList.find(
      (areaInfo) => areaInfo.type == AreaType.mainCastle,
    );
    if (mainCastleResource) {
      const detailed = getDetailedArea(mainCastleResource.extraData[0]);
      if (detailed)
        targets.push({
          key: "greatEmpireMainCastle",
          areaInfo: detailed,
          type: AreaType.mainCastle,
        });
    }

    resourceAreaInfoList
      .filter((areaInfo) => areaInfo.type == AreaType.outpost)
      .sort((left, right) => left.extraData[0] - right.extraData[0])
      .forEach((resourceArea, index) => {
        const detailed = getDetailedArea(resourceArea.extraData[0]);
        if (detailed)
          targets.push({
            key: `greatEmpireOutpost${index + 1}`,
            areaInfo: detailed,
            type: AreaType.outpost,
          });
      });

    return targets;
  }

  const kingdomKey = {
    [KingdomID.burningSands]: "burningSandsCastle",
    [KingdomID.everWinterGlacier]: "everWinterGlacierCastle",
    [KingdomID.firePeaks]: "firePeaksCastle",
  }[kingdomResourceArea.kingdomID];

  if (!kingdomKey) return targets;

  const mainCastleResource = resourceAreaInfoList.find((areaInfo) =>
    [AreaType.mainCastle, AreaType.externalKingdom].includes(areaInfo.type),
  );
  if (mainCastleResource) {
    const detailed = getDetailedArea(mainCastleResource.extraData[0]);
    if (detailed)
      targets.push({
        key: kingdomKey,
        areaInfo: detailed,
        type: mainCastleResource.type,
      });
  }

  return targets;
};

const tryToFeast = async () => {
  let feasts = 0;

  if (!Number.isFinite(feastFoodReduction) || feastFoodReduction <= 0) {
    console.warn("invalidFeastFoodReduction", pluginOptions.feastFoodReduction);
    return;
  }

  if (!Number.isFinite(minimumFood)) {
    console.warn("invalidMinimumFood", pluginOptions.minimumFood);
    return;
  }

  if (!Number.isFinite(minimumFoodRate)) {
    console.warn("invalidMinimumFoodRate", pluginOptions.minimumFoodRate);
    return;
  }

  if (selectedFeastCastles.size == 0) {
    console.log("noFeastTargetsSelected");
    return;
  }

  try {
    const detailedCastleList = await ClientCommands.getDetailedCastleList();
    const resourceCastleList = await getResourceCastleList();

    const detailedKingdoms = Array.isArray(detailedCastleList?.castles)
      ? detailedCastleList.castles
      : [];
    const resourceKingdoms = Array.isArray(resourceCastleList?.castles)
      ? resourceCastleList.castles
      : [];

    if (detailedKingdoms.length == 0 || resourceKingdoms.length == 0) {
      console.warn("feastNoCastlesAvailable");
      return;
    }

    for (const resourceKingdom of resourceKingdoms) {
      if (resourceKingdom.kingdomID == KingdomID.stormIslands) continue;
      if (resourceKingdom.kingdomID == KingdomID.berimond) continue;

      const detailedKingdom = detailedKingdoms.find(
        (k) => k.kingdomID == resourceKingdom.kingdomID,
      );
      if (!detailedKingdom) continue;

      for (const { key, areaInfo, type } of getSelectedCastleTargets(
        resourceKingdom,
        detailedKingdom,
      )) {
        if (!selectedFeastCastles.has(key)) continue;

        let foodRate =
          areaInfo.getProductionData.deltaFood -
          areaInfo.getProductionData.FoodConsumptionRate *
            areaInfo.getProductionData.foodConsumptionReductionPercentage;
        if (foodRate < Math.max(0, minimumFoodRate)) continue;

        if (
          resourceKingdom.kingdomID == KingdomID.greatEmpire &&
          type == AreaType.mainCastle &&
          areaInfo.getProductionData.maxAmountFood < areaInfo.food
        )
          continue;

        while (
          minimumFood < areaInfo.food - feastFoodReduction &&
          feastFoodReduction <= areaInfo.food
        ) {
          await ClientCommands.startFeast(
            8,
            areaInfo.areaID,
            resourceKingdom.kingdomID,
          )();
          feasts++;
          areaInfo.food -= feastFoodReduction;
        }
      }
    }

    if (feasts > 0)
      console.log("consumed", feastFoodReduction * feasts,  `(${feasts}x)`);
    else {
      console.log("notEnoughFoodToFeast");
    }
  } catch (error) {
    console.error("feastFailed", error);
  }
};

events.once("load", () => {
  setInterval(() => {
    tryToFeast().catch((error) => console.error("feastFailed", error));
  }, FEAST_INTERVAL_MS);
  tryToFeast().catch((error) => console.error("feastFailed", error));
});
