'use strict';
const fs = require('fs');
const playwright = require('playwright');

// Potential issues:
// - https://github.com/microsoft/playwright/issues/6319 (ram usage keeps increasing)
// - https://github.com/microsoft/playwright/issues/4488 (cannot intercept websockets so we may get detected, workaround: use incognito contexts)

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

// Limit an asynchronous function to be executed only once at a time
const limit = (fn) => {
	let prev = Promise.resolve();

	return (...args) => {
		let resolve;
		let reject;
		const promise = new Promise((_resolve, _reject) => {
			resolve = _resolve;
			reject = _reject;
		});

		prev.finally(() => {
			queueMicrotask(() => {
				fn(...args).then(resolve, reject);
			});
		});

		prev = promise;

		return promise;
	};
};

// What we are missing is target interception.
// We want to to send CDP messages when:
// - a target is created, but before any requests are made (in order to set up container environent such as document.cookie, localStorage, etc.).
// - a target is closed (in order to clean up containers).

(async () => {
	const browser = await playwright.chromium.launchPersistentContext('', {
		headless: false,
	});

	const open = async (url = 'https://www.google.com') => {
		const page = await browser.newPage();

		const id = 'asdf';
		const prefix = 'apify.container.' + id + '.';

		const source = '(() => {' + 'let key = "' + id + '";\n' + container + '})();';

		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Fetch.enable');
		// await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
		// await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'alert(1)' });

		const requestHandler = async (data) => {
			let cookies;

			const handleResponse = async () => {
				// Get cookies for this URL
				cookies = (await cdp.send('Network.getCookies', { urls: [ data.request.url ] })).cookies;

				// Get new cookies
				cookies = cookies.filter(cookie => !cookie.name.startsWith('apify.container.'));

				// Remove those cookies
				await Promise.allSettled(cookies.map(cookie => cdp.send('Network.deleteCookies', cookie)));

				// Update cookie names
				for (const cookie of cookies) {
					cookie.name = prefix + cookie.name;
				}

				// Set updated cookies
				await cdp.send('Network.setCookies', { cookies });

				// Resume response
				await cdp.send('Fetch.continueResponse', {
					requestId: data.requestId,
					responseCode: data.responseStatusCode,
					responseHeaders: [],
				});
			};

			const handleRequest = async () => {
				// Get cookies for this URL
				cookies = (await cdp.send('Network.getCookies', { urls: [ data.request.url ] })).cookies;

				// Get cookies unassociated with this instance
				const cookiesToRemove = cookies.filter(cookie => !cookie.name.startsWith(prefix));

				// Get cookies associated with this instance
				const cookiesToSet = cookies.filter(cookie => cookie.name.startsWith(prefix));

				// Remove cookies unassociated with this instance
				await Promise.allSettled(cookiesToRemove.map(cookie => cdp.send('Network.deleteCookies', cookie)));

				// Slice cookie names associated with this instance
				for (const cookie of cookiesToSet) {
					cookie.name = cookie.name.slice(prefix.length);
				}

				// Set unwrapped cookies
				await cdp.send('Network.setCookies', { cookies: cookiesToSet });

				// Continue the request
				await cdp.send('Fetch.continueRequest', {
					requestId: data.requestId,
					interceptResponse: true,
				});

				// Remove unwrapped cookies
				await Promise.allSettled(cookiesToSet.map(cookie => cdp.send('Network.deleteCookies', cookie)));

				// Restore deleted cookies
				await cdp.send('Network.setCookies', { cookies: cookiesToRemove });

				// Restore wrapped cookies
				for (const cookie of cookiesToSet) {
					cookie.name = prefix + cookie.name;
				}
				await cdp.send('Network.setCookies', { cookies: cookiesToSet });
			};

			// If response status code is defined, then it's a response.
			if (data.responseStatusCode) {
				await handleResponse();
			} else {
				await handleRequest();
			}
		};

		const safeRequestHandler = async (...args) => {
			const messages = [
				'Invalid InterceptionId',
				'Target closed',
				'Target page, context or browser has been closed',
			];

			try {
				await requestHandler(...args);
			} catch (error) {
				if (!messages.some(message => error.message.includes(message))) {
					throw error;
				}
			}
		};

		// https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#event-requestPaused
		// Limit concurrency to 1 in order to prevent races
		cdp.on('Fetch.requestPaused', limit(safeRequestHandler));

		await page.goto(url);

		return page;
	};

	const pages = await Promise.all([ open(), /*open()*/ ]);
})();
