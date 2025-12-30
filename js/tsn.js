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

    // Interfaces
    INTERFACES: 2005,
    INTERFACE_LIST: 2033,
    INTERFACE_NAME: 2042,
    INTERFACE_ENABLED: 2036,
    INTERFACE_OPER_STATUS: 2043,
    INTERFACE_PHYS_ADDR: 2044,

    // Bridge port
    BRIDGE_PORT: 7163,
    BRIDGE_PORT_STATISTICS: 7224,
    STATISTICS_FRAME_RX: 7232,
    STATISTICS_FRAME_TX: 7233,
    STATISTICS_OCTETS_RX: 7235,
    STATISTICS_OCTETS_TX: 7236,

    // TAS (Qbv)
    GATE_PARAMETER_TABLE: 23101,
    GATE_ENABLED: 23125,
    ADMIN_GATE_STATES: 23115,
    ADMIN_CYCLE_TIME: 23111,
    ADMIN_CYCLE_TIME_NUMERATOR: 23114,
    ADMIN_CYCLE_TIME_DENOMINATOR: 23113,
    CONFIG_CHANGE: 23116,
    OPER_GATE_STATES: 23139,

    // PTP
    PTP: 15076,
    PTP_INSTANCES: 15133
};

// State
let interfaces = [];
let yangData = {};
let prevStats = {};
let pollInterval = null;
let isFetching = false;  // Prevent concurrent fetch requests

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

    // Packet Chart
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

    // Throughput Chart
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
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

function showToast(message, type = 'info') {
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

// Fetch interfaces
async function fetchInterfaces() {
    // Prevent concurrent fetch requests (Block2 transfer takes multiple round trips)
    if (isFetching) {
        console.log('[TSN] Skipping fetch - previous request still in progress');
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
        const operStatus = iface[SID.INTERFACE_OPER_STATUS];
        const physAddr = iface[SID.INTERFACE_PHYS_ADDR];

        // Bridge port stats
        const bridgePort = iface[SID.BRIDGE_PORT] || {};
        const stats = bridgePort[SID.BRIDGE_PORT_STATISTICS] || {};
        const gateParams = bridgePort[SID.GATE_PARAMETER_TABLE] || {};

        interfaces.push({
            index,
            name,
            enabled,
            operStatus: operStatus === 1 ? 'up' : 'down',
            physAddr: formatMac(physAddr),
            stats: {
                frameRx: stats[SID.STATISTICS_FRAME_RX] || 0,
                frameTx: stats[SID.STATISTICS_FRAME_TX] || 0,
                octetsRx: stats[SID.STATISTICS_OCTETS_RX] || 0,
                octetsTx: stats[SID.STATISTICS_OCTETS_TX] || 0
            },
            gateEnabled: gateParams[SID.GATE_ENABLED] || false,
            gateStates: gateParams[SID.OPER_GATE_STATES] || 0xFF,
            cycleTime: gateParams[SID.ADMIN_CYCLE_TIME] || {}
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
    elements.interfaceList.innerHTML = '';

    if (interfaces.length === 0) {
        elements.interfaceList.innerHTML = '<div class="placeholder"><div>인터페이스 없음</div></div>';
        return;
    }

    interfaces.forEach(iface => {
        // Calculate rates
        const prev = prevStats[iface.name] || iface.stats;
        const rxRate = iface.stats.octetsRx - prev.octetsRx;
        const txRate = iface.stats.octetsTx - prev.octetsTx;

        const item = document.createElement('div');
        item.className = 'interface-item';
        item.innerHTML = `
            <div class="interface-icon ${iface.operStatus}">
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
            <label class="interface-toggle">
                <input type="checkbox" ${iface.enabled ? 'checked' : ''} data-iface="${iface.index}">
                <span class="toggle-slider"></span>
            </label>
        `;

        const toggle = item.querySelector('input[type="checkbox"]');
        toggle.addEventListener('change', async () => {
            await setInterfaceEnabled(iface.index, toggle.checked);
        });

        elements.interfaceList.appendChild(item);

        // Store current stats for next rate calculation
        prevStats[iface.name] = { ...iface.stats };
    });
}

function updateStats() {
    // Calculate totals
    let totalRx = 0, totalTx = 0, totalRxBytes = 0, totalTxBytes = 0;
    let rxRate = 0, txRate = 0, rxBytesRate = 0, txBytesRate = 0;

    interfaces.forEach(iface => {
        totalRx += iface.stats.frameRx;
        totalTx += iface.stats.frameTx;
        totalRxBytes += iface.stats.octetsRx;
        totalTxBytes += iface.stats.octetsTx;

        const prev = prevStats[iface.name];
        if (prev) {
            rxRate += iface.stats.frameRx - prev.frameRx;
            txRate += iface.stats.frameTx - prev.frameTx;
            rxBytesRate += iface.stats.octetsRx - prev.octetsRx;
            txBytesRate += iface.stats.octetsTx - prev.octetsTx;
        }
    });

    // Update stat cards
    elements.totalRxPackets.textContent = formatNumber(totalRx);
    elements.totalTxPackets.textContent = formatNumber(totalTx);
    elements.totalRxBytes.innerHTML = formatBytes(totalRxBytes);
    elements.totalTxBytes.innerHTML = formatBytes(totalTxBytes);

    elements.rxPacketsRate.textContent = `+${formatNumber(rxRate)} pps`;
    elements.txPacketsRate.textContent = `+${formatNumber(txRate)} pps`;
    elements.rxBytesRate.textContent = `+${formatRate(rxBytesRate)}`;
    elements.txBytesRate.textContent = `+${formatRate(txBytesRate)}`;

    // Update charts
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    chartHistory.labels.push(now);
    chartHistory.rxPackets.push(rxRate);
    chartHistory.txPackets.push(txRate);
    chartHistory.rxMbps.push((rxBytesRate * 8) / 1000000);
    chartHistory.txMbps.push((txBytesRate * 8) / 1000000);

    // Limit history
    if (chartHistory.labels.length > MAX_HISTORY) {
        chartHistory.labels.shift();
        chartHistory.rxPackets.shift();
        chartHistory.txPackets.shift();
        chartHistory.rxMbps.shift();
        chartHistory.txMbps.shift();
    }

    // Update packet chart
    if (packetChart) {
        packetChart.data.labels = chartHistory.labels;
        packetChart.data.datasets[0].data = chartHistory.rxPackets;
        packetChart.data.datasets[1].data = chartHistory.txPackets;
        packetChart.update('none');
    }

    // Update throughput chart
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

    elements.tasInterface.innerHTML = '<option value="">선택하세요</option>' + options;
    elements.cbsInterface.innerHTML = '<option value="">선택하세요</option>' + options;

    elements.tasInterface.addEventListener('change', () => {
        elements.tasApplyBtn.disabled = !elements.tasInterface.value;
        if (elements.tasInterface.value) {
            loadTasConfig(parseInt(elements.tasInterface.value));
        }
    });

    elements.cbsInterface.addEventListener('change', () => {
        elements.cbsApplyBtn.disabled = !elements.cbsInterface.value;
    });
}

function loadTasConfig(ifIndex) {
    const iface = interfaces[ifIndex];
    if (!iface) return;

    elements.tasGateEnable.checked = iface.gateEnabled;

    const cycleTime = iface.cycleTime;
    const numerator = cycleTime[SID.ADMIN_CYCLE_TIME_NUMERATOR] || 1000000;
    const denominator = cycleTime[SID.ADMIN_CYCLE_TIME_DENOMINATOR] || 1;
    elements.tasCycleTime.value = Math.floor(numerator / denominator);

    // Update gate visual
    const bits = elements.gateVisual.querySelectorAll('.gate-bit');
    bits.forEach((bit, i) => {
        const isOpen = (iface.gateStates >> i) & 1;
        bit.classList.toggle('open', isOpen);
    });
}

// Fetch PTP status
async function fetchPtpStatus() {
    // Share the same busy flag to prevent concurrent requests
    if (isFetching) {
        console.log('[TSN] Skipping PTP fetch - previous request still in progress');
        return;
    }

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

// Set interface enabled
async function setInterfaceEnabled(ifIndex, enabled) {
    showLoading();
    try {
        const iface = interfaces[ifIndex];
        const entry = new Map();
        entry.set(9, iface.name);
        entry.set(3, enabled);

        const patch = new Map();
        patch.set(28, [entry]);

        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast(`${iface.name} ${enabled ? '활성화' : '비활성화'} 완료`, 'success');
            await fetchInterfaces();
        } else {
            showToast(`설정 실패: ${response.getCodeClass()}.${response.getCodeDetail().toString().padStart(2, '0')}`, 'error');
        }
    } catch (error) {
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Apply TAS config
async function applyTasConfig() {
    const ifIndex = parseInt(elements.tasInterface.value);
    if (isNaN(ifIndex)) return;

    showLoading();
    try {
        const iface = interfaces[ifIndex];
        const gateEnabled = elements.tasGateEnable.checked;
        const cycleTime = parseInt(elements.tasCycleTime.value) || 1000000;

        // Get gate states from visual
        let gateStates = 0;
        elements.gateVisual.querySelectorAll('.gate-bit').forEach((bit, i) => {
            if (bit.classList.contains('open')) {
                gateStates |= (1 << i);
            }
        });

        const gateParams = new Map();
        gateParams.set(24, gateEnabled);  // gate-enabled
        gateParams.set(14, gateStates);   // admin-gate-states

        const cycleTimeMap = new Map();
        cycleTimeMap.set(3, cycleTime);
        cycleTimeMap.set(2, 1);
        gateParams.set(10, cycleTimeMap);
        gateParams.set(15, true);  // config-change

        const bridgePort = new Map();
        bridgePort.set(15938, gateParams);

        const ifaceEntry = new Map();
        ifaceEntry.set(9, iface.name);
        ifaceEntry.set(5130, bridgePort);

        const patch = new Map();
        patch.set(28, [ifaceEntry]);

        console.log('Sending TAS patch:', patch);
        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast('TAS 설정 적용 완료', 'success');
            await fetchInterfaces();
        } else {
            showToast(`TAS 설정 실패: ${response.getCodeClass()}.${response.getCodeDetail().toString().padStart(2, '0')}`, 'error');
        }
    } catch (error) {
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Apply CBS config
async function applyCbsConfig() {
    showToast('CBS 설정은 아직 구현 중입니다', 'info');
}

// Start polling (2 seconds to allow Block2 transfers to complete)
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
        if (serialManager.isConnected && serialManager.boardReady && !isFetching) {
            await fetchInterfaces();
        }
    }, 2000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// Event listeners
elements.connectBtn.addEventListener('click', async () => {
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

elements.refreshBtn.addEventListener('click', async () => {
    if (serialManager.isConnected && serialManager.boardReady) {
        showLoading('새로고침...');
        await fetchInterfaces();
        await fetchPtpStatus();
        hideLoading();
        showToast('새로고침 완료', 'success');
    }
});

elements.tasApplyBtn.addEventListener('click', applyTasConfig);
elements.cbsApplyBtn.addEventListener('click', applyCbsConfig);

serialManager.addEventListener('disconnected', () => {
    stopPolling();
    updateConnectionUI(false);
    showToast('연결 해제됨', 'info');
});

serialManager.addEventListener('announce', async () => {
    updateConnectionUI(true);
    showToast('보드 연결됨', 'success');

    showLoading('데이터 로딩...');
    await fetchInterfaces();
    await fetchPtpStatus();
    hideLoading();

    startPolling();
});

// Initialize
initCharts();
updateConnectionUI(false);
