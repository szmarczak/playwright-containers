import playwright from 'playwright';
import launch, { createFindPageByTargetId } from './browser_launcher.mjs';

const {send, sendAndForget, events, createSession, url} = await launch('/home/szm/Downloads/chrome-linux/chrome', [
    // '--headless=chrome',
]);

await send('Fetch.enable');

events.on('Fetch.requestPaused', async (data) => {
    console.log('fetch');

    await sendAndForget('Fetch.continueRequest', {
        requestId: data.requestId,
    });
});

const { targetId } = await send('Target.createTarget', {
    url: 'about:blank',
});

const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
});

const pageSession = createSession(sessionId);

await pageSession.send('Page.navigate', {
    url: 'http://httpbin.org/anything',
});

await pageSession.detach();

console.log('Navigated to http://example.com');

const browser = await playwright.chromium.connectOverCDP(url);

console.log('Connected via Playwright');

const findPageByTargetId = createFindPageByTargetId({
    getPages: async () => {
        const contexts = await browser.contexts();

        return contexts.flatMap(context => context.pages());
    },
    getTargetInfo: async (page) => {
        const session = await page.context().newCDPSession(page);
        const { targetInfo } = await session.send('Target.getTargetInfo');
        await session.detach();

        return targetInfo;
    },
});

const page = await findPageByTargetId(targetId);

console.log(page.url(), await page.evaluate('navigator.userAgent'), await page.content());

await browser.close();

process.on('exit', () => {
    console.log('Exiting!');
});
