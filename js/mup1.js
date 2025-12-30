/**
 * MUP1 (Microchip UART Protocol 1) - WebSerial Implementation
 * Based on keti-tsn-cli mup1-v2.js
 */

// Frame markers
export const SOF = 0x3E;  // '>'
export const EOF = 0x3C;  // '<'
export const ESC = 0x5C;  // '\\'
export const ESC_00 = 0x30;  // '0' (escaped 0x00)
export const ESC_FF = 0x46;  // 'F' (escaped 0xFF)

// Frame types
export const FrameType = {
    ANNOUNCE:      0x50,  // 'P' (Frame sent by device after PING_REQ)
    COAP:          0x63,  // 'c' (lowercase - for sending requests)
    COAP_RESPONSE: 0x43,  // 'C' (uppercase - device may respond with this)
    PING_REQ:      0x70,  // 'p' (Frame sent by host to initiate handshake)
    TRACE:         0x54,  // 'T'
};

/**
 * Calculate Internet Checksum (RFC 1071)
 * @param {Uint8Array} data
 * @returns {string} 4-char hex string
 */
export function calculateChecksum(data) {
    let sum = 0;

    for (let i = 0; i < data.length; i += 2) {
        if (i + 1 < data.length) {
            sum += (data[i] << 8) + data[i + 1];
        } else {
            sum += data[i] << 8;
        }
    }

    sum = (sum >> 16) + (sum & 0xFFFF);
    sum = (sum >> 16) + (sum & 0xFFFF);
    sum = (~sum) & 0xFFFF;

    return sum.toString(16).padStart(4, '0');
}

/**
 * Escape special bytes for byte stuffing
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function escapeData(data) {
    const escaped = [];

    for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        if (byte === SOF || byte === EOF || byte === ESC) {
            escaped.push(ESC);
            escaped.push(byte);
        } else {
            escaped.push(byte);
        }
    }

    return new Uint8Array(escaped);
}

/**
 * Unescape data
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function unescapeData(data) {
    const unescaped = [];
    let i = 0;

    while (i < data.length) {
        if (data[i] === ESC && i + 1 < data.length) {
            const next = data[i + 1];
            if (next === ESC_00) {
                unescaped.push(0x00);
            } else if (next === ESC_FF) {
                unescaped.push(0xFF);
            } else {
                unescaped.push(next);
            }
            i += 2;
        } else {
            unescaped.push(data[i]);
            i++;
        }
    }

    return new Uint8Array(unescaped);
}

/**
 * Build MUP1 frame
 * @param {Uint8Array} payload
 * @param {Object} options
 * @returns {Uint8Array}
 */
export function buildFrame(payload, options = {}) {
    const type = options.type || FrameType.COAP;

    // Build frame for checksum calculation
    const checksumDataLen = 2 + payload.length + 1 + (payload.length % 2 === 0 ? 1 : 0);
    const frameForChecksum = new Uint8Array(checksumDataLen);
    let idx = 0;
    frameForChecksum[idx++] = SOF;
    frameForChecksum[idx++] = type;
    for (let i = 0; i < payload.length; i++) {
        frameForChecksum[idx++] = payload[i];
    }
    frameForChecksum[idx++] = EOF;
    if (payload.length % 2 === 0) {
        frameForChecksum[idx++] = EOF;
    }

    const checksumStr = calculateChecksum(frameForChecksum);
    const checksumBytes = new TextEncoder().encode(checksumStr);

    // Build actual frame with byte stuffing
    const escapedPayload = escapeData(payload);
    const eofCount = payload.length % 2 === 0 ? 2 : 1;
    const frameLen = 1 + 1 + escapedPayload.length + eofCount + 4;
    const frame = new Uint8Array(frameLen);

    idx = 0;
    frame[idx++] = SOF;
    frame[idx++] = type;
    for (let i = 0; i < escapedPayload.length; i++) {
        frame[idx++] = escapedPayload[i];
    }
    frame[idx++] = EOF;
    if (payload.length % 2 === 0) {
        frame[idx++] = EOF;
    }
    for (let i = 0; i < checksumBytes.length; i++) {
        frame[idx++] = checksumBytes[i];
    }

    return frame;
}

/**
 * Parse MUP1 frame
 * @param {Uint8Array} data
 * @returns {Object|null}
 */
export function parseFrame(data) {
    let offset = 0;

    if (data[offset] !== SOF) {
        console.error(`[MUP1] Invalid SOF: expected 0x3E, got 0x${data[offset].toString(16)}`);
        return null;
    }
    offset++;

    const type = data[offset++];

    // Find EOF marker(s)
    let eofIndex = -1;
    for (let i = offset; i < data.length; i++) {
        if (data[i] === EOF) {
            if (i > offset && data[i - 1] === ESC) {
                continue;
            }
            eofIndex = i;
            break;
        }
    }

    if (eofIndex === -1) {
        console.error('[MUP1] No EOF marker found');
        return null;
    }

    const escapedPayload = data.slice(offset, eofIndex);
    const payload = unescapeData(escapedPayload);

    offset = eofIndex + 1;
    if (offset < data.length && data[offset] === EOF) {
        offset++;
    }

    if (offset + 4 > data.length) {
        console.error('[MUP1] Insufficient data for checksum');
        return null;
    }

    const receivedChecksum = new TextDecoder().decode(data.slice(offset, offset + 4));

    // Verify checksum
    const checksumDataLen = 2 + payload.length + 1 + (payload.length % 2 === 0 ? 1 : 0);
    const frameForChecksum = new Uint8Array(checksumDataLen);
    let idx = 0;
    frameForChecksum[idx++] = SOF;
    frameForChecksum[idx++] = type;
    for (let i = 0; i < payload.length; i++) {
        frameForChecksum[idx++] = payload[i];
    }
    frameForChecksum[idx++] = EOF;
    if (payload.length % 2 === 0) {
        frameForChecksum[idx++] = EOF;
    }

    const calculatedChecksum = calculateChecksum(frameForChecksum);

    if (receivedChecksum !== calculatedChecksum) {
        console.error(`[MUP1] Checksum mismatch: received=${receivedChecksum}, calculated=${calculatedChecksum}`);
        return null;
    }

    return {
        type,
        payload,
        isValid: true
    };
}

/**
 * Frame buffer for handling fragmented frames
 */
export class FrameBuffer {
    constructor() {
        this.buffer = new Uint8Array(0);
    }

    addData(data) {
        const newBuffer = new Uint8Array(this.buffer.length + data.length);
        newBuffer.set(this.buffer);
        newBuffer.set(data, this.buffer.length);
        this.buffer = newBuffer;

        const frames = [];

        while (true) {
            const sofIndex = this.buffer.indexOf(SOF);
            if (sofIndex === -1) {
                this.buffer = new Uint8Array(0);
                break;
            }

            if (sofIndex > 0) {
                this.buffer = this.buffer.slice(sofIndex);
            }

            if (this.buffer.length < 7) {
                break;
            }

            let eofIndex = -1;
            for (let i = 1; i < this.buffer.length; i++) {
                if (this.buffer[i] === EOF) {
                    if (i > 1 && this.buffer[i - 1] === ESC) {
                        continue;
                    }
                    eofIndex = i;
                    break;
                }
            }

            if (eofIndex === -1) {
                if (this.buffer.length > 4096) {
                    this.buffer = this.buffer.slice(1);
                }
                break;
            }

            let checksumOffset = eofIndex + 1;
            if (checksumOffset < this.buffer.length && this.buffer[checksumOffset] === EOF) {
                checksumOffset++;
            }

            if (this.buffer.length < checksumOffset + 4) {
                break;
            }

            const frameEnd = checksumOffset + 4;
            const frameData = this.buffer.slice(0, frameEnd);
            const frame = parseFrame(frameData);

            if (frame) {
                frames.push(frame);
                this.buffer = this.buffer.slice(frameEnd);
            } else {
                this.buffer = this.buffer.slice(1);
            }
        }

        return frames;
    }

    clear() {
        this.buffer = new Uint8Array(0);
    }
}
