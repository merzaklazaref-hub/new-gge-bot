const path = require("node:path");
const fs = require("fs");
const ggeConfig = require("../ggeConfig.json");

/*
 * plugins-extra loader: same as plugins/index.js but for extra plugin set.
 * - Recursively reads JS files in plugins-extra/
 * - Skips Discord plugins when Discord credentials missing
 */
const dir = fs.readdirSync(__dirname, { recursive: true });

const plugins = [];

dir.forEach((file) => {
	if (file == path.basename(__filename)) return;
	let pathSeperator = "/";
	if (process.platform == "win32") pathSeperator = "\\";

	if (fs.lstatSync(__dirname + pathSeperator + file).isDirectory()) return;
	//Ew hacky...
	if (
		(!ggeConfig.discordToken || !ggeConfig.discordClientId) &&
		file.includes("discord")
	)
		return;

	if (path.extname(file) != ".js") return;
	// throw Error(`None javascript file within path ${file}`)

	plugins.push([
		`plugins-extra/${file.slice(0, -3)}`,
		require(path.join(__dirname, file)),
	]);
});

module.exports = plugins;
