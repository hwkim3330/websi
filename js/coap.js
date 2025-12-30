/**
 * CoAP (Constrained Application Protocol) - WebSerial Implementation
 * RFC 7252, RFC 8132, RFC 7959
 */

// CoAP Message Types
export const MessageType = {
    CON: 0,  // Confirmable
    NON: 1,  // Non-confirmable
    ACK: 2,  // Acknowledgement
    RST: 3   // Reset
};

// CoAP Method Codes
export const MethodCode = {
    GET: 0x01,
    POST: 0x02,
    PUT: 0x03,
    DELETE: 0x04,
    FETCH: 0x05,
    PATCH: 0x06,
    IPATCH: 0x07
};

// CoAP Response Codes
export const ResponseCode = {
    CREATED: 0x41,
    DELETED: 0x42,
    VALID: 0x43,
    CHANGED: 0x44,
    CONTENT: 0x45,
    CONTINUE: 0x5F,
    BAD_REQUEST: 0x80,
    UNAUTHORIZED: 0x81,
    NOT_FOUND: 0x84,
    METHOD_NOT_ALLOWED: 0x85,
    REQUEST_ENTITY_INCOMPLETE: 0x88,
    REQUEST_ENTITY_TOO_LARGE: 0x8D
};

// CoAP Option Numbers
export const OptionNumber = {
    IF_MATCH: 1,
    URI_HOST: 3,
    ETAG: 4,
    IF_NONE_MATCH: 5,
    URI_PORT: 7,
    LOCATION_PATH: 8,
    URI_PATH: 11,
    CONTENT_FORMAT: 12,
    MAX_AGE: 14,
    URI_QUERY: 15,
    ACCEPT: 17,
    LOCATION_QUERY: 20,
    BLOCK2: 23,
    BLOCK1: 27,
    PROXY_URI: 35,
    PROXY_SCHEME: 39,
    SIZE1: 60
};

// Content-Format for CORECONF
export const ContentFormat = {
    CBOR: 60,
    YANG_DATA_CBOR_SID: 140,
    YANG_IDENTIFIERS_CBOR: 141,
    YANG_INSTANCES_CBOR: 142
};

/**
 * Encode option value
 * @param {string|number|Uint8Array} value
 * @returns {Uint8Array}
 */
function encodeOptionValue(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'string') {
        return new TextEncoder().encode(value);
    }
    if (typeof value === 'number') {
        if (value === 0) return new Uint8Array(0);
        const bytes = [];
        let temp = value;
        while (temp > 0) {
            bytes.unshift(temp & 0xFF);
            temp >>= 8;
        }
        return new Uint8Array(bytes);
    }
    return new Uint8Array(0);
}

/**
 * Encode CoAP options
 * @param {Array} options
 * @returns {Uint8Array}
 */
function encodeOptions(options) {
    options.sort((a, b) => a.number - b.number);

    const parts = [];
    let previousNumber = 0;

    for (const option of options) {
        const delta = option.number - previousNumber;
        const value = encodeOptionValue(option.value);
        const length = value.length;

        let optionHeader = 0;
        let extendedDelta = null;
        let extendedLength = null;

        if (delta < 13) {
            optionHeader |= (delta << 4);
        } else if (delta < 269) {
            optionHeader |= (13 << 4);
            extendedDelta = new Uint8Array([delta - 13]);
        } else {
            optionHeader |= (14 << 4);
            extendedDelta = new Uint8Array(2);
            extendedDelta[0] = ((delta - 269) >> 8) & 0xFF;
            extendedDelta[1] = (delta - 269) & 0xFF;
        }

        if (length < 13) {
            optionHeader |= length;
        } else if (length < 269) {
            optionHeader |= 13;
            extendedLength = new Uint8Array([length - 13]);
        } else {
            optionHeader |= 14;
            extendedLength = new Uint8Array(2);
            extendedLength[0] = ((length - 269) >> 8) & 0xFF;
            extendedLength[1] = (length - 269) & 0xFF;
        }

        parts.push(new Uint8Array([optionHeader]));
        if (extendedDelta) parts.push(extendedDelta);
        if (extendedLength) parts.push(extendedLength);
        parts.push(value);

        previousNumber = option.number;
    }

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }

    return result;
}

/**
 * Build CoAP message
 * @param {Object} options
 * @returns {Uint8Array}
 */
export function buildMessage(options) {
    const {
        type = MessageType.CON,
        code,
        messageId = Math.floor(Math.random() * 65536),
        token = new Uint8Array(0),
        options: coapOptions = [],
        payload = null
    } = options;

    if (token.length > 8) {
        throw new Error('Token length must be 0-8 bytes');
    }

    const parts = [];

    // Header (4 bytes)
    const header = new Uint8Array(4);
    header[0] = (1 << 6) | (type << 4) | token.length;
    header[1] = code;
    header[2] = (messageId >> 8) & 0xFF;
    header[3] = messageId & 0xFF;
    parts.push(header);

    // Token
    if (token.length > 0) {
        parts.push(token);
    }

    // Options
    if (coapOptions.length > 0) {
        parts.push(encodeOptions(coapOptions));
    }

    // Payload
    if (payload && payload.length > 0) {
        parts.push(new Uint8Array([0xFF]));
        parts.push(payload);
    }

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }

    return result;
}

/**
 * Encode Block2 option value
 */
export function encodeBlock2Value(num, m, szx) {
    if (szx < 0 || szx > 6) throw new Error('Invalid SZX value');
    if (num < 0 || num >= (1 << 20)) throw new Error('Invalid block number');
    return (num << 4) | ((m ? 1 : 0) << 3) | szx;
}

/**
 * Decode Block2 option value
 */
export function decodeBlock2Value(value) {
    let intValue = 0;
    for (let i = 0; i < value.length; i++) {
        intValue = (intValue << 8) | value[i];
    }

    const szx = intValue & 0x07;
    const m = ((intValue >> 3) & 0x01) === 1;
    const num = intValue >> 4;
    const size = 1 << (szx + 4);

    return { num, m, szx, size };
}

/**
 * Encode Block1 option value
 */
export function encodeBlock1Value(num, m, szx) {
    if (szx < 0 || szx > 6) throw new Error('Invalid SZX value');
    if (num < 0 || num >= (1 << 20)) throw new Error('Invalid block number');
    return (num << 4) | ((m ? 1 : 0) << 3) | szx;
}

/**
 * Decode Block1 option value
 */
export function decodeBlock1Value(value) {
    let intValue = 0;
    for (let i = 0; i < value.length; i++) {
        intValue = (intValue << 8) | value[i];
    }

    const szx = intValue & 0x07;
    const m = ((intValue >> 3) & 0x01) === 1;
    const num = intValue >> 4;
    const size = 1 << (szx + 4);

    return { num, m, szx, size };
}

/**
 * Build iFETCH request
 */
export function buildiFetchRequest(query, options = {}) {
    // CBOR.encode returns ArrayBuffer
    const encoded = CBOR.encode(query);
    const payload = new Uint8Array(encoded);

    return buildMessage({
        type: MessageType.CON,
        code: MethodCode.FETCH,
        token: options.token || new Uint8Array(0),
        options: [
            { number: OptionNumber.URI_PATH, value: 'c' },
            { number: OptionNumber.URI_QUERY, value: 'd=a' },
            { number: OptionNumber.CONTENT_FORMAT, value: ContentFormat.YANG_IDENTIFIERS_CBOR },
            { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_INSTANCES_CBOR }
        ],
        payload,
        ...options
    });
}

/**
 * Build iPATCH request
 * contentFormat options:
 *   - 140: yang-data+cbor-sid (YANG_DATA_CBOR_SID)
 *   - 141: yang-identifiers+cbor (YANG_IDENTIFIERS_CBOR)
 *   - 142: yang-instances+cbor (YANG_INSTANCES_CBOR) [default]
 */
export function buildiPatchRequest(patch, options = {}) {
    let payload;
    if (patch instanceof Uint8Array) {
        payload = patch;
    } else {
        const encoded = CBOR.encode(patch);
        payload = new Uint8Array(encoded);
    }

    // Content-Format 142 (yang-instances+cbor) required for iPatch
    // Error 4.15 = Unsupported Content-Format if wrong
    const contentFormat = options.contentFormat !== undefined
        ? options.contentFormat
        : ContentFormat.YANG_INSTANCES_CBOR;

    return buildMessage({
        type: MessageType.CON,
        code: MethodCode.IPATCH,
        token: options.token || new Uint8Array(0),
        options: [
            { number: OptionNumber.URI_PATH, value: 'c' },
            { number: OptionNumber.CONTENT_FORMAT, value: contentFormat },
            { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_DATA_CBOR_SID }
        ],
        payload,
        ...options
    });
}

/**
 * Build GET request
 */
export function buildGetRequest(options = {}) {
    const defaultOptions = [
        { number: OptionNumber.URI_PATH, value: 'c' },
        { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_DATA_CBOR_SID }
    ];

    const customOptions = options.options || [];
    const { options: _opts, ...restOfOptions } = options;

    return buildMessage({
        type: MessageType.CON,
        code: MethodCode.GET,
        ...restOfOptions,
        options: [...defaultOptions, ...customOptions]
    });
}

/**
 * Parse CoAP response
 * @param {Uint8Array} data
 * @returns {Object}
 */
export function parseResponse(data) {
    if (data.length < 4) {
        throw new Error('Invalid CoAP message: too short');
    }

    let offset = 0;

    const version = (data[0] >> 6) & 0x03;
    const type = (data[0] >> 4) & 0x03;
    const tokenLength = data[0] & 0x0F;
    const code = data[1];
    const messageId = (data[2] << 8) | data[3];
    offset += 4;

    const token = data.slice(offset, offset + tokenLength);
    offset += tokenLength;

    const options = [];
    let previousNumber = 0;

    while (offset < data.length && data[offset] !== 0xFF) {
        const optionHeader = data[offset++];
        let delta = (optionHeader >> 4) & 0x0F;
        let length = optionHeader & 0x0F;

        if (delta === 13) {
            delta = data[offset++] + 13;
        } else if (delta === 14) {
            delta = (data[offset] << 8) | data[offset + 1];
            delta += 269;
            offset += 2;
        }

        if (length === 13) {
            length = data[offset++] + 13;
        } else if (length === 14) {
            length = (data[offset] << 8) | data[offset + 1];
            length += 269;
            offset += 2;
        }

        const number = previousNumber + delta;
        const value = data.slice(offset, offset + length);
        offset += length;

        options.push({ number, value });
        previousNumber = number;
    }

    let payload = null;
    if (offset < data.length && data[offset] === 0xFF) {
        offset++;
        payload = data.slice(offset);
    }

    return {
        version,
        type,
        code,
        messageId,
        token,
        options,
        payload,
        isSuccess: () => (code >> 5) === 2,
        getCodeClass: () => code >> 5,
        getCodeDetail: () => code & 0x1F,
        getPayloadAsCBOR: () => {
            if (!payload) return null;
            // CBOR.decode expects ArrayBuffer, not Uint8Array
            const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
            return CBOR.decode(buffer);
        },
        getBlock2Value: () => {
            const block2Opt = options.find(opt => opt.number === OptionNumber.BLOCK2);
            return block2Opt ? decodeBlock2Value(block2Opt.value) : null;
        },
        getBlock1Value: () => {
            const block1Opt = options.find(opt => opt.number === OptionNumber.BLOCK1);
            return block1Opt ? decodeBlock1Value(block1Opt.value) : null;
        }
    };
}
