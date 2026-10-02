/*
 * Frontend user setting pane.
 * - Defines user details and plugin-specific options.
 * - Interacts with app websocket and manages user save/remove actions.
 */
import * as React from "react";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";

import { ErrorType, ActionType } from "../types.js";
import PluginsTable from "./pluginsTable";
import settings from "../settings.json";

const servers = new DOMParser().parseFromString(
	await (
		await fetch(
			`${window.location.protocol === "https:" ? "https" : "http"}://${window.location.hostname}:${settings.port ?? window.location.port}/1.xml`,
		)
	).text(),
	"text/xml",
);
const instances = [];
const _instances = servers.getElementsByTagName("instance");

for (var key in _instances) {
	const obj = _instances[key];

	let server, zone, instanceLocaId, instanceName;

	for (var key2 in obj.childNodes) {
		const obj2 = obj.childNodes[key2];

		switch (obj2.nodeName) {
			case "server":
				server = obj2.childNodes[0].nodeValue;
				break;
			case "zone":
				zone = obj2.childNodes[0].nodeValue;
				break;
			case "instanceLocaId":
				instanceLocaId = obj2.childNodes[0].nodeValue;
				break;
			case "instanceName":
				instanceName = obj2.childNodes[0].nodeValue;
				break;
			default:
		}
	}
	if (instanceLocaId)
		instances.push({
			id: obj.getAttribute("value"),
			server,
			zone,
			instanceLocaId,
			instanceName,
		});
}

export default function UserSettings({
	__,
	selectedUser,
	channels,
	plugins,
	ws,
	closeBackdrop,
	initialPlugin,
}) {
	const isMobile = useMediaQuery("(max-width:900px)");
	selectedUser.name ??= "";
	selectedUser.plugins ??= {};
	const isNewUser = selectedUser.name === "";
	const [name, setName] = React.useState(selectedUser.name);
	const [pass, setPass] = React.useState("");
	const [server, setServer] = React.useState(
		selectedUser.server ?? instances[0].id,
	);
	const [externalEvent, setExternalEvent] = React.useState(
		selectedUser.externalEvent,
	);
	const [showCredentials, setShowCredentials] = React.useState(isNewUser);

	return (
		<div
			onClick={(event) => event.stopPropagation()}
			style={{ width: isMobile ? "96vw" : "max-content", maxWidth: "100%" }}
		>
			<Paper
				sx={{
					height: "92dvh",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					width: isMobile ? "96vw" : "85vw",
					maxWidth: "1400px",
					border: "2px solid rgba(0, 255, 170, 0.6)",
					boxShadow:
						"0 0 50px rgba(0, 255, 170, 0.15), inset 0 0 30px rgba(0, 255, 170, 0.03)",
					backgroundColor: "#0d0f12",
					borderRadius: 0,
				}}
			>
				<div
					style={{
						padding: "8px 16px",
						backgroundColor: "#13161a",
						borderBottom: "1px solid rgba(0, 255, 170, 0.3)",
						color: "#00ffaa",
						fontFamily: '"JetBrains Mono", monospace',
						fontSize: "14px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "8px",
						flexShrink: 0,
					}}
				>
					<span style={{ wordBreak: "break-word" }}>
						{isNewUser ? "[INIT_NEW_USER]" : "[CONFIG_USER]"}
						{" // "}
						{name || "NULL"}
					</span>
					<Button
						onClick={closeBackdrop}
						style={{
							minWidth: "30px",
							color: "#ff3366",
							padding: "0",
							fontSize: "1.2rem",
						}}
					>
						x
					</Button>
				</div>
				<Box
					sx={{
							p: isMobile ? 1.25 : 2,
						flexGrow: 1,
						overflowY: "auto",
						minHeight: 0,
						"&::-webkit-scrollbar": {
							width: "10px",
						},
						"&::-webkit-scrollbar-track": {
							background: "rgba(0, 0, 0, 0.3)",
							borderLeft: "1px solid rgba(0, 255, 170, 0.2)",
						},
						"&::-webkit-scrollbar-thumb": {
							background: "rgba(0, 255, 170, 0.4)",
							border: "1px solid rgba(0, 255, 170, 0.6)",
						},
						"&::-webkit-scrollbar-thumb:hover": {
							background: "rgba(0, 255, 170, 0.6)",
						},
					}}
				>
					{/* Collapsible Credentials Section */}
					<Box sx={{ mb: 2 }}>
						<Button
							onClick={() => setShowCredentials(!showCredentials)}
							variant="outlined"
							size="small"
							sx={{
								mb: showCredentials ? 1.5 : 0,
								textTransform: "none",
								color: "#00ffaa",
								borderColor: "rgba(0, 255, 170, 0.3)",
								fontSize: "0.8rem",
								"&:hover": {
									borderColor: "rgba(0, 255, 170, 0.6)",
									backgroundColor: "rgba(0, 255, 170, 0.05)",
								},
							}}
						>
							{showCredentials ? "▼" : "▶"} Account Credentials
						</Button>
						{showCredentials && (
							<FormGroup
								row={!isMobile}
								sx={{
									gap: 1.5,
									flexWrap: "wrap",
									flexDirection: isMobile ? "column" : "row",
									alignItems: isMobile ? "stretch" : "flex-end",
								}}
							>
								<TextField
									required
									size="small"
									label={__("username")}
									value={name}
									onChange={(e) => setName(e.target.value)}
									disabled={!isNewUser}
									sx={{
										flex: "1 1 150px",
										minWidth: isMobile ? "100%" : "120px",
										maxWidth: isMobile ? "100%" : "200px",
										"& .MuiInputBase-input": {
											color: "#00ffaa",
											fontSize: "0.85rem",
											padding: "6px 8px",
										},
										"& .MuiInputLabel-root": {
											fontSize: "0.8rem",
										},
									}}
								/>
								<TextField
									required
									size="small"
									label={__("password")}
									type="password"
									value={pass}
									onChange={(e) => setPass(e.target.value)}
									sx={{
										flex: "1 1 150px",
										minWidth: isMobile ? "100%" : "120px",
										maxWidth: isMobile ? "100%" : "200px",
										"& .MuiInputBase-input": {
											fontSize: "0.85rem",
											padding: "6px 8px",
										},
										"& .MuiInputLabel-root": {
											fontSize: "0.8rem",
										},
									}}
								/>

								<FormControl
									size="small"
									sx={{
										flex: "1 1 180px",
										minWidth: isMobile ? "100%" : "150px",
										maxWidth: isMobile ? "100%" : "250px",
										"& .MuiInputBase-root": {
											fontSize: "0.85rem",
										},
										"& .MuiInputLabel-root": {
											fontSize: "0.8rem",
										},
									}}
								>
									<InputLabel
										required
										id="simple-select-label"
										sx={{ color: "#8a9ab0" }}
									>
										{__("server")}
									</InputLabel>
									<Select
										labelId="simple-select-label"
										id="simple-select"
										value={server}
										onChange={(newValue) => setServer(newValue.target.value)}
										sx={{
											color: "#00ccff",
											"& .MuiOutlinedInput-notchedOutline": {
												borderColor: "rgba(0, 204, 255, 0.3)",
											},
										}}
									>
										{instances.map((server, i) => (
											<MenuItem value={server.id} key={i}>
												{__(server.instanceLocaId) + " " + server.instanceName}
											</MenuItem>
										))}
									</Select>
								</FormControl>
								<FormControlLabel
									sx={{
										m: 0,
										width: isMobile ? "100%" : "auto",
										color: "#00ffaa",
										"& .MuiTypography-root": {
											fontSize: "0.85rem",
										},
									}}
									control={
										<Checkbox
											checked={externalEvent}
											onChange={(event) => {
												setExternalEvent(event.target.checked);
											}}
											sx={{
												color: "rgba(0, 255, 170, 0.4)",
												"&.Mui-checked": {
													color: "#00ffaa",
												},
												"& .MuiSvgIcon-root": {
													fontSize: "1.2rem",
												},
											}}
										/>
									}
									label={__("OR/BTH")}
								/>
							</FormGroup>
						)}
					</Box>

					<div
						style={{
							padding: "6px 0",
							marginBottom: "12px",
							borderBottom: "1px dashed rgba(0, 255, 170, 0.2)",
							color: "#8a9ab0",
							fontFamily: '"JetBrains Mono", monospace',
							fontSize: "12px",
						}}
					>
						{">"} CONFIGURE_PLUGINS
					</div>
					<PluginsTable
						plugins={plugins}
						userPlugins={selectedUser.plugins}
						channels={channels}
						__={__}
						initialPlugin={initialPlugin}
					/>
				</Box>

				<Box
					sx={{
						p: 1.5,
						borderTop: "1px solid rgba(0, 255, 170, 0.3)",
						display: "flex",
						justifyContent: isMobile ? "stretch" : "flex-end",
						bgcolor: "#13161a",
						flexShrink: 0,
					}}
				>
					<Button
						variant="contained"
						color="primary"
						size="small"
						style={{
							padding: "6px 20px",
							letterSpacing: "2px",
							width: isMobile ? "100%" : "auto",
							backgroundColor: "rgba(0, 255, 170, 0.15)",
							color: "#00ffaa",
							border: "1px solid #00ffaa",
							fontSize: "0.85rem",
						}}
						onClick={async () => {
							for (const key in selectedUser.plugins) {
								if (Object.keys(selectedUser.plugins[key]).length === 0)
									delete selectedUser.plugins[key];
							}
							const obj = {
								name: name,
								pass: pass,
								server: server,
								plugins: selectedUser.plugins,
								externalEvent: externalEvent,
								state: selectedUser.state,
							};
							if (!isNewUser) {
								obj.id = selectedUser.id;
								if (pass === "") obj.pass = selectedUser.pass;
							}

							ws.send(
								JSON.stringify([
									ErrorType.Success,
									isNewUser ? ActionType.AddUser : ActionType.SetUser,
									obj,
								]),
							);

							closeBackdrop();
						}}
					>
						{__("save")}
					</Button>
				</Box>
			</Paper>
		</div>
	);
}
