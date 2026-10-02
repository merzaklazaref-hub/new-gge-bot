// Asset loader that fetches unit image files from local cache or remote source,
// converts to PNG and caches files locally for reuse.
const fs = require("fs");
const sharp = require("sharp");
const { Readable } = require("stream");
const assets = require("./assets.json");

/**
 * Return a readable stream to an asset for the given key.
 * If asset is missing, tries fallback download and local caching.
 */
let getAsset = (key, hardFail) =>
	new Promise(async (resolve, reject) => {
		if (key == undefined || key == "undefined_undefined_undefined")
			return resolve(await getAsset(`Unknown_Unit_Soldiers`, true));
		if (!assets[key]) return resolve(await getAsset(`Unknown_Unit_Soldiers`, true));

		try {
			let data = fs.createReadStream(`./assets/${assets[key]}.png`);
			data.on("error", async function (err) {
				console.debug(err);
				try {
					let imageFile = await fetch(
						`https://empire-html5.goodgamestudios.com/default/assets/${assets[key]}.webp`,
					);
					if (imageFile.status != 200) {
						if (hardFail) {
							throw "Could not get soldier";
						}
						return resolve(getAsset(`Unknown_Unit_Soldiers`, true));
					}
					let imageBlob = await imageFile.blob();

					if (imageBlob.size == 0) {
						console.warn("couldntGetAsset");
						return resolve(await getAsset(`Unknown_Unit_Soldiers`, true));
					}
					let sharpImg = sharp(await imageBlob.arrayBuffer());

					sharpImg.on("error", reject);

					const convertedImageBuffer = await sharpImg
						.png()
						.resize(24, 24)
						.toBuffer();

					if (convertedImageBuffer.byteLength == 0) {
						console.warn("couldntGetAsset");
						return resolve(await getAsset(`Unknown_Unit_Soldiers`, true));
					}

					let data = Readable.from(convertedImageBuffer);

					fs.mkdirSync(`./assets/${assets[key].replace(/\/[^\/]+\/?$/, "")}`, {
						recursive: true,
					});
					await sharp(convertedImageBuffer).toFile(`./assets/${assets[key]}.png`);
					resolve(data);
				} catch (e) {
					if (hardFail) return reject(e);
					resolve(getAsset(`Unknown_Unit_Soldiers`, true));
				}
			});

			data.on("open", () => resolve(data));
		} catch (err) {
			reject(err);
		}
	});

module.exports = { getAsset };
