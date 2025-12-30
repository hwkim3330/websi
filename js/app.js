/**
 * KETI TSN WebSerial - Main Application
 */

import { serialManager } from './webserial.js';

// DOM Elements
const elements = {
    connectBtn: document.getElementById('connectBtn'),
    connectionStatus: document.getElementById('connectionStatus'),
    deviceInfo: document.getElementById('deviceInfo'),
    cardStatusIcon: document.getElementById('cardStatusIcon'),
    connStatusText: document.getElementById('connStatusText'),
    platformInfo: document.getElementById('platformInfo'),
    versionInfo: document.getElementById('versionInfo'),
    yangCacheStatus: document.getElementById('yangCacheStatus'),
    downloadYangBtn: document.getElementById('downloadYangBtn'),

    // Quick actions
    getChecksumBtn: document.getElementById('getChecksumBtn'),
    getConfigBtn: document.getElementById('getConfigBtn'),
    fetchSystemBtn: document.getElementById('fetchSystemBtn'),
    fetchBridgeBtn: document.getElementById('fetchBridgeBtn'),

    // Config panel
    yangPathInput: document.getElementById('yangPathInput'),
    fetchBtn: document.getElementById('fetchBtn'),
    fetchResult: document.getElementById('fetchResult'),
    copyResultBtn: document.getElementById('copyResultBtn'),

    // TSN panel
    applyCbsBtn: document.getElementById('applyCbsBtn'),
    applyTasBtn: document.getElementById('applyTasBtn'),
    addGateEntry: document.getElementById('addGateEntry'),
    gateEntries: document.getElementById('gateEntries'),

    // Terminal
    terminalOutput: document.getElementById('terminalOutput'),
    clearTerminalBtn: document.getElementById('clearTerminalBtn'),
    autoScrollCheck: document.getElementById('autoScrollCheck'),
    showHexCheck: document.getElementById('showHexCheck'),

    // Loading
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),

    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

        item.classList.add('active');
        const panelId = item.dataset.panel + 'Panel';
        document.getElementById(panelId).classList.add('active');
    });
});

// TSN Tabs
document.querySelectorAll('.tsn-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tsn-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tsn-tab-panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Tab').classList.add('active');
    });
});

// Example path buttons
document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        elements.yangPathInput.value = btn.dataset.path;
    });
});

// Utility functions
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

    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-message">${message}</div>
    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function addTerminalLine(message, type = 'system') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = message;
    elements.terminalOutput.appendChild(line);

    if (elements.autoScrollCheck.checked) {
        elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
    }
}

function formatTimestamp() {
    return new Date().toLocaleTimeString();
}

function updateConnectionUI(connected, ready = false) {
    if (connected) {
        elements.connectionStatus.classList.add('connected');
        elements.connectionStatus.classList.remove('connecting');
        elements.connectionStatus.querySelector('.status-text').textContent = ready ? '연결됨' : '대기 중...';
        elements.connectBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            연결 해제
        `;
        elements.cardStatusIcon.classList.toggle('connected', ready);
        elements.connStatusText.textContent = ready ? '보드 연결됨' : 'ANNOUNCE 대기 중';
    } else {
        elements.connectionStatus.classList.remove('connected', 'connecting');
        elements.connectionStatus.querySelector('.status-text').textContent = '연결 안됨';
        elements.connectBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            연결
        `;
        elements.cardStatusIcon.classList.remove('connected');
        elements.connStatusText.textContent = '연결 대기';
        elements.deviceInfo.querySelector('.device-value').textContent = '-';
        elements.platformInfo.textContent = '-';
        elements.versionInfo.textContent = '-';
    }

    // Enable/disable buttons
    const buttonsToToggle = [
        elements.downloadYangBtn,
        elements.getChecksumBtn,
        elements.getConfigBtn,
        elements.fetchSystemBtn,
        elements.fetchBridgeBtn,
        elements.fetchBtn,
        elements.applyCbsBtn,
        elements.applyTasBtn
    ];

    buttonsToToggle.forEach(btn => {
        if (btn) btn.disabled = !ready;
    });
}

// Serial Manager Event Handlers
serialManager.addEventListener('connected', (e) => {
    console.log('Connected:', e.detail);
    updateConnectionUI(true, false);
    addTerminalLine(`[${formatTimestamp()}] 시리얼 포트 연결됨`, 'info');

    if (e.detail.port) {
        const info = e.detail.port;
        elements.deviceInfo.querySelector('.device-value').textContent =
            info.usbVendorId ? `VID:${info.usbVendorId.toString(16)} PID:${info.usbProductId.toString(16)}` : 'USB Serial';
    }
});

serialManager.addEventListener('disconnected', () => {
    console.log('Disconnected');
    updateConnectionUI(false);
    addTerminalLine(`[${formatTimestamp()}] 시리얼 포트 연결 해제됨`, 'system');
});

serialManager.addEventListener('announce', (e) => {
    console.log('Board ready');
    updateConnectionUI(true, true);
    showToast('보드 연결 완료!', 'success');
    addTerminalLine(`[${formatTimestamp()}] ANNOUNCE 수신 - 보드 준비 완료`, 'info');

    // Try to fetch system info
    fetchSystemInfo();
});

serialManager.addEventListener('tx', (e) => {
    const hex = elements.showHexCheck.checked ? ` [${e.detail.hex}]` : '';
    addTerminalLine(`[${formatTimestamp()}] TX: ${e.detail.data.length} bytes${hex}`, 'tx');
});

serialManager.addEventListener('rx', (e) => {
    const hex = elements.showHexCheck.checked ? ` [${e.detail.hex}]` : '';
    addTerminalLine(`[${formatTimestamp()}] RX: ${e.detail.data.length} bytes${hex}`, 'rx');
});

serialManager.addEventListener('error', (e) => {
    console.error('Serial error:', e.detail);
    addTerminalLine(`[${formatTimestamp()}] 에러: ${e.detail.message || e.detail}`, 'error');
    showToast(e.detail.message || '오류가 발생했습니다', 'error');
});

serialManager.addEventListener('trace', (e) => {
    addTerminalLine(`[${formatTimestamp()}] TRACE: ${e.detail.error}`, 'error');
});

// Connect/Disconnect button
elements.connectBtn.addEventListener('click', async () => {
    try {
        if (serialManager.isConnected) {
            await serialManager.disconnect();
        } else {
            elements.connectionStatus.classList.add('connecting');
            elements.connectionStatus.querySelector('.status-text').textContent = '연결 중...';
            await serialManager.connect();
        }
    } catch (error) {
        console.error('Connection error:', error);
        updateConnectionUI(false);
        showToast(error.message, 'error');
    }
});

// Fetch system info
async function fetchSystemInfo() {
    try {
        // SID for /ietf-system:system-state/platform is typically around 1716
        // Using instance-identifier format for query
        const query = [1716]; // SID for system-state/platform
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            console.log('System info:', data);

            // Try to extract platform info
            if (data) {
                // The response format depends on the YANG model
                // This is a simplified extraction
                const platformStr = JSON.stringify(data, (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value
                , 2);

                // Update UI with available info
                if (typeof data === 'object') {
                    const entries = data instanceof Map ? Array.from(data.entries()) : Object.entries(data);
                    for (const [key, value] of entries) {
                        if (typeof value === 'string') {
                            if (key.toString().includes('name') || key < 10) {
                                elements.platformInfo.textContent = value;
                            }
                            if (key.toString().includes('version') || key > 10) {
                                elements.versionInfo.textContent = value;
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to fetch system info:', error);
    }
}

// Quick actions
elements.getChecksumBtn?.addEventListener('click', async () => {
    try {
        showLoading('체크섬 조회 중...');
        // Query for YANG catalog checksum - this is device-specific
        const query = [29304]; // SID varies by device
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            elements.yangCacheStatus.textContent = typeof data === 'string' ? data :
                JSON.stringify(data, (k, v) => typeof v === 'bigint' ? v.toString() : v);
            showToast('체크섬 조회 완료', 'success');
        }
    } catch (error) {
        showToast('체크섬 조회 실패: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
});

elements.getConfigBtn?.addEventListener('click', async () => {
    try {
        showLoading('설정 백업 중...');
        const response = await serialManager.sendGetRequest();

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            const jsonStr = JSON.stringify(data, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            , 2);

            // Download as file
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `config-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showToast('설정 백업 완료', 'success');
        }
    } catch (error) {
        showToast('설정 백업 실패: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
});

elements.fetchSystemBtn?.addEventListener('click', async () => {
    try {
        showLoading('시스템 정보 조회 중...');
        const query = [1716]; // system-state/platform SID
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            elements.fetchResult.textContent = JSON.stringify(data, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            , 2);

            // Switch to config panel
            document.querySelector('[data-panel="config"]').click();
            showToast('시스템 정보 조회 완료', 'success');
        }
    } catch (error) {
        showToast('시스템 정보 조회 실패: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
});

elements.fetchBridgeBtn?.addEventListener('click', async () => {
    try {
        showLoading('브릿지 정보 조회 중...');
        const query = [1523]; // bridges SID (approximate)
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            elements.fetchResult.textContent = JSON.stringify(data, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            , 2);

            document.querySelector('[data-panel="config"]').click();
            showToast('브릿지 정보 조회 완료', 'success');
        }
    } catch (error) {
        showToast('브릿지 정보 조회 실패: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
});

// Config fetch
elements.fetchBtn?.addEventListener('click', async () => {
    const path = elements.yangPathInput.value.trim();
    if (!path) {
        showToast('YANG 경로를 입력하세요', 'warning');
        return;
    }

    try {
        showLoading('설정 조회 중...');

        // Convert path to SID query
        // This is a simplified version - real implementation needs YANG catalog
        const query = pathToSidQuery(path);
        const response = await serialManager.sendiFetchRequest(query);

        if (response.isSuccess() && response.payload) {
            const data = response.getPayloadAsCBOR();
            elements.fetchResult.textContent = JSON.stringify(data, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            , 2);
            showToast('조회 완료', 'success');
        } else {
            elements.fetchResult.textContent = `// 응답 코드: ${response.getCodeClass()}.${response.getCodeDetail()}`;
            showToast('조회 실패: 응답 코드 ' + response.code, 'error');
        }
    } catch (error) {
        elements.fetchResult.textContent = `// 에러: ${error.message}`;
        showToast('조회 실패: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
});

// Path to SID conversion (simplified)
function pathToSidQuery(path) {
    // Common SID mappings for VelocityDRIVE-SP
    const sidMap = {
        '/ietf-system:system-state': [1716],
        '/ietf-system:system-state/platform': [1716],
        '/ieee802-dot1q-bridge:bridges': [1523],
        '/ietf-interfaces:interfaces': [1533],
        '/ietf-yang-library:yang-library': [29304],
    };

    // Check for exact match
    for (const [p, sid] of Object.entries(sidMap)) {
        if (path.startsWith(p)) {
            return sid;
        }
    }

    // Try to parse as numeric SID
    if (/^\d+$/.test(path)) {
        return [parseInt(path)];
    }

    // Default to system-state
    return [1716];
}

// Copy result
elements.copyResultBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(elements.fetchResult.textContent)
        .then(() => showToast('클립보드에 복사됨', 'success'))
        .catch(() => showToast('복사 실패', 'error'));
});

// Clear terminal
elements.clearTerminalBtn?.addEventListener('click', () => {
    elements.terminalOutput.innerHTML = '<div class="terminal-line system">터미널 클리어됨</div>';
});

// TAS Gate Entry management
elements.addGateEntry?.addEventListener('click', () => {
    const entry = document.createElement('div');
    entry.className = 'schedule-entry';
    entry.innerHTML = `
        <input type="text" class="input" placeholder="Gate States (예: 0xFF)" value="0x00">
        <input type="number" class="input" placeholder="Time Interval (ns)" value="20000000">
        <button class="btn-remove">×</button>
    `;
    elements.gateEntries.appendChild(entry);

    entry.querySelector('.btn-remove').addEventListener('click', () => entry.remove());
});

// Initialize remove buttons for existing entries
document.querySelectorAll('.schedule-entry .btn-remove').forEach(btn => {
    btn.addEventListener('click', () => btn.parentElement.remove());
});

// Check WebSerial support
if (!('serial' in navigator)) {
    showToast('이 브라우저는 WebSerial을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.', 'error');
    elements.connectBtn.disabled = true;
    addTerminalLine('WebSerial을 지원하지 않는 브라우저입니다.', 'error');
}

// Initial state
addTerminalLine(`[${formatTimestamp()}] KETI TSN WebSerial 초기화 완료`, 'system');
addTerminalLine('Chrome/Edge 브라우저에서 사용해주세요. 연결 버튼을 클릭하여 시작하세요.', 'system');
