addEventListener("DOMContentLoaded", () =>
	document.getElementById("login-form").addEventListener("submit", login),
);

async function login(event) {
	event.preventDefault();

	let loginFormElement = document.getElementById("login-form");

	let emailOrName = loginFormElement.querySelector("#email_name").value;
	let password = loginFormElement.querySelector("#password").value;
	let loginInfoBannerElement =
		loginFormElement.querySelector("#login-info-banner");
	let isChecked = loginFormElement.querySelector("#remember-password").checked;

	loginInfoBannerElement.innerHTML = "";
	if (emailOrName.length === 0 || password.length === 0) {
		loginInfoBannerElement.innerHTML =
			"The credentials that you provided were invalid";
		return false;
	}

	let json = await (
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
	).json(); //Ugly! FUCK THIS SHIT WHO WHY...

	switch (Number(json.id)) {
		case 0: //Logged in
			if (json.r != 0) {
				loginInfoBannerElement.innerHTML = json.error;
				return false;
			}
			if (!isChecked) document.cookie = `uuid=${json.uuid}`;
			else document.cookie = `uuid=${json.uuid};max-age=31536000`;

			window.location.replace("/index.html");
	}
	return false;
}
