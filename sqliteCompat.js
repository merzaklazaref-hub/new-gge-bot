// Compatibility layer that prefers node:sqlite API, falling back to better-sqlite3 for environments
// where node:sqlite is unavailable.
let DatabaseSync;

try {
	({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
	const recoverableCodes = new Set([
		"ERR_UNKNOWN_BUILTIN_MODULE",
		"MODULE_NOT_FOUND",
	]);
	if (!recoverableCodes.has(error?.code)) throw error;

	const BetterSqlite3 = require("better-sqlite3");

	// Provide a minimal node:sqlite-compatible constructor for the used options.
	DatabaseSync = class DatabaseSyncCompat extends BetterSqlite3 {
		constructor(filename, options = {}) {
			const dbOptions = {};

			if (typeof options.timeout == "number")
				dbOptions.timeout = options.timeout;

			if (typeof options.readonly == "boolean")
				dbOptions.readonly = options.readonly;

			if (typeof options.fileMustExist == "boolean")
				dbOptions.fileMustExist = options.fileMustExist;

			if (typeof options.verbose == "function")
				dbOptions.verbose = options.verbose;

			super(filename, dbOptions);
		}
	};
}

module.exports = { DatabaseSync };
