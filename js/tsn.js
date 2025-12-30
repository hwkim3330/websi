/**
 * VelocityDRIVE-SP TSN Configuration
 * Focused TSN settings with proper iPatch support
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

// Known SIDs for TSN configuration
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

    // Bridge port (augments interface)
    BRIDGE_PORT: 7163,
    BRIDGE_PORT_PVID: 7213,

    // TAS (Qbv) - Gate Parameter Table
    GATE_PARAMETER_TABLE: 23101,
    GATE_ENABLED: 23125,
    ADMIN_GATE_STATES: 23115,
    ADMIN_CONTROL_LIST: 23105,
    GATE_CONTROL_ENTRY: 23106,
    ADMIN_CYCLE_TIME: 23111,
    ADMIN_CYCLE_TIME_NUMERATOR: 23114,
    ADMIN_CYCLE_TIME_DENOMINATOR: 23113,
    CONFIG_CHANGE: 23116,
    OPER_GATE_STATES: 23139,

    // CBS (Qav) - uses eth-qos
    ETH_QOS: 8048,
    ETH_QOS_CONFIG: 8049,
    TRAFFIC_CLASS_SHAPERS: 8051,

    // PTP
    PTP: 15076,
    PTP_INSTANCES: 15133,
    PTP_INSTANCE: 15134
};

// State
let interfaces = [];
let yangData = {};

const $ = id => document.getElementById(id);

const elements = {
    connectBtn: $('connectBtn'),
    refreshBtn: $('refreshBtn'),
    status: $('status'),
    statusText: $('statusText'),
    placeholder: $('placeholder'),
    content: $('content'),
    interfaceList: $('interfaceList'),
    infoPlatform: $('infoPlatform'),
    infoVersion: $('infoVersion'),
    infoInterfaces: $('infoInterfaces'),
    loadingOverlay: $('loadingOverlay'),
    toastContainer: $('toastContainer'),
    // TAS
    tasInterface: $('tasInterface'),
    tasGateEnable: $('tasGateEnable'),
    tasCycleTime: $('tasCycleTime'),
    tasGateList: $('tasGateList'),
    tasApplyBtn: $('tasApplyBtn'),
    // CBS
    cbsInterface: $('cbsInterface'),
    cbsTrafficClass: $('cbsTrafficClass'),
    cbsIdleSlope: $('cbsIdleSlope'),
    cbsSendSlope: $('cbsSendSlope'),
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
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
});

function showLoading() {
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
        elements.status.classList.add('connected');
        elements.statusText.textContent = '연결됨';
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> 해제';
        elements.refreshBtn.disabled = false;
        elements.placeholder.style.display = 'none';
        elements.content.style.display = 'block';
    } else {
        elements.status.classList.remove('connected');
        elements.statusText.textContent = '연결 안됨';
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> 연결';
        elements.refreshBtn.disabled = true;
        elements.placeholder.style.display = 'block';
        elements.content.style.display = 'none';
    }
}

// Decode delta-SIDs from CBOR response
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

// Build delta-SID encoded patch for iPatch
function buildPatch(targetSid, value) {
    // For a simple single-value patch at top level
    // The patch needs to use delta encoding from parent
    // Since we're patching at specific SID, we use absolute SID as key
    const patch = new Map();
    patch.set(targetSid, value);
    return patch;
}

// Fetch interfaces data
async function fetchInterfaces() {
    try {
        const response = await serialManager.sendiFetchRequest(SID.INTERFACES);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            yangData.interfaces = decodeDeltaSids(raw, 0);
            parseInterfaces();
        }
    } catch (error) {
        console.error('Failed to fetch interfaces:', error);
    }
}

function parseInterfaces() {
    interfaces = [];

    // Navigate: INTERFACES -> INTERFACE_LIST (array)
    const ifData = yangData.interfaces;
    if (!ifData) return;

    // Find interface list
    const interfacesList = ifData[SID.INTERFACES]?.[SID.INTERFACE_LIST];
    if (!Array.isArray(interfacesList)) return;

    interfacesList.forEach((iface, index) => {
        const name = iface[SID.INTERFACE_NAME] || `eth${index}`;
        const enabled = iface[SID.INTERFACE_ENABLED] !== false;
        const operStatus = iface[SID.INTERFACE_OPER_STATUS];
        const physAddr = iface[SID.INTERFACE_PHYS_ADDR];

        // Get bridge-port info (augmented)
        const bridgePort = iface[SID.BRIDGE_PORT] || {};
        const gateParams = bridgePort[SID.GATE_PARAMETER_TABLE] || {};

        interfaces.push({
            index,
            name,
            enabled,
            operStatus: operStatus === 1 ? 'up' : 'down',
            physAddr: formatMac(physAddr),
            bridgePort,
            gateParams,
            gateEnabled: gateParams[SID.GATE_ENABLED] || false,
            cycleTime: gateParams[SID.ADMIN_CYCLE_TIME] || {}
        });
    });

    renderInterfaces();
    populateInterfaceSelects();
}

function formatMac(bytes) {
    if (!bytes || !bytes.length) return '-';
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
}

function renderInterfaces() {
    elements.interfaceList.innerHTML = '';
    elements.infoInterfaces.textContent = `${interfaces.length}개`;

    interfaces.forEach(iface => {
        const item = document.createElement('div');
        item.className = 'interface-item';
        item.innerHTML = `
            <div class="interface-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="1" y="4" width="22" height="16" rx="2"/>
                    <path d="M1 10h22"/>
                </svg>
            </div>
            <div class="interface-info">
                <div class="interface-name">${iface.name}</div>
                <div class="interface-status">
                    <span class="${iface.operStatus}">${iface.operStatus.toUpperCase()}</span>
                    <span>${iface.physAddr}</span>
                </div>
            </div>
            <div class="interface-actions">
                <label class="toggle" title="${iface.enabled ? 'Disable' : 'Enable'}">
                    <input type="checkbox" ${iface.enabled ? 'checked' : ''} data-iface="${iface.index}">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;

        // Toggle handler
        const toggle = item.querySelector('input[type="checkbox"]');
        toggle.addEventListener('change', async () => {
            await setInterfaceEnabled(iface.index, toggle.checked);
        });

        elements.interfaceList.appendChild(item);
    });
}

function populateInterfaceSelects() {
    const options = interfaces.map(iface =>
        `<option value="${iface.index}">${iface.name}</option>`
    ).join('');

    elements.tasInterface.innerHTML = '<option value="">선택하세요</option>' + options;
    elements.cbsInterface.innerHTML = '<option value="">선택하세요</option>' + options;

    // Enable buttons when interface selected
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

    // Show current gate states
    const gateStates = iface.gateParams[SID.OPER_GATE_STATES] || 0xFF;
    renderGateList(gateStates);
}

function renderGateList(gateStates) {
    // Simple display of current gate state
    const gateBits = [];
    for (let i = 0; i < 8; i++) {
        const open = (gateStates >> i) & 1;
        gateBits.push(`<span class="gate-bit ${open ? 'open' : ''}">${i}</span>`);
    }

    elements.tasGateList.innerHTML = `
        <tr>
            <td>1</td>
            <td><div class="gate-state">${gateBits.join('')}</div></td>
            <td><input type="number" class="form-input" value="${elements.tasCycleTime.value}" style="width: 120px;"></td>
            <td></td>
        </tr>
    `;
}

// Fetch system info
async function fetchSystemInfo() {
    try {
        const response = await serialManager.sendiFetchRequest(SID.SYSTEM_STATE_PLATFORM);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            const data = decodeDeltaSids(raw, 0);

            // Navigate to platform info
            const platform = data[SID.SYSTEM_STATE_PLATFORM];
            if (platform) {
                const machine = platform[SID.SYSTEM_STATE_PLATFORM + 1]; // machine
                const osVersion = platform[SID.SYSTEM_STATE_PLATFORM + 4]; // os-version
                elements.infoPlatform.textContent = machine || '-';
                elements.infoVersion.textContent = osVersion || '-';
            }
        }
    } catch (error) {
        console.error('Failed to fetch system info:', error);
    }
}

// Fetch PTP status
async function fetchPtpStatus() {
    try {
        const response = await serialManager.sendiFetchRequest(SID.PTP);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            yangData.ptp = decodeDeltaSids(raw, 0);

            // Parse PTP data (read-only status)
            elements.ptpState.textContent = 'Active';
            elements.ptpClockId.textContent = '-';
            elements.ptpPortState.textContent = '-';
            elements.ptpOffset.textContent = '-';
        }
    } catch (error) {
        elements.ptpState.textContent = 'Not configured';
    }
}

// Set interface enabled/disabled
async function setInterfaceEnabled(ifIndex, enabled) {
    showLoading();
    try {
        // Build patch: interface/enabled
        // Path: /ietf-interfaces:interfaces/interface[name='ethX']/enabled
        // SID: INTERFACE_ENABLED (2036) is delta from INTERFACE_LIST (2033)
        // Delta = 2036 - 2033 = 3

        const patch = new Map();
        // We need to patch the specific interface by key
        // The interface list is keyed by "name" field
        const iface = interfaces[ifIndex];

        // For list entries, we need to send the key + value
        // Format: { interface_list_sid: [ { name: "ethX", enabled: true } ] }
        const entry = new Map();
        entry.set(9, iface.name); // name delta from interface = 9 (2042-2033)
        entry.set(3, enabled);     // enabled delta from interface = 3 (2036-2033)

        patch.set(SID.INTERFACE_LIST - SID.INTERFACES, [entry]); // delta = 28

        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast(`${iface.name} ${enabled ? '활성화' : '비활성화'} 완료`, 'success');
            await fetchInterfaces();
        } else {
            showToast(`설정 실패: ${response.getCodeName()}`, 'error');
        }
    } catch (error) {
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Apply TAS configuration
async function applyTasConfig() {
    const ifIndex = parseInt(elements.tasInterface.value);
    if (isNaN(ifIndex)) return;

    showLoading();
    try {
        const iface = interfaces[ifIndex];
        const gateEnabled = elements.tasGateEnable.checked;
        const cycleTime = parseInt(elements.tasCycleTime.value) || 1000000;

        // Build TAS patch
        // Path: interfaces/interface[name]/bridge-port/gate-parameter-table/...
        // Need to patch:
        // - gate-enabled (23125)
        // - admin-cycle-time/numerator (23114)
        // - config-change (23116) = true to apply

        const gateParams = new Map();

        // gate-enabled: delta from gate-parameter-table = 23125 - 23101 = 24
        gateParams.set(24, gateEnabled);

        // admin-cycle-time: delta = 23111 - 23101 = 10
        const cycleTimeMap = new Map();
        cycleTimeMap.set(3, cycleTime);  // numerator: delta = 23114 - 23111 = 3
        cycleTimeMap.set(2, 1);          // denominator: delta = 23113 - 23111 = 2
        gateParams.set(10, cycleTimeMap);

        // config-change: delta = 23116 - 23101 = 15
        gateParams.set(15, true);

        // Build interface entry
        const bridgePort = new Map();
        // gate-parameter-table: delta from bridge-port = 23101 - 7163 = 15938
        bridgePort.set(15938, gateParams);

        const ifaceEntry = new Map();
        ifaceEntry.set(9, iface.name);  // name
        // bridge-port: delta from interface = 7163 - 2033 = 5130
        ifaceEntry.set(5130, bridgePort);

        const patch = new Map();
        // interface list: delta from interfaces = 2033 - 2005 = 28
        patch.set(28, [ifaceEntry]);

        console.log('Sending TAS patch:', patch);
        const response = await serialManager.sendiPatchRequest(patch);

        if (response.isSuccess()) {
            showToast('TAS 설정 적용 완료', 'success');
            await fetchInterfaces();
        } else {
            showToast(`TAS 설정 실패: ${response.getCodeName()}`, 'error');
        }
    } catch (error) {
        showToast(`오류: ${error.message}`, 'error');
        console.error('TAS config error:', error);
    }
    hideLoading();
}

// Apply CBS configuration
async function applyCbsConfig() {
    const ifIndex = parseInt(elements.cbsInterface.value);
    if (isNaN(ifIndex)) return;

    showLoading();
    try {
        const iface = interfaces[ifIndex];
        const tc = parseInt(elements.cbsTrafficClass.value);
        const idleSlope = parseInt(elements.cbsIdleSlope.value) || 0;

        // CBS uses eth-qos augmentation
        // Path: interfaces/interface[name]/eth-qos/config/traffic-class-shapers
        showToast('CBS 설정은 아직 구현 중입니다', 'info');
    } catch (error) {
        showToast(`오류: ${error.message}`, 'error');
    }
    hideLoading();
}

// Event listeners
elements.connectBtn.addEventListener('click', async () => {
    try {
        if (serialManager.isConnected) {
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
        showLoading();
        await fetchSystemInfo();
        await fetchInterfaces();
        await fetchPtpStatus();
        hideLoading();
        showToast('새로고침 완료', 'success');
    }
});

elements.tasApplyBtn.addEventListener('click', applyTasConfig);
elements.cbsApplyBtn.addEventListener('click', applyCbsConfig);

serialManager.addEventListener('disconnected', () => {
    updateConnectionUI(false);
    showToast('연결 해제됨', 'info');
});

serialManager.addEventListener('announce', async () => {
    updateConnectionUI(true);
    showToast('보드 연결됨', 'success');

    showLoading();
    await fetchSystemInfo();
    await fetchInterfaces();
    await fetchPtpStatus();
    hideLoading();
});

// Initialize
updateConnectionUI(false);
