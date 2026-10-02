/*
 * Extra plugin: automated barracks training and troop upgrades.
 * - Selects troop builds by type and schedules regular training.
 */
const TROOP_BUILD_OPTIONS = [
  { label: "Range Mead Attack", id: 205 },
  { label: "Range Mead Defense", id: 228 },
  { label: "Melee Mead Attack", id: 195 },
  { label: "Melee Mead Defense", id: 217 },
  { label: "Relic Shortbow", id: 149 },
  { label: "Relic Axeman", id: 148 },
  { label: "Veteran Heavy Crossbow", id: 312 },
  { label: "Spearman", id: 602 },
];

if (require("node:worker_threads").isMainThread)
  return (module.exports = {
    pluginOptions: [
      {
        type: "Text",
        key: "level",
      },
      {
        type: "Select",
        key: "troopType",
        selection: TROOP_BUILD_OPTIONS.map((option) => option.label),
        default: "0",
      },
      {
        type: "Checkbox",
        key: "enableStorm",
        default: false,
      },
      {
        type: "Text",
        key: "stormLevel",
      },
      {
        type: "Select",
        key: "stormTroopType",
        selection: TROOP_BUILD_OPTIONS.map((option) => option.label),
        default: "0",
      },
      {
        type: "Checkbox",
        key: "randomizeTiming",
        default: true,
      },
    ],
  });
const { botConfig, xtHandler } = require("../ggeBot.js");
const {
  KingdomID,
  AreaType,
  getResourceCastleList,
  kingdomLock,
} = require("../protocols.js");
const { sendXT, waitForResult, events } = require("../ggeBot.js");
const units = require("../items/units.json");
const buildings = require("../items/buildings.json");

const effectTypes = require("../items/effecttypes.json");
const pluginOptions =
  botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {};
const sceatSkills = require("../items/sceatSkills.json");

let selectedTroop = TROOP_BUILD_OPTIONS[Number(pluginOptions.troopType)]?.id;
if (!Number.isFinite(selectedTroop)) selectedTroop = TROOP_BUILD_OPTIONS[0].id;

let stormSelectedTroop = TROOP_BUILD_OPTIONS[Number(pluginOptions.stormTroopType)]?.id;
if (!Number.isFinite(stormSelectedTroop)) stormSelectedTroop = TROOP_BUILD_OPTIONS[0].id;

//SKL
const getUpgradeChain = (startID, source, fallbackLabel) => {
  let foundAll = false;
  let chain = [];
  let start = startID;
  while (!foundAll) {
    let item = source.find((e) => e?.wodID == start);
    if (!item) throw Error(`MissingUpgradeData:${fallbackLabel}:${start}`);
    chain.push(item.wodID);
    if (!item.upgradeWodID) foundAll = true;
    if (start == item.upgradeWodID) throw Error("Recursion");
    start = item.upgradeWodID;
  }
  return chain;
};
let list = getUpgradeChain(160, buildings, "building");
let skl;
xtHandler.on("skl", (e) => (skl = e));
let activeEffects = {};
let ungroupedActiveEffects = {};
const RECRUIT_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SWEEP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SWEEP_INTERVAL_JITTER_MS = 15 * 60 * 1000; // 15 minutes
const areaRecruitTimers = new Map();

const getAreaKey = (kingdomID, areaID) => `${kingdomID}:${areaID}`;

const clearAreaRecruitTimer = (kingdomID, areaID) => {
  const key = getAreaKey(kingdomID, areaID);
  const existingTimer = areaRecruitTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    areaRecruitTimers.delete(key);
  }
};

events.once("load", async () => {
  // ungroupedActiveEffects = {}
  // skl.SIDS.forEach(skillID => {
  //     const sceatSkill = sceatSkills.find(e => e.skillID == skillID)
  //     if (!sceatSkill)
  //         return
  //     const [effectID, value] = sceatSkill.effects.split('&')

  //     ungroupedActiveEffects[effectID] ??= []
  //     ungroupedActiveEffects[effectID] = value.split(',')
  // })
  // activeEffects = {}
  // for (const key in ungroupedActiveEffects) {
  //     let effectTypeID = effects.find(e => e.effectID == key).effectTypeID
  //     let effectType = effectTypes.find(e => e.effectTypeID == effectTypeID)
  //     activeEffects[effectType.name] = ungroupedActiveEffects[key]
  // }

  if (String(pluginOptions.level) == "" && String(pluginOptions.stormLevel) == "")
    return console.warn("barracksLevelNotDefined");

  const requestBarracksHelp = (kingdomID, areaID) =>
    kingdomLock(async () => {
      sendXT("jca", JSON.stringify({ CID: areaID, KID: kingdomID }));
      await waitForResult(
        "jaa",
        1000 * 10,
        (o) => o?.grc?.KID == kingdomID && o?.grc?.AID == areaID,
      );
      sendXT("ahr", JSON.stringify({ ID: 0, T: 6 }));
    });

  let scheduleRecruitTroops;

  let recruitTroops = (kingdomID, areaID, index) =>
    kingdomLock(async () => {
      index ??= 0;
      index++;
      await sendXT("jca", JSON.stringify({ CID: areaID, KID: kingdomID }));
      let [obj, _] = await waitForResult(
        "jaa",
        1000 * 10,
        (o) => o?.grc?.KID == kingdomID && o?.grc?.AID == areaID,
      );

      const buildingObject = obj?.gca?.BD?.find((e) => list.includes(e[0]));
      if (!buildingObject) return 0;
      const wodID = buildingObject[0];

      if (!wodID) return 0;

      await sendXT("spl", JSON.stringify({ LID: 0 }));
      const obj2 = (await waitForResult("spl", 1000 * 10))[0];
      let troopsRecruited = 0;

      for (let i = 0; i < obj2.QS.length; i++) {
        const obj4 = obj2.QS[i];

        if (obj4.P) continue;
        if (obj4.SI.RUT == 0) continue;

        let troopList = [];
        let level = kingdomID === KingdomID.stormIslands ? pluginOptions.stormLevel : pluginOptions.level;
        let currentSelectedTroop = kingdomID === KingdomID.stormIslands ? stormSelectedTroop : selectedTroop;

        if ([, ""].includes(level)) return 0;

        troopList = getUpgradeChain(currentSelectedTroop, units, "unit");
        switch (currentSelectedTroop) {
          case 228:
            troopList.push(493);
            break;
          case 217:
            troopList.push(489);
        }

        let stackSize = Number(
          buildings.find((e) => e?.wodID == wodID)?.stackSize,
        );

        // const unlockedIDs = Array.from(buildings[wodID].unlockIDs).split(',').map(Number)

        let buildingUniqueID = buildingObject[1];
        let builditems = obj.gca.CI.find((e) => e.OID == buildingUniqueID);
        if (builditems?.CIL.find((e) => e.CID == 14)) stackSize += 80;

        if (stackSize <= 0) {
          console.log(
            "couldNotRecruitReason",
            "couldNotRecruitReasonTroopLimitReached",
          );
          scheduleRecruitTroops(
            kingdomID,
            areaID,
            RECRUIT_RETRY_DELAY_MS,
            index,
          );
          return 0;
        }

        await sendXT(
          "bup",
          JSON.stringify({
            LID: 0,
            WID: troopList[Number(level)],
            AMT: stackSize,
            PO: -1,
            PWR: 0,
            SK: 73,
            SID: kingdomID === KingdomID.stormIslands ? 4 : 2,
            AID: areaID,
          }),
        );

        if ((await waitForResult("bup", 1000 * 10))[1] != 0) {
          console.warn(
            "failedToRecruitTroops",
            `KID:${kingdomID} AID:${areaID}`,
          );
          return 0;
        }

        troopsRecruited += stackSize;
      }
      await sendXT("spl", JSON.stringify({ LID: 0 }));
      const postRecruitSpl = (await waitForResult("spl", 1000 * 10))[0];
      const canRequestHelp = (postRecruitSpl?.QS ?? []).some(
        (e) => e?.P?.RAH === false,
      );

      if (canRequestHelp) {
        if (pluginOptions.randomizeTiming) {
          const randomIntFromInterval = (min, max) =>
            Math.floor(Math.random() * (max - min + 1) + min);
          setTimeout(
            () =>
              requestBarracksHelp(kingdomID, areaID).catch((error) =>
                console.warn(
                  "failedToRequestBarracksHelp",
                  `KID:${kingdomID} AID:${areaID}`,
                  error,
                ),
              ),
            randomIntFromInterval(1 * index, 3 * index) * 1000,
          ).unref();
        } else await requestBarracksHelp(kingdomID, areaID);
      }

      scheduleRecruitTroops(
        kingdomID,
        areaID,
        Math.max(10, Number(postRecruitSpl?.TCT ?? 30)) * 1000,
        index,
      );

      return troopsRecruited;
    });

  scheduleRecruitTroops = (kingdomID, areaID, delayMs, index) => {
    clearAreaRecruitTimer(kingdomID, areaID);
    const key = getAreaKey(kingdomID, areaID);
    const timer = setTimeout(
      () => {
        recruitTroops(kingdomID, areaID, index).catch((error) => {
          console.warn(
            "failedToRecruitTroopsCycle",
            `KID:${kingdomID} AID:${areaID}`,
            error,
          );
          scheduleRecruitTroops(
            kingdomID,
            areaID,
            RECRUIT_RETRY_DELAY_MS,
            index,
          );
        });
      },
      Math.max(0, Number(delayMs) || 0),
    );
    timer.unref?.();
    areaRecruitTimers.set(key, timer);
  };

  let sweepInProgress = false;
  const runRecruitSweep = async () => {
    if (sweepInProgress) {
      console.warn("barracksSweepSkipped", "previousSweepStillRunning");
      return;
    }

    sweepInProgress = true;
    try {
      let troopsRecruited = 0;
      const resourceCastleList = await getResourceCastleList();
      for (let i = 0; i < resourceCastleList.castles.length; i++) {
        const resourceCastle = resourceCastleList.castles[i];

        if (resourceCastle.kingdomID === KingdomID.berimond) continue;
        if (resourceCastle.kingdomID === KingdomID.stormIslands && !pluginOptions.enableStorm) continue;

        for (let j = 0; j < resourceCastle.areaInfo.length; j++) {
          const areaInfo = resourceCastle.areaInfo[j];
          if (resourceCastle.kingdomID === KingdomID.stormIslands && areaInfo.type !== AreaType.externalKingdom) continue;
          
          const areaID = areaInfo.extraData[0];

          clearAreaRecruitTimer(resourceCastle.kingdomID, areaID);
          try {
            troopsRecruited += await recruitTroops(
              resourceCastle.kingdomID,
              areaID,
              j + i,
            );
          } catch (e) {
            console.warn(e);
          }
        }
      }
      console.log(troopsRecruited, "recruitedTroops");
    } catch (error) {
      console.warn("barracksSweepFailed", error);
    } finally {
      sweepInProgress = false;
    }
  };

  const getRandomIntFromInterval = (min, max) =>
    Math.floor(Math.random() * (max - min + 1) + min);

  const getNextSweepDelay = () => {
    if (!pluginOptions.randomizeTiming) return DEFAULT_SWEEP_INTERVAL_MS;
    return (
      DEFAULT_SWEEP_INTERVAL_MS +
      getRandomIntFromInterval(
        -SWEEP_INTERVAL_JITTER_MS,
        SWEEP_INTERVAL_JITTER_MS,
      )
    );
  };

  const scheduleNextSweep = () => {
    const delayMs = Math.max(60 * 1000, getNextSweepDelay());
    const timer = setTimeout(() => {
      runRecruitSweep().finally(() => scheduleNextSweep());
    }, delayMs);
    timer.unref?.();
  };

  await runRecruitSweep();
  scheduleNextSweep();
});
