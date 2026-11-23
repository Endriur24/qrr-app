import { Hono } from "hono";
import { QrrAppDO, createMessageHubRoutes } from "./message-hub-do";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";


type Bindings = {
	DO: DurableObjectNamespace<QrrAppDO>;
	ASSETS: Fetcher;
};

type Variables = {
	messageHub: DurableObjectStub<QrrAppDO>;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** Same security headers as public/_headers (that file only covers assets served directly) */
const SECURITY_HEADERS: Record<string, string> = {
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
	"Content-Security-Policy":
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.bunny.net https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

/** Re-wraps an asset response with a given status and extra headers */
const withHeaders = (res: Response, status: number, extra: Record<string, string> = {}) => {
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
	return new Response(res.body, { status, headers });
};

const appType = app
	// Share Target is normally handled by the service worker. If the SW is not
	// active (first launch, update in progress) the POST reaches the server –
	// redirect back instead of showing a 404.
	.post("/receive-files/", (c) => c.redirect("/?share-target=error", 303))
	.get("/:id", async (c) => {
		if (!/^\d{6}$/.test(c.req.param("id"))) return c.notFound();
		const res = await c.env.ASSETS.fetch(
			new Request(`${new URL(c.req.url).origin}/index.html`)
		);
		// Session pages are temporary – keep them out of search results
		return withHeaders(res, res.status, { "X-Robots-Tag": "noindex, nofollow" });
	})
	.get("/", (c) => c.env.ASSETS.fetch(c.req.raw))

	.post("/getid", async (c) => {
		let notInitializedYet;
		let id;
		let messageHub;
		let generatedCode = "";

		//generate a code that was not initialized yet
		do {
			generatedCode = (Math.floor(Math.random() * 999999) + 1)
				.toString()
				.padStart(6, "0");
			id = c.env.DO.idFromName(generatedCode);
			messageHub = c.env.DO.get(id);
			notInitializedYet = await messageHub.isInitialized();
		} while (notInitializedYet);
		const hostCode = await messageHub.setInitialized();

		setCookie(c, "sessionHost", hostCode, {
			path: `/${generatedCode}`,
		});
		return c.json({ id: generatedCode });
	})

	.post(
		"/checkid",
		zValidator(
			"query",
			z.object({
				id: z.string(),
			})
		),
		async (c) => {
			const id = c.req.valid("query").id;
			if (!id || !/^\d{6}$/.test(id)) {
				return c.json(
					{
						success: false,
						error: "Invalid session ID",
					},
					400
				);
			}

			const messageHub = c.env.DO.get(c.env.DO.idFromName(id));
			const initialized = await messageHub.isInitialized();

			if (!initialized) {
				return c.json(
					{
						success: false,
						error: "Session with given ID does not exist",
					},
					404
				);
			}

			return c.json({ success: true, error: null });
		}
	)

	// Forward all other /:id/* requests to Durable Object
	.all("/:id/*", async (c) => {
		//id id is not 6 digit code then not found
		if (!/^\d{6}$/.test(c.req.param("id"))) {
			return c.notFound();
		}
		const id = c.env.DO.idFromName(c.req.param("id"));
		const messageHub = c.env.DO.get(id);

		// Create new request with path relative to DO
		const url = new URL(c.req.url);
		const doPath = url.pathname.replace(/^\/[^/]+/, "");
		const request = new Request(`http://do${doPath}`, c.req.raw);

		return messageHub.fetch(request);
	});

app.notFound(async (c) => {
	const res = await c.env.ASSETS.fetch(
		new Request(`${new URL(c.req.url).origin}/404.html`)
	);
	// Return a real 404 status (previously 200 = "soft 404" for search engines)
	return withHeaders(res, 404, { "X-Robots-Tag": "noindex" });
});
export type AppType = typeof appType;
export type MessageHubRoutes = import("./message-hub-do").MessageHubRoutes;
export type DO = typeof QrrAppDO;

export { QrrAppDO };
export default app;
