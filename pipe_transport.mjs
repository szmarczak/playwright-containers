export class PipeTransport {
    onopen;
    onmessage;
    onclose;
    #writable;
    #closed = false;

    constructor(writable, readable) {
        this.#writable = writable;

        const buffer = [];

        readable.once('close', () => {
            this.#closed = true;

            if (typeof this.onclose === 'function') {
                this.onclose();
            }
        });

        const onData = data => {
            const separatorIndex = data.indexOf('\0');

            if (separatorIndex !== -1) {
                buffer.push(data.subarray(0, separatorIndex));

                if (typeof this.onmessage === 'function') {
                    try {
                        this.onmessage({
                            data: Buffer.concat(buffer).toString(),
                        });
                    } finally {
                        buffer.length = 0;
                    }
                }

                if (data.length > (separatorIndex + 1)) {
                    onData(data.subarray(separatorIndex + 1));
                }
            } else {
                buffer.push(data);
            }
        };

        readable.on('data', onData);

        queueMicrotask(() => {
            if (typeof this.onopen === 'function') {
                this.onopen();
            }
        });
    }

    send(data) {
        this.#writable.write(data);
        this.#writable.write('\0');
    }

    get readyState() {
        return this.#closed ? PipeTransport.CLOSED : PipeTransport.OPEN;
    }

    static get CONNECTING() {
        return 0;
    }

    static get OPEN() {
        return 1;
    }

    static get CLOSING() {
        return 2;
    }

    static get CLOSED() {
        return 3;
    }
}
