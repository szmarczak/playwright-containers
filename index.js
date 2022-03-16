'use strict';
const fs = require('fs');
const playwright = require('playwright');

// Playwright is not supported due to https://github.com/microsoft/playwright/issues/7220 (cache disabled if intercepting)
// Also please see https://github.com/microsoft/playwright/issues/6319

const container = fs.readFileSync('container.js', 'utf8');

// Pending feature: https://github.com/microsoft/playwright/issues/10143
const removeCookies = async (context, filter) => {
	let cookies = await context.cookies();
	for (const cookie of cookies) {
		if (filter(cookie)) {
			cookie.expires = 1;
			cookie.value = '';
		}
	}
	cookies = cookies.filter(cookie => cookie.expires === 1);

	// BUG: https://github.com/microsoft/playwright/issues/12808
	cookies = cookies.filter(cookie => cookie.name !== '');

	await context.addCookies(cookies);
};

// Pending feature: https://github.com/microsoft/playwright/issues/6258
const _removeStorage = async (url, id) => {
	const page = await context.newPage();

	await page.route('**/*', (route) => {
		route.fulfill({ body: `<!DOCTYPE html><html><head></head><body></body></html>` }).catch(() => {});
	});

	await page.goto(url + '/pleaseNoIntercept', { waitUntil: 'load' });

	await page.evaluate(
		({ id }) => {
			for (const storage of [ localStorage, sessionStorage ]) {
				const length = storage.length;
				const keys = [];
				for (let i = 0; i < length; i++) {
					keys.push(storage.key(i));
				}
				for (const key of keys) {
					if (key.startsWith('apify.container.' + id)) {
						storage.removeItem(key);
					}
				}
			}
		},
		{ id }
	);

	await page.close();
};

const removeStorage = async (context, id) => {
	const state = await context.storageState();
	const promises = [];

	// Missing sessionStorage, see https://github.com/microsoft/playwright/issues/8874
	for (const pair of state.origins) {
		const {origin, localStorage} = pair;

		let has = false;
		for (const [name] of localStorage) {
			if (name.startsWith('apify.container.id' + id)) {
				has = true;
				break;
			}
		}

		if (has) {
			// promises.push(_removeStorage(origin, id));
		}
	}

	await Promise.allSettled(promises);
};

const containerId = new WeakMap();
const containerReferences = new Map();

// BUG: Sometimes the opener is null, see https://github.com/microsoft/playwright/issues/12805
const getMainOpener = (page) => {
	// Based on https://github.com/microsoft/playwright/blob/b6c001c6de1afaef7c765ff0ef471d80dbe306e2/packages/playwright-core/src/client/page.ts#L226
	// We can't use `await page.opener()` - even though it returns `page._opener` as well.
	// Asynchronous functions delay the event loop.
	// Also we want the opener even if it was closed.
	let current = page._opener;
	if (current) {
		while (current._opener) {
			current = current._opener;
		}
	}

	return current;
};

const generateContainerId = () => Math.random().toString(36).slice(2);

const registerContainerCleanup = (page, id) => {
	if (containerReferences.has(id)) {
		containerReferences.set(id, containerReferences.get(id) + 1);
	} else {
		containerReferences.set(id, 1);
	}

	const onClose = async () => {
		const count = containerReferences.get(id) - 1;
		if (count === 0) {
			containerReferences.delete(id);

			await Promise.allSettled([
				removeCookies(page.context(), cookie => cookie.name.startsWith('apify.container.' + id)),
				// BUG: https://github.com/microsoft/playwright/issues/12809
				// removeStorage(page.context(), id),
			]);
		} else {
			containerReferences.set(id, count);
		}
	};

	page.on('close', async () => {
		try {
			await onClose();
		} catch {}
	});
};

const onPage = (page) => {
	if (containerId.has(page)) {
		return;
	}

	const mainOpener = getMainOpener(page);
	const id = mainOpener ? containerId.get(mainOpener) : generateContainerId();

	// TODO: Should we propagate up as well?
	containerId.set(page, id);

	registerContainerCleanup(page, id);

	page.addInitScript('(() => {' + 'let key = "' + id + '";\n' + container + '})();').catch(() => {});
};

const registerContainerId = async (context) => {
	context.on('page', onPage);
};

const normalizeCookie = (cookie) => {
	cookie = cookie.trimStart();

	const delimiterIndex = cookie.indexOf(';');
	const equalsIndex = cookie.indexOf('=');

	if ((equalsIndex === -1) || ((delimiterIndex !== -1) && (equalsIndex > delimiterIndex))) {
		cookie = '=' + cookie;
	}

	return cookie;
};

const registerCookieTransfomer = async (context) => {
	// It doesn't intercept requests from service workers. Bug? Feature?
	// See https://github.com/microsoft/playwright/issues/1090
	await context.route('**/*', async (route, request) => {
		// it's very easy to crash if websites abuse this.
		// if (request.url().endsWith('pleaseNoIntercept')) {
		// 	return;
		// }

		const cid = containerId.get(request.frame().page());

		if (!cid) {
			return;
		}

		const prefix = 'apify.container.' + cid + '.';

		const headers = request.headers();
		const cookie = headers.cookie;

		if (cookie) {
			const parsedCookies = cookie.split('; ');
			const filteredCookies = parsedCookies.filter(cookie => cookie.startsWith(prefix));
			const mappedCookies = filteredCookies.map(cookie => cookie.slice(prefix.length));

			headers.cookie = mappedCookies.join('; ');
		}

		try {
			const requestContext = await playwright.request.newContext();
			const response = await requestContext.fetch(route.request(), { headers });

			const responseHeaders = response.headers();

			const setCookie = responseHeaders['set-cookie'];
			if (setCookie) {
				responseHeaders['set-cookie'] = setCookie.split('\n').map(cookie => prefix + normalizeCookie(cookie)).join('\n');
			}

			route.fulfill({
				response,
				headers: responseHeaders,
			});
		} catch (error) {
			 console.error(error);
			route.abort('failed');
		}
	});
};

const useContainers = async (context) => {
	await registerContainerId(context);
	await registerCookieTransfomer(context);
};

(async () => {
	const browser = await playwright.chromium.launchPersistentContext('', {
		headless: false,
	});

	await useContainers(browser);

	const open = async (url = 'https://www.google.com') => {
		const page = await browser.newPage();
		await page.goto(url);

		return page;
	};

	const pages = await Promise.all([ open(), open() ]);
})();

