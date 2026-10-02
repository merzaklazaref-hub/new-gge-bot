// Local cache wrapper for map area requests to avoid repeated network roundtrips.
const NodeCache = require("node-cache");
const myCache = new NodeCache({ useClones: false });

const { ClientCommands } = require("./protocols.js");
/**
 *
 * @param {Number} kid
 * @param {Number} fromX
 * @param {Number} fromY
 * @param {Number} toX
 * @param {Number} toY
 * @returns {Promise<import("./protocols.js").ClassTypes.ServerGetAreaInfo>}
 */
/**
 * Fetches map area info from ClientCommands with in-memory TTL cache.
 * @param {Number} kid
 * @param {Number} fromX
 * @param {Number} fromY
 * @param {Number} toX
 * @param {Number} toY
 * @returns {Promise<import("./protocols.js").ClassTypes.ServerGetAreaInfo>}
 */
async function getAreaCached(kid, fromX, fromY, toX, toY) {
	const key = `${kid}_${fromX}_${fromY}_${fromX}_${fromY}`;
	let response = myCache.get(key);

	if (!response) {
		response = await ClientCommands.getAreaInfo(kid, fromX, fromY, toX, toY)();
		if (response == 0) myCache.set(key, response, 60);
	}
	return response;
}

module.exports = getAreaCached;
