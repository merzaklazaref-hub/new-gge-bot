/*
 * Frontend plugin options table helper component.
 * - Renders all plugin options for a given user with MUI controls.
 * - Supports different input types, table, and conditional state.
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
import Checkbox from "@mui/material/Checkbox";
import Select from "@mui/material/Select";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { Container } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import dayjs from "dayjs";

const sideToggleByOptionKey = {
	leftTroopCount: "attackLeft",
	leftTroopType: "attackLeft",
	middleTroopCount: "attackMiddle",
	middleTroopType: "attackMiddle",
	rightTroopCount: "attackRight",
	rightTroopType: "attackRight",
	stormLevel: "enableStorm",
	stormTroopType: "enableStorm",
};

function PluginOption({
	pluginData,
	channels,
	userPlugins,
	plugin,
	__,
	onOptionChange,
    forceRenderValue,
}) {
	userPlugins[plugin.key] ??= {};
	const pluginValues = userPlugins[plugin.key];
	const [value, setValue] = React.useState(
		pluginValues[pluginData.key] ?? pluginData.default,
	);

	const getOptionDefaultValue = (key) =>
		plugin?.pluginOptions?.find((option) => option.key === key)?.default;

	const getOptionValue = (key) =>
		pluginValues[key] ?? getOptionDefaultValue(key);

	const sideToggleKey = pluginData.dependsOn || sideToggleByOptionKey[pluginData.key];
	const rawSideValue = sideToggleKey ? getOptionValue(sideToggleKey) : undefined;
	const isOptionDisabled = sideToggleKey
		? rawSideValue === false || rawSideValue === "false" || rawSideValue === 0 || rawSideValue === "0" || rawSideValue === ""
		: false;

	const onChange = (value) => {
		pluginValues[pluginData.key] = value;
		setValue(value);
		onOptionChange?.();
	};
	const optionLabel = __(pluginData.label ?? pluginData.key);
	switch (pluginData.type) {
		case "":
			return <></>;
		case "Label":
			return (
				<Typography
					variant="subtitle2"
					sx={{
						width: "100%",
						borderBottom: "1px solid rgba(0, 204, 255, 0.3)",
						pb: 0.2,
						mb: 0.2,
						color: "#00ccff",
						mt: 0.5,
						fontWeight: "bold",
						textTransform: "uppercase",
						fontSize: "0.7rem",
						fontFamily: '"JetBrains Mono", monospace',
					}}
				>
					{"//"} {optionLabel}
				</Typography>
			);
		case "Text": {
			const placeholder = pluginData.placeholder
				? __(pluginData.placeholder)
				: undefined;
			const helperText = pluginData.hint ? __(pluginData.hint) : undefined;
			return (
				<TextField
					fullWidth
					label={optionLabel}
					variant="outlined"
					size="small"
					placeholder={placeholder}
					helperText={helperText}
					value={__(value)}
					disabled={isOptionDisabled}
					onChange={(e) => onChange(e.target.value)}
					sx={{
						"& .MuiInputBase-root": {
							fontSize: "0.75rem",
							fontFamily: '"JetBrains Mono", monospace',
						},
						"& .MuiInputLabel-root": { fontSize: "0.75rem", color: "#8a9ab0" },
						my: 0.5,
					}}
				/>
			);
		}
		case "Checkbox": {
			const isChecked = value === true || value === "true" || value === 1 || value === "1";
			return (
				<FormControlLabel
					control={
						<Checkbox
							size="small"
							sx={{
								p: 0.5,
								color: "rgba(0, 255, 170, 0.5)",
								"&.Mui-checked": { color: "#00ffaa" },
							}}
						/>
					}
					label={
						<Typography
							variant="body2"
							sx={{
								fontSize: "0.75rem",
								fontFamily: '"JetBrains Mono", monospace',
								color: isOptionDisabled ? "#555" : "#c9d1df",
							}}
						>
							{pluginData.hideText ? "" : optionLabel}
						</Typography>
					}
					checked={isChecked}
					onChange={(_, newValue) => onChange(newValue)}
					sx={{
						mr: 1,
						ml: 0,
						"& .MuiFormControlLabel-label": {
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						},
					}}
				/>
			);
		}
		case "Table": {
			const array_chunks = (array, chunk_size) =>
				Array(Math.ceil(array.length / chunk_size))
					.fill()
					.map((_, index) => index * chunk_size)
					.map((begin) => array.slice(begin, begin + chunk_size));
			return (
				<TableContainer
					component={Paper}
					elevation={0}
					sx={{
						bgcolor: "rgba(0, 255, 170, 0.02)",
						mt: 0.5,
						border: "1px solid rgba(0, 255, 170, 0.2)",
						borderRadius: 0,
					}}
				>
					<Table aria-label="simple table" size="small" stickyHeader>
						<TableHead>
							<TableRow>
								{pluginData.row.map((cRow, i) => (
									<TableCell
										key={i}
										sx={{
											fontSize: "0.7rem",
											fontWeight: "bold",
											color: "#00ffaa",
											bgcolor: "#13161a",
											py: 0.5,
											borderBottom: "1px solid rgba(0,255,170,0.3)",
										}}
									>
										{cRow}
									</TableCell>
								))}
							</TableRow>
						</TableHead>
						<TableBody>
							{array_chunks(pluginData.data, pluginData.row.length).map(
								(e, i) => (
									<TableRow key={i}>
										{e.map((pluginData, j) => (
											<TableCell key={j} sx={{ py: 0.5 }}>
												<PluginOption
													pluginData={pluginData}
													channels={channels}
													userPlugins={(userPlugins[plugin.key] ??= {})}
													__={__}
													plugin={{ key: i }}
													onOptionChange={onOptionChange}
                                                    forceRenderValue={forceRenderValue}
												/>
											</TableCell>
										))}
									</TableRow>
								),
							)}
						</TableBody>
					</Table>
				</TableContainer>
			);
		}
		case "Channel":
			return (
				<FormControl fullWidth size="small" sx={{ my: 0.5 }}>
					<InputLabel sx={{ fontSize: "0.75rem" }}>{optionLabel}</InputLabel>
					<Select
						value={value}
						label={pluginData.label ?? pluginData.key}
						onChange={(newValue) => onChange(newValue.target.value)}
						sx={{ fontSize: "0.75rem" }}
						disabled={isOptionDisabled}
					>
						{channels?.map((channel, i) => (
							<MenuItem value={channel.id} key={i} sx={{ fontSize: "0.75rem" }}>
								{channel.name}
							</MenuItem>
						))}
					</Select>
				</FormControl>
			);
		case "Select": {
			const hasValueLabel =
				pluginData.selection?.[0] &&
				typeof pluginData.selection[0] === "object" &&
				!Array.isArray(pluginData.selection[0]);
			const selectValue = value === null || value === undefined ? "" : value;
			return (
				<FormControl fullWidth size="small" sx={{ my: 0.5 }}>
					<InputLabel sx={{ fontSize: "0.75rem" }}>{optionLabel}</InputLabel>
					<Select
						value={selectValue}
						label={pluginData.label ?? pluginData.key}
						onChange={(newValue) => onChange(newValue.target.value)}
						sx={{ fontSize: "0.75rem" }}
						disabled={isOptionDisabled}
					>
						{pluginData.selection.map((e, i) => (
							<MenuItem
								value={hasValueLabel ? e.value : String(i)}
								key={i}
								sx={{ fontSize: "0.75rem" }}
							>
								{hasValueLabel ? e.label : e}
							</MenuItem>
						))}
					</Select>
				</FormControl>
			);
		}
		case "MultiSelect": {
			const hasValueLabelMulti =
				pluginData.selection?.[0] &&
				typeof pluginData.selection[0] === "object" &&
				!Array.isArray(pluginData.selection[0]);
			const multiValue = Array.isArray(value)
				? value
				: value == null || value === ""
					? []
					: [value];
			const optionValueOfMulti = (option) =>
				hasValueLabelMulti
					? option.value
					: String(pluginData.selection.indexOf(option));
			const optionLabelOfMulti = (option) =>
				hasValueLabelMulti ? option.label : option;
			const selectedLabelMulti = (selectedValue) => {
				const selectedOption = pluginData.selection.find(
					(option) => optionValueOfMulti(option) === selectedValue,
				);
				return selectedOption
					? optionLabelOfMulti(selectedOption)
					: selectedValue;
			};

			return (
				<FormControl fullWidth size="small" sx={{ my: 0.5 }}>
					<InputLabel sx={{ fontSize: "0.75rem" }}>{optionLabel}</InputLabel>
					<Select
						multiple
						value={multiValue}
						disabled={isOptionDisabled}
						label={pluginData.label ?? pluginData.key}
						onChange={(newValue) => {
							const nextValue = newValue.target.value;
							onChange(
								typeof nextValue === "string"
									? nextValue.split(",")
									: nextValue,
							);
						}}
						renderValue={(selected) =>
							selected.map(selectedLabelMulti).join(", ")
						}
						sx={{ fontSize: "0.75rem" }}
					>
						{pluginData.selection.map((e, i) => {
							const optionValue = hasValueLabelMulti ? e.value : String(i);
							return (
								<MenuItem
									value={optionValue}
									key={i}
									sx={{ fontSize: "0.75rem" }}
								>
									<Checkbox
										size="small"
										checked={multiValue.includes(optionValue)}
										sx={{ p: 0.5, mr: 0.75 }}
									/>
									{hasValueLabelMulti ? e.label : e}
								</MenuItem>
							);
						})}
					</Select>
				</FormControl>
			);
		}
		case "Slider":
			return (
				<Box
					sx={{ display: "flex", alignItems: "center", width: "100%", my: 0.5 }}
				>
					<Typography variant="body2" sx={{ mr: 1, fontSize: "0.75rem" }}>
						{optionLabel}
					</Typography>
					<Slider
						size="small"
						sx={{ flexGrow: 1 }}
						value={value}
						onChange={(_, newValue) => onChange(newValue)}
					/>
					<Typography
						variant="body2"
						sx={{ ml: 1, minWidth: "25px", fontSize: "0.75rem" }}
					>{`${value}%`}</Typography>
				</Box>
			);
		case "Time":
			return (
				<LocalizationProvider dateAdapter={AdapterDayjs}>
					<TimePicker
						label={optionLabel}
						value={dayjs(value) ?? dayjs()}
						onChange={onChange}
					/>
				</LocalizationProvider>
			);
		default:
			return null;
	}
}
const PluginOptionContainer = ({ plugin, channels, userPlugins, __ }) => {
	const [forceRenderValue, forceRender] = React.useState(0);
	const onOptionChange = () => {
		forceRender((current) => current + 1);
	};

	const optionRows = [];
	for (let index = 0; index < (plugin?.pluginOptions?.length ?? 0); index++) {
		const pluginData = plugin.pluginOptions[index];
		const nextPluginData = plugin.pluginOptions[index + 1];

		if (
			nextPluginData?.inlineWithPrevious === true &&
			nextPluginData.type === "Checkbox"
		) {
			optionRows.push(
				<Box
					key={`${plugin.key} ${index}`}
					sx={{
						display: "flex",
						alignItems: "center",
						gap: 1,
						width: "100%",
					}}
				>
					<Box sx={{ flex: 1, minWidth: 0 }}>
						<PluginOption
							pluginData={pluginData}
							key={`${plugin.key} ${index} left`}
							channels={channels}
							userPlugins={userPlugins}
							__={__}
							plugin={plugin}
							onOptionChange={onOptionChange}
                            forceRenderValue={forceRenderValue}
						/>
					</Box>
					<Box
						sx={{
							flexShrink: 0,
							minWidth: "150px",
							display: "flex",
							justifyContent: "flex-end",
							mt: 0.5,
						}}
					>
						<PluginOption
							pluginData={nextPluginData}
							key={`${plugin.key} ${index} right`}
							channels={channels}
							userPlugins={userPlugins}
							__={__}
							plugin={plugin}
							onOptionChange={onOptionChange}
                            forceRenderValue={forceRenderValue}
						/>
					</Box>
				</Box>,
			);

			index += 1;
			continue;
		}

		if (pluginData?.inlineWithPrevious === true) continue;

		optionRows.push(
			<PluginOption
				pluginData={pluginData}
				key={`${plugin.key} ${index}`}
				channels={channels}
				userPlugins={userPlugins}
				__={__}
				plugin={plugin}
				onOptionChange={onOptionChange}
                forceRenderValue={forceRenderValue}
			/>,
		);
	}

	return (
		<>
			<Typography
				sx={{
					width: "100%",
					pb: 0.2,
					mb: 0.2,
					mt: 0.5,
					fontWeight: "bold",
					fontSize: "0.85rem",
					color: "#00ccff",
					fontFamily: '"JetBrains Mono", monospace',
					textTransform: "uppercase",
					borderBottom: "1px dotted rgba(0, 204, 255, 0.3)",
				}}
			>
				{">_ " + __(plugin.key)}
			</Typography>
			{optionRows}
		</>
	);
};
function Plugin({
	plugin,
	__,
	userPlugins,
	selectedPlugin,
	setSelectedPlugin,
	forwardedRef,
}) {
	userPlugins[plugin.key] ??= {};
	const [state, setState] = React.useState(userPlugins[plugin.key].state);
	function onClick() {
		if (plugin.pluginOptions?.length > 0) setSelectedPlugin(plugin);
	}
	return (
		<TableRow
			ref={forwardedRef}
			sx={
				plugin !== selectedPlugin
					? {
							borderBottom: "1px solid rgba(0, 255, 170, 0.1)",
							"&:hover": {
								backgroundColor: "rgba(0, 255, 170, 0.05)",
							},
							cursor: "pointer",
						}
					: {
							backgroundColor: "rgba(0, 204, 255, 0.15)",
							borderLeft: "3px solid #00ccff",
							cursor: "pointer",
						}
			}
		>
			<TableCell
				onClick={onClick}
				sx={{
					fontWeight: "bold",
					color: plugin === selectedPlugin ? "#00ccff" : "#e0e6ed",
					borderBottom: "none",
				}}
			>
				{__(plugin.key)}
			</TableCell>
			<TableCell align="right" sx={{ borderBottom: "none" }}>
				{!plugin.force ? (
					<Button
						variant={state ? "contained" : "outlined"}
						size="small"
						sx={{
							minWidth: "70px",
							height: "28px",
							fontSize: "0.75rem",
							backgroundColor: state
								? "rgba(255, 51, 102, 0.1)"
								: "rgba(0, 255, 170, 0.05)",
							color: state ? "#ff3366" : "#00ffaa",
							borderColor: state ? "#ff3366" : "#00ffaa",
						}}
						onClick={() => {
							setState(!state);
							userPlugins[plugin.key].state = !state;
						}}
					>
						{__(state ? "stop" : "start")}
					</Button>
				) : (
					<Button
						size="small"
						sx={{ minWidth: "70px", height: "28px", fontSize: "0.75rem" }}
						disabled
					/>
				)}
			</TableCell>
		</TableRow>
	);
}
export default function PluginsTable({
	__,
	userPlugins,
	plugins,
	channels,
	initialPlugin,
}) {
	const [selectedPlugin, setSelectedPlugin] = React.useState(undefined); //, maxHeight: "40vh"
	const isMobile = useMediaQuery("(max-width:900px)");
	const pluginRefs = React.useRef({});

	React.useEffect(() => {
		if (initialPlugin) {
			const plugin = plugins.find((p) => p.key === initialPlugin);
			if (plugin) {
				setSelectedPlugin(plugin);
				setTimeout(() => {
					pluginRefs.current[initialPlugin]?.scrollIntoView({
						behavior: "smooth",
						block: "nearest",
					});
				}, 100);
			}
		}
	}, [initialPlugin, plugins]);

	return (
		<Paper
			elevation={0}
			style={{
				minHeight: isMobile ? "38vh" : "45vh",
				maxHeight: isMobile ? "62vh" : "65vh",
				backgroundColor: "#0d0f12",
				border: "1px solid rgba(0, 255, 170, 0.3)",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<TableContainer
				sx={{
					scrollbarColor: "#00ffaa #0d0f12",
					maxHeight: isMobile ? "24vh" : "30vh",
					overflowY: "auto",
					flex: "0 0 auto",
					borderBottom: "1px dashed rgba(0, 255, 170, 0.3)",
				}}
			>
				<Table aria-label="plugins table" size="small">
					<TableBody>
						{plugins
							.sort((a, b) => a.key.localeCompare(b.key))
							.map((plugin, index) => (
								<Plugin
									plugin={plugin}
									key={index}
									userPlugins={userPlugins}
									__={__}
									selectedPlugin={selectedPlugin}
									setSelectedPlugin={setSelectedPlugin}
									forwardedRef={(el) => (pluginRefs.current[plugin.key] = el)}
								/>
							))}
					</TableBody>
				</Table>
			</TableContainer>
			<Container
				sx={{
					scrollbarColor: "#00ccff #0d0f12",
					minWidth: "100%",
					minHeight: isMobile ? "20vh" : "28vh",
					maxHeight: isMobile ? "34vh" : "35vh",
					overflowY: "auto",
					flex: "1 1 auto",
					backgroundColor: "rgba(0, 204, 255, 0.02)",
					padding: isMobile ? "10px" : "16px",
				}}
			>
				{selectedPlugin ? (
					<PluginOptionContainer
						userPlugins={userPlugins}
						channels={channels}
						__={__}
						plugin={selectedPlugin}
					/>
				) : (
					<Typography
						sx={{
							color: "#8a9ab0",
							textAlign: "center",
							mt: 4,
							fontFamily: '"JetBrains Mono", monospace',
							fontStyle: "italic",
						}}
					>
						{"// SELECT A PLUGIN TO CONFIGURE"}
					</Typography>
				)}
			</Container>
		</Paper>
	);
}
