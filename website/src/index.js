import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { CookiesProvider } from "react-cookie";

ReactDOM.createRoot(document.getElementById("root")).render(
	// <React.StrictMode>
	<CookiesProvider defaultSetOptions={{ path: "/" }}>
		<App />
	</CookiesProvider>,
	// </React.StrictMode>
);
