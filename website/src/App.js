// Frontend React app for GGE-BOT control panel.
// - Connects to backend WebSocket and exposes plugin/user management.
// - Provides multi-language support with local + remote language merge.
// - Uses MUI dark theme and responsive user table components.
import ReconnectingWebSocket from "reconnecting-websocket";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { CircularProgress } from "@mui/material";
import { useCookies } from "react-cookie";
import * as React from "react";
import "./App.css";
import { ErrorType, GetErrorTypeName, ActionType, User } from "./types.js";
import GGEUserTable from "./modules/GGEUsersTable";
import settings from "./settings.json";

const getBackendHttpBaseUrl = () => {
	if (settings.baseUrl) return settings.baseUrl.replace(/\/+$/, "");

	const host = settings.port
		? `${window.location.hostname}:${settings.port}`
		: window.location.host;
	return `${window.location.protocol}//${host}`;
};

const getBackendWsBaseUrl = () => {
	if (settings.wsUrl) return settings.wsUrl.replace(/\/+$/, "");

	const host = settings.port
		? `${window.location.hostname}:${settings.port}`
		: process.env.NODE_ENV === "development"
			? `${window.location.hostname}:3001`
			: window.location.host;
	return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host}`;
};

function GrabAssets() {
	const [cookies, setCookie] = useCookies([]);
	const [lang, setLang] = React.useState(false);
	const setLanguage = async (lang) => {
		setCookie("lang", (cookies.lang = lang), { maxAge: 31536000 });

		try {
			const backendHttpBaseUrl = getBackendHttpBaseUrl();
			const fetches = await Promise.all([
				new Promise(async (resolve) => {
					const version = (
						await (
							await fetch(
								`${backendHttpBaseUrl}/ggeProxyEmpire5/config/languages/version.json`,
							)
						).json()
					).languages[lang];
					resolve(
						fetch(
							`${backendHttpBaseUrl}/ggeProxyEmpire5/config/languages/${version}/${lang}.json`,
						),
					);
				}),
				fetch(`${window.location.origin}/locales/${lang}.json`),
			]);
			const langFile = {};
			for (let i = 0; i < fetches.length; i++) {
				const response = fetches[i];

				Object.assign(langFile, await response.json());
			}
			setLang(langFile);
		} catch (e) {
			throw new Error("Failed to load language.\n\n" + e);
		}
	};

	if (lang === false) {
		setLanguage(cookies.lang ?? "en");

		return (
			<CircularProgress
				style={{
					margin: "0",
					position: "absolute",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
				}}
			/>
		);
	}
	const __ = (key) => {
		// if(lang[key] == undefined)
		// console.warn(`[Language] ${key} key not found`)
		return lang[key] || key;
	};
	return <App setLanguage={setLanguage} languageCode={cookies.lang} __={__} />;
}

const darkTheme = createTheme({
	palette: {
		mode: "dark",
		background: {
			default: "#0d0f12",
			paper: "#13161a",
		},
		primary: {
			main: "#00ffaa",
			dark: "#00cc88",
		},
		secondary: {
			main: "#00ccff",
		},
		error: {
			main: "#ff3366",
		},
		warning: {
			main: "#ffcc00",
		},
		info: {
			main: "#3388ff",
		},
		text: {
			primary: "#e0e6ed",
			secondary: "#8a9ab0",
		},
	},
	typography: {
		fontFamily: '"JetBrains Mono", -apple-system, sans-serif',
		h1: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		h2: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		h3: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		h4: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		h5: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		h6: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		button: {
			fontFamily: '"JetBrains Mono", monospace',
			letterSpacing: "0.1em",
		},
	},
	shape: {
		borderRadius: 0,
	},
	components: {
		MuiButton: {
			styleOverrides: {
				root: {
					border: "1px solid rgba(0, 255, 170, 0.2)",
					backgroundColor: "rgba(0, 255, 170, 0.05)",
					color: "#00ffaa",
					transition: "all 0.2s ease-in-out",
					boxShadow: "none",
					"&:hover": {
						backgroundColor: "rgba(0, 255, 170, 0.15)",
						boxShadow: "0 0 10px rgba(0, 255, 170, 0.3)",
						border: "1px solid rgba(0, 255, 170, 0.5)",
					},
				},
				contained: {
					backgroundColor: "rgba(0, 255, 170, 0.1)",
					color: "#00ffaa",
				},
			},
		},
		MuiPaper: {
			styleOverrides: {
				root: {
					backgroundImage: "none",
					border: "1px solid #232933",
					boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				root: {
					borderBottom: "1px solid #1a1e24",
					fontFamily: '"JetBrains Mono", monospace',
				},
				head: {
					color: "#00ffaa",
					textTransform: "uppercase",
					fontWeight: 600,
					borderBottom: "1px solid #00ffaa",
					backgroundColor: "#0d0f12",
				},
			},
		},
		MuiCheckbox: {
			styleOverrides: {
				root: {
					color: "rgba(0, 255, 170, 0.4)",
					"&.Mui-checked": {
						color: "#00ffaa",
					},
				},
			},
		},
	},
});

function App({ setLanguage, languageCode, __ }) {
	const [users, setUsers] = React.useState([]);
	const [usersStatus, setUsersStatus] = React.useState({});
	const [plugins, setPlugins] = React.useState([]);
	const [channelInfo, setChannelInfo] = React.useState([]);
	const usersStatusRef = React.useRef({});
	const [ws] = React.useState(() => {
		return new ReconnectingWebSocket(getBackendWsBaseUrl(), [], {
			WebSocket: WebSocket,
			minReconnectionDelay: 3000,
		});
	});

	React.useEffect(() => {
		const handleMessage = (msg) => {
			const [err, action, obj] = JSON.parse(msg.data.toString());
			if (err) console.error(GetErrorTypeName(err));

			switch (Number(action)) {
				case ActionType.GetUUID:
					if (err === ErrorType.Unauthenticated)
						return (window.location.href = "signin.html");
					break;
				case ActionType.GetChannels:
					setChannelInfo(obj ?? []);
					break;
				case ActionType.GetUsers:
					if (err !== ErrorType.Success) return;

					setUsers(obj[0].map((e) => new User(e)));
					setPlugins(obj[1]);
					break;
				case ActionType.StatusUser:
					usersStatusRef.current[obj.id] = obj;
					setUsersStatus(structuredClone(usersStatusRef.current));
					break;
				default:
					return;
			}
		};

		ws.addEventListener("message", handleMessage);
		return () => {
			ws.removeEventListener("message", handleMessage);
			ws.close();
		};
	}, [ws]);

	return (
		<div className="App">
			<ThemeProvider theme={darkTheme}>
				<GGEUserTable
					ws={ws}
					plugins={plugins}
					rows={users}
					usersStatus={usersStatus}
					channelInfo={channelInfo}
					setLanguage={setLanguage}
					languageCode={languageCode}
					__={__}
				/>
			</ThemeProvider>
		</div>
	);
}

export default GrabAssets;
