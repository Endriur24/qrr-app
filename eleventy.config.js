import { DateTime } from "luxon";

export default function (eleventyConfig) {
	eleventyConfig.addFilter("httpUrl", (url) => {
		if (!url) return "/";
		if (url.startsWith("http")) return url;
		const clean = url.replace(/\.html$/, "");
		return `https://qrr.app${clean}`;
	});

	eleventyConfig.addFilter("dateDisplayNow", () => {
		return DateTime.now().toFormat("yyyy-MM-dd");
	});

	eleventyConfig.addFilter("date", (dateObj, format) => {
		return DateTime.fromJSDate(dateObj).toFormat(format);
	});

	eleventyConfig.addFilter("valueIfEmpty", (value, fallback) => {
		return value || fallback;
	});

	return {
		dir: {
			input: "src-html",
			includes: "_includes",
			output: "dist",
		},
	};
}
