// Image generation helper for unit wave layouts and asset labels.
// Uses pureimage to draw units and counts over a base castle blueprint.
const { Stream } = require("stream");
const PImage = require("pureimage");
const fs = require("fs");

const { getAsset } = require("./units.js");
const units = require("./items/units.json");
const ggeConfig = require("./ggeConfig.json");

const fontCandidates = () =>
	[
		process.env.FONT_PATH,
		ggeConfig.fontPath,
		...(process.platform == "linux"
			? [
					"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
					"/usr/share/fonts/dejavu/DejaVuSans.ttf",
					"/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
					"/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
					"/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
					"/usr/share/fonts/truetype/freefont/FreeSans.ttf",
				]
			: ["C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf"]),
	]
		.filter(Boolean)
		.filter((value, index, arr) => arr.indexOf(value) == index);

let fontLoadPromise;
const ensureFontLoaded = async () => {
	if (fontLoadPromise) return fontLoadPromise;

	fontLoadPromise = (async () => {
		for (const fontPath of fontCandidates()) {
			try {
				await PImage.registerFont(fontPath, "arial").load();
				ggeConfig.fontPath = fontPath;
				return true;
			} catch {}
		}

		console.warn("couldntAccessFontForImageGen");
		return false;
	})();

	return fontLoadPromise;
};

let wavePattern = {
	leftFlank: {
		startX: 30,
		startY: 43 + 1,
		maxWidth: 5,
		maxHeight: 20,
	},
	front: {
		startX: 194,
		startY: 43 + 1,
		maxWidth: 5,
		maxHeight: 20,
	},
	rightFlank: {
		startX: 359,
		startY: 43 + 1,
		maxWidth: 5,
		maxHeight: 20,
	},
	courtyard: {
		startX: 113,
		startY: 273 + 1,
		maxWidth: 10,
		maxHeight: 20,
	},
};

// Create a PNG layout stream for a group army formation object (`GA`).
// Returns a readable stream containing the generated image bytes.
let createLayout = (GA) => {
	let passThroughStream = new Stream.PassThrough();
	(async () => {
		await ensureFontLoaded();

		let img = await PImage.decodePNGFromStream(
			fs.createReadStream("./assets/asset.png"),
		);
		let ctx = img.getContext("2d");

		let displayAttack = (attack, attackSection) =>
			attack.map((wave, index) =>
				addUnit(
					units.find((e) => e?.wodID == wave[0]),
					ctx,
					attackSection.startX,
					attackSection.startY,
					wave[1],
					attackSection.maxWidth,
					attackSection.maxHeight,
					index,
				),
			);

		let resolves = [];

		resolves.push(...displayAttack(GA.L, wavePattern.leftFlank));
		resolves.push(...displayAttack(GA.M, wavePattern.front));
		resolves.push(...displayAttack(GA.R, wavePattern.rightFlank));
		resolves.push(...displayAttack(GA.RW, wavePattern.courtyard));

		await Promise.allSettled(resolves);
		await PImage.encodePNGToStream(img, passThroughStream, {
			deflateStrategy: 3,
			deflateLevel: 9,
		});
	})();

	return passThroughStream;
};

// Draw a unit icon block with count and optional level indicator into the composition context.
let addUnit = (
	unit,
	/**@type {PImage.Context}*/ ctx,
	x,
	y,
	count,
	maxWidth,
	maxHeight,
	index,
) =>
	new Promise(async (resolve, reject) => {
		try {
			let asset = await getAsset(`${unit?.name}_${unit?.group}_${unit?.type}`);

			asset.on("error", reject);
			let unitImage = await PImage.decodePNGFromStream(asset);

			x += 29 * (index % maxWidth);
			y += 42 * Math.floor(index / maxWidth);

			if (index > maxHeight) return reject();

			if (index == maxHeight) {
				ctx.font = "35ft arial";
				ctx.fillStyle = "#000000";
				let str = "...";
				let textLength = ctx.measureText(str);
				ctx.fillText(str, x + (32 - textLength.width) / 2, y + 32 - 10 + 1);
				return;
			}

			ctx.drawImage(
				unitImage,
				0,
				0,
				unitImage.width,
				unitImage.height,
				x,
				y,
				unitImage.width,
				unitImage.height,
			);

			let textHeight = 12;
			ctx.font = `${textHeight}px arial`;
			let textLength = ctx.measureText(`${count}`);

			ctx.fillStyle = "#E3C9A8";
			ctx.fillRect(x, y + unitImage.height, unitImage.width, textHeight + 5);

			ctx.fillStyle = "#000000";
			ctx.fillText(
				`${count}`,
				x + (unitImage.width - textLength.width) / 2,
				y + unitImage.height + textHeight,
			);

			if (unit?.level) {
				let asset = await getAsset(`Colleactable_LevelIndicator_Unit`);

				let image = await PImage.decodePNGFromStream(asset);
				textHeight = 12;
				ctx.font = `${textHeight}px arial`;
				textLength = ctx.measureText(`${unit.level}`);
				ctx.drawImage(
					image,
					0,
					0,
					image.width,
					image.height,
					x + unitImage.width / 2 - 1,
					y - 11 / 2 - 1,
					20 + 2,
					20 + 2,
				);

				ctx.fillText(
					`${unit.level}`,
					x + unitImage.width - textLength.width / 2 - 2,
					y + textHeight / 2 + 2,
				);
			}
			resolve();
		} catch (err) {
			reject(err);
		}
	});

module.exports = { createLayout };
