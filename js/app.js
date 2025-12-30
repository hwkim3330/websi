/**
 * VelocityDRIVE-SP YANG Browser
 * Registry Editor style tree view for YANG data
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

// YANG SID Catalog
const yangCatalog = {
    sidMap: new Map(),
    sidToPath: new Map(),
    checksum: null
};

// Root YANG modules to fetch
const ROOT_MODULES = [
    { name: 'system-state', sid: 19020, path: '/ietf-system:system-state' },
    { name: 'system', sid: 19017, path: '/ietf-system:system' },
    { name: 'interfaces', sid: 2005, path: '/ietf-interfaces:interfaces' },
    { name: 'bridges', sid: 7025, path: '/ieee802-dot1q-bridge:bridges' },
    { name: 'ptp', sid: 15076, path: '/ieee1588-ptp:ptp' },
    { name: 'lldp', sid: 11001, path: '/ieee802-dot1ab-lldp:lldp' },
    { name: 'routing', sid: 12010, path: '/ietf-routing:routing' },
    { name: 'hardware', sid: 31054, path: '/ietf-hardware:hardware' },
    { name: 'stream-id', sid: 24005, path: '/ieee802-dot1cb-stream-identification:stream-identity' },
    { name: 'acl', sid: 39008, path: '/mchp-velocitysp-acl:acl' }
];

// Tree data store
let yangData = {};
let selectedNode = null;

// DOM Elements
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
    copyValueBtn: $('copyValueBtn'),
    terminalOutput: $('terminalOutput'),
    clearTerminalBtn: $('clearTerminalBtn'),
    toggleTerminalBtn: $('toggleTerminalBtn'),
    showHexCheck: $('showHexCheck'),
    expandAllBtn: $('expandAllBtn'),
    loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'),
    toastContainer: $('toastContainer')
};

// Utilities
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
    } else {
        elements.statusBar.classList.remove('connected');
        elements.statusText.textContent = '연결 안됨';
        elements.platformInfo.textContent = '-';
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5"/></svg> 연결';
        elements.refreshBtn.disabled = true;
        elements.treeContainer.innerHTML = '<div class="tree-placeholder">보드에 연결하면<br>YANG 데이터가 표시됩니다</div>';
        yangData = {};
    }
}

// YANG Catalog
async function loadYangCatalog(checksumHex) {
    log(`YANG 카탈로그 로딩: ${checksumHex}`, 'info');
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

// Try to resolve SID - first as delta, then as absolute
function resolveSid(key, parentSid, depth = 0) {
    if (typeof key !== 'number') {
        return { sid: null, name: String(key) };
    }

    // Try delta-based SID first
    const deltaSid = parentSid + key;
    let name = getSidName(deltaSid);

    // Debug logging
    const indent = '  '.repeat(depth);
    console.log(`${indent}[SID] key=${key}, parent=${parentSid}, delta=${deltaSid}, name=${name || 'NOT FOUND'}`);

    if (name) {
        return { sid: deltaSid, name };
    }

    // Try as absolute SID (for augmentations from other modules)
    name = getSidName(key);
    if (name) {
        console.log(`${indent}[SID] Found as absolute: ${key} -> ${name}`);
        return { sid: key, name };
    }

    // Fallback: if delta result is reasonable (positive), use it
    if (deltaSid > 0 && deltaSid < 100000) {
        console.log(`${indent}[SID] UNRESOLVED: delta=${deltaSid}`);
        return { sid: deltaSid, name: String(deltaSid) };
    }

    return { sid: key, name: String(key) };
}

function decodeDeltaSids(data, parentSid, depth = 0) {
    if (data === null || typeof data !== 'object') return data;

    const indent = '  '.repeat(depth);

    if (data instanceof Map) {
        console.log(`${indent}[DECODE] Map with ${data.size} entries, parentSid=${parentSid}`);
        const result = {};
        for (const [key, value] of data.entries()) {
            console.log(`${indent}[DECODE] Map key: ${key} (type: ${typeof key})`);
            const { sid, name } = resolveSid(key, parentSid, depth);
            const nextParent = sid !== null ? sid : parentSid;
            result[name] = decodeDeltaSids(value, nextParent, depth + 1);
        }
        return result;
    }

    if (Array.isArray(data)) {
        console.log(`${indent}[DECODE] Array with ${data.length} items, parentSid=${parentSid}`);
        return data.map((item, i) => {
            console.log(`${indent}[DECODE] Array[${i}]`);
            return decodeDeltaSids(item, parentSid, depth + 1);
        });
    }

    if (typeof data === 'object') {
        const keys = Object.keys(data);
        console.log(`${indent}[DECODE] Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}, parentSid=${parentSid}`);
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            const numKey = parseInt(key);
            if (!isNaN(numKey)) {
                const { sid, name } = resolveSid(numKey, parentSid, depth);
                const nextParent = sid !== null ? sid : parentSid;
                result[name] = decodeDeltaSids(value, nextParent, depth + 1);
            } else {
                console.log(`${indent}[DECODE] Non-numeric key: ${key}`);
                result[key] = decodeDeltaSids(value, parentSid, depth + 1);
            }
        }
        return result;
    }

    return data;
}

// Tree View Functions
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

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    if (isExpandable(value)) {
        toggle.classList.add('collapsed');
    } else {
        toggle.classList.add('empty');
    }
    header.appendChild(toggle);

    // Icon
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

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-node-name';
    nameSpan.textContent = name;
    header.appendChild(nameSpan);

    // Badge for arrays/objects
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

    // Children container
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

        // Toggle click handler
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
    // Deselect previous
    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // Select new
    node.querySelector('.tree-node-header').classList.add('selected');
    selectedNode = { name, value, path };

    // Update path display
    elements.currentPath.textContent = path || '/';

    // Update value table
    updateValueTable(value);
}

function updateValueTable(data) {
    elements.valueTableBody.innerHTML = '';

    if (data === null || data === undefined) {
        elements.valueTableBody.innerHTML = '<tr class="placeholder-row"><td colspan="3">값 없음</td></tr>';
        return;
    }

    if (typeof data !== 'object') {
        // Primitive value
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="name-cell">(value)</td>
            <td class="type-cell">${typeof data}</td>
            <td class="value-cell ${typeof data}">${formatValue(data)}</td>
        `;
        elements.valueTableBody.appendChild(row);
        return;
    }

    if (Array.isArray(data)) {
        data.forEach((item, index) => {
            const row = document.createElement('tr');
            const type = getValueType(item);
            row.innerHTML = `
                <td class="name-cell">[${index}]</td>
                <td class="type-cell">${getTypeLabel(item)}</td>
                <td class="value-cell ${type}">${formatValue(item)}</td>
            `;
            elements.valueTableBody.appendChild(row);
        });
    } else {
        Object.entries(data).forEach(([key, value]) => {
            const row = document.createElement('tr');
            const type = getValueType(value);
            row.innerHTML = `
                <td class="name-cell">${escapeHtml(key)}</td>
                <td class="type-cell">${getTypeLabel(value)}</td>
                <td class="value-cell ${type}">${formatValue(value)}</td>
            `;
            elements.valueTableBody.appendChild(row);
        });
    }

    if (elements.valueTableBody.children.length === 0) {
        elements.valueTableBody.innerHTML = '<tr class="placeholder-row"><td colspan="3">빈 객체</td></tr>';
    }
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

// Data Fetching
async function fetchAllData() {
    showLoading('YANG 데이터 로딩 중...');
    yangData = {};

    for (const module of ROOT_MODULES) {
        try {
            log(`Fetching ${module.name} (SID: ${module.sid})...`, 'info');
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

async function fetchChecksum() {
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
            }
        }
    } catch (error) {
        log(`체크섬 조회 실패: ${error.message}`, 'error');
    }
}

async function fetchSystemInfo() {
    try {
        const response = await serialManager.sendiFetchRequest(19024);
        if (response.isSuccess() && response.payload) {
            const raw = response.getPayloadAsCBOR();
            const decoded = decodeDeltaSids(raw, 0);
            console.log('System platform data:', decoded);

            // Try different possible structures
            let platform = decoded;
            if (decoded['platform']) platform = decoded['platform'];
            if (decoded['system-state']) platform = decoded['system-state']['platform'] || decoded['system-state'];

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

// Event Handlers
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
        await fetchChecksum();
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

// Button handlers
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

elements.clearTerminalBtn.addEventListener('click', () => {
    elements.terminalOutput.innerHTML = '<div class="log-line info">터미널 클리어</div>';
});

elements.toggleTerminalBtn.addEventListener('click', () => {
    const terminal = document.querySelector('.terminal-panel');
    terminal.classList.toggle('collapsed');
});

elements.copyPathBtn.addEventListener('click', () => {
    if (selectedNode) {
        navigator.clipboard.writeText(selectedNode.path);
        showToast('경로 복사됨', 'success');
    }
});

elements.copyValueBtn.addEventListener('click', () => {
    if (selectedNode) {
        navigator.clipboard.writeText(JSON.stringify(selectedNode.value, null, 2));
        showToast('값 복사됨', 'success');
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
updateConnectionUI(false);
log('VelocityDRIVE-SP YANG Browser 준비됨', 'info');
