/**
 * WebSerial Manager for MUP1/CoAP communication
 */

import { FrameBuffer, buildFrame, FrameType } from './mup1.js';
import {
    buildiFetchRequest,
    buildiPatchRequest,
    buildGetRequest,
    buildMessage,
    parseResponse,
    OptionNumber,
    ContentFormat,
    ResponseCode,
    MessageType,
    MethodCode,
    encodeBlock2Value,
    encodeBlock1Value
} from './coap.js';

const DEFAULT_BLOCK_SIZE_EXPONENT = 6;

export class WebSerialManager extends EventTarget {
    constructor() {
        super();
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.frameBuffer = new FrameBuffer();
        this.isConnected = false;
        this.boardReady = false;
        this.pendingRequests = new Map();
        this.requestTimeout = 30000;
        this.readLoopActive = false;
    }

    /**
     * Check WebSerial support
     */
    static isSupported() {
        return 'serial' in navigator;
    }

    /**
     * Connect to serial port
     */
    async connect(options = {}) {
        if (!WebSerialManager.isSupported()) {
            throw new Error('WebSerial is not supported in this browser');
        }

        if (this.isConnected) {
            throw new Error('Already connected');
        }

        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({
                baudRate: options.baudRate || 115200,
                dataBits: options.dataBits || 8,
                stopBits: options.stopBits || 1,
                parity: options.parity || 'none'
            });

            this.isConnected = true;
            this.dispatchEvent(new CustomEvent('connected', {
                detail: { port: this.port.getInfo() }
            }));

            // Start read loop
            this._startReadLoop();

            // Send PING to initiate handshake
            await this.sendPing();

            return this.port.getInfo();
        } catch (error) {
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Disconnect from serial port
     */
    async disconnect() {
        if (!this.isConnected || !this.port) {
            return;
        }

        this.readLoopActive = false;

        // Cancel pending requests
        for (const [messageId, request] of this.pendingRequests.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Disconnected'));
            this.pendingRequests.delete(messageId);
        }

        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }

            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }

            await this.port.close();
        } catch (e) {
            console.warn('Error during disconnect:', e);
        }

        this.isConnected = false;
        this.boardReady = false;
        this.port = null;
        this.frameBuffer.clear();

        this.dispatchEvent(new CustomEvent('disconnected'));
    }

    /**
     * Start reading from serial port
     */
    async _startReadLoop() {
        if (!this.port || !this.port.readable) {
            return;
        }

        this.readLoopActive = true;

        while (this.readLoopActive && this.port.readable) {
            try {
                this.reader = this.port.readable.getReader();

                while (this.readLoopActive) {
                    const { value, done } = await this.reader.read();

                    if (done) {
                        break;
                    }

                    if (value) {
                        this._handleData(value);
                    }
                }
            } catch (error) {
                if (this.readLoopActive) {
                    console.error('Read error:', error);
                    this.dispatchEvent(new CustomEvent('error', { detail: error }));
                }
            } finally {
                if (this.reader) {
                    try {
                        this.reader.releaseLock();
                    } catch (e) {}
                    this.reader = null;
                }
            }
        }
    }

    /**
     * Handle incoming data
     */
    _handleData(data) {
        this.dispatchEvent(new CustomEvent('rx', {
            detail: { data: data, hex: this._toHex(data) }
        }));

        const frames = this.frameBuffer.addData(data);

        for (const frame of frames) {
            this._handleFrame(frame);
        }
    }

    /**
     * Handle parsed MUP1 frame
     */
    _handleFrame(frame) {
        if (frame.type === FrameType.COAP || frame.type === FrameType.COAP_RESPONSE) {
            try {
                const coapResponse = parseResponse(frame.payload);

                const pending = this.pendingRequests.get(coapResponse.messageId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingRequests.delete(coapResponse.messageId);
                    pending.resolve(coapResponse);
                }

                this.dispatchEvent(new CustomEvent('response', { detail: coapResponse }));
            } catch (err) {
                console.error('Failed to parse CoAP response:', err);
                this.dispatchEvent(new CustomEvent('error', {
                    detail: new Error(`Parse error: ${err.message}`)
                }));
            }
        } else if (frame.type === FrameType.ANNOUNCE) {
            console.log('[MUP1] Announce frame received - Board is ready');
            this.boardReady = true;
            this.dispatchEvent(new CustomEvent('announce', {
                detail: { data: frame.payload }
            }));
        } else if (frame.type === FrameType.TRACE) {
            const errorMessage = new TextDecoder().decode(frame.payload);
            console.log('[MUP1] Trace frame:', errorMessage);

            // TRACE frames are often informational logging from the device
            // Don't reject pending requests - wait for actual CoAP response
            // Only reject on fatal TRACE errors that won't have a CoAP response
            const isFatalError = errorMessage.includes('coap data cannot be transported by MUP1') ||
                                 errorMessage.includes('MUP1 frame too large');

            if (isFatalError && this.pendingRequests.size > 0) {
                console.warn('[MUP1] Fatal error, failing pending requests');
                for (const [messageId, pending] of this.pendingRequests.entries()) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(`Device error: ${errorMessage}`));
                    this.pendingRequests.delete(messageId);
                }
            }

            this.dispatchEvent(new CustomEvent('trace', {
                detail: { data: frame.payload, error: errorMessage }
            }));
        }
    }

    /**
     * Send PING frame
     */
    async sendPing() {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }

        console.log('[MUP1] Sending PING...');
        const pingFrame = buildFrame(new Uint8Array(0), { type: FrameType.PING_REQ });
        await this._writeData(pingFrame);
    }

    /**
     * Write data to serial port
     */
    async _writeData(data) {
        if (!this.port || !this.port.writable) {
            throw new Error('Port not writable');
        }

        const writer = this.port.writable.getWriter();
        try {
            await writer.write(data);
            this.dispatchEvent(new CustomEvent('tx', {
                detail: { data: data, hex: this._toHex(data) }
            }));
        } finally {
            writer.releaseLock();
        }
    }

    /**
     * Send CoAP request wrapped in MUP1
     */
    async _sendRequest(coapFrame, messageId) {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }

        if (!this.boardReady) {
            throw new Error('Board not ready. ANNOUNCE frame not received yet.');
        }

        const mup1Frame = buildFrame(coapFrame, { type: FrameType.COAP });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new Error('Request timeout'));
            }, this.requestTimeout);

            this.pendingRequests.set(messageId, {
                resolve,
                reject,
                timeout
            });

            this._writeData(mup1Frame).catch(err => {
                clearTimeout(timeout);
                this.pendingRequests.delete(messageId);
                reject(err);
            });
        });
    }

    /**
     * Send iFETCH request with Block2 response support
     * Compatible with LAN9662/LAN9692 VelocityDRIVE-SP boards
     *
     * IMPORTANT: Include Block2 in initial request to request small block size
     * Default server block size may exceed MUP1 frame limit
     */
    async sendiFetchRequest(query, options = {}) {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }
        if (!this.boardReady) {
            throw new Error('Board not ready');
        }

        const payloads = [];
        let lastResponse = null;

        // Token must be same for all blocks (RFC 7959)
        const token = options.token || new Uint8Array([
            Math.floor(Math.random() * 256),
            Math.floor(Math.random() * 256)
        ]);

        // SZX=2 → 64 bytes (very safe for MUP1)
        // SZX=3 → 128 bytes
        // SZX=4 → 256 bytes
        const szx = options.blockSize !== undefined ? options.blockSize : 2;

        // Initial request WITH Block2 to request small block size (RFC 7959 Section 2.3)
        const initialMessageId = Math.floor(Math.random() * 65536);
        const block2Value = encodeBlock2Value(0, false, szx);

        const coapFrame = buildMessage({
            type: MessageType.CON,
            code: MethodCode.FETCH,
            messageId: initialMessageId,
            token,
            options: [
                { number: OptionNumber.URI_PATH, value: 'c' },
                { number: OptionNumber.URI_QUERY, value: 'd=a' },
                { number: OptionNumber.CONTENT_FORMAT, value: ContentFormat.YANG_IDENTIFIERS_CBOR },
                { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_INSTANCES_CBOR },
                { number: OptionNumber.BLOCK2, value: block2Value }
            ],
            payload: new Uint8Array(CBOR.encode(query))
        });

        const firstResponse = await this._sendRequest(coapFrame, initialMessageId);
        lastResponse = firstResponse;

        if (!firstResponse.isSuccess()) {
            throw new Error(`iFETCH failed with code ${firstResponse.code}`);
        }

        if (firstResponse.payload) {
            payloads.push(firstResponse.payload);
        }

        // Check for Block2 in response (server-initiated block transfer)
        let block2 = firstResponse.getBlock2Value();
        let more = block2 ? block2.m : false;
        let blockNum = block2 ? block2.num : 0;

        // Fetch remaining blocks if needed
        while (more) {
            blockNum++;

            const messageId = Math.floor(Math.random() * 65536);
            const block2Value = encodeBlock2Value(blockNum, false, block2.szx);
            const block2Option = { number: OptionNumber.BLOCK2, value: block2Value };

            // Build iFETCH with Block2 option for continuation
            const continuationFrame = buildMessage({
                type: MessageType.CON,
                code: MethodCode.FETCH,
                messageId,
                token,
                options: [
                    { number: OptionNumber.URI_PATH, value: 'c' },
                    { number: OptionNumber.URI_QUERY, value: 'd=a' },
                    { number: OptionNumber.CONTENT_FORMAT, value: ContentFormat.YANG_IDENTIFIERS_CBOR },
                    { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_INSTANCES_CBOR },
                    block2Option
                ],
                payload: new Uint8Array(CBOR.encode(query))
            });

            const coapResponse = await this._sendRequest(continuationFrame, messageId);
            lastResponse = coapResponse;

            if (!coapResponse.isSuccess()) {
                throw new Error(`Block ${blockNum} failed with code ${coapResponse.code}`);
            }

            if (coapResponse.payload) {
                payloads.push(coapResponse.payload);
            }

            const nextBlock2 = coapResponse.getBlock2Value();
            if (nextBlock2) {
                more = nextBlock2.m;
                block2 = nextBlock2;
            } else {
                more = false;
            }
        }

        // Assemble payload if multiple blocks
        if (payloads.length > 1) {
            const totalLength = payloads.reduce((sum, p) => sum + p.length, 0);
            const assembledPayload = new Uint8Array(totalLength);
            let offset = 0;
            for (const p of payloads) {
                assembledPayload.set(p, offset);
                offset += p.length;
            }

            return {
                ...lastResponse,
                payload: assembledPayload,
                getPayloadAsCBOR: () => {
                    if (assembledPayload.length === 0) return null;
                    const buffer = assembledPayload.buffer.slice(
                        assembledPayload.byteOffset,
                        assembledPayload.byteOffset + assembledPayload.byteLength
                    );
                    return CBOR.decode(buffer);
                }
            };
        }

        return lastResponse;
    }

    /**
     * Send iPATCH request with Block1 support
     */
    async sendiPatchRequest(patch, options = {}) {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }
        if (!this.boardReady) {
            throw new Error('Board not ready');
        }

        let payload;
        if (patch instanceof Uint8Array) {
            payload = patch;
        } else {
            const encoded = CBOR.encode(patch);
            payload = new Uint8Array(encoded);
        }
        const totalSize = payload.length;

        const token = options.token || new Uint8Array([
            Math.floor(Math.random() * 256),
            Math.floor(Math.random() * 256)
        ]);

        let szx = options.blockSize || DEFAULT_BLOCK_SIZE_EXPONENT;
        let blockSize = 1 << (szx + 4);

        if (totalSize <= blockSize) {
            const messageId = Math.floor(Math.random() * 65536);
            const coapFrame = buildiPatchRequest(payload, {
                messageId,
                token,
                ...options
            });
            return this._sendRequest(coapFrame, messageId);
        }

        // Block-wise transfer
        let blockNum = 0;
        let offset = 0;
        let lastResponse = null;

        while (offset < totalSize) {
            const chunk = payload.slice(offset, offset + blockSize);
            const moreBlocks = (offset + chunk.length) < totalSize;
            const messageId = Math.floor(Math.random() * 65536);

            const block1Value = encodeBlock1Value(blockNum, moreBlocks, szx);
            const block1Option = { number: OptionNumber.BLOCK1, value: block1Value };

            const coapOptions = [
                { number: OptionNumber.URI_PATH, value: 'c' },
                { number: OptionNumber.CONTENT_FORMAT, value: ContentFormat.YANG_INSTANCES_CBOR },
                { number: OptionNumber.ACCEPT, value: ContentFormat.YANG_DATA_CBOR_SID },
                block1Option
            ];

            const coapFrame = buildMessage({
                type: MessageType.CON,
                code: MethodCode.IPATCH,
                messageId,
                token,
                options: coapOptions,
                payload: chunk
            });

            const response = await this._sendRequest(coapFrame, messageId);
            lastResponse = response;

            if (moreBlocks && response.code !== ResponseCode.CONTINUE) {
                throw new Error(`Expected 2.31 Continue, got ${response.code}`);
            }

            if (!moreBlocks && !response.isSuccess()) {
                throw new Error(`Final block failed with code ${response.code}`);
            }

            const responseBlock1 = response.getBlock1Value();
            if (responseBlock1 && responseBlock1.szx < szx) {
                szx = responseBlock1.szx;
                blockSize = 1 << (szx + 4);
            }

            offset += chunk.length;
            blockNum++;
        }

        return lastResponse;
    }

    /**
     * Send GET request with Block2 support
     * Compatible with LAN9662/LAN9692 VelocityDRIVE-SP boards
     */
    async sendGetRequest(options = {}) {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }
        if (!this.boardReady) {
            throw new Error('Board not ready');
        }

        const payloads = [];
        let lastResponse = null;

        const token = options.token || new Uint8Array([
            Math.floor(Math.random() * 256),
            Math.floor(Math.random() * 256)
        ]);

        // Initial request WITHOUT Block2 (let server decide block size)
        const initialMessageId = Math.floor(Math.random() * 65536);
        const { token: _token, messageId: _mid, ...restOptions } = options;

        const initialCoapFrame = buildGetRequest({
            ...restOptions,
            messageId: initialMessageId,
            token
        });

        const firstResponse = await this._sendRequest(initialCoapFrame, initialMessageId);
        lastResponse = firstResponse;

        if (!firstResponse.isSuccess()) {
            throw new Error(`CoAP request failed with code ${firstResponse.code}`);
        }

        if (firstResponse.payload) {
            payloads.push(firstResponse.payload);
        }

        let block2 = firstResponse.getBlock2Value();
        let more = block2 ? block2.m : false;
        let blockNum = block2 ? block2.num : 0;

        while (more) {
            blockNum++;

            const messageId = Math.floor(Math.random() * 65536);
            const block2Value = encodeBlock2Value(blockNum, false, block2.szx);
            const block2Option = { number: OptionNumber.BLOCK2, value: block2Value };

            const coapFrame = buildGetRequest({
                ...restOptions,
                messageId,
                token,
                options: [block2Option, ...(options.options || [])]
            });

            const coapResponse = await this._sendRequest(coapFrame, messageId);
            lastResponse = coapResponse;

            if (!coapResponse.isSuccess()) {
                throw new Error(`Block ${blockNum} failed with code ${coapResponse.code}`);
            }

            if (coapResponse.payload) {
                payloads.push(coapResponse.payload);
            }

            const nextBlock2 = coapResponse.getBlock2Value();
            if (nextBlock2) {
                more = nextBlock2.m;
                block2 = nextBlock2;
            } else {
                more = false;
            }
        }

        // Assemble payload
        const totalLength = payloads.reduce((sum, p) => sum + p.length, 0);
        const assembledPayload = new Uint8Array(totalLength);
        let offset = 0;
        for (const p of payloads) {
            assembledPayload.set(p, offset);
            offset += p.length;
        }

        return {
            ...lastResponse,
            payload: assembledPayload,
            getPayloadAsCBOR: () => {
                if (assembledPayload.length === 0) return null;
                const buffer = assembledPayload.buffer.slice(
                    assembledPayload.byteOffset,
                    assembledPayload.byteOffset + assembledPayload.byteLength
                );
                return CBOR.decode(buffer);
            }
        };
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            boardReady: this.boardReady
        };
    }

    /**
     * Helper: Convert Uint8Array to hex string
     */
    _toHex(data) {
        return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }
}

// Create singleton instance
export const serialManager = new WebSerialManager();
