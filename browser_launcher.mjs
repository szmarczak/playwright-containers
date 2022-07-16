import child_process from 'node:child_process';
import readline from 'node:readline';
import process from 'node:process';
import { EventEmitter } from 'node:events';
import { PipeTransport } from './pipe_transport.mjs';

class CDPError extends Error {
    constructor(message, code, method) {
        super(message);

        this.code = code;
        this.method = method;
    }
}

const createFindPageByTargetId = ({
    getPages,
    getTargetInfo,
}) => {
    const findPageByTargetId = async (targetId) => {
        const pages = await getPages();
    
        const promises = [];
    
        for (let i = 0; i < pages.length; i++) {
            promises.push(
                (async () => {
                    const targetInfo = await getTargetInfo(pages[i]);
    
                    if (targetInfo.targetId === targetId) {
                        return pages[i];
                    }
                })(),
            );
        }
    
        const settledPromises = await Promise.allSettled(promises);
        const page = settledPromises.find(settledPromise => settledPromise.status === 'fulfilled' && settledPromise.value !== undefined)?.value;
    
        if (page) {
            return page;
        }
    
        const errors = settledPromises.filter(settledPromise => settledPromise.status === 'rejected').map(settledPromise => settledPromise.reason);

        throw new AggregateError(errors, `Could not find page with targetId ${targetId}`);
    };

    return findPageByTargetId;
};

export { createFindPageByTargetId, CDPError };

export default async (path, userArgs = []) => {
    // https://source.chromium.org/chromium/chromium/src/+/main:native_client_sdk/doc_generated/devguide/devcycle/debugging.html
    // https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md
    // https://niek.github.io/chrome-features/
    // https://peter.sh/experiments/chromium-command-line-switches/
    const args = [
        ...userArgs,
        '--remote-debugging-port=0',                     // Listen on random port so Playwright can connect over WebSocket
        '--remote-debugging-pipe',                       // For internal purposes we can use pipes instead

        // De-Google
        '--disable-background-networking',               // Disable extension updates, Safe Browsing, upgrades, User Metrics Analytics
        '--disable-breakpad',                            // Disable crashdump collection
        '--disable-component-update',                    // Disable chrome://components/ updates
        '--disable-domain-reliability',                  // Disable Google's domains feedback
        '--disable-sync',                                // Disable Google Sync
        '--metrics-recording-only',                      // Disable User Metrics Analytics reporting
        '--disable-field-trial-config',                  // Disable Chrome Trials
        '--disable-features=Translate',                  // Disable Google Translate

        // First run
        '--no-default-browser-check',                    // Skip annoying browser check
        '--no-first-run',                                // Skip first run tutorial

        // Optimization
        '--disable-renderer-backgrounding',              // Disable renderer process backgrounding
        '--disable-ipc-flooding-protection',             // Disable throttling between browser processes
        '--disable-device-discovery-notifications',      // Disable network device discovery
        '--disable-default-apps',                        // self-explanatory
        '--disable-client-side-phishing-detection',      // self-explanatory
        '--disable-background-timer-throttling',         // self-explanatory
        '--net-log-capture-mode=IncludeSensitive',       // self-explanatory
        '--enable-features=NetworkServiceInProcess2',    // Run networking in a separate process

        // Automation
        '--enable-automation',                           // Enable more automation features
        '--allow-pre-commit-input',                      // Allow interacting before rendering
        '--disable-prompt-on-repost',                    // Skip prompt on POST refresh
        '--disable-popup-blocking',                      // Allow popups
        '--disable-hang-monitor',                        // Skip unresponsive tab warning
        '--disable-back-forward-cache',                  // Intercept back requests
        '--force-color-profile=srgb',                    // Force sRGB
        '--disable-backgrounding-occluded-windows',      // Do not background non-visible windows
        '--disable-blink-features=AutomationControlled', // navigator.webdriver = false

        // Fixes
        '--no-service-autorun',                          // https://chromium-review.googlesource.com/c/chromium/src/+/2436773
        '--use-mock-keychain',                           // macOS specific to prevent permissions dialogs
        '--password-store=basic',                        // https://crbug.com/571003
        '--disable-dev-shm-usage',                       // https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md

        // '--no-startup-window',                          // Do NOT uncomment - otherwise gets rid of the first tab
        // '--hide-scrollbars',                            // Do NOT uncomment - otherwise greater possibility of getting detected
        // '--disable-fetching-hints-at-navigation-start', // Do NOT uncomment - otherwise greater possibility of getting detected

        // Worth reconsidering:
        // '--autoplay-policy=user-gesture-required',

        // No idea what these do - copied from Playwright
        '--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync',
    ];

    const browserProcess = child_process.spawn(path, args, {
        stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
        detached: false,
        serialization: 'json',
    });
    browserProcess.stdout.resume();
    browserProcess.stderr.resume();

    process.once('beforeExit', () => {
        if (browserProcess.exitCode !== null) {
            return;
        }

        browserProcess.ref();
        browserProcess.kill('SIGINT');

        setTimeout(() => {
            browserProcess.kill('SIGTERM');
        }, 1000).unref();
    });

    process.once('exit', () => {
        browserProcess.kill('SIGTERM');
    });

    browserProcess.unref();

    let id = 1;
    const handlers = {};
    const sessions = {};

    const createSession = (sessionId) => {
        if (typeof sessionId !== 'string') {
            throw new TypeError(`Expected sessionId to be a string, got ${typeof sessionId}`);
        }

        const events = new EventEmitter();

        const session = {
            async send(method, params) {
                return send(sessionId, method, params);
            },
            async sendAndForget(method, params) {
                return sendAndForget(sessionId, method, params);
            },
            async detach() {
                return sendAndForget('', 'Target.detachFromTarget', {
                    sessionId,
                });
            },
            events,
        };

        sessions[sessionId] = session;

        return session;
    };

    const getWebSocketURL = async () => {
        const stderrReadline = readline.createInterface({
            input: browserProcess.stderr,
            crlf: Number.POSITIVE_INFINITY,
        });

        for await (const line of stderrReadline) {
            const listening = 'DevTools listening on ';

            if (line.startsWith(listening)) {
                try {
                    return line.slice(listening.length);
                } finally {
                    stderrReadline.close();
                }
            }
        }
    };

    const url = await getWebSocketURL();

    if (url === undefined) {
        return Promise.reject(new CDPError(`Failed to launch. Exit code: ${browserProcess.exitCode}`));
    }

    const send = async (sessionId, method, params) => {
        return new Promise((resolve, reject) => {
            if (typeof sessionId !== 'string') {
                throw new TypeError(`Expected sessionId to be a string, got ${typeof sessionId}`);
            }

            if (typeof method !== 'string') {
                throw new TypeError(`Expected method to be a string, got ${typeof method}`);
            }

            if (typeof params !== 'object' && typeof params !== 'undefined') {
                throw new TypeError(`Expected method to be an object, got ${typeof method}`);
            }

            // The error is created immediately here to get the stacktrace,
            // so the stacktrace isn't cluttererd by async things like TCP.
            let error = new CDPError('', '', undefined);

            if (ws.readyState === ws.constructor.CLOSED || ws.readyState == ws.constructor.CLOSING) {
                error.message = 'WebSocket has been already closed';
                error.method = method;
    
                reject(error);
                return;
            }

            const messageId = id++;

            handlers[messageId] = (data) => {
                if (data.result) {
                    resolve(data.result);
                }
    
                if (data.error) {
                    error.message = data.error.message;
                    error.method = method;
                    error.code = data.error.code;
    
                    reject(error);
                }
    
                reject(data);
            };

            ws.send(JSON.stringify({
                id: messageId,
                method,
                params,
                sessionId,
            }));
        });
    };

    const sendAndForget = async (...args) => {
        try {
            return await send(...args);
        } catch {}
    };

    const ws = new PipeTransport(browserProcess.stdio[3], browserProcess.stdio[4]); // new WebSocket(url);
    ws.onmessage = ({ data }) => {
        if (typeof data !== 'string') {
            throw new Error(`Unexpected binary data: ${data.toString('hex')}`);
        }

        // console.log(data);

        const parsed = JSON.parse(data);

        if (parsed.id !== undefined) {
            handlers[parsed.id](parsed);
            delete handlers[parsed.id];
            return;
        }

        const events = sessions[parsed.sessionId ?? '']?.events;
        if (events === undefined) {
            throw new Error(`Failed to find sessionId ${parsed.sessionId} of ${parsed.method}`);
        }

        if (parsed.error !== undefined) {
            events.emit('uncaughtError', parsed.error);
            return;
        }

        if (parsed.method !== undefined) {
            events.emit(parsed.method, parsed.params);
            return;
        }

        throw new Error(`Uncaught CDP message:\n${data}`);
    };

    return new Promise((resolve, reject) => {
        ws.onopen = async () => {
            ws.onerror = undefined;

            resolve({
                url,
                browserProcess,
                createSession,
                ...createSession(''),
            });
        };

        ws.onerror = (error) => {
            reject(error);
        };
    });
};
