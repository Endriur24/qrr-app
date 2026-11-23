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

const appType = app
	.get("/debug-sentry", () => {
		throw new Error("My first Sentry error!");
	})
	// Share Target is normally handled by the service worker. If the SW is not
	// active (first launch, update in progress) the POST reaches the server –
	// redirect back instead of showing a 404.
	.post("/receive-files/", (c) => c.redirect("/?share-target=error", 303))
	.get("/:id", (c) =>

		!/^\d{6}$/.test(c.req.param("id"))
			? c.notFound()
			: c.env.ASSETS.fetch(
				new Request(`${new URL(c.req.url).origin}/index.html`)
			)
	)
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

app.notFound((c) => {
	return c.env.ASSETS.fetch(
		new Request(`${new URL(c.req.url).origin}/404.html`)
	);
});
export type AppType = typeof appType;
export type MessageHubRoutes = import("./message-hub-do").MessageHubRoutes;
export type DO = typeof QrrAppDO;

export { QrrAppDO };
export default app;
