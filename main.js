const path = require("path");
const crypto = require("crypto");
const undici = require("undici");
const fs = require("fs/promises");
const http = require("node:http");
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const https = require("node:https");
const bodyParser = require("body-parser");
const { WebSocketServer } = require("ws");
const { parseStringPromise } = require("xml2js");
const { DatabaseSync } = require("./sqliteCompat");
const { Worker } = require("node:worker_threads");
const {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");
const ErrorType = require("./errors.json");
const ActionType = require("./actions.json");
const { I18n } = require("i18n");
const { EventEmitter } = require("node:stream");
// Main server implementation for GGE-BOT.
// This file bootstraps the web/UI backend, persistently stores users, creates worker bots,
// and orchestrates communication between web frontend (WS / REST) and bot logic.

// Default font candidates used for server-side image generation components.
// The code attempts these in order to find an accessible font path on both Linux and Windows.
const DEFAULT_FONT_CANDIDATES =
  process.platform == "linux"
    ? [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
      ]
    : ["C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf"];

const resolveAccessibleFontPath = async (preferredPath) => {
  const candidates = [
    process.env.FONT_PATH,
    preferredPath,
    ...DEFAULT_FONT_CANDIDATES,
  ].filter(Boolean);

  for (const fontPath of [...new Set(candidates)]) {
    try {
      await fs.access(fontPath);
      return fontPath;
    } catch {}
  }

  return undefined;
};

// EventEmitter used for internal state changes between HTTP API and worker lifecycle.
const events = new EventEmitter();

// Localization engine configuration. This keeps all UI strings translated
// and supports the listed locales via JSON translation files in website/public/locales.
const i18n = new I18n({
  locales: [
    "en",
    "de",
    "ar",
    "fi",
    "he",
    "hu",
    "pl",
    "ro",
    "tr",
    "cs",
    "nl",
    "fr",
  ],
  directory: path.join(__dirname, "website", "public", "locales"),
  updateFiles: false,
});

const clientOptions = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildIntegrations,
  ],
};

const client = new Client(clientOptions);

console.info(i18n.__("startBanner"));

const ggeConfigExample = `{
    "webPort" : "3001",
    "fontPath" : "",
    "privateKey" : "",
    "cert" : "",
    "signupToken" : "",
    "discordToken" : "",
    "discordClientId" : "",
    "discordClientSecret" : "",
    "timeoutMultiplier" : 1,
    "secondsTillRestartBot": 10,
    "debug" : false
}`;

const loggedInUsers = {};
const botMap = new Map();
const userLogState = new Map();
const LOG_BUFFER_SIZE = 25;

// Retrieve or initialize a circular log buffer for a user session.
// Each worker bot has separate message logging, and the frontend can request the last 25 messages.
const getUserLogState = (userId) => {
  const id = Number(userId);
  if (!userLogState.has(id)) {
    userLogState.set(id, {
      messageBuffer: [],
      messageBufferCount: 0,
    });
  }
  return userLogState.get(id);
};

const buildSystemLogParts = (botName, message) => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return [`[${botName}] `, `[${hours}:${minutes}] `, "[system] ", message];
};

// Append one log event to user's in-memory circular buffer; if the user is currently connected,
// also push it in real-time over WebSocket (ActionType.GetLogs) so UI updates live.
const appendUserLog = (uuid, userId, level, parts, createdAt = Date.now()) => {
  const cachedLogState = getUserLogState(userId);
  cachedLogState.messageBuffer[cachedLogState.messageBufferCount] = [
    level,
    parts,
    createdAt,
  ];
  cachedLogState.messageBufferCount =
    (cachedLogState.messageBufferCount + 1) % LOG_BUFFER_SIZE;

  const worker = botMap.get(userId);
  if (worker) {
    worker.messageBuffer = cachedLogState.messageBuffer;
    worker.messageBufferCount = cachedLogState.messageBufferCount;
  }

  loggedInUsers[uuid]?.forEach((o) => {
    if (o.viewedUser != userId) return;
    o.ws.send(
      JSON.stringify([
        ErrorType.Success,
        ActionType.GetLogs,
        [
          cachedLogState.messageBuffer,
          cachedLogState.messageBufferCount,
          userId,
        ],
      ]),
    );
  });
};

// Set up SQLite path and initialize table schemas for registered users and bot subusers.
// It creates the DB if it does not already exist and enforces schema consistency.
const userDbPath = process.env.USER_DB_PATH || "./user.db";
const userDatabase = new DatabaseSync(userDbPath, { timeout: 1000 * 60 });
userDatabase.exec(
  `CREATE TABLE IF NOT EXISTS "Users" (
	"username"	TEXT NOT NULL UNIQUE,
	"passwordHash" BLOB NOT NULL,
  "passwordSalt" INTEGER NOT NULL,
  "uuid" TEXT UNIQUE,
	"privilege"	INTEGER,
  "discordUserId"	TEXT,
  "discordGuildId" TEXT
)
`,
);
userDatabase.exec(
  `CREATE TABLE IF NOT EXISTS "SubUsers" (
  "id"	INTEGER,
	"uuid"	TEXT NOT NULL,
	"name"	TEXT NOT NULL,
	"pass"	TEXT NOT NULL,
	"plugins"	TEXT,
	"state"	INTEGER,
  "externalEvent" INTEGER,
	"server"	INTEGER,
  PRIMARY KEY("id" AUTOINCREMENT)
)
`,
);

// User DTO to normalize SubUsers rows coming from the database.
class User {
  constructor(obj) {
    if (obj == undefined) return;
    this.id = Number(obj?.id);
    this.uuid = String(obj?.uuid);
    this.state = Number(obj?.state);
    this.name = String(obj?.name);
    this.pass = String(obj?.pass);
    this.server = Number(obj?.server);
    this.plugins = obj?.plugins ?? {};
    this.externalEvent = Boolean(obj?.externalEvent);
  }
}
const addUser = (uuid, user) => {
  userDatabase
    .prepare(
      "INSERT INTO SubUsers (uuid, name, pass, plugins, state, externalEvent, server) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      uuid,
      user.name,
      user.pass,
      JSON.stringify(user.plugins),
      0,
      Number(user.externalEvent),
      user.server,
    );
};
const getSpecificUser = (uuid, user) => {
  const row = userDatabase
    .prepare(
      "Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?",
    )
    .get(uuid, user.id);

  row.plugins = JSON.parse(row.plugins ?? "{}");

  return new User(row);
};
const changeUser = (uuid, user) => {
  events.emit("userChange", user);
  if (user.pass == undefined || user.pass === "" || user.pass == "null") {
    userDatabase
      .prepare(
        "UPDATE SubUsers SET name=?, state=?, plugins=?, externalEvent =?, server=? WHERE uuid=? AND id=?",
      )
      .run(
        user.name,
        user.state,
        JSON.stringify(user.plugins),
        Number(user.externalEvent),
        user.server,
        uuid,
        user.id,
      );

    const row = userDatabase
      .prepare(
        "Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?",
      )
      .get(uuid, user.id);

    row.plugins = JSON.parse(row.plugins ?? "{}");

    return new User(row);
  }
  userDatabase
    .prepare(
      `UPDATE SubUsers SET name = ?, pass = ?, state = ?, plugins = ?, externalEvent = ?, server = ? WHERE uuid = ? AND id = ?`,
    )
    .run(
      user.name,
      user.pass,
      user.state,
      JSON.stringify(user.plugins),
      Number(user.externalEvent),
      user.server,
      uuid,
      user.id,
    );

  const row = userDatabase
    .prepare(
      "Select id, name, plugins, pass, state, externalEvent, server From SubUsers WHERE uuid=? AND id=?",
    )
    .get(uuid, user.id);
  row.plugins = JSON.parse(row.plugins ?? "{}");

  return new User(row);
};
const removeUser = (uuid, user) => {
  events.emit("userRemoved", user);
  if (uuid === undefined || user.id === undefined) return;

  userDatabase
    .prepare("DELETE FROM SubUsers WHERE uuid = ? AND id = ?")
    .run(uuid, user.id);
};

// Helper to query SubUsers, optionally filtered by the account owner UUID.
const getUser = (uuid) => {
  let str = uuid === undefined ? "" : "Where uuid=?";

  const prep = userDatabase.prepare(
    `Select id, uuid, name, plugins, pass, state, externalEvent, server From SubUsers ${str}`,
  );
  const rows = uuid ? prep.all(uuid) : prep.all();

  return rows?.map((e) => {
    e.plugins = JSON.parse(e.plugins);
    return new User(e);
  });
};

// Application entrypoint: reads config, ensures remote language/items/server data is available,
// initializes API routes, websocket server, and starts per-user bot workers.
async function start() {
  try {
    await fs.access("./ggeConfig.json");
  } catch {
    await fs.writeFile("./ggeConfig.json", ggeConfigExample);
    console.info(i18n.__("ggeConfigGenerated"));
  }
  const ggeConfig = JSON.parse(
    (await fs.readFile("./ggeConfig.json")).toString(),
  );

  // Overwrite config with env vars if they exist (Friendly for cloud hostings like Railway)
  ggeConfig.discordToken = process.env.DISCORD_TOKEN || ggeConfig.discordToken;
  ggeConfig.discordClientId =
    process.env.DISCORD_CLIENT_ID || ggeConfig.discordClientId;
  ggeConfig.discordClientSecret =
    process.env.DISCORD_CLIENT_SECRET || ggeConfig.discordClientSecret;
  ggeConfig.signupToken = process.env.SIGNUP_TOKEN || ggeConfig.signupToken;

  console.debug = ggeConfig.debug ? console.debug : (_) => {};

  ggeConfig.webPort = process.env.PORT ?? ggeConfig.webPort ?? "3001";

  if (ggeConfig.cert) await fs.access(ggeConfig.cert);

  if (ggeConfig.privateKey) await fs.access(ggeConfig.privateKey);

  let certFound = true;
  if (!(ggeConfig.privateKey || ggeConfig.cert)) {
    certFound = false;
    if (!ggeConfig.privateKey) console.warn(i18n.__("couldntFindPrivateKey"));
    if (!ggeConfig.cert) console.warn(i18n.__("couldntFindCertificate"));
  }
  let hasDiscord = true;

  const resolvedFontPath = await resolveAccessibleFontPath(ggeConfig.fontPath);
  if (resolvedFontPath) ggeConfig.fontPath = resolvedFontPath;
  else
    console.warn(
      `${i18n.__("couldntAccessFont")} ${ggeConfig.fontPath || process.env.FONT_PATH || "(no configured path)"}`,
    );

  if (!ggeConfig.discordToken || !ggeConfig.discordClientId) {
    console.warn(i18n.__("couldntSetupDiscord"));
    console.warn(i18n.__("configurationsMissing"));
    if (!ggeConfig.discordToken) console.warn("discordToken");
    if (!ggeConfig.discordClientId) console.warn("discordClientId");

    hasDiscord = false;
  }

  let needLang = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const hasLocalItemsCache = async () => {
    try {
      await fs.access("./items");
      const entries = await fs.readdir("./items");
      return entries.some((entry) => entry.endsWith(".json"));
    } catch {
      return false;
    }
  };

  const fetchWithRetry = async (
    url,
    { retries = 2, timeoutMs = 15000, parse = "text" } = {},
  ) => {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref?.();

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);

        if (parse == "json") return await response.json();
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(500 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  };
  // Ensures local item database cache is up-to-date by fetching version and item packs from remote server.
  // Falls back to existing local cache if remote fetch fails.
  async function getItemsJSON() {
    const versionUrl =
      "https://empire-html5.goodgamestudios.com/default/items/ItemsVersion.properties";

    let localVersion = undefined;
    try {
      localVersion = (
        await fs.readFile("./ItemsVersion.properties")
      ).toString();
    } catch {}

    let remoteVersion;
    try {
      remoteVersion = await fetchWithRetry(versionUrl);
    } catch (error) {
      if (await hasLocalItemsCache()) {
        console.warn(
          "itemsFetchFallbackUsingLocalCache",
          error?.message ?? error,
        );
        return;
      }
      throw new Error(
        `Failed to download item metadata and no local cache exists: ${error?.message ?? error}`,
      );
    }

    let needItems = (needLang = remoteVersion != localVersion);
    try {
      await fs.access("./items");
    } catch {
      needItems = true;
      await fs.mkdir("./items");
    }
    if (needItems) {
      await fs.writeFile("./ItemsVersion.properties", remoteVersion);

      const itemsVersion = remoteVersion.match(new RegExp(/(?!.*=).*/))[0];
      const itemsUrl = `https://empire-html5.goodgamestudios.com/default/items/items_v${itemsVersion}.json`;

      let itemsData;
      try {
        itemsData = await fetchWithRetry(itemsUrl, { parse: "json" });
      } catch (error) {
        if (await hasLocalItemsCache()) {
          console.warn(
            "itemsDataFetchFallbackUsingLocalCache",
            error?.message ?? error,
          );
          return;
        }
        throw new Error(
          `Failed to download items JSON and no local cache exists: ${error?.message ?? error}`,
        );
      }

      for (const [key, value] of Object.entries(itemsData)) {
        if (!/^[A-Za-z\_]+$/.test(key)) continue;

        await fs.writeFile(`./items/${key}.json`, JSON.stringify(value));
      }
    }
  }

  // Loads locale lookup for the current i18n locale (from config, environment or default),
  // downloading from Goodgame servers as needed and caching locally for offline re-use.
  async function getLangJSON() {
    try {
      try {
        await fs.access("./lang");
      } catch {
        await fs.mkdir("./lang");
      }
      await fs.access(`./lang/${i18n.getLocale()}.json`);
    } catch {
      needLang = true;
    }
    if (needLang) {
      try {
        const versions = await fetchWithRetry(
          "https://empire-html5.goodgamestudios.com/config/languages/version.json",
          { parse: "json" },
        );
        const version = versions.languages[i18n.getLocale()];
        const str = await fetchWithRetry(
          `https://empire-html5.goodgamestudios.com/config/languages/${version}/${i18n.getLocale()}.json`,
        );

        await fs.writeFile(`./lang/${i18n.getLocale()}.json`, str);
      } catch (error) {
        try {
          await fs.access(`./lang/${i18n.getLocale()}.json`);
          console.warn(
            "langFetchFallbackUsingLocalCache",
            error?.message ?? error,
          );
        } catch {
          throw new Error(
            `Failed to download language file and no local cache exists: ${error?.message ?? error}`,
          );
        }
      }
    }
  }

  // Ensures game network server configuration XML is downloaded and cached, used to map available game instances.
  async function getServerXML() {
    try {
      await fs.access("./1.xml");
    } catch {
      needLang = true;
    }
    if (needLang) {
      try {
        const str = await fetchWithRetry(
          "https://empire-html5.goodgamestudios.com/config/network/1.xml",
        );

        await fs.writeFile("./1.xml", str);
      } catch (error) {
        try {
          await fs.access("./1.xml");
          console.warn(
            "serverXmlFetchFallbackUsingLocalCache",
            error?.message ?? error,
          );
        } catch {
          throw new Error(
            `Failed to download network config XML and no local cache exists: ${error?.message ?? error}`,
          );
        }
      }
    }
  }

  await getItemsJSON();
  await getLangJSON();
  await getServerXML();

  const instances = [];
  const json = await parseStringPromise(
    (await fs.readFile("./1.xml")).toString(),
  );

  json.network.instances[0].instance.forEach((e) =>
    instances.push({
      gameURL: e.server[0],
      gameServer: e.zone[0],
      gameID: e["$"].value,
    }),
  );

  let pluginData = require("./plugins");

  try {
    pluginData.push(...require("./plugins-extra"));
  } catch (e) {
    console.debug(e);
  }
  try {
    pluginData.push(...require("./plugins-exploits"));
  } catch {}

  const plugins = pluginData
    .map(
      (e) =>
        new Object({
          key: path.basename(e[0]),
          filename: e[0],
          description: e[1].description,
          force: e[1].force,
          pluginOptions: e[1]?.pluginOptions,
          hidden: e[1].hidden,
        }),
    )
    .sort((a, b) => (a.force ?? 0) - (b.force ?? 0));

  const loginCheck = (uuid) =>
    !!userDatabase
      .prepare("SELECT * FROM Users WHERE uuid = ?")
      .get(uuid ?? "");

  const app = express();
  app.set("trust proxy", 1);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  const isFrontendDevMode = process.env.GGE_DEV === "1";
  const frontendDevUrl =
    process.env.FRONTEND_DEV_URL ?? "http://localhost:3000";
  const websiteBuildDir = path.join(__dirname, "website", "build");
  const getPublicBaseUrl = (request) =>
    publicBaseUrl || `${request.protocol}://${request.get("host")}`;

  app.use(
    "/ggeProxyEmpire5",
    createProxyMiddleware({
      target: "https://empire-html5.goodgamestudios.com",
      changeOrigin: true,
      followRedirects: true,
    }),
  );

  app.use(bodyParser.urlencoded({ extended: true }));
  app.get("/health", (_, res) => res.status(200).send("ok"));
  app.get("/", (_, res) => {
    if (isFrontendDevMode) return res.redirect(`${frontendDevUrl}/`);
    res.sendFile(path.join(websiteBuildDir, "index.html"));
  });
  app.get("/1.xml", (_, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/xml");
    res.sendFile("1.xml", { root: "." });
  });
  app.get("/assets.json", (_, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.sendFile("assets.json", { root: "." });
  });
  app.get("/logout", (req, res) => {
    const origin = req.get("origin");
    const secFetchSite = req.get("sec-fetch-site");
    const expectedOrigin = getPublicBaseUrl(req);
    const hasOriginHeader = !!origin;
    const hasSecFetchSiteHeader = !!secFetchSite;
    if (!hasOriginHeader && !hasSecFetchSiteHeader)
      return res.status(400).send("Invalid logout request");

    const isSameOrigin = !hasOriginHeader || origin === expectedOrigin;
    const isSameOriginFetch =
      !hasSecFetchSiteHeader || secFetchSite === "same-origin";
    if (!isSameOrigin || !isSameOriginFetch)
      return res.status(400).send("Invalid logout request");

    res.clearCookie("uuid");
    res.redirect("/signin.html");
  });
  app.post("/api", bodyParser.json(), async (req, res) => {
    let json = req.body;
    res.setHeader("Content-Type", "application/json");
    if (json.id == 0) {
      const row = userDatabase
        .prepare("Select * FROM Users WHERE username = ?")
        .get(json.email_name);
      if (!row)
        return res.send(
          JSON.stringify({ id: 0, r: 1, error: "Invalid login details." }),
        );

      if (
        crypto
          .pbkdf2Sync(json.password, row.passwordSalt, 600000, 64, "sha256")
          .compare(row.passwordHash) == 0
      )
        res.send(JSON.stringify({ id: 0, r: 0, uuid: row.uuid }));
      else
        res.send(
          JSON.stringify({ id: 0, r: 1, error: "Invalid login details." }),
        ); //TODO: sort this out server side
    } else if (json.id == 1) {
      if (json.token != (ggeConfig.signupToken ?? ""))
        return res.send(
          JSON.stringify({ id: 0, r: 1, error: "Invalid Sign up details." }),
        );

      const salt = crypto.randomBytes(256);
      const passwordHash = crypto.pbkdf2Sync(
        json.password,
        salt,
        600000,
        64,
        "sha256",
      );
      const uuid = crypto.randomUUID();
      try {
        userDatabase
          .prepare(
            "INSERT INTO Users (username, passwordHash, passwordSalt, uuid) VALUES(?,?,?,?)",
          )
          .run(json.username, passwordHash, salt, uuid);
        res.send(JSON.stringify({ r: 0, uuid: uuid }));
      } catch (e) {
        res.send(JSON.stringify({ r: 1 }));
        console.error(e);
      }
    }
  });

  if (hasDiscord) {
    client.login(ggeConfig.discordToken);
    await new Promise((resolve) => {
      client.once(Events.ClientReady, () => {
        resolve();
        app.get("/discordAuth", async (request, response) => {
          const tokenResponseData = await undici.request(
            "https://discord.com/api/oauth2/token",
            {
              method: "POST",
              body: new URLSearchParams({
                client_id: ggeConfig.discordClientId,
                client_secret: ggeConfig.discordClientSecret,
                code: request.query.code,
                grant_type: "authorization_code",
                redirect_uri: `${getPublicBaseUrl(request)}/discordAuth`,
                scope: "identify",
              }).toString(),
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            },
          );

          const oauthData = await tokenResponseData.body.json();
          const userResult = await undici.request(
            "https://discord.com/api/users/@me",
            {
              headers: {
                authorization: `${oauthData.token_type} ${oauthData.access_token}`,
              },
            },
          );
          let discordIdentifier = await userResult.body.json();
          let guildId = request.query.guild_id;
          if (!discordIdentifier.id)
            return response.send(i18n.__("missingDiscordID"));
          if (!guildId) return response.send(i18n.__("missingGuildID"));

          let guild = client.guilds.cache.get(guildId);
          let channelData = guild.channels.cache
            .map((channel) => {
              if (
                guild.members.me
                  .permissionsIn(channel)
                  .has([
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                  ])
              )
                return { id: channel.id, name: channel.name };

              return undefined;
            })
            .filter((e) => e !== undefined);
          let uuid = request.headers.cookie
            .split("; ")
            .find((e) => e.startsWith("uuid="))
            .substring(5, Infinity);
          let valid = loginCheck(uuid);
          if (!valid) return response.send(i18n.__("uuidInvalid"));

          userDatabase
            .prepare(
              "UPDATE Users SET discordUserId = ?, discordGuildId = ? WHERE uuid = ?",
            )
            .run(discordIdentifier.id, guildId, uuid);

          loggedInUsers[uuid].forEach((o) =>
            o.ws.send(
              JSON.stringify([
                ErrorType.Success,
                ActionType.GetChannels,
                [ggeConfig.discordClientId, channelData],
              ]),
            ),
          );
          return response.send(
            '<html><script language="JavaScript" type="text/javascript">window.close()</script><body>Successful</body></html>',
          );
        });
      });
    });
  }

  if (isFrontendDevMode) {
    // In dev, serve frontend pages from CRA dev server while backend keeps API routes.
    app.get(
      /^\/(?!api(?:\/|$)|health(?:\/|$)|1\.xml$|assets\.json$|logout$|discordAuth$|ggeProxyEmpire5(?:\/|$)).*/,
      (req, res) => res.redirect(`${frontendDevUrl}${req.originalUrl}`),
    );
  } else {
    app.use(express.static(websiteBuildDir));
  }

  // Creates or updates a worker thread that runs ggeBot.js for a given SubUser.
  // This orchestrates plugin options, external event pre-login routing, and handles restart-on-crash.
  async function createBot(uuid, user, messageBuffer, messageBufferCount) {
    const cachedLogState = getUserLogState(user.id);
    messageBuffer ??= cachedLogState.messageBuffer;
    messageBufferCount ??= cachedLogState.messageBufferCount;
    if (user.id && botMap.get(user.id) != undefined)
      throw Error(i18n.__("gameAccountSessionAlreadyInUse"));

    let data = structuredClone(user);

    let discordCreds = (uuid) => {
      const row = userDatabase
        .prepare("SELECT * FROM Users WHERE uuid = ?")
        .get(uuid);
      return row
        ? {
            discordGuildId: row.discordGuildId,
            discordUserId: row.discordUserId,
          }
        : undefined;
    };
    const discordData = discordCreds(uuid);
    plugins.forEach((plugin) => {
      data.plugins[plugin.key] ??= {};
      if (plugin.force) {
        data.plugins[plugin.key].state = true;
      }
      if (data.plugins[plugin.key]?.state) {
        data.plugins[plugin.key].filename = plugin.filename;
        plugin.pluginOptions?.forEach((option) => {
          let objectValue = data.plugins[plugin.key][option.key];
          if (option.key == undefined || ![, ""].includes(objectValue)) return;

          data.plugins[plugin.key][option.key] = option.default;
        });
      }
    });
    const instance = instances.find((e) => Number(e.gameID) == data.server);

    data.gameURL ??= instance.gameURL;
    data.gameServer ??= instance.gameServer;
    data.gameID ??= instance.gameID;

    if (user.externalEvent == true) {
      let users = getUser(uuid);
      let bot = users.find(
        (e) => user.name == e.id && user.id != e.id && e.state,
      );
      let getExternalEvent = (worker, alreadyStarted) =>
        new Promise((resolve) => {
          let resolved = false;
          const cleanup = () => {
            clearTimeout(timeout);
            worker.off("message", func);
            worker.off("message", onStarted);
          };
          const resolveOnce = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
          };

          const timeout = setTimeout(() => {
            resolveOnce({ sei: { E: [] }, glt: {}, error: "TIMED_OUT" });
          }, 1000 * 45);
          timeout.unref?.();

          let func = (obj) => {
            if (obj[0] != ActionType.GetExternalEvent) return;
            resolveOnce(obj[1]);
          };

          worker.on("message", func);

          if (alreadyStarted)
            return worker.postMessage([ActionType.GetExternalEvent]);

          let onStarted = (obj) => {
            if (obj[0] != ActionType.Started) return;

            worker.postMessage([ActionType.GetExternalEvent]);
          };
          worker.on("message", onStarted);
        });

      if (bot && !botMap.get(bot.id)) bot = undefined;

      if (bot) {
        let worker = botMap.get(bot.id);

        let data3 = await getExternalEvent(worker, true);

        if (data3?.ths?.tsid == 24) user.gameURL = "EmpireEx_42";

        user.gameServer = "ep-live-temp1-game.goodgamestudios.com";
        user.tempServerData = data3;
      } else {
        let data2 = structuredClone(user);

        plugins.forEach((plugin) => {
          data2.plugins[plugin.key] ??= {};
          if (plugin.force) {
            data2.plugins[plugin.key].state = true;
          }
          if (data2.plugins[plugin.key]?.state) {
            data2.plugins[plugin.key].filename = plugin.filename;
            plugin.pluginOptions?.forEach((option) => {
              let objectValue = data.plugins[plugin.key][option.key];
              if (option.key == undefined || ![, ""].includes(objectValue))
                return;

              data2.plugins[plugin.key][option.key] = option.default;
            });
          }
        });
        data2.plugins = [];
        data2.externalEvent = false;

        data2.gameURL ??= instance.gameURL;
        data2.gameServer ??= instance.gameServer;
        data2.gameID ??= instance.gameID;

        const worker = new Worker("./ggeBot.js", {
          workerData: { ...data2, discordData },
        });
        worker.messageBuffer = messageBuffer;
        worker.messageBufferCount = messageBufferCount;
        worker.on("message", async (obj) => {
          switch (obj[0]) {
            case ActionType.GetLogs:
              if (!uuid) break;
              worker.messageBuffer[worker.messageBufferCount] = [
                obj[1],
                obj[2],
                obj[3] ?? Date.now(),
              ];
              worker.messageBufferCount =
                (worker.messageBufferCount + 1) % LOG_BUFFER_SIZE;
              cachedLogState.messageBuffer = worker.messageBuffer;
              cachedLogState.messageBufferCount = worker.messageBufferCount;
              loggedInUsers[uuid]?.forEach((o) => {
                if (o.viewedUser == user.id)
                  o.ws.send(
                    JSON.stringify([
                      ErrorType.Success,
                      ActionType.GetLogs,
                      [
                        worker.messageBuffer,
                        worker.messageBufferCount,
                        user.id,
                      ],
                    ]),
                  );
              });
              break;
          }
        });
        let data3 = await getExternalEvent(worker);

        let tempServerEvent = data3.sei.E.find((e) => e.EID == 106);
        if (data3.glt.TSIP && data3.glt.TSZ) {
          data.gameURL = `${data3.glt.TSIP}`;
          data.gameServer = data3.glt.TSZ;
        } else if (tempServerEvent?.TSID == 24) {
          data.gameServer = "EmpireEx_42";
          data.gameURL = "ep-live-temp1-game.goodgamestudios.com";
        } else if (tempServerEvent?.TSID == 21) {
          data.gameServer = "EmpireEx_42";
          data.gameURL = "ep-live-temp1-game.goodgamestudios.com";
        } else if (data3.sei.E.find((e) => e.EID == 113)) {
          data.gameServer = "EmpireEx_45";
          data.gameURL = "ep-live-battle1-game.goodgamestudios.com";
        } else {
          console.error(i18n.__("failedToJoinEventServer"));
          return await worker.terminate();
        }
        data.tempServerData = data3;
        await worker.terminate();
      }
    }

    const worker = new Worker("./ggeBot.js", {
      workerData: { ...data, discordData },
    });

    worker.messageBuffer = messageBuffer;
    worker.messageBufferCount = messageBufferCount;
    cachedLogState.messageBuffer = worker.messageBuffer;
    cachedLogState.messageBufferCount = worker.messageBufferCount;

    if (user.id) botMap.set(user.id, worker);

    const onTerminate = () => {
      if (botMap.get(user.id) == worker) {
        botMap.set(user.id, undefined);
        if (getSpecificUser(uuid, user).state == true) {
          console.debug(`[${user.name}] ${i18n.__("restartDelay")}`);
          setTimeout(
            () => {
              // Re-fetch user state to ensure they didn't turn it off during the 10s wait
              user = getSpecificUser(uuid, user);
              if (user && user.state == true) {
                createBot(
                  uuid,
                  user,
                  worker.messageBuffer,
                  worker.messageBufferCount,
                );
              } else {
                console.debug(
                  `[${user.name}] ${i18n.__("restartCanceledReasonBotStoppedByUser")}`,
                );
              }
            },
            1000 * (ggeConfig.secondsTillRestartBot ?? 10),
          );
        }
      }
    };

    worker.on("message", (obj) => {
      switch (obj[0]) {
        case ActionType.TakeBreak: {
          const durationSec = Number(obj[1]) || 300;
          appendUserLog(
            uuid,
            user.id,
            0,
            buildSystemLogParts(user.name, `Taking a break for ${durationSec} seconds...`),
          );
          worker.off("exit", onTerminate);
          removeBot(user.id);

          setTimeout(() => {
            const currentUser = getSpecificUser(uuid, user);
            if (currentUser && currentUser.state !== 0 && !botMap.has(user.id)) {
              appendUserLog(
                uuid,
                user.id,
                0,
                buildSystemLogParts(user.name, `Break over, restarting...`),
              );
              createBot(
                uuid,
                currentUser,
                worker.messageBuffer,
                worker.messageBufferCount
              );
            }
          }, durationSec * 1000);
          break;
        }
        case ActionType.KillBot:
          userDatabase
            .prepare("UPDATE SubUsers SET state = ? WHERE id = ?")
            .run(0, user.id);
          removeBot(user.id);

          loggedInUsers[uuid]?.forEach(({ ws }) =>
            ws.send(
              JSON.stringify([
                ErrorType.Success,
                ActionType.GetUsers,
                [getUser(uuid), plugins.filter((e) => !e.hidden)],
              ]),
            ),
          );
          break;
        case ActionType.GetLogs:
          // console.log("logged something")
          worker.messageBuffer[worker.messageBufferCount] = [
            obj[1],
            obj[2],
            obj[3] ?? Date.now(),
          ];
          worker.messageBufferCount =
            (worker.messageBufferCount + 1) % LOG_BUFFER_SIZE;
          cachedLogState.messageBuffer = worker.messageBuffer;
          cachedLogState.messageBufferCount = worker.messageBufferCount;
          loggedInUsers[uuid]?.forEach((o) =>
            o.viewedUser == user.id
              ? o.ws.send(
                  JSON.stringify([
                    ErrorType.Success,
                    ActionType.GetLogs,
                    [worker.messageBuffer, worker.messageBufferCount, user.id],
                  ]),
                )
              : undefined,
          );
          break;
        case ActionType.StatusUser:
          obj[1].id = user.id;
          loggedInUsers[uuid]?.forEach((o) =>
            o.ws.send(
              JSON.stringify([
                ErrorType.Success,
                ActionType.StatusUser,
                obj[1],
              ]),
            ),
          );
          break;
        case ActionType.RemoveUser:
          worker.off("exit", onTerminate);
          removeUser(uuid, user);
          break;
        case ActionType.SetUser:
          userDatabase
            .prepare("UPDATE SubUsers SET pass = ? WHERE uuid = ? AND id = ?")
            .run(obj[1], uuid, user.id);
          break;
      }
    });

    worker.on("exit", onTerminate);

    await new Promise((resolve) => {
      const func = (obj) => {
        if (obj[0] != ActionType.Started) return;
        resolve();
        worker.once("exit", resolve);
        worker.off("message", func);
      };

      worker.on("message", func);
    });

    return worker;
  }

  const removeBot = (id) => {
    const worker = botMap.get(id);

    if (worker == undefined) throw i18n.__("noThreadWorker");

    botMap.delete(id);
    worker.terminate();
  };
  //Judge me
  events.on("createBot", createBot);
  events.on("removeBot", removeBot);

  const users = getUser();
  for (let i = 0; i < users.length; i++) {
    let user = users[i];
    let keyRemoved = false;
    for (const key of Object.keys(user.plugins)) {
      const pluginFile = plugins.find((e) => e?.key == key);
      if (pluginFile != undefined) continue;
      keyRemoved = true;
      delete user.plugins[key];
    }

    if (keyRemoved) {
      user = changeUser(user.uuid, user);
    }

    if (user.state != 0) createBot(user.uuid, user);
  }

  const wss = new WebSocketServer({ noServer: true });
  const options = {};

  if (certFound) {
    options.key = await fs.readFile(ggeConfig.privateKey, "utf8");
    options.cert = await fs.readFile(ggeConfig.cert, "utf8");
  }

  const socket = (certFound ? https : http).createServer(options, app);

  socket.listen(ggeConfig.webPort, () =>
    console.info(`Web server listening on port ${ggeConfig.webPort}`),
  );

  socket.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (socket) =>
      wss.emit("connection", socket, req),
    ),
  );

  wss.addListener("connection", (ws, req) => {
    const refreshUsers = () =>
      ws.send(
        JSON.stringify([
          ErrorType.Success,
          ActionType.GetUsers,
          [getUser(uuid), plugins.filter((e) => !e.hidden)],
        ]),
      );

    let uuid = req.headers.cookie
      ?.split("; ")
      .find((e) => e.startsWith("uuid="))
      ?.substring(5, Infinity);

    if (!loginCheck(uuid))
      return ws.send(
        JSON.stringify([ErrorType.Unauthenticated, ActionType.GetUUID, {}]),
      );

    loggedInUsers[uuid] ??= [];
    loggedInUsers[uuid].push({ ws });

    refreshUsers();

    let users = getUser(uuid);
    users.forEach((user) => {
      if (user.state != 1) return;

      let worker = botMap.get(user.id);
      if (worker == undefined) return;

      worker.postMessage([ActionType.StatusUser]);
    });
    if (hasDiscord) {
      const row = userDatabase
        .prepare("SELECT * FROM Users WHERE uuid = ?")
        .get(uuid);
      try {
        if (!row.discordGuildId) throw i18n.__("missingGuildID");
        if (!row.discordUserId) throw i18n.__("missingDiscordUserID");

        let guild = client.guilds.cache.get(row.discordGuildId);
        let channelData = guild.channels.cache
          .map((channel) => {
            if (
              guild.members.me
                .permissionsIn(channel)
                .has([
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                ])
            )
              return { id: channel.id, name: channel.name };

            return undefined;
          })
          .filter((e) => e !== undefined);
        ws.send(
          JSON.stringify([
            ErrorType.Success,
            ActionType.GetChannels,
            [ggeConfig.discordClientId, channelData],
          ]),
        );
      } catch (e) {
        ws.send(
          JSON.stringify([
            ErrorType.Success,
            ActionType.GetChannels,
            [ggeConfig.discordClientId, ggeConfig.discordPort, undefined],
          ]),
        );
        console.error(e);
      }
    }

    ws.addListener("message", async (event) => {
      let [_, action, obj] = JSON.parse(event.toString());

      switch (action) {
        case ActionType.GetUsers: {
          refreshUsers();
          break;
        }
        case ActionType.StatusUser: {
          break;
        }
        case ActionType.AddUser: {
          addUser(uuid, new User(obj));
          refreshUsers();
          break;
        }
        case ActionType.RemoveUser: {
          let lastError = undefined;
          for (let i = 0; i < obj.length; i++) {
            const user = obj[i];
            try {
              removeUser(uuid, user);
              userLogState.delete(Number(user.id));
            } catch (e) {
              lastError = e;
            }
          }
          if (lastError) {
            console.warn(lastError);
            ws.send(
              JSON.stringify([ErrorType.Generic, ActionType.RemoveUser, {}]),
            );
          }
          refreshUsers();
          break;
        }
        case ActionType.SetUser: {
          let oldUser = getSpecificUser(uuid, new User(obj));
          let user = changeUser(uuid, new User(obj));
          if (user.state == 0) {
            const wasRunning = oldUser.state != 0;
            try {
              removeBot(user.id);
            } catch (e) {
              console.warn(e);
            }
            if (wasRunning) {
              appendUserLog(
                uuid,
                user.id,
                0,
                buildSystemLogParts(user.name, "Stopped by user, Logged out"),
              );
            }
          } else {
            let worker = botMap.get(user.id);
            if (worker == undefined) worker = await createBot(uuid, user);
            else {
              let restartedUser = false;
              const pluginKeys = new Set([
                ...Object.keys(oldUser?.plugins ?? {}),
                ...Object.keys(user?.plugins ?? {}),
              ]);
              for (const key of pluginKeys) {
                const oldState = Boolean(oldUser?.plugins?.[key]?.state);
                const newState = Boolean(user?.plugins?.[key]?.state);
                if (oldState == newState) continue;
                restartedUser = true;
                removeBot(user.id);
                worker = await createBot(
                  uuid,
                  user,
                  worker.messageBuffer,
                  worker.messageBufferCount,
                );
                break;
              }
              if (!restartedUser) {
                let data = structuredClone(user);

                plugins.forEach((plugin) => {
                  data.plugins[plugin.key] ??= {};
                  if (plugin.force) {
                    data.plugins[plugin.key].state = true;
                  }
                  if (data.plugins[plugin.key]?.state) {
                    data.plugins[plugin.key].filename = plugin.filename;
                    plugin.pluginOptions?.forEach((option) => {
                      let objectValue = data.plugins[plugin.key][option.key];
                      if (
                        option.key == undefined ||
                        ![, ""].includes(objectValue)
                      )
                        return;

                      data.plugins[plugin.key][option.key] = option.default;
                    });
                  }
                });
                worker.postMessage([ActionType.SetPluginOptions, data]);
              }
            }
          }
          loggedInUsers[uuid]?.forEach(({ ws }) =>
            ws.send(
              JSON.stringify([
                ErrorType.Success,
                ActionType.GetUsers,
                [getUser(uuid), plugins.filter((e) => !e.hidden)],
              ]),
            ),
          );
          break;
        }
        case ActionType.GetLogs: {
          if (!obj) {
            loggedInUsers[uuid].find((o) => o.ws == ws).viewedUser = undefined;
            break;
          }
          const user = new User(obj);
          const worker = botMap.get(user.id);
          const cachedLogState = getUserLogState(user.id);

          let loggedInUser = loggedInUsers[uuid].find((obj) => obj.ws == ws);
          loggedInUser.viewedUser = user.id;

          const messageBuffer = worker
            ? worker.messageBuffer
            : cachedLogState.messageBuffer;
          const messageBufferCount = worker
            ? worker.messageBufferCount
            : cachedLogState.messageBufferCount;

          loggedInUser.ws.send(
            JSON.stringify([
              ErrorType.Success,
              ActionType.GetLogs,
              [messageBuffer, messageBufferCount, user.id],
            ]),
          );
          break;
        }
        default:
          ws.send(
            JSON.stringify([ErrorType.UnknownAction, ActionType.Unknown, {}]),
          );
      }
    });
    ws.addListener("close", () => {
      if (!uuid) return;
      let index = loggedInUsers[uuid].findIndex((obj) => obj.ws == ws);
      if (index == -1) throw Error(i18n.__("couldntFindWebClientIndex"));

      loggedInUsers[uuid].splice(index, 1);

      if (loggedInUsers[uuid].length == 0) loggedInUsers[uuid] = undefined;
    });
  });

  console.info(i18n.__("started"));
}

start();

module.exports = {
  loggedInUsers,
  botMap,
  userDatabase,
  changeUser,
  getUser,
  removeUser,
  events,
};
