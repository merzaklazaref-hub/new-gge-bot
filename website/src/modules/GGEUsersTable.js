/*
 * Frontend component: User table management view.
 * - Renders account list and detailed plugin/state management controls.
 */
import * as React from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Backdrop from "@mui/material/Backdrop";
import Checkbox from "@mui/material/Checkbox";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import useMediaQuery from "@mui/material/useMediaQuery";

import { ErrorType, ActionType, LogLevel } from "../types.js";
import UserSettings from "./userSettings";
import settings from "../settings.json";
import { Grid } from "@mui/material";

const getBackendPort = () => {
	if (settings.port) return settings.port;
	if (process.env.NODE_ENV === "development") return "3001";
	return window.location.port;
};

const formatStatusLabel = (key, __) => {
	const translated = __(key);
	if (translated && translated !== key) return translated;

	return String(key)
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());
};

function Log({ ws, __, logUserId }) {
	const [currentLogs, setCurrentLogs] = React.useState([]);
	const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true);
	const logsContainerRef = React.useRef(null);
	const isMobile = useMediaQuery("(max-width:600px)");
	const LOG_FONT = '"JetBrains Mono", monospace';

	const getLevelColor = (logLevel) =>
		logLevel === LogLevel.Error
			? "#ff5a7a"
			: logLevel === LogLevel.Warn
				? "#ffd166"
				: "#00ffaa";

	React.useEffect(() => {
		const renderLogLine = (entry, index) => {
		const [level, parts, createdAt] = entry;
		const levelColor = getLevelColor(level);
		const localTime =
			typeof createdAt === "number" && Number.isFinite(createdAt)
				? new Intl.DateTimeFormat([], {
						hour: "2-digit",
						minute: "2-digit",
						hour12: false,
					}).format(new Date(createdAt))
				: undefined;
		const normalizeTokenFormatting = (value) =>
			String(value)
				.replace(/\s+/g, " ")
				.replace(/\s*:\s*/g, ":")
				.replace(/\bC\s+(\d+)\b/g, "C$1")
				.replace(/\b(\d+)\s*m(?:in(?:ute)?s?)?\s*(\d+)\s*s(?:ec(?:ond)?s?)?\b/gi, "$1m $2s")
				.replace(/\b(\d+)\s*m(?:in(?:ute)?s?)\b/gi, "$1m")
				.replace(/\b(\d+)\s*s(?:ec(?:ond)?s?)\b/gi, "$1s")
				.trim();

		const text = (parts ?? [])
			.map((part) => {
				if (part instanceof Error) return part.message;
				if (typeof part === "string") return part;
				if (part === null || part === undefined) return "";
				if (typeof part === "object") {
					try {
						return JSON.stringify(part);
					} catch {
						return String(part);
					}
				}
				return String(part);
			})
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();

		const parsedWithPlugin =
			/^\[(?<plugin>[^\]]+)\]\s*\[(?<time>[^\]]+)\]\s*\[(?<source>[^\]]+)\]\s*(?<message>[\s\S]*)$/.exec(
				text,
			);
		const parsedLegacy =
			/^\[(?<time>[^\]]+)\]\s*\[(?<source>[^\]]+)\]\s*(?<message>[\s\S]*)$/.exec(
				text,
			);
		const parsed = parsedWithPlugin ?? parsedLegacy;

		const plugin = parsedWithPlugin?.groups?.plugin?.trim();
		const time = parsed?.groups?.time;
		const source = parsed?.groups?.source;
		const sourceLabel = source?.trim() || "system";
		const displayTime = localTime ?? time;
		const message = normalizeTokenFormatting(parsed?.groups?.message ?? text);
		const highlightedMessage = message
			.split(/(\b\d+:\d+\b|\bC\d+\b|\b\d+m(?:\s+\d+s)?\b|\b\d+s\b|\(\d+x\)|\b\d+(?:\.\d+)?[km]\b)/gi)
			.filter((chunk) => chunk.length > 0)
			.map((chunk, chunkIndex) => {
				const isCommanderChunk = /^C\d+$/.test(chunk);
				const isTimeChunk = /^\d+m(?:\s+\d+s)?$|^\d+s$/i.test(chunk);
				const isMultiplierChunk = /^\(\d+x\)$/i.test(chunk);
				const isNumberChunk = /^\d+(?:\.\d+)?[km]?$/i.test(chunk);
				return (
					<span
						key={chunkIndex}
						style={
							isCommanderChunk
								? {
									color: "#00ccff",
									fontWeight: 700,
								}
								: isTimeChunk
									? {
									color: "#ffd166",
									fontWeight: 700,
								}
									: isMultiplierChunk || isNumberChunk
										? {
											color: "#ffd166",
											fontWeight: 700,
										}
								: undefined
						}
					>
						{chunk}
					</span>
				);
			});

		return (
			<div
				key={index}
				style={{
					display: "flex",
					alignItems: "baseline",
					flexWrap: "wrap",
					gap: "8px",
					padding: "5px 0",
					borderBottom: "1px dashed rgba(255,255,255,0.06)",
					lineHeight: 1.35,
				}}
			>
				<span style={{ color: levelColor, minWidth: "24px" }}>{">_"}</span>
				{plugin ? (
					<span
						style={{
							color: "#00ffaa",
							fontWeight: 700,
							fontFamily: LOG_FONT,
						}}
					>
						[{plugin}]
					</span>
				) : null}
				{displayTime ? (
					<span style={{ color: "#7f8b9c" }}>[{displayTime}]</span>
				) : null}
				{source ? (
					<span
						style={{
							color: "#79f7da",
							padding: "0 6px 0 2px",
							fontSize: "0.84em",
							fontWeight: 600,
							fontFamily: LOG_FONT,
							letterSpacing: "0.02em",
							lineHeight: 1.2,
							borderLeft: "2px solid rgba(0, 255, 170, 0.45)",
							borderRight: "1px solid rgba(0, 255, 170, 0.2)",
							textTransform: "none",
						}}
					>
						{sourceLabel}
					</span>
				) : null}
				<span style={{ color: "#d4dfec", wordBreak: "break-word", flex: 1 }}>
					{highlightedMessage}
				</span>
			</div>
		);
		};

		const logGrabber = (msg) => {
			const [err, action, obj] = JSON.parse(msg.data.toString());

			if (Number(action) !== ActionType.GetLogs) return;
			if (obj?.[2] !== undefined && Number(obj[2]) !== Number(logUserId)) return;

			if (Number(err) !== ErrorType.Success) {
				setCurrentLogs([]);
				return;
			}

			const ringBuffer = Array.isArray(obj?.[0]) ? obj[0] : [];
			const startIndex = Number(obj?.[1]) || 0;

			setCurrentLogs(
				ringBuffer
					.slice(startIndex)
					.concat(ringBuffer.slice(0, startIndex))
					.filter(Boolean)
					.map((entry, index) => renderLogLine(entry, index)),
			);
		};
		ws.addEventListener("message", logGrabber);
		return () => ws.removeEventListener("message", logGrabber);
	}, [ws, logUserId, isMobile]);

	React.useEffect(() => {
		setCurrentLogs([]);
		setAutoScrollEnabled(true);
	}, [logUserId]);

	React.useEffect(() => {
		if (!autoScrollEnabled) return;
		const container = logsContainerRef.current;
		if (!container) return;
		container.scrollTop = container.scrollHeight;
	}, [currentLogs, autoScrollEnabled]);

	const handleLogScroll = () => {
		const container = logsContainerRef.current;
		if (!container) return;

		const remaining =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		const isNearBottom = remaining <= 20;
		setAutoScrollEnabled(isNearBottom);
	};

	return (
		<Paper
			sx={{
				overflow: "auto",
				backgroundColor: "#0d0f12",
				border: "1px solid rgba(0, 255, 170, 0.4)",
				boxShadow: "0 0 30px rgba(0, 255, 170, 0.1)",
				width: "min(920px, 96vw)",
				maxWidth: "96vw",
			}}
		>
			<div
				style={{
					padding: isMobile ? "8px 10px" : "8px 16px",
					backgroundColor: "#13161a",
					borderBottom: "1px solid rgba(0, 255, 170, 0.3)",
					color: "#00ffaa",
					fontFamily: LOG_FONT,
					fontSize: isMobile ? "12px" : "14px",
					display: "flex",
					justifyContent: "space-between",
					gap: "8px",
					flexWrap: "wrap",
				}}
			>
				<span>root@system:~/logs</span>
				<span>[TERMINAL ACTIVE]</span>
			</div>
			<div
				onClick={(e) => e.stopPropagation()}
				ref={logsContainerRef}
				onScroll={handleLogScroll}
				style={{
					maxHeight: "75dvh",
					maxWidth: "96vw",
					padding: isMobile ? "10px" : "12px",
					fontFamily: LOG_FONT,
					overflowY: "auto",
				}}
			>
				<Typography
					variant="body2"
					component="div"
					align="left"
					style={{ fontFamily: "inherit" }}
				>
					{currentLogs.length === 0 ? (
						<div style={{ color: "#00ffaa" }}>
							$ waiting for system output...
						</div>
					) : (
						currentLogs
					)}
				</Typography>
			</div>
		</Paper>
	);
}
function Language({ languageCode, setLanguage }) {
	const [anchorEl, setAnchorEl] = React.useState(null);
	const open = Boolean(anchorEl);
	const handleClick = (event) => {
		setAnchorEl(event.currentTarget);
	};
	const handleClose = () => {
		setAnchorEl(null);
	};

	return (
		<>
			<Button
				id="basic-button"
				aria-controls={open ? "basic-menu" : undefined}
				aria-haspopup="true"
				aria-expanded={open ? "true" : undefined}
				onClick={handleClick}
				variant="outlined"
				style={{
					margin: "5px",
					maxHeight: "28px",
					minHeight: "28px",
					minWidth: "50px",
					borderColor: "rgba(0, 255, 170, 0.5)",
					color: "#00ffaa",
					backgroundColor: "rgba(0, 255, 170, 0.05)",
					fontFamily: '"JetBrains Mono", monospace',
					letterSpacing: "0.1em",
				}}
			>
				{languageCode}
			</Button>
			<Menu
				id="basic-menu"
				anchorEl={anchorEl}
				open={open}
				onClose={handleClose}
				slotProps={{
					list: {
						"aria-labelledby": "basic-button",
					},
					paper: {
						style: {
							backgroundColor: "#13161a",
							border: "1px solid rgba(0, 255, 170, 0.4)",
							boxShadow: "0 4px 20px rgba(0, 255, 170, 0.15)",
							marginTop: "4px",
						},
					},
				}}
				MenuListProps={{
					sx: {
						padding: "4px",
						"& .MuiMenuItem-root": {
							fontFamily: '"JetBrains Mono", monospace',
							color: "#8a9ab0",
							padding: "8px 16px",
							transition: "all 0.2s ease",
							"&:hover": {
								backgroundColor: "rgba(0, 255, 170, 0.1)",
								color: "#00ffaa",
							},
						},
					},
				}}
			>
				<MenuItem
					onClick={() => {
						setLanguage("en");
						handleClose();
					}}
				>
					EN
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("pl");
						handleClose();
					}}
				>
					PL
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("de");
						handleClose();
					}}
				>
					DE
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("tr");
						handleClose();
					}}
				>
					TR
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("ar");
						handleClose();
					}}
				>
					AR
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("cs");
						handleClose();
					}}
				>
					CS
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("fr");
						handleClose();
					}}
				>
					FR
				</MenuItem>
				<MenuItem
					onClick={() => {
						setLanguage("nl");
						handleClose();
					}}
				>
					NL
				</MenuItem>
			</Menu>
		</>
	);
}

const assets = JSON.parse(
	await (
		await fetch("/assets.json")
	).text(),
);

function Resources({ __, openResources: resources, languageCode }) {
	const isMobile = useMediaQuery("(max-width:600px)");
	if (!resources) return <></>;

	delete resources["coins"];
	delete resources["rubies"];

	const nameOverrides = {
		screws: "component1",
		blackPowder: "component2",
		saws: "component3",
		drills: "component4",
		crowbars: "component5",
		leatherStrips: "component6",
		chains: "component7",
		metalPlates: "component8",
	};
	for (const key in nameOverrides) {
		const value = resources[key];
		if (value) {
			resources[nameOverrides[key]] = value;
			delete resources[key];
		}
	}
	for (const key in resources) {
		if ([undefined, 0, null].includes(resources[key])) {
			delete resources[key];
			continue;
		}
		if (Number(resources[key])) {
			const skipOverrides = {
				"1MinSkip": 1,
				"5MinSkip": 5,
				"10MinSkip": 10,
				"30MinSkip": 30,
				"60MinSkip": 60,
				"5HourSkip": 5,
				"24HourSkip": 24,
			};
			const value = skipOverrides[key];
			resources[key] =
				`${value ? `${value}x` : ""}${new Intl.NumberFormat(languageCode, { notation: "compact" }).format(resources[key])}`;
		}
	}
	function capitalizeFirstLetter(val) {
		return String(val).charAt(0).toLocaleUpperCase() + String(val).slice(1);
	}
	return (
		<Paper
			sx={{
				overflow: "auto",
				backgroundColor: "#0d0f12",
				border: "1px solid rgba(0, 204, 255, 0.4)",
				boxShadow: "0 0 30px rgba(0, 204, 255, 0.1)",
				width: "min(980px, 96vw)",
				maxWidth: "96vw",
			}}
		>
			<div
				style={{
					padding: isMobile ? "8px 10px" : "8px 16px",
					backgroundColor: "#13161a",
					borderBottom: "1px solid rgba(0, 204, 255, 0.3)",
					color: "#00ccff",
					fontFamily: '"JetBrains Mono", monospace',
					fontSize: isMobile ? "12px" : "14px",
					display: "flex",
					justifyContent: "space-between",
					gap: "8px",
					flexWrap: "wrap",
				}}
			>
				<span>[RESOURCES DATABASE]</span>
				<span>STATUS: ONLINE</span>
			</div>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					maxHeight: "75dvh",
					maxWidth: "96vw",
					padding: isMobile ? "8px" : "10px",
				}}
			>
				<Grid container spacing={isMobile ? 1 : 2} justifyContent="center">
					{Object.entries(resources).map(([key, value], i) => {
						const jsonKey = capitalizeFirstLetter(key);
						return (
							<Grid key={i} item xs={6} sm={4} md={2}>
								<div
									style={{
										justifyContent: "center",
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										backgroundColor: "rgba(0, 204, 255, 0.05)",
										border: "1px solid rgba(0, 204, 255, 0.2)",
										borderRadius: "4px",
										padding: "16px 8px",
										transition: "all 0.2s ease",
										":hover": {
											backgroundColor: "rgba(0, 204, 255, 0.1)",
											transform: "translateY(-2px)",
											boxShadow: "0 4px 12px rgba(0, 204, 255, 0.2)",
										},
									}}
								>
									<div
										style={{
											height: "48px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											overflowWrap: "break-word",
										}}
									>
										<img
											alt={__(key)}
											onError={(e) => {
												e.currentTarget.outerHTML = `<div style="overflow:hidden;max-height:100%;max-width:100%;color:#00ccff;font-family:'JetBrains Mono',monospace;font-size:12px;text-align:center;">${__(key).toUpperCase()}</div>`;
											}}
											style={{
												maxHeight: "100%",
												maxWidth: "100%",
												filter: "drop-shadow(0 0 4px rgba(0,204,255,0.4))",
											}}
											src={`/ggeProxyEmpire5/default/assets/${assets[`Collectable_Currency_${jsonKey}`]}.webp`}
										></img>
									</div>
									<Typography
										variant="subtitle2"
										component="div"
										align="center"
										paddingTop={"12px"}
										style={{
											color: "#00ccff",
											fontFamily: '"JetBrains Mono", monospace',
											fontWeight: "bold",
										}}
									>
										{value}
									</Typography>
								</div>
							</Grid>
						);
					})}
				</Grid>
			</div>
		</Paper>
	);
}
function PlayerTable({
	setLanguage,
	__,
	languageCode,
	rows,
	usersStatus,
	ws,
	channelInfo,
	handleSettingsOpen,
	handleLogOpen,
	setSelectedUser,
	setOpenSettings,
	handleResourcesOpen,
}) {
	const [selected, setSelected] = React.useState([]);
	const isMobile = useMediaQuery("(max-width:900px)");
	const isSmallMobile = useMediaQuery("(max-width:600px)");
	const backendPort = getBackendPort();
	const handleSignOut = () => {
		if (ws?.readyState === WebSocket.OPEN) {
			ws.close(1000, "User signed out");
		} else if (ws?.readyState === WebSocket.CONNECTING) {
			ws.close();
		}
		window.location.replace("/logout");
	};

	const handleSelectAllClick = (event) => {
		if (event.target.checked) {
			const newSelected = rows.map((n) => n.id);
			setSelected(newSelected);
			return;
		}
		setSelected([]);
	};

	return (
		<TableContainer
			component={Paper}
			sx={{
				margin: "0",
				width: "100%",
				border: "none",
				borderRadius: "0",
				boxShadow: "none",
				backgroundColor: "#0d0f12",
				overflowX: "auto",
				overflowY: "hidden",
				WebkitOverflowScrolling: "touch",
				px: isSmallMobile ? 0.5 : 0,
			}}
		>
			<div
				style={{
					background: "linear-gradient(135deg, #13161a 0%, #0d0f12 100%)",
					padding: isMobile ? "14px 12px" : "18px 24px",
					borderBottom: "2px solid rgba(0, 255, 170, 0.4)",
					display: "flex",
					alignItems: "center",
					flexWrap: isMobile ? "wrap" : "nowrap",
					gap: isMobile ? "10px" : "0",
					justifyContent: "space-between",
					boxShadow:
						"0 4px 20px rgba(0, 0, 0, 0.3), inset 0 -1px 0 rgba(0, 255, 170, 0.2)",
				}}
			>
				<Typography
					variant="h6"
					style={{
						color: "#00ffaa",
						display: "flex",
						alignItems: "center",
						gap: "10px",
					}}
				>
					<span
						style={{
							display: "inline-block",
							width: "8px",
							height: "8px",
							backgroundColor: "#00ffaa",
							borderRadius: "50%",
							boxShadow: "0 0 8px #00ffaa",
						}}
					></span>
					DASHBOARD
				</Typography>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						flexWrap: isMobile ? "wrap" : "nowrap",
						justifyContent: isMobile ? "flex-end" : "flex-start",
						width: isMobile ? "100%" : "auto",
					}}
				>
					<Typography
						variant="caption"
						style={{
							color: "#8a9ab0",
							fontFamily: "monospace",
							marginRight: "8px",
							display: isMobile ? "none" : "block",
						}}
					>
					</Typography>
					<Language setLanguage={setLanguage} languageCode={languageCode} />
					<Button
						variant="outlined"
						style={{
							maxHeight: "28px",
							minHeight: "28px",
							fontSize: isSmallMobile ? "0.7rem" : "0.8rem",
							borderColor: "rgba(0, 204, 255, 0.5)",
							color: "#00ccff",
							backgroundColor: "rgba(0, 204, 255, 0.05)",
						}}
						onClick={async () =>
							window.open(
								`https://discord.com/oauth2/authorize?client_id=${channelInfo[0]}&permissions=8&response_type=code&redirect_uri=${window.location.protocol === "https:" ? "https" : "http"}%3A%2F%2F${window.location.hostname}%3A${backendPort !== "" ? backendPort : window.location.protocol === "https:" ? "443" : "80"}%2FdiscordAuth&integration_type=0&scope=identify+guilds.join+bot`,
								"_blank",
							)
						}
					>
						{__("linkDiscord")}
					</Button>
					<Button
						variant="outlined"
						style={{
							maxWidth: "40px",
							maxHeight: "28px",
							minWidth: "40px",
							minHeight: "28px",
							padding: isSmallMobile ? "0 8px" : undefined,
						}}
						onClick={handleSettingsOpen}
					>
						+
					</Button>
					<div
						style={{
							width: "1px",
							height: "28px",
							backgroundColor: "rgba(255, 51, 102, 0.3)",
							margin: "0 4px",
							display: isSmallMobile ? "none" : "block",
						}}
					/>
					<Button
						variant="outlined"
						aria-label={__("signOut")}
						style={{
							maxHeight: "28px",
							minHeight: "28px",
							fontSize: isSmallMobile ? "0.7rem" : "0.8rem",
							borderColor: "rgba(255, 51, 102, 0.5)",
							color: "#ff3366",
							backgroundColor: "rgba(255, 51, 102, 0.05)",
						}}
						onClick={handleSignOut}
					>
						{__("signOut")}
					</Button>
				</div>
			</div>
			<Table sx={{ minWidth: isSmallMobile ? 360 : isMobile ? 520 : 650 }} aria-label="simple table">
				<TableHead>
					<TableRow>
						<TableCell
							padding="checkbox"
							sx={{ borderBottom: "1px solid #00ffaa" }}
						>
							<Checkbox
								color="primary"
								checked={rows.length === selected.length}
								onClick={handleSelectAllClick}
								inputProps={{
									"aria-label": "select all entries",
								}}
							/>
						</TableCell>
						<TableCell
							align="right"
							padding="none"
							style={{
								width: "max-content",
								borderBottom: "1px solid #00ffaa",
							}}
						></TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{rows.map((row, index) => {
						function PlayerRow() {
							const getEnabledPlugins = () => {
								const enabledPlugins = [];
								Object.entries(row.plugins).forEach(([key, value]) => {
									if (
										Boolean(value.state) === true &&
										Boolean(value.forced) !== true
									)
										enabledPlugins.push(key);
									return;
								});
								return enabledPlugins.sort((a, b) =>
									__(a).localeCompare(__(b), undefined, {
										sensitivity: "base",
									}),
								);
							};

							const isItemSelected = selected.includes(row.id);
							const labelId = `enhanced-table-checkbox-${index}`;
							const [state, setState] = React.useState(row.state);
							row.state = state;

							const status = usersStatus[row.id] ?? {};

							return (
								<React.Fragment key={row.id}>
									{/* Spacer row before each account group */}
									{index > 0 && (
										<TableRow>
											<TableCell
												colSpan={3}
												sx={{
													height: "12px",
													padding: 0,
													borderBottom: "2px solid rgba(0, 255, 170, 0.2)",
													background:
														"linear-gradient(90deg, transparent 0%, rgba(0, 255, 170, 0.05) 50%, transparent 100%)",
												}}
											/>
										</TableRow>
									)}
									<TableRow
										style={
											status?.hasError
												? {
														backgroundColor: "rgba(255, 51, 102, 0.05)",
														borderLeft: "4px solid #ff3366",
														borderTop:
															index > 0
																? "1px solid rgba(0, 255, 170, 0.15)"
																: "none",
													}
												: {
														borderLeft: "4px solid rgba(0, 255, 170, 0.3)",
														transition: "all 0.2s ease",
														borderTop:
															index > 0
																? "1px solid rgba(0, 255, 170, 0.15)"
																: "none",
													}
										}
										sx={{
											"&:hover": {
												backgroundColor: "rgba(0, 255, 170, 0.03)",
												borderLeft:
													"4px solid rgba(0, 255, 170, 0.6) !important",
											},
										}}
									>
										<TableCell padding="checkbox" rowSpan={3}>
											<Checkbox
												color="primary"
												checked={isItemSelected}
												onClick={() => {
													const index = selected.indexOf(row.id);
													if (index < 0) {
														selected.push(row.id);
														setSelected(Array.from(selected));
														return;
													}
													setSelected(selected.toSpliced(index, 1));
												}}
												inputProps={{
													"aria-labelledby": labelId,
												}}
											/>
										</TableCell>
										<TableCell
											component="th"
											scope="row"
											style={{
												color: "#fff",
												fontWeight: "bold",
												fontSize: isSmallMobile ? "0.9rem" : "1.05rem",
												fontFamily: '"JetBrains Mono", monospace',
												letterSpacing: "0.05em",
											}}
										>
											{row.name}
										</TableCell>
										<TableCell
											align="right"
											padding="none"
											style={{ padding: isMobile ? "8px" : "10px" }}
										>
											<div
												style={{
													display: "flex",
													justifyContent: isSmallMobile ? "flex-start" : "flex-end",
													gap: "6px",
													flexWrap: "wrap",
												}}
											>
											<Button
												variant="outlined"
												style={{
														margin: "0",
													fontSize: "0.8rem",
														padding: isMobile ? "4px 6px" : "4px 8px",
													minWidth: isSmallMobile ? "72px" : undefined,
												}}
												onClick={() => {
													handleResourcesOpen(status);
												}}
											>
												{__("resources")}
											</Button>
											<Button
												variant="outlined"
												style={{
														margin: "0",
													fontSize: "0.8rem",
														padding: isMobile ? "4px 6px" : "4px 8px",
													minWidth: isSmallMobile ? "62px" : undefined,
												}}
												onClick={() => {
													ws.send(
														JSON.stringify([
															ErrorType.Success,
															ActionType.GetLogs,
															row,
														]),
													);
														handleLogOpen(row.id);
												}}
											>
												{__("logs")}
											</Button>
											<Button
												variant="outlined"
												style={{
														margin: "0",
													fontSize: "0.8rem",
														padding: isMobile ? "4px 6px" : "4px 8px",
													minWidth: isSmallMobile ? "80px" : undefined,
												}}
												onClick={() => {
													handleSettingsOpen(row.id);
												}}
											>
												{__("settings")}
											</Button>
											<Button
												variant="contained"
												onClick={() => {
													row.state = !state;
													ws.send(
														JSON.stringify([
															ErrorType.Success,
															ActionType.SetUser,
															row,
														]),
													);
													setState(!state);
												}}
												style={{
														margin: "0",
													fontSize: "0.8rem",
														padding: isMobile ? "4px 10px" : "4px 12px",
													minWidth: "70px",
													backgroundColor: state
														? "rgba(255, 51, 102, 0.1)"
														: "rgba(0, 255, 170, 0.1)",
													color: state ? "#ff3366" : "#00ffaa",
													borderColor: state ? "#ff3366" : "#00ffaa",
												}}
											>
												{state ? __("stop") : __("start")}
											</Button>
											</div>
										</TableCell>
									</TableRow>

									{/* Plugins Row */}
									<TableRow
										style={
											status?.hasError
												? {
														backgroundColor: "rgba(255, 51, 102, 0.05)",
														borderLeft: "4px solid #ff3366",
													}
												: {
														borderLeft: "4px solid rgba(0, 255, 170, 0.3)",
													}
										}
										sx={{
											"&:hover": {
												backgroundColor: "rgba(0, 255, 170, 0.03)",
												borderLeft:
													"4px solid rgba(0, 255, 170, 0.6) !important",
											},
										}}
									>
										<TableCell
											colSpan={2}
											style={{
												borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
												padding: isSmallMobile ? "8px 10px" : "8px 16px",
											}}
										>
											<Typography
												variant="caption"
												style={{
													color: "#00ffaa",
													textTransform: "uppercase",
													fontSize: "0.75rem",
													marginBottom: "8px",
													display: "block",
													fontFamily: '"JetBrains Mono", monospace',
													letterSpacing: "0.1em",
													fontWeight: "600",
												}}
											>
												▸ {__("plugins")}
											</Typography>
											<div
												style={{
													display: "flex",
													gap: "8px",
													flexWrap: "wrap",
												}}
											>
												{getEnabledPlugins().length === 0 ? (
													<span
														style={{
															padding: "6px 12px",
															backgroundColor: "rgba(138, 154, 176, 0.1)",
															border: "1px solid rgba(138, 154, 176, 0.2)",
															fontSize: "0.75em",
															color: "#8a9ab0",
															fontStyle: "italic",
														}}
													>
														No plugins enabled
													</span>
												) : (
													getEnabledPlugins().map((p, i) => (
														<span
															key={i}
															style={{
																padding: "6px 12px",
																backgroundColor: "rgba(19, 22, 26, 0.8)",
																border: "1px solid rgba(0, 255, 170, 0.25)",
																fontSize: "0.8em",
																color: "#8a9ab0",
																transition: "all 0.2s ease",
																cursor: "default",
															}}
															onMouseEnter={(e) => {
																e.target.style.backgroundColor =
																	"rgba(0, 255, 170, 0.1)";
																e.target.style.borderColor =
																	"rgba(0, 255, 170, 0.5)";
																e.target.style.color = "#00ffaa";
															}}
															onMouseLeave={(e) => {
																e.target.style.backgroundColor =
																	"rgba(19, 22, 26, 0.8)";
																e.target.style.borderColor =
																	"rgba(0, 255, 170, 0.25)";
																e.target.style.color = "#8a9ab0";
															}}
															onClick={() => {
																handleSettingsOpen(row.id, p);
															}}
														>
															{__(p)}
														</span>
													))
												)}
											</div>
										</TableCell>
									</TableRow>

									{/* Status Row */}
									<TableRow
										style={
											status?.hasError
												? {
														backgroundColor: "rgba(255, 51, 102, 0.05)",
														borderLeft: "4px solid #ff3366",
														borderBottom: "2px solid rgba(255, 51, 102, 0.2)",
													}
												: {
														borderLeft: "4px solid rgba(0, 255, 170, 0.3)",
														borderBottom: "2px solid rgba(0, 255, 170, 0.1)",
													}
										}
										sx={{
											"&:hover": {
												backgroundColor: "rgba(0, 255, 170, 0.03)",
												borderLeft:
													"4px solid rgba(0, 255, 170, 0.6) !important",
											},
										}}
									>
										<TableCell
											colSpan={2}
											style={{
												borderBottom: "none",
													padding: isSmallMobile
														? "8px 10px 10px 10px"
														: "8px 16px 10px 16px",
											}}
										>
											<Typography
												variant="caption"
												style={{
													color: "#00ffaa",
													textTransform: "uppercase",
													fontSize: "0.75rem",
													marginBottom: "8px",
													display: "block",
													fontFamily: '"JetBrains Mono", monospace',
													letterSpacing: "0.1em",
													fontWeight: "600",
												}}
											>
												▸ {__("status")}
											</Typography>
											<Box
																			sx={{
																				display: "flex",
																				gap: isSmallMobile ? "4px" : "6px",
																				flexWrap: "wrap",
																			}}
											>
																		{(() => {
																			const visibleStatus = Object.entries(status).filter(
																				([key, value]) =>
																					!["id", "hasError", "resources", "requestCount"].includes(key) &&
																					value !== undefined &&
																					value !== null &&
																					value !== "" &&
																					value !== 0,
																			);

																			if (visibleStatus.length === 0)
																				return (
													<Box
														sx={{
															display: "flex",
															alignItems: "center",
															padding: "6px 6px",
															backgroundColor: "rgba(138, 154, 176, 0.08)",
															border: "1px solid rgba(138, 154, 176, 0.2)",
															color: "#8a9ab0",
															fontStyle: "italic",
															fontSize: "0.75rem",
														}}
													>
														No status data available
													</Box>
																				);

																			return visibleStatus.map(([key, value], index) => (
																				<Box
																					key={index}
																					sx={{
																						display: "flex",
																						flexDirection: "column",
																						alignItems: "center",
																						justifyContent: "center",
																						textAlign: "center",
																						backgroundColor: "rgba(0, 204, 255, 0.05)",
																						padding: "6px 6px",
																						border: "1px solid rgba(0, 204, 255, 0.28)",
																						// minWidth: isSmallMobile ? "68px" : "70px",
																						// minHeight: isSmallMobile ? "40px" : "42px",
																						transition: "all 0.2s ease",
																						"&:hover": {
																							backgroundColor: "rgba(0, 204, 255, 0.12)",
																							borderColor: "rgba(0, 204, 255, 0.5)",
																							transform: "translateY(-1px)",
																							boxShadow: "0 2px 8px rgba(0, 204, 255, 0.2)",
																						},
																					}}
																				>
																					<Typography
																						variant="caption"
																						style={{
																							color: "#8a9ab0",
																							fontSize: isSmallMobile ? "0.5rem" : "0.65rem",
																							textTransform: "uppercase",
																							letterSpacing: "0.06em",
																							marginBottom: "5px",
																							lineHeight: 1,
																						}}
																					>
																						{formatStatusLabel(key, __)}
																					</Typography>
																					<Typography
																						style={{
																							color: "#00ccff",
																							fontFamily: '"JetBrains Mono", monospace',
																							fontWeight: 800,
																							fontSize: isSmallMobile ? "1.04rem" : ".9rem",
																							lineHeight: 1,
																							letterSpacing: "0.02em",
																							textShadow: "0 0 10px rgba(0, 204, 255, 0.35)",
																						}}
																					>
																						{typeof value === "number"
																							? value.toLocaleString()
																							: String(value)}
																					</Typography>
																				</Box>
																			));
																		})()}
											</Box>
										</TableCell>
									</TableRow>
								</React.Fragment>
							);
						}
						return <PlayerRow key={row.id} />;
					})}
					<TableRow
						sx={{
							"&:last-child td, &:last-child th": {
								border: 0,
								backgroundColor: "#0d0f12",
							},
						}}
					>
						<TableCell align="right" padding="none" colSpan={2} />
						<TableCell align="right" padding="none">
							<Button
								variant="outlined"
								style={{
									paddingLeft: "24px",
									paddingRight: "24px",
									margin: "10px",
									borderColor: "rgba(255, 51, 102, 0.5)",
									color: "#ff3366",
									backgroundColor: "rgba(255, 51, 102, 0.05)",
								}}
								onClick={() => {
									ws.send(
										JSON.stringify([
											ErrorType.Success,
											ActionType.RemoveUser,
											rows.filter((e) => selected.includes(e.id)),
										]),
									);
								}}
							>
								X // {__("remove").toUpperCase()}
							</Button>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</TableContainer>
	);
}
export default function GGEUserTable({
	setLanguage,
	__,
	languageCode,
	rows,
	usersStatus,
	ws,
	channelInfo,
	plugins,
}) {
	const user = {};

	const [openSettings, setOpenSettings] = React.useState(false);
	const [selectedUser, setSelectedUser] = React.useState(user);
	const [openLogs, setOpenLogs] = React.useState(false);
	const [logUserId, setLogUserId] = React.useState(undefined);
	const [openResources, setOpenResources] = React.useState(false);
	const [initialPlugin, setInitialPlugin] = React.useState(undefined);

	const handleSettingsOpen = (userId, pluginKey) => {
		if (userId) {
			const user = rows.find((r) => r.id === userId);
			if (user) setSelectedUser(user);
		}
		setInitialPlugin(pluginKey);
		setOpenSettings(true);
	};
	const handleSettingsClose = () => {
		setOpenSettings(false);
		setSelectedUser(user);
		setInitialPlugin(undefined);
	};
	const handleLogClose = () => {
		setOpenLogs(false);
		setLogUserId(undefined);
	};
	const handleLogOpen = (userId) => {
		setLogUserId(userId);
		setOpenLogs(true);
	};
	const handleResourcesClose = () => setOpenResources(false);
	const handleResourcesOpen = (status) => setOpenResources(status.resources);
	return (
		<>
			<Backdrop
				sx={(theme) => ({
					backgroundColor: "rgba(13, 15, 18, 0.85)",
					backdropFilter: "blur(4px)",
					color: "#00ffaa",
					zIndex: theme.zIndex.drawer + 1,
				})}
				open={openSettings}
				onClick={handleSettingsClose}
				style={{ maxHeight: "100%", overflow: "auto" }}
				key={selectedUser.id}
			>
				<UserSettings
					ws={ws}
					selectedUser={selectedUser}
					key={selectedUser.id}
					closeBackdrop={handleSettingsClose}
					plugins={plugins}
					channels={channelInfo[1]}
					__={__}
					initialPlugin={initialPlugin}
				/>
			</Backdrop>
			<Backdrop
				sx={(theme) => ({
					backgroundColor: "rgba(13, 15, 18, 0.85)",
					backdropFilter: "blur(4px)",
					color: "#00ffaa",
					zIndex: theme.zIndex.drawer + 1,
				})}
				open={openLogs}
				onClick={() => {
					ws.send(
						JSON.stringify([ErrorType.Success, ActionType.GetLogs, undefined]),
					);

					handleLogClose();
				}}
				style={{ maxHeight: "100%", overflow: "auto" }}
			>
				<Log ws={ws} __={__} logUserId={logUserId} />
			</Backdrop>
			<Backdrop
				sx={(theme) => ({
					backgroundColor: "rgba(13, 15, 18, 0.85)",
					backdropFilter: "blur(4px)",
					color: "#00ffaa",
					zIndex: theme.zIndex.drawer + 1,
				})}
				open={openResources !== false}
				onClick={() => {
					handleResourcesClose();
				}}
				style={{ maxHeight: "100%", overflow: "auto" }}
			>
				<Resources
					usersStatus={usersStatus}
					__={__}
					openResources={openResources}
					languageCode={languageCode}
				/>
			</Backdrop>
			<PlayerTable
				setLanguage={setLanguage}
				__={__}
				languageCode={languageCode}
				rows={rows}
				usersStatus={usersStatus}
				ws={ws}
				channelInfo={channelInfo}
				handleSettingsOpen={handleSettingsOpen}
				handleLogOpen={handleLogOpen}
				handleResourcesOpen={handleResourcesOpen}
				setSelectedUser={setSelectedUser}
				setOpenSettings={setOpenSettings}
				plugins={plugins}
			/>
		</>
	);
}
