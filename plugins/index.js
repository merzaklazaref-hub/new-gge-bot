const path = require("node:path");
const fs = require("fs");
const ggeConfig = require("../ggeConfig.json");

// Enumeration of plugin JS modules from `plugins/` (includes nested directories).
// Excludes Discord plugins when Discord credentials are not configured.
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

	plugins.push([
		`plugins/${file.slice(0, -3)}`,
		require(path.join(__dirname, file)),
	]);
});

module.exports = plugins;
