// An emulated Clerk Frontend API for headless tests of the REAL vendored SDK (web/vendor/clerk/clerk.mjs): Playwright routes answer the
// requests clerk-js 6.39.0 makes for a development instance (environment, client, a Google sign-in attempt, session touch and tokens,
// sign-out) and stand in for Google, which "signs the person in" and sends the page back to the sign-in's redirect_url. The shapes follow
// FAPI's JSON (snake_case resources wrapped in {response, client}); only what the SDK reads is filled in. Nothing leaves the machine.
//   const fapi = await emulateFapi(context, { origin, host })   // fapi.log: [[method, path, body]...]; fapi.unhandled: the paths it had no answer for
//   fapi.setNewUser(true)                                        // the next "Google" sign-in is a first one: Clerk transfers it to a sign-up
export async function emulateFapi(ctx, { origin: ORIGIN, host: HOST }) {
	const now = Date.now()
	const env = {
		object: "environment", id: "env_1",
		auth_config: { object: "auth_config", id: "aac_1", single_session_mode: true, claimed_at: null, reverification: false, preferred_channels: {} },
		display_config: { object: "display_config", id: "display_config_1", instance_environment_type: "development", application_name: "Physics Sandbox", branded: false, home_url: ORIGIN, sign_in_url: `https://accounts.example.test/sign-in`, sign_up_url: `https://accounts.example.test/sign-up`, user_profile_url: "https://accounts.example.test/user", after_sign_in_url: ORIGIN, after_sign_up_url: ORIGIN, after_sign_out_one_url: ORIGIN, after_sign_out_all_url: ORIGIN, after_switch_session_url: ORIGIN, organization_profile_url: "", create_organization_url: "", after_leave_organization_url: "", after_create_organization_url: "", logo_image_url: "", favicon_image_url: "", theme: {}, preferred_sign_in_strategy: "otp", captcha_public_key: null, captcha_widget_type: null, captcha_provider: null, captcha_public_key_invisible: null, captcha_oauth_bypass: [], support_email: null, clerk_js_version: null, show_devmode_warning: true, terms_url: null, privacy_policy_url: null, waitlist_url: "", after_join_waitlist_url: "", google_one_tap_client_id: null },
		user_settings: {
			attributes: { email_address: { enabled: true, required: true, used_for_first_factor: true, first_factors: ["email_code"], used_for_second_factor: false, second_factors: [], verifications: ["email_code"], verify_at_sign_up: true }, password: { enabled: false, required: false, used_for_first_factor: false, first_factors: [], used_for_second_factor: false, second_factors: [], verifications: [], verify_at_sign_up: false } },
			social: { oauth_google: { enabled: true, required: false, authenticatable: true, block_email_subaddresses: false, strategy: "oauth_google", not_selectable: false, deprecated: false, name: "Google", logo_url: "" } },
			saml: { enabled: false }, enterprise_sso: { enabled: false },
			sign_in: { second_factor: { required: false } },
			sign_up: { captcha_enabled: false, captcha_widget_type: null, custom_action_required: false, progressive: true, mode: "public", legal_consent_enabled: false },
			restrictions: { allowlist: { enabled: false }, blocklist: { enabled: false } },
			password_settings: { disable_hibp: false, min_length: 8, max_length: 72, require_special_char: false, require_numbers: false, require_uppercase: false, require_lowercase: false, show_zxcvbn: false, min_zxcvbn_strength: 0, enforce_hibp_on_sign_in: false, allowed_special_characters: "" },
			passkey_settings: { allow_autofill: false, show_sign_in_button: false },
			actions: { delete_self: true, create_organization: false },
			attack_protection: {},
		},
		organization_settings: { enabled: false, max_allowed_memberships: 0, actions: {}, domains: { enabled: false, enrollment_modes: [] } },
		commerce_settings: { billing: { enabled: false, stripe_publishable_key: "", has_paid_user_plans: false, has_paid_org_plans: false } },
		maintenance_mode: false,
	}
	const log = []
	let state = { signIn: null, session: null, user: null }
	let newUser = false // (setNewUser(true): the next Google sign-in is someone Clerk has never seen, so it becomes a sign-up)
	const user = { object: "user", id: "user_g1", first_name: "Ana", last_name: "Lima", username: null, primary_email_address_id: "idn_1", email_addresses: [{ object: "email_address", id: "idn_1", email_address: "ana@example.com", verification: { status: "verified", strategy: "from_oauth_google" }, linked_to: [] }], phone_numbers: [], web3_wallets: [], external_accounts: [], passkeys: [], enterprise_accounts: [], saml_accounts: [], organization_memberships: [], password_enabled: false, two_factor_enabled: false, totp_enabled: false, backup_code_enabled: false, public_metadata: {}, unsafe_metadata: {}, image_url: "", has_image: false, created_at: now, updated_at: now, last_sign_in_at: now }
	const clientJSON = () => ({ object: "client", id: "client_1", sessions: state.session ? [state.session] : [], sign_in: state.signIn, sign_up: null, last_active_session_id: state.session?.id ?? null, cookie_expires_at: null, captcha_bypass: false, created_at: now, updated_at: now })
	const sessionJSON = () => ({ object: "session", id: "sess_1", status: "active", expire_at: now + 864e5, abandon_at: now + 864e5, last_active_at: now, last_active_token: { object: "token", jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyX2cxIiwiZXhwIjo5OTk5OTk5OTk5fQ.c2ln" }, last_active_organization_id: null, actor: null, user, public_user_data: { first_name: "Ana", last_name: "Lima", identifier: "ana@example.com", image_url: "", has_image: false }, factor_verification_age: [0, -1], created_at: now, updated_at: now, tasks: null })
	await ctx.route("**/*", async (route) => {
		const req = route.request()
		const u = new URL(req.url())
		if (u.origin === ORIGIN) return route.continue()
		const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Content-Type": "application/json" }
		if (u.host === "accounts.google.test") {
			log.push(["GOOGLE", u.href])
			// Google signs the person in and sends them to Clerk's callback; Clerk completes the sign-in and redirects to our redirect_url
			if (newUser) {
				// a Google account Clerk has never seen: the sign-in can't finish, its verification is "transferable" to a sign-up
				state.signIn = { object: "sign_in_attempt", id: "sia_1", status: "needs_identifier", created_session_id: null, identifier: null, supported_identifiers: [], supported_first_factors: [], supported_second_factors: null, first_factor_verification: { status: "transferable", strategy: "oauth_google", external_verification_redirect_url: null, error: { code: "external_account_not_found", message: "The External Account was not found.", long_message: "The External Account was not found." } }, second_factor_verification: null, user_data: {}, abandon_at: now + 864e5 }
			} else {
				state.session = sessionJSON()
				state.signIn = { object: "sign_in_attempt", id: "sia_1", status: "complete", created_session_id: "sess_1", identifier: "ana@example.com", supported_identifiers: [], supported_first_factors: [], supported_second_factors: null, first_factor_verification: { status: "verified", strategy: "oauth_google", external_verification_redirect_url: null }, second_factor_verification: null, user_data: {}, abandon_at: now + 864e5 }
			}
			return route.fulfill({ status: 302, headers: { Location: state.redirectUrl } })
		}
		if (u.host !== HOST) { log.push(["OTHER", req.method(), u.href]); return route.abort() }
		if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
		const body = req.postData() ?? ""
		log.push([req.method(), u.pathname + (u.searchParams.get("_method") ? `?_method=${u.searchParams.get("_method")}` : ""), body.slice(0, 300)])
		const reply = (obj) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify(obj) })
		if (u.pathname === "/v1/environment") return reply(env)
		if (u.pathname === "/v1/client" && req.method() === "GET") return reply({ response: clientJSON(), client: null })
		if (u.pathname === "/v1/client/sign_ins" && req.method() === "POST") {
			const p = new URLSearchParams(body)
			state.redirectUrl = p.get("redirect_url")
			state.signIn = { object: "sign_in_attempt", id: "sia_1", status: "needs_first_factor", identifier: null, supported_identifiers: ["email_address"], supported_first_factors: [{ strategy: "oauth_google" }], supported_second_factors: null, first_factor_verification: { status: "unverified", strategy: "oauth_google", external_verification_redirect_url: "https://accounts.google.test/o/oauth2/v2/auth?client_id=shared&state=xyz", attempts: null, expire_at: now + 6e5, error: null }, second_factor_verification: null, created_session_id: null, user_data: {}, abandon_at: now + 864e5 }
			return reply({ response: state.signIn, client: clientJSON() })
		}
		if (/^\/v1\/client\/sign_ins\/sia_1$/.test(u.pathname)) return reply({ response: state.signIn, client: clientJSON() })
		if (u.pathname === "/v1/client/sign_ups" && req.method() === "POST") {
			// the transfer: the sign-up finishes at once (nothing but the Google email is required: docs/ACCOUNTS.md 9.1 step 3)
			state.session = sessionJSON()
			const signUp = { object: "sign_up_attempt", id: "sua_1", status: "complete", created_session_id: "sess_1", created_user_id: "user_g1", required_fields: ["email_address"], optional_fields: [], missing_fields: [], unverified_fields: [], verifications: { email_address: { status: "verified", strategy: "from_oauth_google" }, phone_number: null, web3_wallet: null, external_account: { status: "verified", strategy: "oauth_google" } }, username: null, email_address: "ana@example.com", phone_number: null, web3_wallet: null, has_password: false, first_name: "Ana", last_name: "Lima", unsafe_metadata: {}, abandon_at: now + 864e5 }
			state.signIn = null
			return reply({ response: signUp, client: { ...clientJSON(), sign_up: signUp } })
		}
		if (/^\/v1\/client\/sessions\/sess_1\/touch$/.test(u.pathname)) return reply({ response: state.session, client: clientJSON() })
		if (/^\/v1\/client\/sessions\/sess_1\/tokens/.test(u.pathname)) return reply({ object: "token", jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyX2cxIiwiZXhwIjo5OTk5OTk5OTk5fQ.c2ln" })
		if (/^\/v1\/client\/sessions(\/sess_1\/(end|remove))?$/.test(u.pathname) && (req.method() === "DELETE" || u.searchParams.get("_method") === "DELETE" || /\/(end|remove)$/.test(u.pathname))) {
			state.session = null
			state.signIn = null
			return reply({ response: clientJSON(), client: clientJSON() })
		}
		log.push(["UNHANDLED", req.method(), u.pathname])
		return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ errors: [{ code: "resource_not_found", message: "not found" }] }) })
	})

	return { log, setNewUser: (v) => (newUser = !!v), get unhandled() { return log.filter((l) => l[0] === "UNHANDLED" || l[0] === "OTHER") }, state: () => state }
}
