/**
 * VelocityDRIVE-SP Mobile YANG Browser
 * Optimized for touch devices
 */

import { WebSerialManager } from './webserial.js';

const serialManager = new WebSerialManager();

const yangCatalog = {
    sidToPath: new Map()
};

const ROOT_MODULES = [
    { name: 'system-state', sid: 19020 },
    { name: 'system', sid: 19017 },
    { name: 'interfaces', sid: 2005 },
    { name: 'bridges', sid: 7025 },
    { name: 'ptp', sid: 15076 },
    { name: 'lldp', sid: 11001 },
    { name: 'hardware', sid: 31054 }
];

let yangData = {};
let selectedPath = '/';
let selectedValue = null;

const $ = id => document.getElementById(id);

const elements = {
    connectBtn: $('connectBtn'),
    statusIndicator: $('statusIndicator'),
    treeContainer: $('treeContainer'),
    currentPath: $('currentPath'),
    valueContainer: $('valueContainer'),
    loadingOverlay: $('loadingOverlay'),
    loadingText: $('loadingText'),
    toastContainer: $('toastContainer'),
    infoPlatform: $('infoPlatform'),
    infoStatus: $('infoStatus'),
    infoCatalog: $('infoCatalog'),
    infoModules: $('infoModules'),
    treePanel: $('treePanel'),
    valuePanel: $('valuePanel'),
    infoPanel: $('infoPanel')
};

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const panelId = item.dataset.panel;

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(panelId).classList.add('active');
    });
});

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
        elements.statusIndicator.classList.add('connected');
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg> 해제';
        elements.infoStatus.textContent = '연결됨';
    } else {
        elements.statusIndicator.classList.remove('connected');
        elements.connectBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg> 연결';
        elements.infoStatus.textContent = '연결 안됨';
        elements.treeContainer.innerHTML = '<div class="placeholder"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/></svg><div>보드에 연결하면<br>YANG 데이터가 표시됩니다</div></div>';
    }
}

// Catalog
async function loadAllCatalogs() {
    try {
        const indexResponse = await fetch('./js/catalogs/index.json');
        if (!indexResponse.ok) return false;

        const index = await indexResponse.json();
        for (const checksum of index.checksums) {
            try {
                const response = await fetch(`./js/catalogs/${checksum}.json`);
                if (response.ok) {
                    const data = await response.json();
                    for (const [sid, path] of Object.entries(data.sidToPath)) {
                        yangCatalog.sidToPath.set(parseInt(sid), path);
                    }
                }
            } catch (e) {}
        }

        elements.infoCatalog.textContent = `${yangCatalog.sidToPath.size} SIDs`;
        return true;
    } catch (error) {
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
    if (typeof key !== 'number') return { sid: null, name: String(key) };

    const deltaSid = parentSid + key;
    let name = getSidName(deltaSid);
    if (name) return { sid: deltaSid, name };

    name = getSidName(key);
    if (name) return { sid: key, name };

    return { sid: deltaSid, name: String(deltaSid) };
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

// Tree
function createTreeNode(name, value, path, depth = 0) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    header.style.paddingLeft = `${depth * 16 + 8}px`;

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    const isExpandable = value !== null && typeof value === 'object';
    toggle.classList.add(isExpandable ? 'collapsed' : 'empty');
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

    if (isExpandable) {
        const count = Array.isArray(value) ? value.length : Object.keys(value).length;
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'tree-node-badge';
            badge.textContent = count;
            header.appendChild(badge);
        }
    }

    node.appendChild(header);

    if (isExpandable) {
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

        header.addEventListener('click', () => {
            const isExpanded = toggle.classList.contains('expanded');
            toggle.classList.toggle('expanded', !isExpanded);
            toggle.classList.toggle('collapsed', isExpanded);
            children.classList.toggle('expanded', !isExpanded);
            selectNode(path, value);
        });
    } else {
        header.addEventListener('click', () => selectNode(path, value));
    }

    return node;
}

function selectNode(path, value) {
    document.querySelectorAll('.tree-node-header.selected').forEach(el => el.classList.remove('selected'));
    event.currentTarget.classList.add('selected');

    selectedPath = path;
    selectedValue = value;

    elements.currentPath.textContent = path;
    updateValuePanel(value);

    // Switch to value panel on mobile
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-panel="valuePanel"]').classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    elements.valuePanel.classList.add('active');
}

function updateValuePanel(data) {
    elements.valueContainer.innerHTML = '';

    if (data === null || data === undefined) {
        elements.valueContainer.innerHTML = '<div class="placeholder"><div>값 없음</div></div>';
        return;
    }

    if (typeof data !== 'object') {
        const item = createValueItem('(value)', data);
        elements.valueContainer.appendChild(item);
        return;
    }

    const entries = Array.isArray(data)
        ? data.map((v, i) => [`[${i}]`, v])
        : Object.entries(data);

    entries.forEach(([key, value]) => {
        const item = createValueItem(key, value);
        elements.valueContainer.appendChild(item);
    });

    if (entries.length === 0) {
        elements.valueContainer.innerHTML = '<div class="placeholder"><div>빈 객체</div></div>';
    }
}

function createValueItem(name, value) {
    const item = document.createElement('div');
    item.className = 'value-item';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'value-name';
    nameDiv.textContent = name;
    item.appendChild(nameDiv);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'value-content';

    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    valueDiv.classList.add(type === 'array' ? 'object' : type);

    if (value === null) {
        valueDiv.textContent = 'null';
    } else if (typeof value === 'string') {
        valueDiv.textContent = `"${value}"`;
    } else if (typeof value === 'object') {
        const count = Array.isArray(value) ? value.length : Object.keys(value).length;
        valueDiv.textContent = Array.isArray(value) ? `[${count} items]` : `{${count} properties}`;
    } else {
        valueDiv.textContent = String(value);
    }
    item.appendChild(valueDiv);

    const typeDiv = document.createElement('div');
    typeDiv.className = 'value-type';
    typeDiv.textContent = type;
    item.appendChild(typeDiv);

    return item;
}

function renderTree() {
    elements.treeContainer.innerHTML = '';

    if (Object.keys(yangData).length === 0) {
        elements.treeContainer.innerHTML = '<div class="placeholder"><div>데이터 없음</div></div>';
        return;
    }

    Object.entries(yangData).forEach(([name, data]) => {
        elements.treeContainer.appendChild(createTreeNode(name, data, `/${name}`, 0));
    });

    // Update info
    elements.infoModules.innerHTML = Object.keys(yangData)
        .map(m => `<div style="padding: 4px 0; color: var(--text-primary);">${m}</div>`)
        .join('');
}

// Data fetching
async function fetchAllData() {
    showLoading('YANG 데이터 로딩...');
    yangData = {};

    for (const module of ROOT_MODULES) {
        try {
            const response = await serialManager.sendiFetchRequest(module.sid);
            if (response.isSuccess() && response.payload) {
                const raw = response.getPayloadAsCBOR();
                yangData[module.name] = decodeDeltaSids(raw, 0);
            }
        } catch (error) {
            console.error(`${module.name} error:`, error);
        }
    }

    renderTree();
    hideLoading();
    showToast('데이터 로드 완료', 'success');
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
            elements.infoPlatform.textContent = `${osName} ${osVersion}`.trim() || '-';
        }
    } catch (error) {}
}

// Events
serialManager.addEventListener('disconnected', () => {
    updateConnectionUI(false);
    showToast('연결 해제됨', 'info');
});

serialManager.addEventListener('announce', async () => {
    updateConnectionUI(true);
    showToast('보드 연결됨', 'success');

    showLoading('초기화 중...');
    await fetchSystemInfo();
    await fetchAllData();
});

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

// Init
async function init() {
    updateConnectionUI(false);
    await loadAllCatalogs();
}

init();
