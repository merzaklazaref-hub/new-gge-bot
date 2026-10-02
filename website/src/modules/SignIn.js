/*
 * Frontend SignIn page component.
 * - Handles username/password login API flow and error display.
 * - Uses Material UI theme and includes animated grid background.
 */
import React, { useState } from "react";
import {
	Container,
	Paper,
	TextField,
	Button,
	FormControlLabel,
	Checkbox,
	Typography,
	Box,
	Link,
	Alert,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";

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
	},
	typography: {
		fontFamily: '"JetBrains Mono", -apple-system, sans-serif',
		h1: {
			fontFamily: '"JetBrains Mono", monospace',
			textTransform: "uppercase",
			letterSpacing: "0.05em",
		},
		button: {
			fontFamily: '"JetBrains Mono", monospace',
			letterSpacing: "0.1em",
		},
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
			},
		},
		MuiTextField: {
			styleOverrides: {
				root: {
					"& .MuiOutlinedInput-root": {
						borderColor: "rgba(0, 255, 170, 0.3)",
					},
				},
			},
		},
	},
});

export default function SignIn() {
	const [emailOrName, setEmailOrName] = useState("");
	const [password, setPassword] = useState("");
	const [rememberPassword, setRememberPassword] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (event) => {
		event.preventDefault();
		setError("");
		setLoading(true);

		try {
			if (emailOrName.length === 0 || password.length === 0) {
				setError("The credentials that you provided were invalid");
				setLoading(false);
				return;
			}

			const json = await (
				await fetch(
					`${location.protocol === "https:" ? "https" : "http"}://${window.location.hostname}:${location.port}/api`,
					{
						method: "POST",
						body: JSON.stringify({
							id: 0,
							email_name: emailOrName,
							password: password,
						}),
						headers: {
							"Content-type": "application/json; charset=UTF-8",
						},
					},
				)
			).json();

			if (Number(json.id) === 0) {
				if (json.r !== 0) {
					setError(json.error || "Login failed");
					setLoading(false);
					return;
				}

				if (!rememberPassword) {
					document.cookie = `uuid=${json.uuid}`;
				} else {
					document.cookie = `uuid=${json.uuid};max-age=31536000`;
				}

				window.location.replace("/index.html");
			}
		} catch (e) {
			setError("Failed to connect to server");
			setLoading(false);
		}
	};

	return (
		<ThemeProvider theme={darkTheme}>
			<Box
				sx={{
					minHeight: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "linear-gradient(135deg, #0d0f12 0%, #13161a 100%)",
					position: "relative",
					overflow: "hidden",
				}}
			>
				{/* Cyber grid background effect */}
				<Box
					sx={{
						position: "absolute",
						inset: 0,
						backgroundImage: `
              linear-gradient(0deg, transparent 24%, rgba(0, 255, 170, 0.05) 25%, rgba(0, 255, 170, 0.05) 26%, transparent 27%, transparent 74%, rgba(0, 255, 170, 0.05) 75%, rgba(0, 255, 170, 0.05) 76%, transparent 77%, transparent),
              linear-gradient(90deg, transparent 24%, rgba(0, 255, 170, 0.05) 25%, rgba(0, 255, 170, 0.05) 26%, transparent 27%, transparent 74%, rgba(0, 255, 170, 0.05) 75%, rgba(0, 255, 170, 0.05) 76%, transparent 77%, transparent)
            `,
						backgroundSize: "50px 50px",
						pointerEvents: "none",
					}}
				/>

				<Container maxWidth="sm" sx={{ position: "relative", zIndex: 1 }}>
					<Paper
						elevation={0}
						sx={{
							p: 4,
							background: "rgba(19, 22, 26, 0.8)",
							border: "2px solid rgba(0, 255, 170, 0.3)",
							boxShadow: "0 0 30px rgba(0, 255, 170, 0.1)",
							borderRadius: 0,
						}}
					>
						{/* Sign Up Link */}
						<Box
							sx={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								mb: 3,
							}}
						>
							<Typography
								variant="h5"
								sx={{ fontWeight: "bold", color: "#00ffaa" }}
							>
								SIGN IN
							</Typography>
							<Link
								href="/signup.html"
								sx={{
									color: "#00ffaa",
									textDecoration: "none",
									fontSize: "0.9rem",
									fontFamily: '"JetBrains Mono", monospace',
									"&:hover": { textDecoration: "underline", color: "#00cc88" },
								}}
							>
								Sign Up
							</Link>
						</Box>

						{/* Logo */}
						<Box sx={{ textAlign: "center", mb: 3 }}>
							<img
								src="/logo192.png"
								alt="Logo"
								style={{ width: "80px", height: "80px", borderRadius: "8px" }}
							/>
						</Box>

						{/* Error Message */}
						{error && (
							<Alert
								severity="error"
								sx={{
									mb: 2,
									bgcolor: "rgba(255, 51, 102, 0.1)",
									color: "#ff3366",
								}}
							>
								{error}
							</Alert>
						)}

						{/* Login Form */}
						<form onSubmit={handleSubmit}>
							<TextField
								fullWidth
								label="Username or Email"
								type="text"
								value={emailOrName}
								onChange={(e) => setEmailOrName(e.target.value)}
								margin="normal"
								variant="outlined"
								sx={{
									"& .MuiOutlinedInput-root": {
										borderColor: "rgba(0, 255, 170, 0.3)",
										"&:hover fieldset": {
											borderColor: "rgba(0, 255, 170, 0.5)",
										},
										"&.Mui-focused fieldset": {
											borderColor: "#00ffaa",
										},
									},
									"& .MuiInputLabel-root": {
										color: "#8a9ab0",
										fontFamily: '"JetBrains Mono", monospace',
									},
								}}
							/>

							<TextField
								fullWidth
								label="Password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								margin="normal"
								variant="outlined"
								sx={{
									"& .MuiOutlinedInput-root": {
										borderColor: "rgba(0, 255, 170, 0.3)",
										"&:hover fieldset": {
											borderColor: "rgba(0, 255, 170, 0.5)",
										},
										"&.Mui-focused fieldset": {
											borderColor: "#00ffaa",
										},
									},
									"& .MuiInputLabel-root": {
										color: "#8a9ab0",
										fontFamily: '"JetBrains Mono", monospace',
									},
								}}
							/>

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
											fontSize: "0.85rem",
											fontFamily: '"JetBrains Mono", monospace',
											color: "#c9d1df",
										}}
									>
										Remember Password
									</Typography>
								}
								sx={{ my: 1.5 }}
								checked={rememberPassword}
								onChange={(e) => setRememberPassword(e.target.checked)}
							/>

							<Button
								fullWidth
								variant="contained"
								type="submit"
								disabled={loading}
								sx={{
									mt: 2,
									py: 1.5,
									fontSize: "0.95rem",
									fontWeight: "bold",
									background: loading
										? "rgba(0, 255, 170, 0.05)"
										: "rgba(0, 255, 170, 0.1)",
									color: "#00ffaa",
									border: "1px solid rgba(0, 255, 170, 0.3)",
									"&:hover": {
										background: "rgba(0, 255, 170, 0.2)",
									},
									"&:disabled": {
										color: "#8a9ab0",
									},
								}}
							>
								{loading ? "LOGGING IN..." : "LOGIN"}
							</Button>
						</form>

						{/* Footer Links */}
						<Box
							sx={{
								display: "flex",
								justifyContent: "space-between",
								mt: 3,
								pt: 2,
								borderTop: "1px solid rgba(0, 255, 170, 0.2)",
							}}
						>
							<Link
								href="/signup.html"
								sx={{
									color: "#8a9ab0",
									textDecoration: "none",
									fontSize: "0.85rem",
									fontFamily: '"JetBrains Mono", monospace',
									"&:hover": { color: "#00ffaa" },
								}}
							>
								Forgot Password
							</Link>
							<Link
								href="/privacypolicy.html"
								sx={{
									color: "#8a9ab0",
									textDecoration: "none",
									fontSize: "0.85rem",
									fontFamily: '"JetBrains Mono", monospace',
									"&:hover": { color: "#00ffaa" },
								}}
							>
								Privacy Policy
							</Link>
						</Box>
					</Paper>
				</Container>
			</Box>
		</ThemeProvider>
	);
}
