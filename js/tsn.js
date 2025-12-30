/**
 * VelocityDRIVE-SP TSN Monitor
 * Real-time traffic monitoring with Chart.js
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

// Known SIDs
const SID = {
    // System
    SYSTEM_STATE: 19020,
    SYSTEM_STATE_PLATFORM: 19024,

    // Interfaces (use smaller queries)
    INTERFACES: 2005,
    INTERFACE_LIST: 2033,
    INTERFACE_NAME: 2042,
    INTERFACE_ENABLED: 2036,

    // Bridge port statistics (fetch directly)
    BRIDGE_PORT: 7163,
    BRIDGE_PORT_STATISTICS: 7224,
    STATISTICS_FRAME_RX: 7232,
    STATISTICS_FRAME_TX: 7233,
    STATISTICS_OCTETS_RX: 7235,
    STATISTICS_OCTETS_TX: 7236,

    // TAS (Qbv) - Port level scheduling
    GATE_PARAMETER_TABLE: 23101,
    GATE_ADMIN_BASE_TIME: 23102,
    GATE_ADMIN_BASE_TIME_NS: 23103,
    GATE_ADMIN_BASE_TIME_SEC: 23104,
    GATE_ADMIN_CONTROL_LIST: 23105,
    GATE_CONTROL_ENTRY: 23106,
    GATE_ADMIN_CYCLE_TIME: 23111,
    GATE_CYCLE_NUMERATOR: 23114,
    GATE_CYCLE_DENOMINATOR: 23113,
    GATE_ADMIN_GATE_STATES: 23115,
    GATE_CONFIG_CHANGE: 23116,
    GATE_ENABLED: 23125,
    GATE_OPER_GATE_STATES: 23139,

    // CBS (Qav) - Credit Based Shaper
    TRAFFIC_CLASS_SHAPERS: 8051,
    SHAPER_TRAFFIC_CLASS: 8052,
    SHAPER_CBS: 8053,
    SHAPER_IDLE_SLOPE: 8054,

    // PTP
    PTP: 15076,
    PTP_INSTANCES: 15133
};

// State
let interfaces = [];
let yangData = {};
let prevStats = {};
let pollInterval = null;
let isFetching = false;

// Chart data history
const MAX_HISTORY = 60;
const chartHistory = {
    labels: [],
    rxPackets: [],
    txPackets: [],
    rxMbps: [],
    txMbps: []
};

// Charts
let packetChart = null;
let throughputChart = null;

const $ = id => document.getElementById(id);

const elements = {
    connectBtn: $('connectBtn'),
    refreshBtn: $('refreshBtn'),
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    interfaceList: $('interfaceList'),
    loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'),
    toastContainer: $('toastContainer'),
    // Stats
    totalRxPackets: $('totalRxPackets'),
    totalTxPackets: $('totalTxPackets'),
    totalRxBytes: $('totalRxBytes'),
    totalTxBytes: $('totalTxBytes'),
    rxPacketsRate: $('rxPacketsRate'),
    txPacketsRate: $('txPacketsRate'),
    rxBytesRate: $('rxBytesRate'),
    txBytesRate: $('txBytesRate'),
    // TAS
    tasInterface: $('tasInterface'),
    tasGateEnable: $('tasGateEnable'),
    tasCycleTime: $('tasCycleTime'),
    gateVisual: $('gateVisual'),
    tasApplyBtn: $('tasApplyBtn'),
    // CBS
    cbsInterface: $('cbsInterface'),
    cbsTrafficClass: $('cbsTrafficClass'),
    cbsIdleSlope: $('cbsIdleSlope'),
    cbsApplyBtn: $('cbsApplyBtn'),
    // PTP
    ptpState: $('ptpState'),
    ptpClockId: $('ptpClockId'),
    ptpPortState: $('ptpPortState'),
    ptpOffset: $('ptpOffset')
};

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const tabId = tab.dataset.tab;
        document.getElementById(tabId)?.classList.add('active');
    });
});

// Gate bit toggle
document.querySelectorAll('.gate-bit').forEach(bit => {
    bit.addEventListener('click', () => {
        bit.classList.toggle('open');
    });
});

// Initialize Charts
function initCharts() {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
            x: {
                display: true,
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8', maxTicksLimit: 10 }
            },
            y: {
                display: true,
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.1)' },
                ticks: { color: '#94a3b8' }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { color: '#e2e8f0', boxWidth: 12 }
            }
        }
    };

    const packetCtx = $('packetChart')?.getContext('2d');
    if (packetCtx) {
        packetChart = new Chart(packetCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'RX',
                        data: [],
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'TX',
                        data: [],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    }
                ]
            },
            options: chartOptions
        });
    }

    const throughputCtx = $('throughputChart')?.getContext('2d');
    if (throughputCtx) {
        throughputChart = new Chart(throughputCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'RX',
                        data: [],
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'TX',
                        data: [],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    }
                ]
            },
            options: chartOptions
        });
    }
}

function showLoading(text = '로딩 중...') {
    if (elements.loadingText) elements.loadingText.textContent = text;
    if (elements.loadingOverlay) elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('active');
}

function showToast(message, type = 'info') {
    if (!elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function updateConnectionUI(connected) {
    if (connected) {
        elements.statusDot?.classList.add('connected');
        if (elements.statusText) elements.statusText.textContent = '연결됨';
        if (elements.connectBtn) elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> 해제';
        if (elements.refreshBtn) elements.refreshBtn.disabled = false;
    } else {
        elements.statusDot?.classList.remove('connected');
        if (elements.statusText) elements.statusText.textContent = '연결 안됨';
        if (elements.connectBtn) elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> 연결';
        if (elements.refreshBtn) elements.refreshBtn.disabled = true;
        if (elements.interfaceList) elements.interfaceList.innerHTML = `
            <div class="placeholder">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
                </svg>
                <div>보드에 연결하면<br>인터페이스가 표시됩니다</div>
            </div>`;
    }
}

// Decode delta-SIDs
function decodeDeltaSids(data, parentSid) {
    if (data === null || typeof data !== 'object') return data;

    if (data instanceof Map) {
        const result = {};
        for (const [key, value] of data.entries()) {
            if (typeof key === 'number') {
                const childSid = parentSid + key;
                result[childSid] = decodeDeltaSids(value, childSid);
            } else {
                result[key] = decodeDeltaSids(value, parentSid);
            }
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
                const childSid = parentSid + numKey;
                result[childSid] = decodeDeltaSids(value, childSid);
            } else {
                result[key] = decodeDeltaSids(value, parentSid);
            }
        }
        return result;
    }

    return data;
}

// Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatRate(bytesPerSec) {
    if (bytesPerSec === 0) return '0 Bps';
    const k = 1024;
    const sizes = ['Bps', 'KBps', 'MBps', 'GBps'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Fetch interfaces with lock to prevent concurrent requests
async function fetchInterfaces() {
    if (isFetching) {
        console.log('[TSN] Request already in progress, skipping...');
        return;
    }

    isFetching = true;
    try {
        const response = await serialManager.sendiFetchRequest(SID.INTERFACES);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            yangData.interfaces = decodeDeltaSids(raw, 0);
            parseInterfaces();
        }
    } catch (error) {
        console.error('Failed to fetch interfaces:', error);
    } finally {
        isFetching = false;
    }
}

function parseInterfaces() {
    interfaces = [];
    const ifData = yangData.interfaces;
    if (!ifData) return;

    const interfacesList = ifData[SID.INTERFACES]?.[SID.INTERFACE_LIST];
    if (!Array.isArray(interfacesList)) return;

    interfacesList.forEach((iface, index) => {
        const name = iface[SID.INTERFACE_NAME] || `eth${index}`;
        const enabled = iface[SID.INTERFACE_ENABLED] !== false;

        // Bridge port stats
        const bridgePort = iface[SID.BRIDGE_PORT] || {};
        const stats = bridgePort[SID.BRIDGE_PORT_STATISTICS] || {};
        const gateParams = bridgePort[SID.GATE_PARAMETER_TABLE] || {};

        interfaces.push({
            index,
            name,
            enabled,
            operStatus: 'up',
            stats: {
                frameRx: stats[SID.STATISTICS_FRAME_RX] || 0,
                frameTx: stats[SID.STATISTICS_FRAME_TX] || 0,
                octetsRx: stats[SID.STATISTICS_OCTETS_RX] || 0,
                octetsTx: stats[SID.STATISTICS_OCTETS_TX] || 0
            },
            gateEnabled: gateParams[SID.GATE_ENABLED] || false,
            gateStates: gateParams[SID.GATE_OPER_GATE_STATES] || 0xFF,
            cycleTime: gateParams[SID.GATE_ADMIN_CYCLE_TIME] || {}
        });
    });

    renderInterfaces();
    populateInterfaceSelects();
    updateStats();
}

function formatMac(bytes) {
    if (!bytes || !bytes.length) return '-';
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
}

function renderInterfaces() {
    if (!elements.interfaceList) return;
    elements.interfaceList.innerHTML = '';

    if (interfaces.length === 0) {
        elements.interfaceList.innerHTML = '<div class="placeholder"><div>인터페이스 없음</div></div>';
        return;
    }

    interfaces.forEach(iface => {
        const prev = prevStats[iface.name] || iface.stats;
        const rxRate = Math.max(0, iface.stats.octetsRx - prev.octetsRx);
        const txRate = Math.max(0, iface.stats.octetsTx - prev.octetsTx);

        const item = document.createElement('div');
        item.className = 'interface-item';
        item.innerHTML = `
            <div class="interface-icon ${iface.enabled ? 'up' : 'down'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="1" y="4" width="22" height="16" rx="2"/>
                    <path d="M1 10h22"/>
                </svg>
            </div>
            <div class="interface-info">
                <div class="interface-name">${iface.name}</div>
                <div class="interface-stats">
                    RX: ${formatNumber(iface.stats.frameRx)} pkts / ${formatBytes(iface.stats.octetsRx)}
                </div>
                <div class="interface-stats">
                    TX: ${formatNumber(iface.stats.frameTx)} pkts / ${formatBytes(iface.stats.octetsTx)}
                </div>
                <div class="interface-rates">
                    <span class="rate-item rx">↓ ${formatRate(rxRate)}</span>
                    <span class="rate-item tx">↑ ${formatRate(txRate)}</span>
                </div>
            </div>
        `;

        elements.interfaceList.appendChild(item);
        prevStats[iface.name] = { ...iface.stats };
    });
}

function updateStats() {
    let totalRx = 0, totalTx = 0, totalRxBytes = 0, totalTxBytes = 0;
    let rxRate = 0, txRate = 0, rxBytesRate = 0, txBytesRate = 0;

    interfaces.forEach(iface => {
        totalRx += iface.stats.frameRx;
        totalTx += iface.stats.frameTx;
        totalRxBytes += iface.stats.octetsRx;
        totalTxBytes += iface.stats.octetsTx;

        const prev = prevStats[iface.name];
        if (prev) {
            rxRate += Math.max(0, iface.stats.frameRx - prev.frameRx);
            txRate += Math.max(0, iface.stats.frameTx - prev.frameTx);
            rxBytesRate += Math.max(0, iface.stats.octetsRx - prev.octetsRx);
            txBytesRate += Math.max(0, iface.stats.octetsTx - prev.octetsTx);
        }
    });

    if (elements.totalRxPackets) elements.totalRxPackets.textContent = formatNumber(totalRx);
    if (elements.totalTxPackets) elements.totalTxPackets.textContent = formatNumber(totalTx);
    if (elements.totalRxBytes) elements.totalRxBytes.innerHTML = formatBytes(totalRxBytes);
    if (elements.totalTxBytes) elements.totalTxBytes.innerHTML = formatBytes(totalTxBytes);

    if (elements.rxPacketsRate) elements.rxPacketsRate.textContent = `+${formatNumber(rxRate)} pps`;
    if (elements.txPacketsRate) elements.txPacketsRate.textContent = `+${formatNumber(txRate)} pps`;
    if (elements.rxBytesRate) elements.rxBytesRate.textContent = `+${formatRate(rxBytesRate)}`;
    if (elements.txBytesRate) elements.txBytesRate.textContent = `+${formatRate(txBytesRate)}`;

    // Update charts
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    chartHistory.labels.push(now);
    chartHistory.rxPackets.push(rxRate);
    chartHistory.txPackets.push(txRate);
    chartHistory.rxMbps.push((rxBytesRate * 8) / 1000000);
    chartHistory.txMbps.push((txBytesRate * 8) / 1000000);

    if (chartHistory.labels.length > MAX_HISTORY) {
        chartHistory.labels.shift();
        chartHistory.rxPackets.shift();
        chartHistory.txPackets.shift();
        chartHistory.rxMbps.shift();
        chartHistory.txMbps.shift();
    }

    if (packetChart) {
        packetChart.data.labels = chartHistory.labels;
        packetChart.data.datasets[0].data = chartHistory.rxPackets;
        packetChart.data.datasets[1].data = chartHistory.txPackets;
        packetChart.update('none');
    }

    if (throughputChart) {
        throughputChart.data.labels = chartHistory.labels;
        throughputChart.data.datasets[0].data = chartHistory.rxMbps;
        throughputChart.data.datasets[1].data = chartHistory.txMbps;
        throughputChart.update('none');
    }
}

function populateInterfaceSelects() {
    const options = interfaces.map(iface =>
        `<option value="${iface.index}">${iface.name}</option>`
    ).join('');

    if (elements.tasInterface) {
        elements.tasInterface.innerHTML = '<option value="">선택하세요</option>' + options;
        elements.tasInterface.addEventListener('change', () => {
            if (elements.tasApplyBtn) elements.tasApplyBtn.disabled = !elements.tasInterface.value;
            if (elements.tasInterface.value) {
                loadTasConfig(parseInt(elements.tasInterface.value));
            }
        });
    }

    if (elements.cbsInterface) {
        elements.cbsInterface.innerHTML = '<option value="">선택하세요</option>' + options;
        elements.cbsInterface.addEventListener('change', () => {
            if (elements.cbsApplyBtn) elements.cbsApplyBtn.disabled = !elements.cbsInterface.value;
        });
    }
}

function loadTasConfig(ifIndex) {
    const iface = interfaces[ifIndex];
    if (!iface) return;

    if (elements.tasGateEnable) elements.tasGateEnable.checked = iface.gateEnabled;

    const cycleTime = iface.cycleTime;
    const numerator = cycleTime[SID.GATE_CYCLE_NUMERATOR] || 1000000;
    const denominator = cycleTime[SID.GATE_CYCLE_DENOMINATOR] || 1;
    if (elements.tasCycleTime) elements.tasCycleTime.value = Math.floor(numerator / denominator);

    const bits = elements.gateVisual?.querySelectorAll('.gate-bit');
    if (bits) {
        bits.forEach((bit, i) => {
            const isOpen = (iface.gateStates >> i) & 1;
            bit.classList.toggle('open', isOpen);
        });
    }
}

// Fetch PTP status
async function fetchPtpStatus() {
    if (isFetching) return;

    isFetching = true;
    try {
        const response = await serialManager.sendiFetchRequest(SID.PTP);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            yangData.ptp = decodeDeltaSids(raw, 0);
            if (elements.ptpState) elements.ptpState.textContent = 'Active';
        }
    } catch (error) {
        if (elements.ptpState) elements.ptpState.textContent = 'Not configured';
    } finally {
        isFetching = false;
    }
}

// Apply TAS config using iPatch
async function applyTasConfig() {
    const ifIndex = parseInt(elements.tasInterface?.value);
    if (isNaN(ifIndex)) return;

    showLoading('TAS 설정 적용 중...');
    try {
        const iface = interfaces[ifIndex];
        const gateEnabled = elements.tasGateEnable?.checked || false;
        const cycleTimeNs = parseInt(elements.tasCycleTime?.value) || 1000000;

        // Get gate states from visual
        let gateStates = 0;
        elements.gateVisual?.querySelectorAll('.gate-bit').forEach((bit, i) => {
            if (bit.classList.contains('open')) {
                gateStates |= (1 << i);
            }
        });

        // Build iPatch payload with delta-SIDs
        // Path: /ietf-interfaces:interfaces/interface[name]/bridge-port/gate-parameter-table
        const gateParams = new Map();
        gateParams.set(SID.GATE_ENABLED - SID.GATE_PARAMETER_TABLE, gateEnabled);  // gate-enabled
        gateParams.set(SID.GATE_ADMIN_GATE_STATES - SID.GATE_PARAMETER_TABLE, gateStates);  // admin-gate-states

        // Cycle time as rational
        const cycleTimeMap = new Map();
        cycleTimeMap.set(SID.GATE_CYCLE_NUMERATOR - SID.GATE_ADMIN_CYCLE_TIME, cycleTimeNs);
        cycleTimeMap.set(SID.GATE_CYCLE_DENOMINATOR - SID.GATE_ADMIN_CYCLE_TIME, 1);
        gateParams.set(SID.GATE_ADMIN_CYCLE_TIME - SID.GATE_PARAMETER_TABLE, cycleTimeMap);

        // Config change to apply
        gateParams.set(SID.GATE_CONFIG_CHANGE - SID.GATE_PARAMETER_TABLE, true);

        // Bridge port container
        const bridgePort = new Map();
        bridgePort.set(SID.GATE_PARAMETER_TABLE - SID.BRIDGE_PORT, gateParams);

        // Interface entry with name key
        const ifaceEntry = new Map();
        ifaceEntry.set(SID.INTERFACE_NAME - SID.INTERFACE_LIST, iface.name);
        ifaceEntry.set(SID.BRIDGE_PORT - SID.INTERFACE_LIST, bridgePort);

        // Root patch - interface list delta from interfaces
        const patch = new Map();
        patch.set(SID.INTERFACE_LIST - SID.INTERFACES, [ifaceEntry]);

        console.log('Sending TAS patch:', patch);
        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast('TAS 설정 적용 완료', 'success');
            await new Promise(resolve => setTimeout(resolve, 1000));
            await fetchInterfaces();
        } else {
            showToast(`TAS 설정 실패: ${response.getCodeClass()}.${response.getCodeDetail().toString().padStart(2, '0')}`, 'error');
        }
    } catch (error) {
        console.error('TAS config error:', error);
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Apply CBS config using iPatch
async function applyCbsConfig() {
    const ifIndex = parseInt(elements.cbsInterface?.value);
    if (isNaN(ifIndex)) return;

    showLoading('CBS 설정 적용 중...');
    try {
        const iface = interfaces[ifIndex];
        const trafficClass = parseInt(elements.cbsTrafficClass?.value) || 6;
        const idleSlope = parseInt(elements.cbsIdleSlope?.value) || 5000000;  // 5 Mbps default

        // Build iPatch payload
        // Path: /ietf-interfaces:interfaces/interface[name]/eth-qos/config/traffic-class-shapers
        const cbsConfig = new Map();
        cbsConfig.set(SID.SHAPER_IDLE_SLOPE - SID.SHAPER_CBS, idleSlope);

        const shaperType = new Map();
        shaperType.set(SID.SHAPER_CBS - SID.TRAFFIC_CLASS_SHAPERS, cbsConfig);

        const shaperEntry = new Map();
        shaperEntry.set(SID.SHAPER_TRAFFIC_CLASS - SID.TRAFFIC_CLASS_SHAPERS, trafficClass);
        shaperEntry.set(2, shaperType);  // type container

        // Interface entry
        const ifaceEntry = new Map();
        ifaceEntry.set(SID.INTERFACE_NAME - SID.INTERFACE_LIST, iface.name);
        // eth-qos path (need to find correct SID)
        // For now, use relative offset
        ifaceEntry.set(SID.TRAFFIC_CLASS_SHAPERS - SID.INTERFACE_LIST, [shaperEntry]);

        const patch = new Map();
        patch.set(SID.INTERFACE_LIST - SID.INTERFACES, [ifaceEntry]);

        console.log('Sending CBS patch:', patch);
        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast('CBS 설정 적용 완료', 'success');
            await new Promise(resolve => setTimeout(resolve, 1000));
            await fetchInterfaces();
        } else {
            showToast(`CBS 설정 실패: ${response.getCodeClass()}.${response.getCodeDetail().toString().padStart(2, '0')}`, 'error');
        }
    } catch (error) {
        console.error('CBS config error:', error);
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Start polling (10 seconds to allow block transfers to complete)
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
        if (serialManager.isConnected && serialManager.boardReady && !isFetching) {
            await fetchInterfaces();
        }
    }, 10000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// Event listeners
elements.connectBtn?.addEventListener('click', async () => {
    try {
        if (serialManager.isConnected) {
            stopPolling();
            await serialManager.disconnect();
        } else {
            await serialManager.connect();
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
});

elements.refreshBtn?.addEventListener('click', async () => {
    if (serialManager.isConnected && serialManager.boardReady && !isFetching) {
        showLoading('새로고침...');
        await fetchInterfaces();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await fetchPtpStatus();
        hideLoading();
        showToast('새로고침 완료', 'success');
    }
});

elements.tasApplyBtn?.addEventListener('click', applyTasConfig);
elements.cbsApplyBtn?.addEventListener('click', applyCbsConfig);

serialManager.addEventListener('disconnected', () => {
    stopPolling();
    updateConnectionUI(false);
    showToast('연결 해제됨', 'info');
});

serialManager.addEventListener('announce', async () => {
    updateConnectionUI(true);
    showToast('보드 연결됨', 'success');

    // Wait for board state to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    showLoading('데이터 로딩...');
    try {
        await fetchInterfaces();
    } catch (e) {
        console.error('Initial fetch failed:', e);
        showToast('데이터 로드 실패 - 새로고침 버튼을 눌러주세요', 'error');
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
        await fetchPtpStatus();
    } catch (e) {
        console.error('PTP fetch failed:', e);
    }
    hideLoading();

    startPolling();
});

// Initialize
initCharts();
updateConnectionUI(false);
