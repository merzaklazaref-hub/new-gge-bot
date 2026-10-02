// Game protocol helpers used by worker bots to translate raw world and player data into
// structured objects, and to perform server map lookups with caching.
const fs = require("fs/promises");
const { RateLimiter } = require("limiter");
const { PerformanceObserver } = require("node:perf_hooks");
const {
	waitForResult,
	sendXT,
	xtHandler,
	events,
	status,
	playerInfo,
} = require("./ggeBot.js");
const currencies = require("./items/currencies.json");
const { parentPort } = require("node:worker_threads");
const ActionType = require("./actions.json");
const EventEmitter = require("node:events");

// Map coordinate helper: converts linear index into expanding spiral coordinates.
function spiralCoordinates(n) {
	if (n === 0) return { x: 0, y: 0 };

	const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2);
	const layerStart = (2 * (k - 1) + 1) ** 2;
	const offset = n - layerStart;
	const sideLength = 2 * k;
	const side = Math.floor(offset / sideLength);
	const posInSide = offset % sideLength;

	let x, y;

	switch (side) {
		case 0:
			x = k;
			y = -k + 1 + posInSide;
			break;
		case 1:
			x = k - 1 - posInSide;
			y = k;
			break;
		case 2:
			x = -k;
			y = k - 1 - posInSide;
			break;
		case 3:
			x = -k + 1 + posInSide;
			y = -k;
			break;
	}

	return { x, y };
}
const AreaType = Object.freeze({
	barron: 2,
	outpost: 4,
	externalKingdom: 12,
	mainCastle: 1,
	alienCastle: 21,
	bloodcrowCastle: 34,
	nomadCamp: 27,
	daimyoCastle: 37,
	stormIsland: 24,
	samCamp: 29,
	beriCamp: 30,
	watchTower: 17,
	capital: 3,
	fortress: 11,
	beriCastle: 15,
	stormTower: 25,
	khanCamp: 35,
});
const HighscoreType = Object.freeze({
	honour: 5,
});

xtHandler.on("earlyLoad", () => sendXT("sce", "{}"));

// Shared in-process map cache containing WeakRefs to GAAAreaInfo objects.
// Uses WeakRefs so the GC can reclaim memory for any stale areas when not referenced.
const map = {};
// const tillMapObjectExpires = 1000 * 60
// const mapTimer = new WeakMap()
/**
 * @param {GAAAreaInfo} AI
 * @param {Number} kingdomID
 * @param {Boolean} shouldEmit
 */
// Normalize or merge incoming backend area info with existing map cache entry.
// Returns a WeakRef-managed object and updates the caller with a merged, canonical instance.
const MapObject = (AI, kingdomID) => {
	if (kingdomID == undefined) return;
	/** @type {GAAAreaInfo} */
	const obj =
		map[`${kingdomID}_${AI.x}_${AI.y}`]?.deref() ??
		((map[`${kingdomID}_${AI.x}_${AI.y}`] = new WeakRef(AI)), AI);

	Object.assign(obj, AI);

	// const timer = mapTimer.get(obj)

	// if(!timer)
	//     mapTimer.set(obj, setTimeout(() => obj, tillMapObjectExpires))
	// else
	//     timer.refresh()

	if (JSON.stringify(obj.extraData) == JSON.stringify(AI.extraData)) return obj;

	console.debug("Monitored object changed");
	console.debug("original: ", obj);
	console.debug("changed: ", AI);

	// events.emit(`area_${obj.type}_${kingdomID}`, obj)

	return obj;
};

// Query indexed map object cache for area items in coordinate rectangle and given type.
const GetMapObjects = (type, kingdomID, fromX, fromY, toX, toY) =>
	Object.entries(map)
		.map(([key, _value]) => {
			if (!key.startsWith(`${kingdomID}_`)) return;
			const value = _value.deref();

			if (!value || value.type != type) return;

			let startX = fromX < toX ? fromX : toX;
			let startY = fromY < toY ? fromY : toY;
			let endX = fromX >= toX ? fromX : toX;
			let endY = fromY >= toY ? fromY : toY;
			const x = value.x;
			const y = value.y;

			if (x < startX || x > endX || y < startY || y > endY) return;

			return value;
		})
		.filter((e) => e !== undefined);

new PerformanceObserver((_) => {
	console.debug("GC Triggered");
	for (const key in map) {
		if (map[key].deref() == undefined) delete map[key];
	}
}).observe({ entryTypes: ["gc"] });

const KingdomSkipType = Object.freeze({
	sendResource: 2,
	sendTroops: 1,

	1: "sendTroops",
	2: "sendResource",
});
const KingdomID = Object.freeze({
	greatEmpire: 0,
	burningSands: 1,
	everWinterGlacier: 2,
	firePeaks: 3,
	stormIslands: 4,
	berimond: 10,

	0: "Great Empire",
	1: "Burning Sands",
	2: "EverWinter Glacier",
	3: "Fire Peaks",
	4: "Storm Islands",
	10: "Berimond",
});
const OwnedCastlePositionList = (o) => ({
	kingdomID: o[0],
	areaID: o[1],
	X: o[2],
	Y: o[3],
	areaType: o[4],
});

const Crest = (o) => ({
	backgroundType: Number(o.BGT),
	backgroundColor1: Number(o.BGC1),
	backgroundColor2: Number(o.BGC2),
	symbolPositionType: Number(o.SPT),
	symbolType1: Number(o.S1),
	symbolColor1: Number(o.SC1),
	symbolType2: Number(o.S2),
	symbolColor2: Number(o.SC2),
	isSet: Boolean(o.IS),
});
const AllianceCrest = (o) =>
	o
		? {
				layoutID: Number(o.ACCA ? o.ACCA.ACLI : o.ACFB?.ACLI),
				colorID: Array.from(o.ACCA ? o.ACCA.ACCS : o.ACFB?.ACCS).map(Number),
			}
		: undefined;
class GAAAreaInfo {
	constructor(o) {
		this.type = Number(o[0]);
		this.x = Number(o[1]);
		this.y = Number(o[2]);
		this.extraData = Array.from(o).toSpliced(0, 3);
		this.timeSinceRequest = Number(Date.now());
	}
}
const FactionData = (o) =>
	o
		? {
				mainCampID: Number(o.MC),
				factionID: Number(o.FID),
				factionTitleID: Number(o.TID),
				remainingNoobTime: Number(o.NS),
				protectionStatus: Number(o.PMS),
				protectionTime: Number(o.PMT),
				specialCampID: Number(o.SPC),
			}
		: undefined;

const ServerUserAttackProtection = (o) => ({
	kingdomID: Number(o?.KID),
	remainingNoobTime: Number(o?.NS),
	factionProtectionStatus: Number(o?.PMS),
	factionProtectionEndTime: Number(o?.PMT),
});

class OwnerInfo {
	constructor(o) {
		this.ownerID = Number(o.OID);
		this.isDummy = Boolean(o.DUM);
		this.name = String(o.N);
		this.crest = o.E ? Crest(o.E) : void 0;
		this.level = Number(o.L + o.LL);
		this.honour = Number(o.H);
		this.achievementPoints = Number(o.AVP);
		this.gloryPoints = Number(o.CF);
		this.highestGloryPoints = Number(o.HF);
		this.titlePrefix = Number(o.PRE);
		this.titleSuffix = Number(o.SUF);
		this.TOPX = Number(o.TOPX);
		this.mightPoints = Number(o.MP);
		this.isRuin = Boolean(o.R);
		this.allianceID = Number(o.AID);
		this.allianceRank = Number(o.AR);
		this.allianceName = String(o.AN);
		this.allianceEmblem = AllianceCrest(o.aee);
		this.remainingPeaceTime = Number(o.RPT);
		this.castlePositionList = o.AP
			? Array.from(o.AP).map(OwnedCastlePositionList)
			: undefined;
		this.villagePositionList = o.VP
			? Array.from(o.VP).map(OwnedCastlePositionList)
			: undefined;
		this.isSearchingForAlliance = Boolean(o.SA);
		this.hasPremiumFlag = Boolean(o.PF);
		this.remainingRelocationTime = Number(o.RRD);
		this.islandTitleID = Number(o.TI);
		this.remainingNoobTime = Number(o.RNP);
		this.factionID = FactionData(o.FN);
	}
}

class ServerGetAreaInfo {
	constructor(o) {
		this.kingdomID = Number(o?.KID);
		this.userAttackProtection = ServerUserAttackProtection(o?.uap);
		this.ownerInfo = o?.OI
			? Array.from(o.OI).map((o) => new OwnerInfo(o))
			: undefined;
		this.areaInfo = o?.AI
			? Array.from(o?.AI).map((o) =>
					MapObject(new GAAAreaInfo(o), this.kingdomID),
				)
			: undefined;
		this.result = Number(o.result);
	}
}
/**
 *
 * @param {Number} x
 * @param {Number} y
 * @param {Number} kingdomID
 */
const clientPreSpyInfo = (x, y, kingdomID) => {
	/** @type {GAAAreaInfo} */
	const cachedMapData = map[`${kingdomID}_${x}_${y}`]?.deref();
	if (Date.now() - cachedMapData?.timeSinceRequest <= 1000 * 10) {
		console.debug("Using cached results");
		return async () => ({ areaInfo: cachedMapData, result: 0 });
	}
	const limiter = sendXT(
		"ssi",
		JSON.stringify({ TX: x, TY: y, KID: kingdomID }),
	);

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult(
			"ssi",
			1000 * 10,
			(obj, result) =>
				result != 0 ||
				(obj?.gaa?.KID == kingdomID && obj?.TX == x && obj?.TY == y),
		);

		if (result != 0) return { areaInfo: undefined, result: result };

		return {
			areaInfo: new ServerGetAreaInfo(obj.gaa, result).areaInfo[0],
			result,
		};
	};
};

const limiter = new RateLimiter({ tokensPerInterval: 5, interval: "second" });

/**
 * This will give you at max a 100x100 chunk of the map
 */
const clientGetAreaInfo = (kingdomID, fromX, fromY, toX, toY) => {
	const waitObject = limiter
		.removeTokens(1)
		.then(() =>
			areaInfoLock(() =>
				sendXT(
					"gaa",
					JSON.stringify({
						KID: Number(kingdomID),
						AX1: Number(fromX),
						AY1: Number(fromY),
						AX2: Number(toX),
						AY2: Number(toY),
					}),
				),
			),
		)
		.then(async (limiter) => {
			await limiter;
			return waitForResult("gaa", 1000 * 10, (obj, result) => {
				if (Number(result) != 0) return true;

				if (obj?.KID != kingdomID) return false;

				let ai = obj?.AI?.[0];
				if (ai == undefined) return false;

				let x = ai[1];
				let y = ai[2];

				let startX = fromX < toX ? fromX : toX;
				let startY = fromY < toY ? fromY : toY;
				let endX = fromX >= toX ? fromX : toX;
				let endY = fromY >= toY ? fromY : toY;

				if (x < startX || x > endX || y < startY || y > endY) return false;

				return true;
			});
		});
	return async () => {
		const [gaa, result] = await waitObject;

		gaa.result = result;
		return new ServerGetAreaInfo(gaa);
	};
};

const StormInfo = (e) => ({
	currentAllianceStormRank: Number(e.AR),
	isStormKing: Boolean(e.KA),
	allianceEnteredStorm: Boolean(e.AE),
	currentPlayerStormRank: Number(e.IR),
	playerAquaPoints: Number(e.AP),
	result: Number(e.result),
});
const clientGetStormIslandInfo = () => {
	const limiter = sendXT("ssi", JSON.stringify({}));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("ssi", 1000 * 10);

		return StormInfo({ ...obj, result: result });
	};
};
const AquaPlayerScores = (e) => ({
	playerID: Number(e[0]),
	playerName: String(e[1]),
	level: Number(e[2]),
	inStorm: Boolean(e[3]),
	allianceRank: Number(e[4]),
});
const AlliancePointsList = (e) => ({
	alliancePlayerScores: Array.from(e.APH ?? []).map(AquaPlayerScores),
	result: Number(e.result),
});

const GetProductionData = (e) => ({
	FoodConsumptionRate: Number(e.DFC) / 10,
	MeadConsumptionRate: Number(e.DMEADC) / 10,
	BeefConsumptionRate: Number(e.DBEEFC) / 10,
	deltaWood: Number(e.DW / 10),
	deltaStone: Number(e.DS / 10),
	deltaFood: Number(e.DF / 10),
	deltaCoal: Number(e.DC / 10),
	deltaOil: Number(e.DO / 10),
	deltaGlass: Number(e.DG / 10),
	deltaAqua: Number(e.DA / 10),
	deltaIron: Number(e.DI / 10),
	deltaHoney: Number(e.DHONEY / 10),
	deltaMead: Number(e.DMEAD / 10),
	deltaBeef: Number(e.DBEEF / 10),

	sickness: Number(e.S), //Old burnt building alternative? Might be connected to riot

	boostWood: Number(e.WM / 100),
	boostStone: Number(e.SM / 100),
	boostFood: Number(e.FM / 100),
	boostCoal: Number(e.CM / 100),
	boostoil: Number(e.OM / 100),
	boostGlass: Number(e.GM / 100),
	boostAqua: Number(e.AM / 100),
	boostIron: Number(e.IM / 100),
	boostHoney: Number(e.HONEYM / 100),
	boostMead: Number(e.MEADM / 100),
	boostBeef: Number(e.BEEFM / 100),

	metroBoost: Number(e.MP ? e.MP : 0),

	foodConsumptionReductionPercentage: Number(e.FCR / 100),
	meadConsumptionReductionPercentage: Number(e.MEADCR / 100),
	beefConsumptionReductionPercentage: Number(e.BEEFCR / 100),

	maxAmmountFood: Number(e.MRF),
	maxAmmountStone: Number(e.MRS),
	maxAmmountWood: Number(e.MRW ?? e.MRF),
	maxAmmountCoal: Number(e.MRC),
	maxAmmountIron: Number(e.MRI),
	maxAmmountOil: Number(e.MRO),
	maxAmmountGlass: Number(e.MRG),
	maxAmmountMead: Number(e.MRMEAD),
	maxAmmountHoney: Number(e.MRHONEY),
	maxAmmountBeef: Number(e.MRBEEF),
	maxAmmountAqua: Number(e.MRA),

	safeFood: Number(e.SAFE_F),
	safeStone: Number(e.SAFE_S),
	safeWood: Number(e.SAFE_W ?? e.SAFE_F),
	safeCoal: Number(e.SAFE_C),
	safeIron: Number(e.SAFE_I),
	safeOil: Number(e.SAFE_O),
	safeGlass: Number(e.SAFE_G),
	safeMead: Number(e.SAFE_MEAD),
	safeHoney: Number(e.SAFE_HONEY),
	safeBeef: Number(e.SAFE_BEEF),
	safeAqua: Number(e.SAFE_A),

	population: Number(e.P),
	decorationPoints: Number(e.NDP),
	decorationPointsReduction: Number(e.R),
	guardCount: Number(e.GRD),
	soldierProductionSpeed: Number(e.RS1),
	offensiveToolProductionSpeed: Number(e.RS2),
	defensiveToolProductionSpeed: Number(e.RS3),
	hospitalProductionSpeed: Number(e.RSH),
	buildSpeedBoost: Number(e.BDB) / 100, //Could be an issue float point integer
	//Beri or other sea event
	maxUnitStorage: Number(e.US),
	hasRoyalCaptialBuff: Boolean(e.RCP),
	maxAuxilariesTroops: Number(e.AUS),
	morality: Number(e.M),
	factionBuff: Number(e.RFPPA),
});

const Unit = (e) => ({
	unitID: Number(e[0]),
	ammount: Number(e[1]),
});

const UnitInventory = (e) => ({
	unitInventory: Array.from(e.I ?? []).map(Unit),
	strongHoldInventory: Array.from(e.SHI ?? []).map(Unit),
	hospitalInventory: Array.from(e.HI ?? []).map(Unit),
});
const DCLAreaInfo = (e) => ({
	areaID: Number(e.AID),
	wood: Number(e.W),
	stone: Number(e.S),
	food: Number(e.F),
	coal: Number(e.C),
	oil: Number(e.O),
	glass: Number(e.G),
	iron: Number(e.I),
	honey: Number(e.HONEY),
	mead: Number(e.MEAD),
	aqua: Number(e.A),
	defence: Number(e.D),
	getProductionData: GetProductionData(e.gpa),
	unitInventory: Array.from(e.AC ?? []).map(Unit),
	strongHoldInventory: Array.from(e.SHI ?? []).map(Unit),
	hospitalInventory: Array.from(e.HI ?? []).map(Unit),
	travelingUnits: Array.from(e.TU ?? []).map(Unit), //TODO: check that this is valid
	marketCarriagesCount: Number(e.MC ?? []),
	hasBarracks: Boolean(e.B),
	hasSiegeWorkshop: Boolean(e.WS),
	hasDefenseWorkshop: Boolean(e.DW),
	hasHospital: Boolean(e.H),
	openGateTime: Number(e.OGT),
});

// const allianceHelpRequest = e => ({
//     confirmed: Boolean(e.AC),
//     listID: Integer(e.LID),
//     playerName: String(e.PN),
//     progress: Integer(e.P),
//     playerID: Integer(e.PID),
//     requestTypeId: Integer(e.TID),
//     optionalParamsID: Integer(e.OP),
//     remainingTime: Integer(e.RT)
// })

const DclCastleList = (e) => ({
	kingdomID: Number(e.KID),
	areaInfo: Array.from(e.AI).map(DCLAreaInfo),
});
const DetailedCastleList = (e) => ({
	playerID: Number(e.PID),
	castles: Array.from(e.C).map(DclCastleList),
	result: Number(e.result),
});
const clientGetDetailedCastleList = async () => {
	let lastError;
	for (let attempt = 0; attempt < 5; attempt++) {
		await sendXT("dcl", JSON.stringify({ CD: 1 }));
		try {
			const [obj, result] = await waitForResult("dcl", 1000 * 60);
			return DetailedCastleList({ ...obj, result: result });
		} catch (e) {
			lastError = e;
		}
	}

	throw lastError ?? "TIMED_OUT";
};

const clientGetUnitInventory = () => {
	const limiter = sendXT("gui", JSON.stringify({}));

	return async () => {
		await limiter;
		let [obj, result] = await waitForResult("gui", 1000 * 10);

		return UnitInventory({ ...obj, result: result });
	};
};
const UnlockInfo = (e) => ({
	kingdomID: Number(e.KID),
	isUnlocked: Boolean(e.U),
	hasContor: Boolean(e.C),
	slumLevel: Number(e.SL),
	kingdomResource: Number(e.KRS), //Probs relating to storm
	eventRewardsEndID: Number(e.CRS), //Probs relating to storm rewards
});
const UnitTransferResource = (e) => ({
	type: String(e[0]),
	count: Number(e[1]),
});
const ResourceTransfer = (e) => ({
	kingdomID: Number(e.KID),
	remainingTime: Number(e.RS),
	resources: Array.from(e.G).map(UnitTransferResource),
});
const TroopTransfer = (e) => ({
	kingdomID: Number(e.KID),
	remainingTime: Number(e.RS),
	units: Array.from(e.I).map(UnitTransferResource),
});
const KingdomInfo = (e) => ({
	//KPI
	unlockInfo: Array.from(e.UL ?? []).map(UnlockInfo),
	resourceTransferList: Array.from(e.RT ?? []).map(ResourceTransfer),
	troopTransferList: Array.from(e.UT ?? []).map(TroopTransfer),
	result: Number(0),
});
//TODO: May Conflict with other clientGetKingdomInfo
const clientGetKingdomInfo = (
	sourceAreaID,
	sourceKingdomID,
	targetKingdomID,
	resources,
) => {
	const limiter = sendXT(
		"kgt",
		JSON.stringify({
			SCID: sourceAreaID,
			SKID: sourceKingdomID,
			TKID: targetKingdomID,
			G: resources,
		}),
	);

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("kgt", 1000 * 10);

		return KingdomInfo({ ...obj.kpi, result: result });
	};
};
const SubActiveQuests = (e) => ({
	playerID: Number(e.PID),
	playerName: String(e.PN),
	questID: Number(e.QID),
	questList: Array.from(e.QL),
	timeLeft: Number(e.RS),
});

const ActiveQuests = (e) => ({
	activeParticipants: Number(e.APC),
	activeQuests: Array.from(e.AQS).map(SubActiveQuests),
	result: Number(e.result),
});

const clientActiveQuestList = () => {
	const limiter = sendXT("aqs", JSON.stringify({}));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("aqs", 1000 * 10);

		return ActiveQuests({ ...obj, result: result });
	};
};

//TODO: May conflict with other clientGetMinuteSkipKingdom
const clientGetMinuteSkipKingdom = (skipType, kingdomID, kingdomSkipType) => {
	const limiter = sendXT(
		"msk",
		JSON.stringify({
			MST: `${skipType}`,
			KID: `${kingdomID}`,
			TT: `${kingdomSkipType}`,
		}),
	);

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("msk", 1000 * 10);

		return KingdomInfo({ ...obj.kpi, result: result });
	};
};
const GCLCastles = (o) => ({
	kingdomID: Number(o.KID),
	areaInfo: Array.from(o.AI).map((e) => ({
		...MapObject(new GAAAreaInfo(e.AI), o.KID),
		abandonOutpostTime: Number(e.AOT),
		abandonOutpostTimeCooldown: Number(e.TA),
	})),
});
// const ResourceCastleList = e => ({
//     playerID: Number(e.PID),
//     castles: Array.from(e.C).map(GCLCastles),
//     result: Number(e.result)
// })
class ResourceCastleList {
	constructor(e) {
		this.playerID = Number(e.PID);
		this.castles = Array.from(e.C).map(GCLCastles);
		this.result = Number(e.result);
	}
}
function isEmpty(obj) {
	for (const prop in obj) {
		if (Object.hasOwn(obj, prop)) {
			return false;
		}
	}

	return true;
}
let _activeEventList = {};

const getEventList = async () => {
	if (!isEmpty(_activeEventList)) return _activeEventList;

	let [obj, result] = await waitForResult("sei", 1000 * 10);

	Object.assign(_activeEventList, { ...obj, result });

	return _activeEventList;
};

function setEvent(obj, result) {
	if (result != 0) return;

	obj.E.find((e) => {
		if (_activeEventList.E?.find((a) => a.EID == e.EID)) return;

		console.debug(`Event ${e.EID} has started`);
		try {
			events.emit("eventStart", e);
		} catch (error) {
			console.warn("eventStart handler failed", error);
		}
	});

	_activeEventList.E?.find((e) => {
		if (obj.E.find((a) => a.EID == e.EID)) return;

		console.debug(`Event ${e.EID} has stopped`);
		try {
			events.emit("eventStop", e);
		} catch (error) {
			console.warn("eventStop handler failed", error);
		}
	});

	Object.assign(_activeEventList, { ...obj, result });
}

xtHandler.on("fjf", (obj, result) => setEvent(obj.sei, result));
xtHandler.on("sei", setEvent);

let _resourceCastleList = {};
/**
 * @returns {Promise<ResourceCastleList>}
 */
const getResourceCastleList = async () => {
	//Never got
	if (!isEmpty(_resourceCastleList)) return _resourceCastleList;

	let [obj, result] = await waitForResult("gcl", 1000 * 10);

	Object.assign(
		_resourceCastleList,
		new ResourceCastleList({ ...obj, result }),
	);

	return _resourceCastleList;
};
xtHandler.on("gcl", (obj, result) =>
	Object.assign(
		_resourceCastleList,
		new ResourceCastleList({ ...obj, result }),
	),
);

xtHandler.on("fjf", (obj, result) =>
	Object.assign(
		_resourceCastleList,
		new ResourceCastleList({ ...obj.mir.gcl, result }),
	),
);

const ResourceList = (obj) => {
	let resource = {};
	function decapitalizeFirstLetter(val) {
		return String(val).charAt(0).toLocaleLowerCase() + String(val).slice(1);
	}
	obj.forEach(([type, ammount]) => {
		const nameOverrides = {
			component1: "screws",
			component2: "blackPowder",
			component3: "saws",
			component4: "drills",
			component5: "crowbars",
			component6: "leatherStrips",
			component7: "chains",
			component8: "metalPlates",
		};
		let name = decapitalizeFirstLetter(
			currencies.find((e) => e.JSONKey == type).Name,
		);
		let realName = nameOverrides[name] ?? name;
		resource[realName] = ammount;
	});
	return resource;
};

const resources = {
	"1MinSkip": NaN,
	"5MinSkip": NaN,
	"10MinSkip": NaN,
	"30MinSkip": NaN,
	"60MinSkip": NaN,
	"5HourSkip": NaN,
	"24HourSkip": NaN,
	allianceCoin: NaN,
	barinToken: NaN,
	cargoPoints: NaN,
	castlePassageToken: NaN,
	coins: NaN,
	commonBricks: NaN,
	commonFinesand: NaN,
	commonStraw: NaN,
	commonTimber: NaN,
	screws: NaN,
	blackPowder: NaN,
	saws: NaN,
	drills: NaN,
	crowbars: NaN,
	leatherStrips: NaN,
	chains: NaN,
	metalPlates: NaN,
	decoCatalyst30: NaN,
	decoCatalyst60: NaN,
	decoCatalyst70: NaN,
	decoDust: NaN,
	dragonCharm: NaN,
	dragonriderLTPEToken: NaN,
	dragonScaleSplinters: NaN,
	dragonScaleTile: NaN,
	epicBoosterConsumable: NaN,
	epicCobblestone: NaN,
	epicMysteryBoxKey: NaN,
	epicPreciousmetals: NaN,
	epicResin: NaN,
	essence: NaN,
	fatKingToken: NaN,
	floraToken: NaN,
	fusionCurrency: NaN,
	generalsSkillsResetToken: NaN,
	goldToken: NaN,
	hasanToken: NaN,
	iceLTPEToken: NaN,
	imperialDucat: NaN,
	kaelrithToken: NaN,
	khanMedal: NaN,
	khanTablet: NaN,
	knightToken: NaN,
	legendaryBoosterConsumable: NaN,
	legendaryFabric: NaN,
	legendaryMaterial: NaN,
	legendaryRiftCoin: NaN,
	legendarySoulstone: NaN,
	legendaryToken: NaN,
	luckyWheelTicket: NaN,
	newKingLTPEToken: NaN,
	pearlRelic: NaN,
	pegasusTicket: NaN,
	plaster: NaN,
	princessToken: NaN,
	questTicket: NaN,
	rareBoosterConsumable: NaN,
	rareFarmingtools: NaN,
	rareFlint: NaN,
	rareGlue: NaN,
	rareNails: NaN,
	refinedLumber: NaN,
	refinedStone: NaN,
	relicFragment: NaN,
	resourceVillageToken: NaN,
	riftCoin: NaN,
	rubies: NaN,
	saleDaysLuckyWheelTicket: NaN,
	samuraiMedal: NaN,
	samuraiMedalBoosterKey: NaN,
	samuraiToken: NaN,
	sceatToken: NaN,
	shardAlice: NaN,
	shardAlyssa: NaN,
	shardAshira: NaN,
	shardDiana: NaN,
	shardEdric: NaN,
	shardGarrik: NaN,
	shardHasan: NaN,
	shardHoratio: NaN,
	shardKaelrith: NaN,
	shardLeo: NaN,
	shardSasaki: NaN,
	shardTizi: NaN,
	shardToril: NaN,
	shardValenta: NaN,
	shogunPointBoosterKey: NaN,
	silverToken: NaN,
	soldierBiscuit: NaN,
	tiziToken: NaN,
	xmasLTPEToken: NaN,
	dragonGlass: NaN,
	steel: NaN,
};

xtHandler.on("gcu", (obj) => {
	resources.coins = obj.C1;
	resources.rubies = obj.C2;
});

xtHandler.on("sce", (obj) => Object.assign(resources, ResourceList(obj)));

const PermanentCastleData = (e) =>
	e.map((e) => ({
		//Units? : Array.from(U.U).map(Number),
		//Tools? : Array.from(U.L).map(Number),

		unlockedHorses: Array.from(e.UH).map(Number),
		areaID: Number(e.AID),
		kingdomID: Number(e.KID),
	}));

const permanentCastleData = [];

const getPermanentCastle = () => PermanentCastleData(permanentCastleData);

xtHandler.on("gpc", (obj) => {
	obj.A.forEach((e) => {
		const castleData = permanentCastleData.find(
			(a) => e.AID == a.AID && e.KID == a.KID,
		);
		if (!castleData) permanentCastleData.push(e);
		else Object.assign(castleData, e);
	});
});

let _kingdomInfoList = {};

const getKingdomInfoList = async () => {
	if (!isEmpty(_kingdomInfoList)) return KingdomInfo(_kingdomInfoList);

	let [obj, result] = await waitForResult("kpi", 1000 * 10); //TODO: Remove?

	Object.assign(_kingdomInfoList, { ...obj, result });

	return KingdomInfo(_kingdomInfoList);
};
xtHandler.on("kpi", (obj, result) =>
	Object.assign(_kingdomInfoList, { ...obj, result }),
);
xtHandler.on("fjf", (obj, result) =>
	Object.assign(_kingdomInfoList, { ...obj.kpi, result }),
);
const Feast = (e) => ({
	type: Number(e.T),
	deltaTime: Number(e.RT),
	result: Number(e.result),
});
const clientStartFeast = (type, areaID, kingdomID) => {
	const limiter = sendXT(
		"bfs",
		JSON.stringify({ T: type, CID: areaID, KID: kingdomID, PO: -1, PWR: 0 }),
	);

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("bfs", 1000 * 10);

		return Feast({ ...obj, result: result });
	};
};
const HighscoreList = (e) => ({
	score: Number(e[0]),
	ammount: Number(e[1]),
	playerData: new OwnerInfo(e[2]),
});
const Highscore = (e) => ({
	eventType: Number(e.LT),
	lootID: Number(e.LID),
	list: Array.from(e.L).map(HighscoreList),
	lootRanking: Number(e.LR),
	searchVariable: String(e.SV),
	rank: Number(e.FR),
	IGH: Number(e.IGH), //TODO: figure this bitch out
	result: Number(e.result),
});

const clientGetHighscore = (LT, LID, SV) => {
	const limiter = sendXT("hgh", JSON.stringify({ LT, LID, SV: `${SV}` }));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult(
			"hgh",
			1000 * 10,
			(obj, result) => {
				if (obj.LT != LT) return false;
				if (obj.SV != SV) return false;
				if (obj.LID != LID) return false;
				return true;
			},
		);

		return Highscore({ ...obj, result: result });
	};
};
const PlayerAlliance = (e) => ({
	allianceID: Number(e.AID),
	rank: Number(e.R),
	allianceName: String(e.N),
	//??? : Number(e.ACF),
	//??? : Number(e.SA)
});
const Alliance = (e) => ({
	members: Array.from(e.M).map((o) => new OwnerInfo(o)),
	allianceID: Number(e.AID),
	//??? : e.CF,
	mightPoints: Number(e.MP),
	description: String(e.D),
	language: String(e.ALL),
	//??? : Number(e.HP),
	//??? : Number(e.IS),
	//??? : Number(e.IA),
	//??? : Number(e.KA),
	allianceCrest: AllianceCrest(e.aee),
	//??? : Number(e.ACLS)
	//??? : Number(e.ML)
	announcement: String(e.A),
	//??? : Number(e.FR),
	//??? : Number(e.SP),
	//??? : Number(e.AP),
	//??? : Number(e.AW),
	//??? : Number(e.HAMP),
	//??? : Number(e.HF),
	//??? : Number(e.AA),
	//??? : Number(e.RT),
	//??? : Array.from(e.ADL).map(),
	//??? : Array.from(e.ABL).map(),
	//??? : AllianceStorage(e.STO),
	//??? : Object(e.AMI),
	//??? : Object(e.ACA),
	//??? : Object(e.ATC),
	//??? : Object(e.AKT),
	//??? : Object(e.AMO),
	//??? : Array.from(e.ALA).map(),
	//??? : Number(e.MF),
	//??? : Number(e.IF),
	//??? : Number(e.SRFU),
	//??? : Number(e.HRFU),
});

const BuildingInfo = (o) => ({
	wodID: Number(o[0]),
	ownerID: Number(o[1]),
	x: Number(o[2]),
	y: Number(o[3]),
	rotation: Number(o[4]),
	buildTime: Number(o[5]),
	buildingState: Number(o[6]),
	hitPoints: Number(o[7]),
	constructionBoost: Number(o[8]) / 100,
	efficiency: Number(o[9]),
	damageType: Number(o[10]),
	extraData: Array.from(o).toSpliced(0, 11),
});
const CastleArea = (o, KID) => ({
	ownerInfo: new OwnerInfo(o.O),
	//??? : Number(e.RAF),
	//??? : Number(e.RAW),
	//??? : Number(e.RAS),
	//??? : Number(e.RAB),
	//??? : Array.from(e.BG).map(),
	buildings: Array.from(o.BD).map(BuildingInfo),
	//??? : Array.from(e.T).map(),
	//??? : Array.from(e.G).map(),
	//??? : Array.from(e.D).map(),
	//??? : Array.from(e.CI).map(),
	areaInfo: MapObject(new GAAAreaInfo(o.A), KID),
	buildingSlots: Array.from(o.scl.OIDL).map(Number),
});
class JoinArea {
	constructor(e) {
		this.kingdomID = Number(e.KID);
		this.type = Number(e.type);
		this.getCastleArea = CastleArea(e.gca, e.KID);
		this.userAttackProtection = ServerUserAttackProtection(e.uap);
		this.areaInfo = DCLAreaInfo(((e.grc.gpa ??= e.gpa), e.grc));
		//??? : Number(e.scl.SSC)
		///??? : csl : {///??? : Number(e.SL)}
	}
}

const clientJoinArea = (x, y, kingdomID) => {
	const limiter = sendXT(
		"joa",
		JSON.stringify({ PX: x, PY: y, KID: kingdomID }),
	);

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("jaa", 1000 * 10, (obj) => {
			if (obj?.KID != kingdomID) return false;
			if (obj?.gca?.A?.[1] != x) return false;
			if (obj?.gca?.A?.[2] != y) return false;

			return true;
		});

		return new JoinArea({ ...obj, result: result });
	};
};

const clientJoinCastle = (areaID, kingdomID) => {
	const limiter = sendXT(
		"jca",
		JSON.stringify({ CID: areaID, KID: kingdomID }),
	);

	return async () => {
		await limiter;
			const [obj, result] = await waitForResult("jaa", 1000 * 10, (o) => {
				if (Number(result) != 0) return true;
				return o?.grc?.KID == kingdomID && o?.grc?.AID == areaID;
			});
	};
};

const clientSearchPlayerName = (playerName) => {
	const limiter = sendXT("wsp", JSON.stringify({ PN: playerName }));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult(
			"wsp",
			1000 * 10,
			(o, r) => r != 0 || o.gaa?.OI.find((e) => e.N == playerName),
		);

		return new ServerGetAreaInfo({ ...obj.gaa, result: result });
	};
};
const AllianceQuestPlayerScore = (e) => ({
	playerID: Number(e.PID),
	playerName: String(e.PN),
	level: Number(e.L),
	points: Number(e.OP),
	allianceRank: Number(e.R),
});
const AllianceQuestPointCount = (e) => ({
	list: Array.from(e.AQPC).map(AllianceQuestPlayerScore),
	result: Number(e.result),
});
const clientAllianceQuestPointCount = () => {
	const limiter = sendXT("aqpc", JSON.stringify({}));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult("aqpc", 1000 * 10);

		return AllianceQuestPointCount({ ...obj, result: result });
	};
};

let areaInfoCallbacks = [];
let kingdomLockCallbacks = [];
let kingdomLockInUse = false;
let currentKingdom = { AID: undefined };

let areaInfoLock = (callback) =>
	new Promise(async (resolve, reject) => {
		if (callback)
			areaInfoCallbacks.push(async () => {
				try {
					currentKingdom.AID = undefined;
					resolve(await callback());
				} catch (e) {
					console.warn(e);
					reject(e);
				}
			});
		else resolve();

		if (areaInfoCallbacks.length <= 0) return;

		if (kingdomLockInUse) return;

		kingdomLockInUse = true;

		do {
			await areaInfoCallbacks.shift()();
		} while (areaInfoCallbacks.length > 0);

		kingdomLockInUse = false;

		if (kingdomLockCallbacks.length <= 0) return;

		kingdomLock();
	});

let kingdomLock = (callback) =>
	new Promise(async (resolve, reject) => {
		if (callback)
			kingdomLockCallbacks.push(async () => {
				try {
					resolve(await callback());
				} catch (e) {
					reject(e);
				}
			});
		else resolve();

		if (kingdomLockCallbacks.length <= 0) return;

		if (kingdomLockInUse) return;

		kingdomLockInUse = true;

		do {
			await kingdomLockCallbacks.shift()();
		} while (kingdomLockCallbacks.length > 0);

		kingdomLockInUse = false;

		if (areaInfoCallbacks.length <= 0) return;

		areaInfoLock();
	});

class Lord {
	constructor(e) {
		this.lordID = Number(e.ID);
		// this.??? = Number(e.WID)
		this.lordPosition = Number(e.VIS);
		this.name = String(e.N);
		this.generalID = Number(e.GID);
		this.generalLevel = Number(e.L);
		// this.??? = Number(e.ST)
		// this.??? = Number(e.W)
		// this.??? = Number(e.D)
		// this.??? = Number(e.SPR)
		this.EQ = e.EQ ? Array.from(e.EQ) : undefined;
		// this.??? = Array.from(e.GASAIDS)
		// this.??? = Array.from(e.SIDS)
		// this.??? = Array.from(e.AE)
	}
}
/** @type {Array<Movement>} */
const movements = [];
const movementEvents = new EventEmitter();
let pendingPlayerIDPromise;

const ensurePlayerID = async () => {
	if (playerInfo.playerID != "") return playerInfo.playerID;

	if (!pendingPlayerIDPromise) {
		pendingPlayerIDPromise = new Promise((resolve) => {
			const onPlayerInfo = (obj) => {
				clearTimeout(timeout);
				pendingPlayerIDPromise = undefined;
				resolve(String(obj?.PID ?? ""));
			};

			const timeout = setTimeout(() => {
				xtHandler.removeListener("gpi", onPlayerInfo);
				pendingPlayerIDPromise = undefined;
				resolve("");
			}, 30 * 1000);

			timeout.unref?.();
			xtHandler.once("gpi", onPlayerInfo);
		});
	}

	const playerID = await pendingPlayerIDPromise;
	if (playerID != "") playerInfo.playerID = playerID;

	return playerInfo.playerID;
};
/** @param {Movement} movement */
async function newMovement(movement) {
	const e = movements.find((e) => e.id == movement.id);
	if (playerInfo.playerID == "") await ensurePlayerID();

	if (e) {
		Object.assign(e, movement);
		if (e.canSeeArmy != movement.canSeeArmy)
			movementEvents.emit("outgoing", movement);
		return;
	}

	movements.push(movement);

	movementEvents.emit("outgoing", movement);
	const clearMovement = () => {
		const movementIndex = movements.findIndex((e) => e.id == movement.id);
		if (movementIndex == -1) return;

		movements.splice(movementIndex, 1);

		if (movement.targetOwner?.ownerID == movement.owner?.ownerID)
			movementEvents.emit("return", movement);
	};

	const ttlMs = movement.totalTime - (movement.deltaTime - Date.now()) + 1000;
	if (ttlMs <= 0) {
		clearMovement();
		return;
	}

	setTimeout(clearMovement, ttlMs).unref?.();
}

class Movement {
	/** @param {Array<OwnerInfo>} ownerInfo */
	constructor(movement, ownerInfo) {
		this.id = Number(movement.M.MID);
		this.type = Number(movement.M.T);
		this.kingdomID = Number(movement.M.KID);
		this.totalTime = Number(movement.M.TT) * 1000;
		this.deltaTime = Number(movement.M.PT) * 1000 + Date.now();

		this.lord = new Lord(movement.UM?.L ?? {});
		this.owner = ownerInfo.find((o) => o.ownerID == Number(movement.M.OID));
		this.targetOwner = ownerInfo.find(
			(o) => o.ownerID == Number(movement.M.TID),
		);
		this.sourceOwner = ownerInfo.find(
			(o) => o.ownerID == Number(movement.M.SID),
		);
		this.targetAttack = MapObject(
			new GAAAreaInfo(movement.M.TA),
			movement.M.KID,
		);
		this.sourceAttack = MapObject(
			new GAAAreaInfo(movement.M.SA),
			movement.M.KID,
		);

		this.horseType = Number(movement.M.HBW);

		this.canSeeArmy = !!movement.GA;

		this.left = Array.from(movement.GA?.L ?? []).map(Unit);
		this.middle = Array.from(movement.GA?.M ?? []).map(Unit);
		this.right = Array.from(movement.GA?.R ?? []).map(Unit);
		this.courtyard = Array.from(movement.GA?.RW ?? []).map(Unit);
		this.station = Array.from(movement.A ?? []).map(Unit);

		newMovement(this);
	}
}

xtHandler.on("cra", (o, r) =>
	r == 0
		? new Movement(
				o.AAM,
				Array.from(o.O ?? []).map((o) => new OwnerInfo(o)),
			)
		: undefined,
);
xtHandler.on("cat", (o, r) => {
	if (r == 0)
		new Movement(
			o.A,
			Array.from(o.O ?? []).map((o) => new OwnerInfo(o)),
		);
});
xtHandler.on("gam", (o, r) =>
	r == 0
		? Array.from(o.M ?? []).map(
				(e) =>
					new Movement(
						e,
						Array.from(o.O ?? []).map((o) => new OwnerInfo(o)),
					),
			)
		: undefined,
);

xtHandler.on("dms", ({ MID }) =>
	MID.forEach((movementID) => {
		const movementIndex = movements.findIndex(
			(e) => e.id == Number(movementID),
		);
		if (movementIndex == -1) return;

		const movement = movements.splice(movementIndex, 1)[0];
		if (!movement) return;

		movementEvents.emit("return", movement);
	}),
);

const clientGetAllianceByID = (AID) => {
	const limiter = sendXT("ain", JSON.stringify({ AID }));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult(
			"ain",
			1000 * 10,
			(obj) => obj?.A.AID == AID,
		);

		return Alliance({ ...obj.A, result: result });
	};
};

const clientGetAllianceByName = (name) => {
	const limiter = sendXT("hgh", JSON.stringify({ LT: 11, SV: name }));

	return async () => {
		await limiter;
		const [obj, result] = await waitForResult(
			"hgh",
			1000 * 60 * 5,
			(obj, result) => {
				if (result != 0) return true;

				if (obj.LT != 11 || obj.SV.toLowerCase() != name.toLowerCase())
					return false;
				return true;
			},
		);

		if (result != 0) throw err[result] ?? result;

		let item = obj?.L?.find((e) => e[2][1].toLowerCase() == name.toLowerCase());
		if (item == undefined) throw Error("ALLIANCE_NOT_FOUND");

		return clientGetAllianceByID(item[2][0])();
	};
};

const getKingdomID = (areaInfo) => {
	if (areaInfo.type == 2) return areaInfo.extraData[3];
	if (areaInfo.type == 11) return areaInfo.extraData[4];
	return undefined;
};

xtHandler.on("gaa", (obj, result) => {
	if (result != 0) return;

	obj.result = result;

	obj.KID ??= getKingdomID(new GAAAreaInfo(obj?.AI?.[0]));

	return new ServerGetAreaInfo(obj);
});
xtHandler.on("ssi", (obj, r) =>
	r == 0 ? new ServerGetAreaInfo(obj.gaa) : undefined,
);
xtHandler.on("msd", (obj, r) => {
	if (r != 0) return;

	const areaInfo = new GAAAreaInfo(obj.AI);

	MapObject(areaInfo, getKingdomID(areaInfo));
});

function updateStatus() {
	status.resources = resources;
	parentPort.postMessage([ActionType.StatusUser, status]);
}

xtHandler.on("gcu", updateStatus);
xtHandler.on("sce", updateStatus);

module.exports = {
	spiralCoordinates,
	movementEvents,
	movements,
	ClientCommands: {
		preSpyInfo: clientPreSpyInfo,
		getHighScore: clientGetHighscore,
		getAreaInfo: clientGetAreaInfo,
		startFeast: clientStartFeast,
		getStormIslandInfo: clientGetStormIslandInfo,
		getDetailedCastleList: clientGetDetailedCastleList,
		getUnitInventory: clientGetUnitInventory,
		getKingdomInfo: clientGetKingdomInfo,
		getMinuteSkipKingdom: clientGetMinuteSkipKingdom,
		activeQuestList: clientActiveQuestList,
		joinArea: clientJoinArea,
		searchPlayerName: clientSearchPlayerName,
		allianceQuestPointCount: clientAllianceQuestPointCount,
		getAllianceByID: clientGetAllianceByID,
		getAllianceByName: clientGetAllianceByName,
		joinCastle: clientJoinCastle,
	},
	kingdomLock,
	areaInfoLock,
	KingdomID,
	AreaType,
	KingdomSkipType,
	getResourceCastleList,
	getKingdomInfoList,
	getEventList,
	getPermanentCastle,
	resources,
	HighscoreType,
	ClassTypes: {
		UnitInventory,
		JoinArea,
		OwnerInfo,
		ServerGetAreaInfo,
		Lord,
		GAAAreaInfo,
		Movement,
		KingdomInfo,
		DetailedCastleList,
	},
	currentKingdom,
};
