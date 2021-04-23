"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.newFetcherSyncExecutionContext = exports.newFetcherExecutionContext = exports.requestHelper = exports.AuthenticatingFetcher = void 0;
const types_1 = require("../types");
const logging_1 = require("../helpers/logging");
const url_1 = require("url");
const ensure_1 = require("../helpers/ensure");
const ensure_2 = require("../helpers/ensure");
const request_promise_native_1 = __importDefault(require("request-promise-native"));
const url_parse_1 = __importDefault(require("url-parse"));
const uuid_1 = require("uuid");
const xml2js_1 = __importDefault(require("xml2js"));
const FetcherUserAgent = 'Coda-Test-Server-Fetcher';
const MaxContentLengthBytes = 25 * 1024 * 1024;
const HeadersToStrip = ['authorization'];
class AuthenticatingFetcher {
    constructor(authDef, credentials) {
        this._authDef = authDef;
        this._credentials = credentials;
    }
    async fetch(request) {
        const { url, headers, body, form } = this._applyAuthentication(request);
        const response = await exports.requestHelper.makeRequest({
            url,
            method: request.method,
            headers: {
                ...headers,
                'User-Agent': FetcherUserAgent,
            },
            body,
            form,
        });
        let responseBody = response.body;
        if (responseBody && responseBody.length >= MaxContentLengthBytes) {
            throw new Error(`Response body is too large for Coda. Body is ${responseBody.length} bytes.`);
        }
        try {
            const contentType = response.headers['content-type'];
            if (contentType && contentType.includes('text/xml')) {
                responseBody = await xml2js_1.default.parseStringPromise(responseBody, { explicitRoot: false });
            }
            else {
                responseBody = JSON.parse(responseBody);
            }
            // Do not inadvertently parse non-objects.
            if (typeof responseBody !== 'object') {
                responseBody = response.body;
            }
        }
        catch (e) {
            // Ignore if we cannot parse.
        }
        const responseHeaders = { ...response.headers };
        for (const key of Object.keys(responseHeaders)) {
            if (HeadersToStrip.includes(key.toLocaleLowerCase())) {
                // In case any services echo back sensitive headers, remove them so pack code can't see them.
                delete responseHeaders[key];
            }
        }
        return {
            status: response.statusCode,
            headers: responseHeaders,
            body: responseBody,
        };
    }
    _applyAuthentication({ url: rawUrl, headers, body, form, disableAuthentication, }) {
        if (!this._authDef || this._authDef.type === types_1.AuthenticationType.None || disableAuthentication) {
            return { url: rawUrl, headers, body, form };
        }
        if (!this._credentials) {
            throw new Error(`${this._authDef.type} authentication is required for this pack, but no local credentials were found. ` +
                'Run "coda auth path/to/pack/manifest to set up credentials."');
        }
        const url = this._applyAndValidateEndpoint(rawUrl);
        switch (this._authDef.type) {
            case types_1.AuthenticationType.WebBasic: {
                const { username, password } = this._credentials;
                const encodedAuth = Buffer.from(`${username}:${password}`).toString('base64');
                return { url, body, form, headers: { ...headers, Authorization: `Basic ${encodedAuth}` } };
            }
            case types_1.AuthenticationType.QueryParamToken: {
                const { paramValue } = this._credentials;
                return { headers, body, form, url: addQueryParam(url, this._authDef.paramName, paramValue) };
            }
            case types_1.AuthenticationType.MultiQueryParamToken: {
                const { params: paramDict } = this._credentials;
                const parsedUrl = new url_1.URL(url);
                for (const [paramName, paramValue] of Object.entries(paramDict)) {
                    if (!paramValue) {
                        throw new Error(`Param value for ${paramName} is empty. Please provide a value for this parameter or omit it.`);
                    }
                    parsedUrl.searchParams.set(paramName, paramValue);
                }
                return { headers, body, form, url: parsedUrl.href };
            }
            case types_1.AuthenticationType.HeaderBearerToken:
            case types_1.AuthenticationType.CodaApiHeaderBearerToken: {
                const { token } = this._credentials;
                return { url, body, form, headers: { ...headers, Authorization: `Bearer ${token}` } };
            }
            case types_1.AuthenticationType.CustomHeaderToken: {
                const { token } = this._credentials;
                const valuePrefix = this._authDef.tokenPrefix ? `${this._authDef.tokenPrefix} ` : '';
                return { url, body, form, headers: { ...headers, [this._authDef.headerName]: `${valuePrefix}${token}` } };
            }
            case types_1.AuthenticationType.AWSSignature4:
                throw new Error('Not yet implemented');
            case types_1.AuthenticationType.OAuth2: {
                const { accessToken } = this._credentials;
                const prefix = this._authDef.tokenPrefix || 'Bearer';
                const requestHeaders = headers || {};
                let requestUrl = url;
                if (this._authDef.tokenQueryParam) {
                    requestUrl = addQueryParam(url, this._authDef.tokenQueryParam, ensure_1.ensureNonEmptyString(accessToken));
                }
                else {
                    requestHeaders.Authorization = `${prefix} ${ensure_1.ensureNonEmptyString(accessToken)}`;
                }
                return {
                    url: requestUrl,
                    body,
                    form,
                    headers: requestHeaders,
                };
            }
            default:
                return ensure_2.ensureUnreachable(this._authDef);
        }
    }
    _applyAndValidateEndpoint(rawUrl) {
        var _a;
        if (!this._authDef || this._authDef.type === types_1.AuthenticationType.None) {
            return rawUrl;
        }
        const endpointUrl = (_a = this._credentials) === null || _a === void 0 ? void 0 : _a.endpointUrl;
        if (!endpointUrl) {
            return rawUrl;
        }
        const parsedEndpointUrl = new url_1.URL(endpointUrl);
        const { endpointDomain } = this._authDef;
        if (endpointUrl) {
            if (parsedEndpointUrl.protocol !== 'https:') {
                throw new Error(`Only https urls are supported, but pack is configured to use ${endpointUrl}.`);
            }
            if (endpointDomain &&
                !(parsedEndpointUrl.hostname === endpointDomain || parsedEndpointUrl.hostname.endsWith(`.${endpointDomain}`))) {
                throw new Error(`The endpoint ${endpointUrl} is not authorized. The domain must match the domain ${endpointDomain} provided in the pack definition.`);
            }
        }
        const parsedUrl = url_parse_1.default(rawUrl, {});
        if (parsedUrl.hostname) {
            if (parsedUrl.hostname !== parsedEndpointUrl.hostname) {
                throw new Error(`The url ${rawUrl} is not authorized. The host must match the host ${parsedEndpointUrl.hostname} that was specified with the auth credentials. ` +
                    'Or leave the host blank and the host will be filled in automatically from the credentials.');
            }
            return rawUrl;
        }
        else {
            const prefixUrl = endpointUrl.endsWith('/') ? endpointUrl : endpointUrl + '/';
            const path = rawUrl.startsWith('/') ? rawUrl.slice(1) : rawUrl;
            return prefixUrl + path;
        }
    }
}
exports.AuthenticatingFetcher = AuthenticatingFetcher;
// Namespaced object that can be mocked for testing.
exports.requestHelper = {
    makeRequest: async (request) => {
        return request_promise_native_1.default({
            ...request,
            encoding: request.isBinaryResponse ? null : undefined,
            resolveWithFullResponse: true,
            timeout: 60000,
            forever: true, // keep alive connections as long as possible.
        });
    },
};
class AuthenticatingBlobStorage {
    constructor(fetcher) {
        this._fetcher = fetcher;
    }
    async storeUrl(url, _opts) {
        await this._fetcher.fetch({ method: 'GET', url, isBinaryResponse: true });
        return `https://not-a-real-url.s3.amazonaws.com/tempBlob/${uuid_1.v4()}`;
    }
    async storeBlob(_blobData, _contentType, _opts) {
        return `https://not-a-real-url.s3.amazonaws.com/tempBlob/${uuid_1.v4()}`;
    }
}
function newFetcherExecutionContext(packName, authDef, credentials) {
    const fetcher = new AuthenticatingFetcher(authDef, credentials);
    return {
        invocationLocation: {
            protocolAndHost: 'https://coda.io',
        },
        timezone: 'America/Los_Angeles',
        invocationToken: uuid_1.v4(),
        endpoint: credentials === null || credentials === void 0 ? void 0 : credentials.endpointUrl,
        fetcher,
        temporaryBlobStorage: new AuthenticatingBlobStorage(fetcher),
        logger: new logging_1.ConsoleLogger(),
    };
}
exports.newFetcherExecutionContext = newFetcherExecutionContext;
function newFetcherSyncExecutionContext(packName, authDef, credentials) {
    const context = newFetcherExecutionContext(packName, authDef, credentials);
    return { ...context, sync: {} };
}
exports.newFetcherSyncExecutionContext = newFetcherSyncExecutionContext;
function addQueryParam(url, param, value) {
    const parsedUrl = new url_1.URL(url);
    // Put the key at the beginning, as some APIs expect it at the beginning.
    const entries = [...parsedUrl.searchParams.entries()];
    parsedUrl.searchParams.set(param, value);
    for (const [key, entryValue] of entries) {
        parsedUrl.searchParams.delete(key);
        parsedUrl.searchParams.set(key, entryValue);
    }
    return parsedUrl.href;
}
