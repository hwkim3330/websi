/**
 * VelocityDRIVE-SP YANG Editor
 * Edit mode with iPatch support
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

// YANG SID Catalog
const yangCatalog = {
    sidMap: new Map(),
    sidToPath: new Map(),
    pathToSid: new Map(),
    checksum: null
};

// Pending changes
const pendingChanges = new Map();

// Root YANG modules
const ROOT_MODULES = [
    { name: 'system-state', sid: 19020, path: '/ietf-system:system-state' },
    { name: 'system', sid: 19017, path: '/ietf-system:system' },
    { name: 'interfaces', sid: 2005, path: '/ietf-interfaces:interfaces' },
    { name: 'bridges', sid: 7025, path: '/ieee802-dot1q-bridge:bridges' },
    { name: 'ptp', sid: 15076, path: '/ieee1588-ptp:ptp' },
    { name: 'lldp', sid: 11001, path: '/ieee802-dot1ab-lldp:lldp' },
    { name: 'hardware', sid: 31054, path: '/ietf-hardware:hardware' },
    { name: 'acl', sid: 39008, path: '/mchp-velocitysp-acl:acl' }
];

// Read-only paths (state data)
const READONLY_PATTERNS = [
    /system-state/,
    /statistics/,
    /oper-status/,
    /if-index/,
    /phys-address/,
    /-state$/,
    /status$/
];

let yangData = {};
let selectedNode = null;

const $ = id => document.getElementById(id);

const elements = {
    connectBtn: $('connectBtn'),
    refreshBtn: $('refreshBtn'),
    statusBar: $('statusBar'),
    statusText: $('statusText'),
    platformInfo: $('platformInfo'),
    treeContainer: $('treeContainer'),
    currentPath: $('currentPath'),
    valueTableBody: $('valueTableBody'),
    copyPathBtn: $('copyPathBtn'),
    terminalOutput: $('terminalOutput'),
    clearTerminalBtn: $('clearTerminalBtn'),
    toggleTerminalBtn: $('toggleTerminalBtn'),
    showHexCheck: $('showHexCheck'),
    expandAllBtn: $('expandAllBtn'),
    loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'),
    toastContainer: $('toastContainer'),
    pendingChanges: $('pendingChanges'),
    changeCount: $('changeCount'),
    saveAllBtn: $('saveAllBtn'),
    quickActions: $('quickActions')
};

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

function log(message, type = 'system') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${message}`;
    elements.terminalOutput.appendChild(line);
    elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

function updateConnectionUI(connected) {
    if (connected) {
        elements.statusBar.classList.add('connected');
        elements.statusText.textContent = '연결됨';
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg> 연결 해제';
        elements.refreshBtn.disabled = false;
        elements.quickActions.style.display = 'flex';
    } else {
        elements.statusBar.classList.remove('connected');
        elements.statusText.textContent = '연결 안됨';
        elements.platformInfo.textContent = '-';
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5"/></svg> 연결';
        elements.refreshBtn.disabled = true;
        elements.quickActions.style.display = 'none';
        elements.treeContainer.innerHTML = '<div class="tree-placeholder">보드에 연결하면<br>YANG 데이터가 표시됩니다</div>';
        yangData = {};
    }
}

function updatePendingUI() {
    const count = pendingChanges.size;
    if (count > 0) {
        elements.pendingChanges.style.display = 'flex';
        elements.changeCount.textContent = count;
    } else {
        elements.pendingChanges.style.display = 'none';
    }
}

function isReadonly(path) {
    return READONLY_PATTERNS.some(pattern => pattern.test(path));
}

// Catalog loading
async function loadSingleCatalog(checksumHex) {
    try {
        const response = await fetch(`./js/catalogs/${checksumHex}.json`);
        if (!response.ok) throw new Error('Catalog not found');

        const data = await response.json();
        for (const [path, sid] of Object.entries(data.pathToSid)) {
            yangCatalog.sidMap.set(path, sid);
            yangCatalog.pathToSid.set(path, sid);
        }
        for (const [sid, path] of Object.entries(data.sidToPath)) {
            yangCatalog.sidToPath.set(parseInt(sid), path);
        }
        return Object.keys(data.sidToPath).length;
    } catch (error) {
        return 0;
    }
}

async function loadAllCatalogs() {
    log('YANG 카탈로그 로딩 중...', 'info');
    try {
        const indexResponse = await fetch('./js/catalogs/index.json');
        if (!indexResponse.ok) throw new Error('Catalog index not found');

        const index = await indexResponse.json();
        for (const checksum of index.checksums) {
            await loadSingleCatalog(checksum);
        }

        log(`카탈로그 로드 완료: ${yangCatalog.sidToPath.size}개 SID`, 'success');
        return true;
    } catch (error) {
        log(`카탈로그 로드 실패: ${error.message}`, 'error');
        return false;
    }
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

function resolveSid(key, parentSid) {
    if (typeof key !== 'number') {
        return { sid: null, name: String(key) };
    }

    const deltaSid = parentSid + key;
    let name = getSidName(deltaSid);
    if (name) return { sid: deltaSid, name };

    name = getSidName(key);
    if (name) return { sid: key, name };

    if (deltaSid > 0 && deltaSid < 100000) {
        return { sid: deltaSid, name: String(deltaSid) };
    }

    return { sid: key, name: String(key) };
}

function decodeDeltaSids(data, parentSid) {
    if (data === null || typeof data !== 'object') return data;

    if (data instanceof Map) {
        const result = {};
        for (const [key, value] of data.entries()) {
            const { sid, name } = resolveSid(key, parentSid);
            result[name] = decodeDeltaSids(value, sid !== null ? sid : parentSid);
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
                const { sid, name } = resolveSid(numKey, parentSid);
                result[name] = decodeDeltaSids(value, sid !== null ? sid : parentSid);
            } else {
                result[key] = decodeDeltaSids(value, parentSid);
            }
        }
        return result;
    }

    return data;
}

// Tree View
function getValueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function getTypeLabel(value) {
    const type = getValueType(value);
    if (type === 'array') return `Array[${value.length}]`;
    if (type === 'object') return 'Object';
    return type;
}

function isExpandable(value) {
    return value !== null && typeof value === 'object';
}

function createTreeNode(name, value, path, depth = 0) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = path;

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    header.style.paddingLeft = `${depth * 20 + 4}px`;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    if (isExpandable(value)) {
        toggle.classList.add('collapsed');
    } else {
        toggle.classList.add('empty');
    }
    header.appendChild(toggle);

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    if (Array.isArray(value)) {
        icon.classList.add('list');
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>';
    } else if (typeof value === 'object' && value !== null) {
        icon.classList.add('container');
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>';
    } else {
        icon.classList.add('leaf');
        icon.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5z"/></svg>';
    }
    header.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-node-name';
    nameSpan.textContent = name;
    header.appendChild(nameSpan);

    if (Array.isArray(value)) {
        const badge = document.createElement('span');
        badge.className = 'tree-node-badge';
        badge.textContent = `${value.length}`;
        header.appendChild(badge);
    } else if (typeof value === 'object' && value !== null) {
        const badge = document.createElement('span');
        badge.className = 'tree-node-badge';
        badge.textContent = `${Object.keys(value).length}`;
        header.appendChild(badge);
    }

    node.appendChild(header);

    if (isExpandable(value)) {
        const children = document.createElement('div');
        children.className = 'tree-children';

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                children.appendChild(createTreeNode(`[${index}]`, item, `${path}[${index}]`, depth + 1));
            });
        } else {
            Object.entries(value).forEach(([key, val]) => {
                children.appendChild(createTreeNode(key, val, `${path}/${key}`, depth + 1));
            });
        }

        node.appendChild(children);

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = toggle.classList.contains('expanded');
            if (isExpanded) {
                toggle.classList.remove('expanded');
                toggle.classList.add('collapsed');
                children.classList.remove('expanded');
            } else {
                toggle.classList.remove('collapsed');
                toggle.classList.add('expanded');
                children.classList.add('expanded');
            }
            selectNode(node, name, value, path);
        });
    } else {
        header.addEventListener('click', () => {
            selectNode(node, name, value, path);
        });
    }

    return node;
}

function selectNode(node, name, value, path) {
    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    node.querySelector('.tree-node-header').classList.add('selected');
    selectedNode = { name, value, path };
    elements.currentPath.textContent = path || '/';
    updateValueTable(value, path);
}

function updateValueTable(data, basePath = '/') {
    elements.valueTableBody.innerHTML = '';

    if (data === null || data === undefined) {
        elements.valueTableBody.innerHTML = '<tr class="placeholder-row"><td colspan="3">값 없음</td></tr>';
        return;
    }

    if (typeof data !== 'object') {
        const row = createValueRow('(value)', data, typeof data, basePath, !isReadonly(basePath));
        elements.valueTableBody.appendChild(row);
        return;
    }

    if (Array.isArray(data)) {
        data.forEach((item, index) => {
            const itemPath = `${basePath}[${index}]`;
            const row = createValueRow(`[${index}]`, item, getValueType(item), itemPath, false);
            elements.valueTableBody.appendChild(row);
        });
    } else {
        Object.entries(data).forEach(([key, value]) => {
            const itemPath = `${basePath}/${key}`;
            const editable = !isReadonly(itemPath) && typeof value !== 'object';
            const row = createValueRow(key, value, getValueType(value), itemPath, editable);
            elements.valueTableBody.appendChild(row);
        });
    }

    if (elements.valueTableBody.children.length === 0) {
        elements.valueTableBody.innerHTML = '<tr class="placeholder-row"><td colspan="3">빈 객체</td></tr>';
    }
}

function createValueRow(name, value, type, path, editable) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    nameCell.textContent = name;
    row.appendChild(nameCell);

    const typeCell = document.createElement('td');
    typeCell.className = 'type-cell';
    typeCell.textContent = getTypeLabel(value);
    if (!editable && typeof value !== 'object') {
        typeCell.innerHTML += '<span class="readonly-badge">(읽기전용)</span>';
    }
    row.appendChild(typeCell);

    const valueCell = document.createElement('td');
    valueCell.className = `value-cell ${type}`;

    if (editable && typeof value !== 'object') {
        valueCell.classList.add('editable');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'value-input';
        input.value = formatValueForInput(value);
        input.dataset.path = path;
        input.dataset.originalValue = JSON.stringify(value);

        input.addEventListener('input', () => {
            const original = JSON.parse(input.dataset.originalValue);
            const current = parseInputValue(input.value, typeof original);
            if (JSON.stringify(current) !== JSON.stringify(original)) {
                input.classList.add('modified');
                pendingChanges.set(path, { value: current, type: typeof original });
            } else {
                input.classList.remove('modified');
                pendingChanges.delete(path);
            }
            updatePendingUI();
        });

        valueCell.appendChild(input);
    } else {
        valueCell.textContent = formatValue(value);
    }

    row.appendChild(valueCell);
    return row;
}

function formatValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${escapeHtml(value)}"`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return `{${Object.keys(value).length} properties}`;
    return String(value);
}

function formatValueForInput(value) {
    if (value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

function parseInputValue(str, originalType) {
    if (originalType === 'boolean') {
        return str.toLowerCase() === 'true';
    }
    if (originalType === 'number') {
        const num = parseFloat(str);
        return isNaN(num) ? 0 : num;
    }
    return str;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderTree() {
    elements.treeContainer.innerHTML = '';

    if (Object.keys(yangData).length === 0) {
        elements.treeContainer.innerHTML = '<div class="tree-placeholder">데이터 없음</div>';
        return;
    }

    Object.entries(yangData).forEach(([name, data]) => {
        const node = createTreeNode(name, data, `/${name}`, 0);
        elements.treeContainer.appendChild(node);
    });
}

// Data operations
async function fetchAllData() {
    showLoading('YANG 데이터 로딩 중...');
    yangData = {};

    for (const module of ROOT_MODULES) {
        try {
            log(`Fetching ${module.name}...`, 'info');
            const response = await serialManager.sendiFetchRequest(module.sid);

            if (response.isSuccess() && response.payload) {
                const raw = response.getPayloadAsCBOR();
                const decoded = decodeDeltaSids(raw, 0);
                yangData[module.name] = decoded;
                log(`${module.name} 로드 완료`, 'success');
            }
        } catch (error) {
            log(`${module.name} 로드 실패: ${error.message}`, 'error');
        }
    }

    renderTree();
    hideLoading();

    if (Object.keys(yangData).length > 0) {
        showToast('YANG 데이터 로드 완료', 'success');
    }
}

async function saveAllChanges() {
    if (pendingChanges.size === 0) return;

    showLoading('변경사항 저장 중...');
    let successCount = 0;
    let failCount = 0;

    for (const [path, change] of pendingChanges) {
        try {
            log(`Saving ${path}...`, 'info');
            // Build patch for this path
            const sid = yangCatalog.pathToSid.get(path);
            if (!sid) {
                log(`SID not found for ${path}`, 'error');
                failCount++;
                continue;
            }

            const patch = new Map();
            patch.set(sid, change.value);

            const response = await serialManager.sendiPatchRequest(patch);
            if (response.isSuccess()) {
                successCount++;
                log(`${path} 저장 완료`, 'success');
            } else {
                failCount++;
                log(`${path} 저장 실패: ${response.getCodeName()}`, 'error');
            }
        } catch (error) {
            failCount++;
            log(`${path} 저장 오류: ${error.message}`, 'error');
        }
    }

    pendingChanges.clear();
    updatePendingUI();
    hideLoading();

    if (successCount > 0) {
        showToast(`${successCount}개 저장 완료`, 'success');
        await fetchAllData();
    }
    if (failCount > 0) {
        showToast(`${failCount}개 저장 실패`, 'error');
    }
}

async function fetchSystemInfo() {
    try {
        const response = await serialManager.sendiFetchRequest(19024);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            const decoded = decodeDeltaSids(raw, 0);
            let platform = decoded;
            if (decoded['platform']) platform = decoded['platform'];
            const osName = platform['os-name'] || platform['machine'] || '';
            const osVersion = platform['os-version'] || '';
            if (osName || osVersion) {
                elements.platformInfo.textContent = `${osName} ${osVersion}`.trim();
            }
        }
    } catch (error) {
        log(`시스템 정보 조회 실패: ${error.message}`, 'error');
    }
}

// Event handlers
serialManager.addEventListener('connected', () => {
    log('시리얼 포트 연결됨', 'info');
});

serialManager.addEventListener('disconnected', () => {
    log('연결 해제됨', 'system');
    updateConnectionUI(false);
});

serialManager.addEventListener('announce', async () => {
    log('ANNOUNCE 수신 - 보드 준비 완료', 'success');
    updateConnectionUI(true);

    showLoading('초기화 중...');
    try {
        await fetchSystemInfo();
        await fetchAllData();
    } catch (error) {
        log(`초기화 오류: ${error.message}`, 'error');
        hideLoading();
    }
});

serialManager.addEventListener('trace', (e) => {
    log(`TRACE: ${e.detail.error}`, 'error');
});

serialManager.addEventListener('tx', (e) => {
    if (elements.showHexCheck?.checked) {
        log(`TX: ${e.detail.hex}`, 'tx');
    }
});

serialManager.addEventListener('rx', (e) => {
    if (elements.showHexCheck?.checked) {
        log(`RX: ${e.detail.hex}`, 'rx');
    }
});

elements.connectBtn.addEventListener('click', async () => {
    try {
        if (serialManager.isConnected) {
            await serialManager.disconnect();
        } else {
            await serialManager.connect();
        }
    } catch (error) {
        log(`연결 오류: ${error.message}`, 'error');
        showToast(error.message, 'error');
        updateConnectionUI(false);
    }
});

elements.refreshBtn.addEventListener('click', async () => {
    if (serialManager.isConnected && serialManager.boardReady) {
        await fetchAllData();
    }
});

elements.saveAllBtn.addEventListener('click', saveAllChanges);

elements.clearTerminalBtn.addEventListener('click', () => {
    elements.terminalOutput.innerHTML = '<div class="log-line info">터미널 클리어</div>';
});

elements.toggleTerminalBtn.addEventListener('click', () => {
    document.querySelector('.terminal-panel').classList.toggle('collapsed');
});

elements.copyPathBtn.addEventListener('click', () => {
    if (selectedNode) {
        navigator.clipboard.writeText(selectedNode.path);
        showToast('경로 복사됨', 'success');
    }
});

elements.expandAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.tree-toggle.collapsed').forEach(toggle => {
        toggle.classList.remove('collapsed');
        toggle.classList.add('expanded');
    });
    document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.add('expanded');
    });
});

// Initialize
async function init() {
    updateConnectionUI(false);
    log('VelocityDRIVE-SP YANG Editor 준비됨', 'info');

    const loaded = await loadAllCatalogs();
    if (loaded) {
        log(`YANG 카탈로그 준비 완료 (${yangCatalog.sidToPath.size} SIDs)`, 'success');
    }
}

init();
