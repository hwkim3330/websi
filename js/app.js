/**
 * VelocityDRIVE-SP WebSerial Application
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

// YANG SID Catalog
const yangCatalog = {
    sidMap: new Map(),
    sidToPath: new Map(),
    checksum: null
};

// DOM Elements
const $ = id => document.getElementById(id);

const elements = {
    connectBtn: $('connectBtn'),
    connectionBadge: $('connectionBadge'),
    statusValue: $('statusValue'),
    platformValue: $('platformValue'),
    versionValue: $('versionValue'),
    yangValue: $('yangValue'),
    portGrid: $('portGrid'),

    getChecksumBtn: $('getChecksumBtn'),
    fetchSystemBtn: $('fetchSystemBtn'),
    fetchBridgeBtn: $('fetchBridgeBtn'),
    fetchInterfacesBtn: $('fetchInterfacesBtn'),

    yangPathInput: $('yangPathInput'),
    fetchBtn: $('fetchBtn'),
    fetchResult: $('fetchResult'),
    copyResultBtn: $('copyResultBtn'),

    applyCbsBtn: $('applyCbsBtn'),
    applyTasBtn: $('applyTasBtn'),
    applyPtpBtn: $('applyPtpBtn'),

    terminalOutput: $('terminalOutput'),
    clearTerminalBtn: $('clearTerminalBtn'),
    autoScrollCheck: $('autoScrollCheck'),
    showHexCheck: $('showHexCheck'),

    loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'),
    toastContainer: $('toastContainer')
};

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(tab.dataset.tab + 'Tab').classList.add('active');
    });
});

// Path buttons
document.querySelectorAll('.path-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        elements.yangPathInput.value = btn.dataset.path;
    });
});

// Utilities
function showLoading(text = '처리 중...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-message">${message}</span>`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function formatTimestamp() {
    return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

function addTerminalLine(text, type = 'system') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    elements.terminalOutput.appendChild(line);
    if (elements.autoScrollCheck?.checked) {
        elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
    }
}

function updateConnectionUI(connected, ready = false) {
    if (connected && ready) {
        elements.connectionBadge.className = 'connection-badge connected';
        elements.connectionBadge.querySelector('.badge-text').textContent = '연결됨';
        elements.connectBtn.querySelector('span').textContent = '연결 해제';
        elements.statusValue.textContent = '연결됨';
        elements.statusValue.className = 'status-value status-connected';
    } else if (connected) {
        elements.connectionBadge.className = 'connection-badge connecting';
        elements.connectionBadge.querySelector('.badge-text').textContent = '연결 중...';
        elements.statusValue.textContent = '연결 중...';
    } else {
        elements.connectionBadge.className = 'connection-badge';
        elements.connectionBadge.querySelector('.badge-text').textContent = '연결 안됨';
        elements.connectBtn.querySelector('span').textContent = '연결';
        elements.statusValue.textContent = '대기 중';
        elements.statusValue.className = 'status-value status-disconnected';
        elements.platformValue.textContent = '-';
        elements.versionValue.textContent = '-';
        elements.yangValue.textContent = '-';
    }

    // Enable/disable buttons
    const btns = [
        elements.getChecksumBtn, elements.fetchSystemBtn,
        elements.fetchBridgeBtn, elements.fetchInterfacesBtn,
        elements.fetchBtn, elements.applyCbsBtn,
        elements.applyTasBtn, elements.applyPtpBtn
    ];
    btns.forEach(btn => {
        if (btn) btn.disabled = !(connected && ready);
    });
}

// YANG Catalog
async function loadYangCatalog(checksumHex) {
    console.log(`Loading YANG SID catalog for checksum: ${checksumHex}`);
    try {
        const response = await fetch(`./js/catalogs/${checksumHex}.json`);
        if (!response.ok) throw new Error('Catalog not found');

        const data = await response.json();
        for (const [path, sid] of Object.entries(data.pathToSid)) {
            yangCatalog.sidMap.set(path, sid);
        }
        yangCatalog.sidToPath = new Map(
            Object.entries(data.sidToPath).map(([k, v]) => [parseInt(k), v])
        );
        yangCatalog.checksum = checksumHex;
        console.log(`Loaded ${yangCatalog.sidToPath.size} SID mappings`);
        elements.yangValue.textContent = checksumHex.substring(0, 8) + '...';
        return true;
    } catch (error) {
        console.error('Failed to load catalog:', error);
        return false;
    }
}

function pathToSidQuery(path) {
    // Try direct SID lookup
    if (yangCatalog.sidMap.has(path)) {
        return yangCatalog.sidMap.get(path);
    }
    // Common SID mappings
    const commonSids = {
        '/ietf-system:system-state': 19020,
        '/ietf-system:system-state/platform': 19024,
        '/ietf-interfaces:interfaces': 2005,
        '/ieee802-dot1q-bridge:bridges': 7025,
        '/ieee1588-ptp:ptp': 8000
    };
    return commonSids[path] || null;
}

function getSidName(sid) {
    if (yangCatalog.sidToPath.has(sid)) {
        const path = yangCatalog.sidToPath.get(sid);
        const parts = path.split('/');
        const last = parts[parts.length - 1];
        return last.includes(':') ? last.split(':')[1] : last;
    }
    return null;
}

function decodeDeltaSids(data, parentSid) {
    if (data === null || typeof data !== 'object') return data;

    if (data instanceof Map) {
        const result = {};
        for (const [key, value] of data.entries()) {
            const absoluteSid = typeof key === 'number' ? parentSid + key : key;
            const name = getSidName(absoluteSid) || String(absoluteSid);
            result[name] = decodeDeltaSids(value, absoluteSid);
        }
        return result;
    }

    if (Array.isArray(data)) {
        return data.map(item => decodeDeltaSids(item, parentSid));
    }

    if (typeof data === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            const numKey = parseInt(key);
            if (!isNaN(numKey)) {
                const absoluteSid = parentSid + numKey;
                const name = getSidName(absoluteSid) || String(absoluteSid);
                result[name] = decodeDeltaSids(value, absoluteSid);
            } else {
                result[key] = decodeDeltaSids(value, parentSid);
            }
        }
        return result;
    }

    return data;
}

// API Functions
async function fetchChecksum() {
    showLoading('체크섬 조회 중...');
    try {
        const query = [29304];
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            let checksumHex = null;

            if (data instanceof Map) {
                for (const value of data.values()) {
                    if (typeof value === 'string') checksumHex = value;
                }
            }

            if (checksumHex) {
                await loadYangCatalog(checksumHex);
                showToast('YANG 카탈로그 로드 완료', 'success');
            }
        }
    } catch (error) {
        console.error('Checksum fetch error:', error);
        addTerminalLine(`체크섬 조회 실패: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function fetchSystemInfo() {
    try {
        const response = await serialManager.sendiFetchRequest(19024);
        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            // Top-level keys are absolute SIDs (delta from 0)
            const decoded = decodeDeltaSids(data, 0);
            console.log('System info decoded:', decoded);

            // Look for platform info in the decoded data
            // The structure might be: { "platform": { "os-name": ..., "os-version": ... } }
            // or nested under SID 19024 key
            const platform = decoded['platform'] || decoded;

            if (platform['os-name']) {
                elements.platformValue.textContent = platform['os-name'];
            }
            if (platform['os-version']) {
                elements.versionValue.textContent = platform['os-version'];
            }
        }
    } catch (error) {
        console.error('System info error:', error);
    }
}

async function fetchPath(path) {
    showLoading('조회 중...');
    try {
        const query = pathToSidQuery(path);
        if (!query) {
            elements.fetchResult.textContent = `// SID를 찾을 수 없습니다: ${path}`;
            return;
        }

        addTerminalLine(`Fetching: ${path} (SID: ${query})`, 'info');
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            // CORECONF response: top-level keys are absolute SIDs (delta from 0)
            // So we start with parentSid=0, not the query SID
            const decoded = decodeDeltaSids(data, 0);
            elements.fetchResult.textContent = JSON.stringify(decoded, null, 2);
        } else {
            elements.fetchResult.textContent = `// Error: ${response.code}`;
        }
    } catch (error) {
        elements.fetchResult.textContent = `// Error: ${error.message}`;
        addTerminalLine(`조회 실패: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// Event Handlers
serialManager.addEventListener('connected', () => {
    console.log('Connected');
    updateConnectionUI(true, false);
    addTerminalLine(`[${formatTimestamp()}] 시리얼 포트 연결됨`, 'info');
});

serialManager.addEventListener('disconnected', () => {
    console.log('Disconnected');
    updateConnectionUI(false);
    addTerminalLine(`[${formatTimestamp()}] 연결 해제됨`, 'system');
});

serialManager.addEventListener('announce', async () => {
    console.log('Board ready');
    updateConnectionUI(true, true);
    addTerminalLine(`[${formatTimestamp()}] ANNOUNCE - 보드 준비 완료`, 'info');

    // Auto-init
    try {
        await fetchChecksum();
        await fetchSystemInfo();
        showToast('보드 초기화 완료!', 'success');
    } catch (error) {
        console.error('Auto-init error:', error);
    }
});

serialManager.addEventListener('trace', (e) => {
    addTerminalLine(`TRACE: ${e.detail.error}`, 'error');
});

serialManager.addEventListener('tx', (e) => {
    if (elements.showHexCheck?.checked) {
        addTerminalLine(`TX: ${e.detail.hex}`, 'tx');
    }
});

serialManager.addEventListener('rx', (e) => {
    if (elements.showHexCheck?.checked) {
        addTerminalLine(`RX: ${e.detail.hex}`, 'rx');
    }
});

// Button handlers
elements.connectBtn.addEventListener('click', async () => {
    try {
        if (serialManager.isConnected) {
            await serialManager.disconnect();
        } else {
            elements.connectionBadge.className = 'connection-badge connecting';
            elements.connectionBadge.querySelector('.badge-text').textContent = '연결 중...';
            await serialManager.connect();
        }
    } catch (error) {
        console.error('Connection error:', error);
        showToast(error.message, 'error');
        updateConnectionUI(false);
    }
});

elements.getChecksumBtn?.addEventListener('click', fetchChecksum);
elements.fetchSystemBtn?.addEventListener('click', () => fetchPath('/ietf-system:system-state/platform'));
elements.fetchBridgeBtn?.addEventListener('click', () => fetchPath('/ieee802-dot1q-bridge:bridges'));
elements.fetchInterfacesBtn?.addEventListener('click', () => fetchPath('/ietf-interfaces:interfaces'));

elements.fetchBtn?.addEventListener('click', () => {
    const path = elements.yangPathInput.value.trim();
    if (path) fetchPath(path);
});

elements.yangPathInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const path = elements.yangPathInput.value.trim();
        if (path) fetchPath(path);
    }
});

elements.copyResultBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.fetchResult.textContent);
    showToast('복사됨', 'success');
});

elements.clearTerminalBtn?.addEventListener('click', () => {
    elements.terminalOutput.innerHTML = '<div class="terminal-line system">터미널 클리어</div>';
});

// Initialize
updateConnectionUI(false);
console.log('VelocityDRIVE-SP WebSerial ready');
