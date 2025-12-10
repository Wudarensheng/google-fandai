const AirGooServer = require('../../airgoo');
const defines = require('../../defines');
const { PassThrough } = require('stream');
const EventEmitter = require('events').EventEmitter;

// Initialize server instance but do NOT call start()
const options = defines.initialize();
const server = new AirGooServer().initialize(options);

function buildQueryString(qsObj) {
    if (!qsObj) return '';
    return Object.keys(qsObj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(qsObj[k])).join('&');
}

exports.handler = async function(event, context) {
    try {
        // Reconstruct URL
        const path = event.path || '/';
        const qs = event.rawQueryString || buildQueryString(event.queryStringParameters);
        const url = path + (qs ? ('?' + qs) : '');

        // Minimal IncomingMessage-like object
        const r1 = new EventEmitter();
        r1.method = event.httpMethod || event.httpMethod || 'GET';
        r1.url = url;
        r1.headers = event.headers || {};
        r1.connection = { remoteAddress: (r1.headers['x-forwarded-for'] || r1.headers['x-nf-client-connection-ip'] || '127.0.0.1') };

        // Body handling
        let bodyBuff = Buffer.alloc(0);
        if (event.body) {
            bodyBuff = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
        }

        // Response-like writable stream
        const pass = new PassThrough();
        let statusCode = 200;
        let resHeaders = {};
        const chunks = [];

        pass.on('data', (c) => chunks.push(Buffer.from(c)));

        pass.writeHead = function(code, headers) {
            statusCode = code || statusCode;
            resHeaders = headers || resHeaders;
        };

        // Ensure end resolves
        let finished;
        const finishedPromise = new Promise((resolve) => { finished = resolve; });
        pass.on('end', () => finished());
        pass.on('close', () => finished());

        // Adapter r4 is the pass stream
        const r4 = pass;

        // Start the request handling
        server.requestHandler(r1, r4);

        // Emit request body if any (simulate IncomingMessage streaming)
        setImmediate(() => {
            if (bodyBuff && bodyBuff.length) r1.emit('data', bodyBuff);
            r1.emit('end');
        });

        // Wait for response finish or timeout
        const timeoutMs = 30000;
        const res = await Promise.race([
            finishedPromise,
            new Promise((resolve) => setTimeout(resolve, timeoutMs))
        ]);

        const body = Buffer.concat(chunks || []);
        const contentType = (resHeaders['content-type'] || resHeaders['Content-Type'] || '') + '';
        const isText = /^(text\/|application\/(json|javascript|xml))/i.test(contentType) || /^utf-?8/i.test(resHeaders['charset']);

        return {
            statusCode: statusCode,
            headers: resHeaders,
            body: isText ? body.toString('utf8') : body.toString('base64'),
            isBase64Encoded: !isText
        };

    } catch (err) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'text/plain' },
            body: 'Internal Server Error: ' + String(err)
        };
    }
};
