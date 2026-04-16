const axios = require('axios');
const { shell, ipcRenderer } = require('electron');
const http = require('http'); 
const fs = require('fs');
const path = require('path');
const { fetchBalances, fetchPositions } = require('./connections.js'); 

let isDataLoaded = false;
let balChartInstance = null;
const audioAlert = new Audio();

// Глобальні змінні
let globalCrossData = {}; 
let patternStats = {}; 
let alertedCoins = new Set();
let lastKnownPositions = {}; // Для відстеження історії закритих угод
let lastAnomalyAlerts = {};  // Для обмеження частоти спаму звуком по аномаліям

// --- НАЛАШТУВАННЯ ТА ЗБЕРЕЖЕННЯ (Persistence) ---
let settings = {
    activeExchanges: ['MEXC', 'Gate.io', 'Binance', 'Bybit', 'Bitget'],
    minVol: 100,
    maxVol: 50000,
    alertSpread: 5,
    soundFile: '',
    soundVolume: 50,
    watchlist: [], 
    apiKeys: {},
    balanceHistory: [],
    minimizeToTray: false,
    autoStart: false,
    savedPositions: {}, 
    openDates: {}, 
    positionHistory: [] 
};

function saveSettingsToLocal() {
    localStorage.setItem('cryptoArbSettings', JSON.stringify(settings));
}

function loadSettingsFromLocal() {
    const s = localStorage.getItem('cryptoArbSettings');
    if(s) {
        try {
            settings = { ...settings, ...JSON.parse(s) };
        } catch(e) {}
    }
    
    document.getElementById('min-vol').value = settings.minVol;
    document.getElementById('max-vol').value = settings.maxVol;
    document.getElementById('alert-spread').value = settings.alertSpread;
    document.getElementById('sound-volume').value = settings.soundVolume;
    document.getElementById('vol-val').innerText = settings.soundVolume + '%';
    
    document.getElementById('setting-tray').checked = settings.minimizeToTray || false;
    document.getElementById('setting-autostart').checked = settings.autoStart || false;
    
    ipcRenderer.send('update-launch-settings', { minimizeToTray: settings.minimizeToTray, autoStart: settings.autoStart });
    
    lastKnownPositions = settings.savedPositions || {};

    document.querySelectorAll('.ex-filter').forEach(cb => {
        cb.checked = settings.activeExchanges.includes(cb.value);
    });

    updateBalancesUI();
}

window.saveLaunchSettings = function() {
    settings.minimizeToTray = document.getElementById('setting-tray').checked;
    settings.autoStart = document.getElementById('setting-autostart').checked;
    saveSettingsToLocal();
    ipcRenderer.send('update-launch-settings', { minimizeToTray: settings.minimizeToTray, autoStart: settings.autoStart });
    window.closeModal('launch-modal');
    window.showToast('Налаштування', 'Параметри запуску збережено.');
};

// --- СИСТЕМА СПОВІЩЕНЬ (ТОАСТИ) ---
window.showToast = function(title, text, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' error' : '');
    
    if(isError) {
        toast.innerHTML = `<span>${title}</span><span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
    } else {
        toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-text">${text}</div><span class="toast-close" style="position:absolute; top:10px; right:15px;" onclick="this.parentElement.remove()">×</span>`;
    }
    
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 8000);
};

// --- РОБОТА ЗІ ЗВУКАМИ ---
function loadSoundFiles() {
    const assetsDir = path.join(__dirname, 'assets');
    const sel = document.getElementById('sound-file');
    
    if(fs.existsSync(assetsDir)) {
        let files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
        if(files.length > 0) {
            sel.innerHTML = files.map(f => `<option value="${f}">${f}</option>`).join('');
            if(settings.soundFile && files.includes(settings.soundFile)) {
                sel.value = settings.soundFile;
            } else {
                settings.soundFile = files[0];
            }
        } else {
            sel.innerHTML = `<option value="">Папка assets пуста</option>`;
        }
    } else {
        sel.innerHTML = `<option value="">Створіть папку assets</option>`;
    }
}

window.testSound = function() {
    const file = document.getElementById('sound-file').value;
    const vol = document.getElementById('sound-volume').value / 100;
    if(!file) return alert("Не вибрано звук!");
    
    audioAlert.src = path.join(__dirname, 'assets', file);
    audioAlert.volume = vol;
    audioAlert.play().catch(e => console.log("Помилка відтворення звуку"));
};

window.saveSoundSettings = function() {
    settings.soundFile = document.getElementById('sound-file').value;
    settings.soundVolume = document.getElementById('sound-volume').value;
    saveSettingsToLocal();
    window.closeModal('notif-modal');
    window.showToast('Налаштування', 'Налаштування звуку збережено.');
};

function playAlert() {
    if(!settings.soundFile) return;
    audioAlert.src = path.join(__dirname, 'assets', settings.soundFile);
    audioAlert.volume = settings.soundVolume / 100;
    audioAlert.play().catch(e => {});
}

// --- БАЛАНСИ ТА РЕАЛЬНІ API ---
async function updateBalancesUI() {
    const btn = document.getElementById('btn-ex-status');
    const drop = document.getElementById('ex-dropdown');
    const totalBadge = document.getElementById('total-balance-badge');
    
    if(Object.keys(settings.apiKeys).length === 0) {
        btn.className = 'api-status-btn';
        drop.innerHTML = `<div class="ex-drop-empty">Немає підключених бірж</div>`;
        totalBadge.innerHTML = `👤 $0.00`;
        return;
    }

    const result = await fetchBalances(settings.apiKeys);

    let dropHtml = '';
    result.details.forEach(info => {
        if(info.error) {
            dropHtml += `<div class="ex-drop-item"><div class="ex-drop-header"><span>🔴 ${info.exchange}</span></div><div class="ex-drop-error">${info.error}</div></div>`;
        } else {
            dropHtml += `<div class="ex-drop-item"><div class="ex-drop-header"><span>🟢 ${info.exchange}</span> <span>$${info.balance.toFixed(2)}</span></div></div>`;
        }
    });

    drop.innerHTML = dropHtml;
    totalBadge.innerHTML = `👤 $${result.total.toFixed(2)}`;
    
    if(result.hasError) {
        btn.className = 'api-status-btn red';
    } else {
        btn.className = 'api-status-btn green';
    }

    const lastRecord = settings.balanceHistory.length > 0 ? settings.balanceHistory[settings.balanceHistory.length - 1].total : null;
    if (lastRecord === null || Math.abs(lastRecord - result.total) > 0.01) {
        settings.balanceHistory.push({ time: Date.now(), total: result.total });
        if (settings.balanceHistory.length > 1000) settings.balanceHistory.shift(); 
        saveSettingsToLocal();
    }
}

window.toggleExStatus = function() {
    const drop = document.getElementById('ex-dropdown');
    drop.classList.toggle('active');
};

document.addEventListener('click', (e) => {
    if(!e.target.closest('#btn-ex-status') && !e.target.closest('#ex-dropdown')) {
        const drop = document.getElementById('ex-dropdown');
        if(drop) drop.classList.remove('active');
    }
});


window.saveApiKeys = function() {
    const ex = document.getElementById('api-exchange').value;
    const k = document.getElementById('api-key').value;
    const s = document.getElementById('api-secret').value;
    if(!k || !s) { alert("Введіть обидва ключі!"); return; }

    settings.apiKeys[ex] = { key: k, secret: s };
    saveSettingsToLocal();
    
    document.getElementById('api-key').value = '';
    document.getElementById('api-secret').value = '';
    window.closeModal('api-modal');
    
    updateBalancesUI();
    window.showToast('API', `Ключі збережено! Підключаюся до ${ex}...`);
};

// --- ГРАФІК БАЛАНСУ ---
window.openBalanceChart = function() {
    window.openModal('balance-chart-modal');
    window.renderBalanceChart(24);
};

window.renderBalanceChart = function(hours) {
    document.querySelectorAll('.btn-time').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    const canvas = document.getElementById('balanceChartCanvas');
    const emptyMsg = document.getElementById('bal-chart-empty');

    if (settings.balanceHistory.length < 2) {
        canvas.style.display = 'none'; emptyMsg.style.display = 'block'; return;
    }
    
    canvas.style.display = 'block'; emptyMsg.style.display = 'none';

    let filterTime = 0;
    if (hours !== 'all') filterTime = Date.now() - (hours * 60 * 60 * 1000);
    
    const filteredData = settings.balanceHistory.filter(d => d.time >= filterTime);
    if (filteredData.length < 2 && settings.balanceHistory.length > 0) {
        filteredData.push(settings.balanceHistory[settings.balanceHistory.length - 1]);
    }

    const labels = filteredData.map(d => {
        const date = new Date(d.time);
        return hours > 24 || hours === 'all' 
            ? `${date.getDate()}/${date.getMonth()+1} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`
            : `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    });
    const dataPts = filteredData.map(d => d.total);

    if(balChartInstance) balChartInstance.destroy();
    balChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Сумарний Баланс ($)', data: dataPts, borderColor: '#f0b90b', backgroundColor: 'rgba(240, 185, 11, 0.1)', borderWidth: 3, fill: true, tension: 0.1, pointRadius: 2, pointHoverRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => '$' + c.raw.toFixed(2) } } }, scales: { y: { grid: { color: '#2b3139' } }, x: { grid: { color: '#2b3139' } } } }
    });
};

// --- СЛАЙДЕР ТА МЕНЮ ---
const numTabs = 4;
window.switchTab = function(index) {
    const indicator = document.getElementById('slider-indicator');
    indicator.style.width = `${100 / numTabs}%`;
    indicator.style.transform = `translateX(${index * 100}%)`;

    document.querySelectorAll('.slider-tab').forEach((tab, i) => tab.classList.toggle('active', i === index));
    document.querySelectorAll('.tab-content').forEach((content, i) => content.classList.toggle('active', i === index));

    const filterContainer = document.getElementById('filter-bar-container');
    const alertGroup = document.getElementById('spread-alert-group');
    const alertDivider = document.getElementById('alert-divider');

    if (index === 1) { 
        filterContainer.style.display = 'block';
        if(alertGroup) alertGroup.style.display = 'none';
        if(alertDivider) alertDivider.style.display = 'none';
        if(!isDataLoaded) fetchMarketData();
    } else if (index === 2) { 
        filterContainer.style.display = 'block';
        if(alertGroup) alertGroup.style.display = 'flex';
        if(alertDivider) alertDivider.style.display = 'block';
        if(!isDataLoaded) fetchMarketData();
    } else {
        filterContainer.style.display = 'none';
    }

    if (index === 0) renderPositionsTab();
    if (index === 3) renderHistoryTab(); 
};

window.onload = () => {
    loadSettingsFromLocal();
    loadSoundFiles();
    window.switchTab(0); 
    
    // Відновлення патернів при старті для вже існуючого вочліста
    if (settings.watchlist && settings.watchlist.length > 0) {
        settings.watchlist.forEach(item => {
            calculateCoinPattern(item.cleanSymbol, item.buyEx, item.sellEx);
        });
    }

    if (typeof processWatchlist === 'function') processWatchlist(); 
    fetchMarketData();
};

window.toggleSidebar = function() {
    const dot = document.getElementById('settings-dot');
    if (dot) dot.style.display = 'none';
    
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('sidebar-overlay').classList.toggle('active');
};

window.openModal = function(modalId) { 
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sb.classList.contains('active')) {
        sb.classList.remove('active');
        overlay.classList.remove('active');
    }
    document.getElementById(modalId).classList.add('active'); 
};

window.closeModal = function(modalId) { 
    document.getElementById(modalId).classList.remove('active'); 
};

window.saveDisplaySettings = function() {
    const cb = document.querySelectorAll('.ex-filter');
    settings.activeExchanges = Array.from(cb).filter(c => c.checked).map(c => c.value);
    if(settings.activeExchanges.length < 2) { alert("Оберіть мінімум 2 біржі!"); return; }
    saveSettingsToLocal();
    window.closeModal('display-modal');
    window.forceUpdate();
};

window.saveFiltersAndUpdate = function() {
    settings.minVol = parseInt(document.getElementById('min-vol').value) || 0;
    settings.maxVol = parseInt(document.getElementById('max-vol').value) || 999999;
    settings.alertSpread = parseFloat(document.getElementById('alert-spread').value) || 999;
    saveSettingsToLocal();
    window.forceUpdate();
};

window.forceUpdate = function() {
    document.getElementById('funding-content').style.display = 'none';
    document.getElementById('funding-loader').style.display = 'block';
    document.getElementById('arb-content').style.display = 'none';
    document.getElementById('arb-loader').style.display = 'block';
    fetchMarketData();
    if(document.getElementById('tab-0').classList.contains('active')) renderPositionsTab();
};

const formatCurrency = (val) => val >= 1e6 ? '$'+(val/1e6).toFixed(2)+'M' : val >= 1e3 ? '$'+(val/1e3).toFixed(2)+'K' : '$'+val.toFixed(0);
window.openLinks = function(u1, u2=null) { if(u1) shell.openExternal(u1); if(u2) setTimeout(()=>shell.openExternal(u2),200); };

function getLinks(ex, sym, cleanSym) {
    let fUrl = ''; let sUrl = null;
    if(ex === 'Binance') { fUrl = `https://www.binance.com/en/futures/${sym}`; sUrl = `https://www.binance.com/en/trade/${cleanSym.replace('USDT', '_USDT')}`; }
    else if(ex === 'Bybit') { fUrl = `https://www.bybit.com/trade/usdt/${sym}`; sUrl = `https://www.bybit.com/en/trade/spot/${cleanSym.replace('USDT', '/USDT')}`; }
    else if(ex === 'MEXC') { fUrl = `https://futures.mexc.com/exchange/${sym}`; sUrl = `https://www.mexc.com/exchange/${cleanSym.replace('USDT', '_USDT')}`; }
    else if(ex === 'Gate.io') { fUrl = `https://www.gate.io/futures/USDT/${sym}`; sUrl = `https://www.gate.io/trade/${cleanSym.replace('USDT', '_USDT')}`; }
    else if(ex === 'Bitget') { fUrl = `https://www.bitget.com/futures/usdt/${sym}`; sUrl = `https://www.bitget.com/spot/${cleanSym}`; }
    return { fUrl, sUrl };
}

function generateTooltipHtml(allRatesMap, isNegativeGrid = false) {
    let html = `<div class="tooltip-content"><div style="margin-bottom: 8px; color: #f0b90b; text-align: center; border-bottom: 1px solid #3c444f; padding-bottom: 4px;">Фандінг на обраних біржах:</div>`;
    let ratesArray = settings.activeExchanges.map(ex => ({ ex: ex, rate: allRatesMap[ex] }));
    ratesArray.sort((a, b) => {
        if (a.rate === undefined && b.rate === undefined) return 0;
        if (a.rate === undefined) return 1;
        if (b.rate === undefined) return -1;
        return isNegativeGrid ? a.rate - b.rate : b.rate - a.rate; 
    });
    ratesArray.forEach(item => {
        let valStr = item.rate !== undefined ? (item.rate * 100).toFixed(4) + '%' : '-';
        let color = item.rate > 0 ? '#e74c3c' : (item.rate < 0 ? '#00d67c' : '#848e9c');
        html += `<div class="tooltip-row"><span class="tooltip-ex">${item.ex}</span><span class="tooltip-val" style="color: ${color}">${valStr}</span></div>`;
    });
    return html + `</div>`;
}

// ГОЛОВНИЙ ПАРСИНГ
async function fetchMarketData() {
    const startTime = Date.now();
    try {
        const minLim = settings.minVol * 1000;
        const maxLim = settings.maxVol * 1000;
        const alertSpreadLimit = settings.alertSpread;
        
        let crossData = {};
        const globalRatesMap = {}; 
        const spotSets = { 'MEXC': new Set(), 'Gate.io': new Set(), 'Binance': new Set(), 'Bybit': new Set(), 'Bitget': new Set() };

        const spotPromises = settings.activeExchanges.map(async (ex) => {
            try {
                if(ex === 'MEXC') { const r = await axios.get('https://api.mexc.com/api/v3/ticker/price', { timeout: 3000 }); r.data.forEach(i => spotSets[ex].add(i.symbol.replace('_',''))); }
                if(ex === 'Gate.io') { const r = await axios.get('https://api.gateio.ws/api/v4/spot/tickers', { timeout: 3000 }); r.data.forEach(i => spotSets[ex].add(i.currency_pair.replace('_',''))); }
                if(ex === 'Binance') { const r = await axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 3000 }); r.data.forEach(i => spotSets[ex].add(i.symbol)); }
                if(ex === 'Bybit') { const r = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot', { timeout: 3000 }); r.data.result.list.forEach(i => spotSets[ex].add(i.symbol)); }
                if(ex === 'Bitget') { const r = await axios.get('https://api.bitget.com/api/v2/spot/market/tickers', { timeout: 3000 }); r.data.data.forEach(i => spotSets[ex].add(i.symbol)); }
            } catch(e) { }
        });

        const futuresPromises = settings.activeExchanges.map(async (ex) => {
            try {
                const add = (sym, cSym, r, b, a, v) => {
                    if (isNaN(r) || isNaN(b) || isNaN(a) || b===0 || a===0) return;
                    if (!globalRatesMap[cSym]) globalRatesMap[cSym] = {};
                    globalRatesMap[cSym][ex] = r; 
                    if (!crossData[cSym]) crossData[cSym] = {};
                    crossData[cSym][ex] = { symbol: sym, rate: r, bid: b, ask: a, vol: v };
                };
                if (ex === 'MEXC') { const r = await axios.get('https://contract.mexc.com/api/v1/contract/ticker', { timeout: 4000 }); r.data.data.forEach(i => i.symbol.endsWith('_USDT') && add(i.symbol, i.symbol.replace('_', ''), parseFloat(i.fundingRate), parseFloat(i.bid1), parseFloat(i.ask1), parseFloat(i.amount24))); }
                if (ex === 'Gate.io') { const r = await axios.get('https://api.gateio.ws/api/v4/futures/usdt/tickers', { timeout: 4000 }); r.data.forEach(i => i.contract.endsWith('_USDT') && add(i.contract, i.contract.replace('_', ''), parseFloat(i.funding_rate), parseFloat(i.highest_bid), parseFloat(i.lowest_ask), parseFloat(i.quote_volume||i.volume_24h_quote||0))); }
                if (ex === 'Binance') { const [f, v, b] = await Promise.all([axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 4000 }), axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 4000 }), axios.get('https://fapi.binance.com/fapi/v1/ticker/bookTicker', { timeout: 4000 })]); const vM={}; v.data.forEach(i=>vM[i.symbol]=parseFloat(i.quoteVolume)); const bM={}; b.data.forEach(i=>bM[i.symbol]={bid:parseFloat(i.bidPrice), ask:parseFloat(i.askPrice)}); f.data.forEach(i => i.symbol.endsWith('USDT') && bM[i.symbol] && add(i.symbol, i.symbol, parseFloat(i.lastFundingRate), bM[i.symbol].bid, bM[i.symbol].ask, vM[i.symbol]||0)); }
                if (ex === 'Bybit') { const r = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear', { timeout: 4000 }); r.data.result.list.forEach(i => i.symbol.endsWith('USDT') && add(i.symbol, i.symbol, parseFloat(i.fundingRate), parseFloat(i.bid1Price), parseFloat(i.ask1Price), parseFloat(i.turnover24h||0))); }
                if (ex === 'Bitget') { const r = await axios.get('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', { timeout: 4000 }); r.data.data.forEach(i => i.symbol.endsWith('USDT') && add(i.symbol, i.symbol, parseFloat(i.fundingRate), parseFloat(i.bestBid), parseFloat(i.bestAsk), parseFloat(i.quoteVolume||0))); }
            } catch(e) { window.showToast(`⚠️ Відмова API ${ex}`, "Ф'ючерси не відповіли", true); }
        });

        await Promise.all([...spotPromises, ...futuresPromises]);
        globalCrossData = crossData;

        let positiveFunding = [], negativeFunding = [], priceArbOpps = [];

        Object.keys(crossData).forEach(cleanSymbol => {
            const exMap = crossData[cleanSymbol];
            const exs = Object.keys(exMap);
            
            exs.forEach(ex => {
                const coin = exMap[ex];
                if (coin.vol >= minLim && coin.vol <= maxLim) {
                    coin.hasSpot = spotSets[ex].has(cleanSymbol);
                    coin.allRatesMap = globalRatesMap[cleanSymbol] || {}; 
                    coin.cleanSymbol = cleanSymbol;
                    coin.exchange = ex;
                    if (coin.rate > 0) positiveFunding.push(coin);
                    if (coin.rate < 0) negativeFunding.push(coin);
                }
            });

            if (exs.length >= 2) {
                for (let i=0; i<exs.length; i++) {
                    for (let j=0; j<exs.length; j++) {
                        if (i===j) continue;
                        const ex1N = exs[i], ex2N = exs[j];
                        const ex1 = exMap[ex1N], ex2 = exMap[ex2N];

                        if (ex1.vol < minLim || ex1.vol > maxLim || ex2.vol < minLim || ex2.vol > maxLim) continue;

                        const spread = ((ex2.bid - ex1.ask) / ex1.ask) * 100;
                        if (spread >= 0.15 && spread <= 15) {
                            priceArbOpps.push({
                                cleanSymbol, spreadPct: spread,
                                buyEx: ex1N, buySymbol: ex1.symbol, buyPrice: ex1.ask, buyRate: ex1.rate, buyVol: ex1.vol,
                                sellEx: ex2N, sellSymbol: ex2.symbol, sellPrice: ex2.bid, sellRate: ex2.rate, sellVol: ex2.vol
                            });

                            if (document.getElementById('tab-2').classList.contains('active') && spread >= alertSpreadLimit) {
                                if (!alertedCoins.has(cleanSymbol)) {
                                    playAlert();
                                    window.showToast(`🚨 ВИСОКИЙ СПРЕД: ${spread.toFixed(2)}%`, `Монета: <b>${cleanSymbol}</b><br>Купити: ${ex1N}<br>Продати: ${ex2N}`);
                                    alertedCoins.add(cleanSymbol);
                                }
                            } else {
                                alertedCoins.delete(cleanSymbol); 
                            }
                        }
                    }
                }
            }
        });
        
        positiveFunding.sort((a, b) => b.rate - a.rate);
        negativeFunding.sort((a, b) => a.rate - b.rate);

        const uniqMap = {};
        priceArbOpps.forEach(o => { if(!uniqMap[o.cleanSymbol] || o.spreadPct > uniqMap[o.cleanSymbol].spreadPct) uniqMap[o.cleanSymbol] = o; });
        let finalArb = Object.values(uniqMap).sort((a,b) => b.spreadPct - a.spreadPct);

        const timeTaken = (Date.now() - startTime) / 1000;
        const timestamp = new Date().toLocaleTimeString('uk-UA');
        document.getElementById('global-status').innerHTML = `🕒 Оновлено: ${timestamp} | ⚡ Ping: ${timeTaken.toFixed(2)}s`;

        renderFundingGrids(positiveFunding.slice(0, 10), negativeFunding.slice(0, 10));
        renderArbitrageGrid(finalArb.slice(0, 20));
        if (typeof processWatchlist === 'function') processWatchlist(); 
        
        if(Object.keys(settings.apiKeys).length > 0) {
            updateBalancesUI();
        }

        isDataLoaded = true;

    } catch (error) { document.getElementById('global-status').innerHTML = `🔴 OFFLINE`; }
}

// --- РЕНДЕР ВІДКРИТИХ ПОЗИЦІЙ ТА ІСТОРІЯ ---
async function renderPositionsTab() {
    const loader = document.getElementById('pos-loader');
    const container = document.getElementById('pos-content');
    loader.style.display = 'block'; container.innerHTML = '';

    if(Object.keys(settings.apiKeys).length === 0) {
        loader.style.display = 'none';
        container.innerHTML = `<div class="placeholder-text">Для перегляду позицій необхідно підключити API бірж у налаштуваннях.</div>`;
        return;
    }

    try {
        const posArray = await fetchPositions(settings.apiKeys);
        
        const currentPosIds = new Set();
        posArray.forEach(p => {
            const id = `${p.exchange}_${p.cleanSymbol}_${p.side}`;
            currentPosIds.add(id);
        });

        Object.keys(lastKnownPositions).forEach(id => {
            if (!currentPosIds.has(id)) {
                const closedPos = lastKnownPositions[id];
                closedPos.closeDate = Date.now();
                closedPos.finalPnl = (closedPos.unRealized || 0) + (closedPos.realized || 0); 
                
                if(!settings.positionHistory) settings.positionHistory = [];
                settings.positionHistory.unshift(closedPos); 
                
                if(settings.positionHistory.length > 200) settings.positionHistory.pop(); 
                
                delete settings.openDates[id];
                saveSettingsToLocal();
            }
        });

        lastKnownPositions = {};
        posArray.forEach(p => {
            const id = `${p.exchange}_${p.cleanSymbol}_${p.side}`;
            if(!settings.openDates) settings.openDates = {};
            if(!settings.openDates[id]) {
                settings.openDates[id] = Date.now(); 
                saveSettingsToLocal();
            }
            p.openDate = settings.openDates[id];
            lastKnownPositions[id] = p;
        });
        
        settings.savedPositions = lastKnownPositions;
        saveSettingsToLocal();

        if (posArray.length === 0) {
            loader.style.display = 'none';
            container.innerHTML = `<div class="placeholder-text">У вас немає відкритих позицій на підключених біржах.</div>`;
            return;
        }

        const grouped = {};
        posArray.forEach(p => {
            if(!grouped[p.cleanSymbol]) grouped[p.cleanSymbol] = [];
            grouped[p.cleanSymbol].push(p);
        });

        let html = '';
        Object.keys(grouped).forEach(sym => {
            const arr = grouped[sym];
            
            let totalUnrealized = 0;
            let totalRealized = 0;
            let totalSize = 0;
            let exSides = [];
            let prices = [];

            arr.forEach(p => {
                totalUnrealized += p.unRealized || 0;
                totalRealized += p.realized || 0;
                totalSize += p.sizeUSDT || 0;
                
                const col = p.side === 'Long' ? 'color:#00d67c;' : 'color:#e74c3c;';
                exSides.push(`<span style="font-weight:bold;">${p.exchange}</span> (<span style="${col}">${p.side} ${p.leverage}x</span>)`);
                prices.push(`$${p.entryPrice.toFixed(4)}`);
            });

            let spreadStr = '-';
            if(arr.length >= 2) {
                const maxP = Math.max(arr[0].entryPrice, arr[1].entryPrice);
                const minP = Math.min(arr[0].entryPrice, arr[1].entryPrice);
                spreadStr = (((maxP - minP) / minP) * 100).toFixed(2) + '%';
            }

            const estProfit = totalUnrealized + totalRealized;
            const pnlClass = estProfit >= 0 ? 'pnl-green' : 'pnl-red';
            const sign = estProfit > 0 ? '+' : '';

            html += `
            <div class="pos-card">
                <div class="pos-col" style="flex: 1.2;">
                    <div class="pos-label">Монета</div>
                    <div class="pos-value" style="font-size: 1.3em;">${sym}</div>
                    <div class="pos-subval" style="margin-top:4px;">${exSides.join(' / ')}</div>
                </div>
                
                <div class="pos-col center" style="flex: 1;">
                    <div class="pos-label">Розмір (USDT)</div>
                    <div class="pos-value">${formatCurrency(totalSize)}</div>
                </div>

                <div class="pos-col center" style="flex: 1.2;">
                    <div class="pos-label">Вхідна ціна</div>
                    <div class="pos-value">${prices.join(' <span style="color:#848e9c;">/</span> ')}</div>
                </div>

                <div class="pos-col center" style="flex: 0.8;">
                    <div class="pos-label">Спред Входу</div>
                    <div class="pos-value" style="color: #3498db;">${spreadStr}</div>
                </div>

                <div class="pos-col right" style="flex: 1.2;">
                    <div style="display:flex; justify-content: flex-end; gap: 15px; margin-bottom: 5px;">
                        <div class="pos-col right">
                            <div class="pos-label">Реалізований</div>
                            <div class="pos-subval ${totalRealized >= 0 ? 'pnl-green' : 'pnl-red'}">$${totalRealized.toFixed(2)}</div>
                        </div>
                        <div class="pos-col right">
                            <div class="pos-label">Нереалізований</div>
                            <div class="pos-subval ${totalUnrealized >= 0 ? 'pnl-green' : 'pnl-red'}">$${totalUnrealized.toFixed(2)}</div>
                        </div>
                    </div>
                    <div class="pos-total-pnl ${pnlClass}">
                        ${sign}$${estProfit.toFixed(2)}
                    </div>
                </div>
            </div>`;
        });

        loader.style.display = 'none';
        container.innerHTML = html;

    } catch (e) {
        loader.style.display = 'none';
        container.innerHTML = `<div class="placeholder-text" style="color:#e74c3c;">Помилка отримання позицій. Перевірте API ключі.</div>`;
    }
}

// --- ВКЛАДКА ІСТОРІЇ ---
function renderHistoryTab() {
    const container = document.getElementById('history-content');
    
    if(!settings.positionHistory || settings.positionHistory.length === 0) {
        container.innerHTML = `<div class="placeholder-text">У вас ще немає закритих позицій в історії.</div>`;
        return;
    }

    let html = '';
    settings.positionHistory.forEach(p => {
        const oDate = new Date(p.openDate || p.closeDate).toLocaleString('uk-UA');
        const cDate = new Date(p.closeDate).toLocaleString('uk-UA');
        const col = p.side === 'Long' ? 'color:#00d67c;' : 'color:#e74c3c;';
        const pnlClass = p.finalPnl >= 0 ? 'pnl-green' : 'pnl-red';
        const sign = p.finalPnl > 0 ? '+' : '';

        html += `
        <div class="pos-card" style="opacity: 0.9;">
            <div class="pos-col" style="flex: 1.2;">
                <div class="pos-label">Монета (Закрита)</div>
                <div class="pos-value" style="font-size: 1.3em;">${p.cleanSymbol}</div>
                <div class="pos-subval" style="margin-top:4px;"><span style="font-weight:bold;">${p.exchange}</span> (<span style="${col}">${p.side} ${p.leverage}x</span>)</div>
            </div>
            
            <div class="pos-col center" style="flex: 1;">
                <div class="pos-label">Розмір (USDT)</div>
                <div class="pos-value">${formatCurrency(p.sizeUSDT || 0)}</div>
            </div>

            <div class="pos-col center" style="flex: 1.5;">
                <div class="pos-label">Час життя позиції</div>
                <div class="pos-subval">Відкр: <span style="color:#fff;">${oDate}</span></div>
                <div class="pos-subval">Закр: <span style="color:#fff;">${cDate}</span></div>
            </div>

            <div class="pos-col right" style="flex: 1.2;">
                <div class="pos-label">Фінальний PNL</div>
                <div class="pos-total-pnl ${pnlClass}" style="display:inline-block; margin-top:5px;">
                    ${sign}$${p.finalPnl.toFixed(2)}
                </div>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

// --- РЕНДЕР ФАНДІНГУ (ОНОВЛЕНО: додано кнопки графіків) ---
function renderFundingGrids(posData, negData) {
    document.getElementById('funding-loader').style.display = 'none';
    document.getElementById('funding-content').style.display = 'block';

    let negHtml = '';
    negData.forEach(item => {
        const rateStr = (item.rate * 100).toFixed(4) + '%';
        const { fUrl } = getLinks(item.exchange, item.symbol, item.cleanSymbol);
        const tooltipHtml = generateTooltipHtml(item.allRatesMap, true);
        
        // Знаходимо іншу доступну біржу для порівняння ціни на графіку
        const counterpartEx = settings.activeExchanges.find(ex => ex !== item.exchange && item.allRatesMap[ex] !== undefined);
        const chartBtn = counterpartEx 
            ? `<button class="btn-chart" style="margin-top: 8px; background: #2b3139;" onclick="openChartWindow('${item.cleanSymbol}', '${item.exchange}', '${counterpartEx}')">📊 Спред з ${counterpartEx}</button>`
            : '';

        negHtml += `
            <div class="card">
                <div class="card-header">
                    <div class="card-header-left"><span class="symbol" title="${item.cleanSymbol}">${item.cleanSymbol}</span></div>
                    <span class="vol-badge">Vol: ${formatCurrency(item.vol)}</span>
                </div>
                <div class="rate-container tooltip-container">
                    <div class="rate-exchange">${item.exchange}</div>
                    <div class="rate-box rate-negative">${rateStr}</div>
                    ${tooltipHtml}
                </div>
                <div class="buttons-row"><button class="btn" onclick="openLinks('${fUrl}')">ВІДКРИТИ ПОЗИЦІЮ</button></div>
                ${chartBtn}
            </div>`;
    });
    document.getElementById('negative-grid').innerHTML = negHtml;

    let posHtml = '';
    posData.forEach(item => {
        const rateStr = (item.rate * 100).toFixed(4) + '%';
        const spotInd = !item.hasSpot ? `<span class="no-spot-dot" title="Немає Спота на ${item.exchange}"></span>` : ``; 
        const { fUrl, sUrl } = getLinks(item.exchange, item.symbol, item.cleanSymbol);
        const clickHandler = item.hasSpot ? `openLinks('${fUrl}', '${sUrl}')` : `openLinks('${fUrl}')`;

        // Знаходимо іншу доступну біржу для порівняння ціни на графіку
        const counterpartEx = settings.activeExchanges.find(ex => ex !== item.exchange && item.allRatesMap[ex] !== undefined);
        const chartBtn = counterpartEx 
            ? `<button class="btn-chart" style="margin-top: 8px; background: #2b3139;" onclick="openChartWindow('${item.cleanSymbol}', '${item.exchange}', '${counterpartEx}')">📊 Спред з ${counterpartEx}</button>`
            : '';

        posHtml += `
            <div class="card">
                <div class="card-header">
                    <div class="card-header-left">${spotInd}<span class="symbol" title="${item.cleanSymbol}">${item.cleanSymbol}</span></div>
                    <span class="vol-badge">Vol: ${formatCurrency(item.vol)}</span>
                </div>
                <div class="rate-container tooltip-container">
                    <div class="rate-exchange">${item.exchange}</div>
                    <div class="rate-box rate-positive">${rateStr}</div>
                    ${generateTooltipHtml(item.allRatesMap, false)}
                </div>
                <div class="buttons-row"><button class="btn" onclick="${clickHandler}">ВІДКРИТИ ПОЗИЦІЮ</button></div>
                ${chartBtn}
            </div>`;
    });
    document.getElementById('positive-grid').innerHTML = posHtml;
}

// --- РЕНДЕР АРБІТРАЖУ ---
function renderArbitrageGrid(arbData) {
    document.getElementById('arb-loader').style.display = 'none';
    document.getElementById('arb-content').style.display = 'flex';
    const grid = document.getElementById('arb-grid');

    if (arbData.length === 0) { grid.innerHTML = `<h3 style="color:#848e9c; text-align:center; grid-column: 1 / -1;">Немає даних</h3>`; return; }

    let html = '';
    arbData.forEach(item => {
        html += generateArbCardHtml(
            item.cleanSymbol, item.spreadPct, 
            item.buyEx, { symbol: item.buySymbol, ask: item.buyPrice, rate: item.buyRate, vol: item.buyVol }, 
            item.sellEx, { symbol: item.sellSymbol, bid: item.sellPrice, rate: item.sellRate, vol: item.sellVol },
            false
        );
    });
    grid.innerHTML = html;
}

function generateArbCardHtml(cleanSymbol, spread, buyEx, buyData, sellEx, sellData, isWatchlist) {
    const maxVol = Math.max(buyData.vol, sellData.vol);
    const sStr = spread.toFixed(2) + '%';
    
    const bR = buyData.rate * 100; const bRStr = (bR>0?'-':'+')+Math.abs(bR).toFixed(4)+'%'; const bRCol = bR>0?'#e74c3c':'#00d67c';
    const sR = sellData.rate * 100; const sRStr = (sR>0?'+':'-')+Math.abs(sR).toFixed(4)+'%'; const sRCol = sR>0?'#00d67c':'#e74c3c';

    const bLink = getLinks(buyEx, buyData.symbol, cleanSymbol).fUrl;
    const sLink = getLinks(sellEx, sellData.symbol, cleanSymbol).fUrl;

    const inWl = settings.watchlist.some(i => i.cleanSymbol === cleanSymbol);
    let iconSvg = '';
    if(isWatchlist) {
        iconSvg = `<svg class="icon-action icon-remove" viewBox="0 0 24 24" onclick="toggleWatchlist('${cleanSymbol}')"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    } else {
        const eyeColor = inWl ? '#f0b90b' : '#848e9c';
        iconSvg = `<svg class="icon-action eye-icon-${cleanSymbol}" style="fill:${eyeColor};" viewBox="0 0 24 24" onclick="toggleWatchlist('${cleanSymbol}','${buyEx}','${sellEx}')"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    }

    // --- ДОДАНА ЛОГІКА СЕРЕДНЬОГО СПРЕДУ ДЛЯ WATCH LIST ---
    let avgSpreadHtml = '';
    if (isWatchlist) {
        if (patternStats[cleanSymbol] && patternStats[cleanSymbol].isReady) {
            avgSpreadHtml = `<div style="font-size: 0.85em; color: #f0b90b; margin-top: 6px; font-weight: bold; border-top: 1px dashed rgba(240, 185, 11, 0.3); padding-top: 4px;" title="Середній спред за 12 годин">~ ${patternStats[cleanSymbol].avg.toFixed(2)}%</div>`;
        } else {
            avgSpreadHtml = `<div style="font-size: 0.75em; color: #848e9c; margin-top: 6px; border-top: 1px dashed #3c444f; padding-top: 4px;" title="Рахуємо історію...">⏳ аналіз...</div>`;
        }
    }

    return `
        <div class="arb-card">
            <div class="arb-top">
                <div class="arb-symbol-col">
                    <div class="arb-symbol-row">
                        ${iconSvg}
                        <span class="symbol" title="${cleanSymbol}">${cleanSymbol}</span>
                    </div>
                    <span class="vol-badge" style="width: max-content;">Vol: ${formatCurrency(maxVol)}</span>
                </div>
                <div class="arb-spread-box">
                    <div style="font-size: 0.75em; color: #848e9c;">Спред Ціни:</div>
                    <div class="arb-spread-val">${sStr}</div>
                    ${avgSpreadHtml}
                </div>
            </div>
            <div>
                <div class="arb-trade-box arb-buy">
                    <div class="arb-trade-box-left">
                        <div class="arb-trade-label" title="🟢 Купити (Лонг) на (Ask):">🟢 Купити (Лонг) на (Ask):</div>
                        <div class="arb-ex-name">${buyEx}</div>
                        <div class="arb-funding-text">Фандінг: <span style="color: ${bRCol}; font-weight: bold;">${bRStr}</span></div>
                    </div>
                    <div class="arb-trade-box-right">
                        <div class="arb-price green">$${buyData.ask || buyData.bid}</div>
                        <span class="arb-link" onclick="openLinks('${bLink}')">Відкрити ↗</span>
                    </div>
                </div>
                <div class="arb-trade-box arb-sell">
                    <div class="arb-trade-box-left">
                        <div class="arb-trade-label" title="🔴 Продати (Шорт) на (Bid):">🔴 Продати (Шорт) на (Bid):</div>
                        <div class="arb-ex-name">${sellEx}</div>
                        <div class="arb-funding-text">Фандінг: <span style="color: ${sRCol}; font-weight: bold;">${sRStr}</span></div>
                    </div>
                    <div class="arb-trade-box-right">
                        <div class="arb-price red">$${sellData.bid || sellData.ask}</div>
                        <span class="arb-link" onclick="openLinks('${sLink}')">Відкрити ↗</span>
                    </div>
                </div>
            </div>
            <button class="btn-chart" onclick="openChartWindow('${cleanSymbol}', '${sellEx}', '${buyEx}')">📊 Історія спреду (12 годин)</button>
        </div>
    `;
}

// --- ЛОГІКА ГРАФІКІВ У НОВІЙ ВКЛАДЦІ CHROME ---
const chartPort = 3001;
const chartServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${chartPort}`);
    if (url.pathname === '/chart') {
        const symbol = url.searchParams.get('symbol');
        const ex1 = url.searchParams.get('ex1'); // Sell
        const ex2 = url.searchParams.get('ex2'); // Buy
        return generateChartPage(symbol, ex1, ex2, res);
    }
    res.writeHead(404); res.end();
});
chartServer.listen(chartPort);

window.openChartWindow = function(symbol, ex1, ex2) {
    shell.openExternal(`http://localhost:${chartPort}/chart?symbol=${symbol}&ex1=${ex1}&ex2=${ex2}`);
};

async function getKlineData(ex, sym) {
    try {
        if(ex==='Binance') return (await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1m&limit=720`)).data.map(k=>({time:parseInt(k[0]),close:parseFloat(k[4])}));
        if(ex==='Bybit') return (await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=1&limit=720`)).data.result.list.reverse().map(k=>({time:parseInt(k[0]),close:parseFloat(k[4])}));
        if(ex==='MEXC') return (await axios.get(`https://api.mexc.com/api/v3/klines?symbol=${sym}&interval=1m&limit=720`)).data.map(k=>({time:parseInt(k[0]),close:parseFloat(k[4])}));
        if(ex==='Gate.io') return (await axios.get(`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${sym.replace('USDT','_USDT')}&interval=1m&limit=720`)).data.map(k=>({time:parseInt(k.t)*1000,close:parseFloat(k.c)}));
        if(ex==='Bitget') return (await axios.get(`https://api.bitget.com/api/v2/mix/market/candles?symbol=${sym}&productType=USDT-FUTURES&granularity=1m&limit=720`)).data.data.map(k=>({time:parseInt(k[0]),close:parseFloat(k[4])}));
    } catch(e) {} return [];
}

async function getFundingHistory(ex, sym) {
    try {
        if(ex==='Binance') return (await axios.get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=40`)).data.map(i=>({time:parseInt(i.fundingTime),rate:parseFloat(i.fundingRate)}));
        if(ex==='Bybit') return (await axios.get(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}&limit=40`)).data.result.list.map(i=>({time:parseInt(i.fundingRateTimestamp),rate:parseFloat(i.fundingRate)}));
        if(ex==='MEXC') return (await axios.get(`https://contract.mexc.com/api/v1/contract/funding_rate/history?symbol=${sym.replace('USDT','_USDT')}&page_num=1&page_size=40`)).data.data.resultList.map(i=>({time:parseInt(i.settleTime),rate:parseFloat(i.fundingRate)}));
        if(ex==='Gate.io') return (await axios.get(`https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${sym.replace('USDT','_USDT')}&limit=40`)).data.map(i=>({time:parseInt(i.t)*1000,rate:parseFloat(i.r)}));
        if(ex==='Bitget') return (await axios.get(`https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${sym}&productType=USDT-FUTURES&pageSize=40`)).data.data.map(i=>({time:parseInt(i.settleTime),rate:parseFloat(i.fundingRate)}));
    } catch(e) {} return [];
}

async function generateChartPage(symbol, ex1, ex2, res) {
    try {
        const [data1, data2, f1, f2] = await Promise.all([
            getKlineData(ex1, symbol), getKlineData(ex2, symbol),
            getFundingHistory(ex1, symbol), getFundingHistory(ex2, symbol)
        ]);

        if (data1.length === 0 || data2.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2 style="color:white; font-family:sans-serif; text-align:center;">❌ Немає достатньо даних для графіка ${symbol}</h2>`);
            return;
        }

        const minLength = Math.min(data1.length, data2.length);
        const d1 = data1.slice(-minLength);
        const d2 = data2.slice(-minLength);

        let spreads = [], labels = [], relativeLabels = [], timestamps = [], rawPrices1 = [], rawPrices2 = [];
        for (let i = 0; i < minLength; i++) {
            timestamps.push(d1[i].time); rawPrices1.push(d1[i].close); rawPrices2.push(d2[i].close);
            spreads.push((((d2[i].close - d1[i].close) / d1[i].close) * 100).toFixed(4));
            let d = new Date(d1[i].time); labels.push(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`); relativeLabels.push(`-${minLength - i} хв`);
        }

        let annotationsObj = {};
        if (timestamps.length > 0) {
            const addLines = (hist, name, pos, off) => {
                hist.forEach((f, idx) => {
                    if (f.time >= timestamps[0] && f.time <= timestamps[timestamps.length - 1]) {
                        let cIdx = 0, mD = Infinity;
                        timestamps.forEach((t, i) => { if(Math.abs(t-f.time)<mD) {mD=Math.abs(t-f.time); cIdx=i;} });
                        let col = f.rate > 0 ? 'rgba(231, 76, 60, 0.9)' : 'rgba(0, 214, 124, 0.9)';
                        annotationsObj[`f_${name}_${idx}`] = { type: 'line', xMin: cIdx, xMax: cIdx, borderColor: col, borderWidth: 2, borderDash: [4, 4], label: { display: true, content: `💰 Фандінг (${name}): ${(f.rate * 100).toFixed(4)}%`, position: pos, backgroundColor: col, color: 'white', font: { size: 10 }, yAdjust: off > 0 ? off + (idx % 3) * 18 : off - (idx % 3) * 18 } };
                    }
                });
            };
            addLines(f1, ex1, 'start', 5); addLines(f2, ex2, 'end', -5);
        }

        const html = `
        <!DOCTYPE html>
        <html lang="uk">
        <head>
            <meta charset="UTF-8">
            <title>Спред: ${symbol}</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #0f1216; color: white; padding: 20px; margin: 0; }
                .header { display: flex; justify-content: space-between; align-items: center; max-width: 1400px; margin: 0 auto 20px auto; border-bottom: 2px solid #2b3139; padding-bottom: 15px;}
                .chart-container { width: 95%; max-width: 1400px; height: 80vh; margin: auto; background: #1e2329; padding: 20px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);}
                .btn-refresh { background: #f0b90b; color: #000; border: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.2s; font-size: 1.1em;}
                .btn-refresh:hover { background: #ffe066; transform: scale(1.05); }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>📊 Історія спреду ${symbol} (${ex1} vs ${ex2}) за 12 годин</h2>
                <button class="btn-refresh" onclick="location.reload()">🔄 Оновити графік</button>
            </div>
            <div class="chart-container"><canvas id="spreadChart"></canvas></div>
            <script>
                const ctx = document.getElementById('spreadChart').getContext('2d');
                const relLabels = ${JSON.stringify(relativeLabels)};
                const pr1 = ${JSON.stringify(rawPrices1)};
                const pr2 = ${JSON.stringify(rawPrices2)};
                new Chart(ctx, {
                    type: 'line',
                    data: { labels: ${JSON.stringify(labels)}, datasets: [{ label: 'Спред (%)', data: ${JSON.stringify(spreads)}, borderColor: '#f0b90b', backgroundColor: 'rgba(240, 185, 11, 0.1)', borderWidth: 2, fill: true, pointRadius: 0, pointHoverRadius: 6 }] },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false, 
                        layout: { padding: { top: 60, bottom: 60 } },
                        interaction: { mode: 'index', intersect: false }, 
                        plugins: { 
                            tooltip: { callbacks: { title: c => c[0].label + ' (' + relLabels[c[0].dataIndex] + ')', afterLabel: c => ['Ціна ${ex1}: $' + pr1[c.dataIndex], 'Ціна ${ex2}: $' + pr2[c.dataIndex]] } }, 
                            annotation: { clip: false, annotations: ${JSON.stringify(annotationsObj)} } 
                        }, 
                        scales: { 
                            y: { title: { display: true, text: 'Спред (%)', color: '#848e9c' }, grid: { color: '#2b3139' } }, 
                            x: { title: { display: true, text: 'Локальний Час', color: '#848e9c' }, grid: { color: '#2b3139' } } 
                        } 
                    }
                });
            </script>
        </body>
        </html>
        `;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2 style="color:white; font-family:sans-serif; text-align:center;">❌ Помилка генерації: ${e.message}</h2>`);
    }
}

// --- ФОРМУВАННЯ ПАТЕРНУ ДЛЯ ВОЧЛІСТУ ---
async function calculateCoinPattern(symbol, buyEx, sellEx) {
    try {
        const [d1, d2] = await Promise.all([
            getKlineData(buyEx, symbol),
            getKlineData(sellEx, symbol)
        ]);
        
        if (!d1 || !d2 || d1.length < 60) return;

        const minLength = Math.min(d1.length, d2.length);
        const s1 = d1.slice(-minLength);
        const s2 = d2.slice(-minLength);

        let spreads = [];
        let sum = 0;
        let max = -Infinity;

        // Рахуємо спреди за останні 12 годин
        for (let i = 0; i < minLength; i++) {
            const sp = (((s2[i].close - s1[i].close) / s1[i].close) * 100);
            spreads.push(sp);
            sum += sp;
            if (sp > max) max = sp;
        }

        const avg = sum / minLength;

        // Зберігаємо "портрет" монети в пам'ять
        patternStats[symbol] = { avg, max, isReady: true };
        console.log(`[WatchList] Патерн ${symbol}: Середнє ${avg.toFixed(2)}%, Макс ${max.toFixed(2)}%`);
        
        // Оновлюємо інтерфейс, якщо ми на вкладці арбітражу, щоб показати цифри замість ⏳
        if (document.getElementById('tab-2').classList.contains('active')) {
            window.processWatchlist();
        }
        
    } catch(e) {
        console.log(`Помилка розрахунку патерну для ${symbol}`, e.message);
    }
}

// --- ЛОГІКА WATCH LIST ---

window.toggleWatchlist = function(cleanSymbol, buyEx, sellEx) {
    const index = settings.watchlist.findIndex(i => i.cleanSymbol === cleanSymbol);
    let added = false;
    
    if (index > -1) {
        settings.watchlist.splice(index, 1);
        delete patternStats[cleanSymbol]; // Видаляємо патерн з пам'яті
        window.showToast('Watch List', `Монету ${cleanSymbol} видалено з відстеження.`);
    } else {
        settings.watchlist.push({ cleanSymbol, buyEx, sellEx });
        window.showToast('Watch List', `Додано ${cleanSymbol}. Аналізую історію за 12 годин...`);
        calculateCoinPattern(cleanSymbol, buyEx, sellEx); // Формуємо патерн!
        added = true;
    }
    
    saveSettingsToLocal();
    processWatchlist(); // Оновлюємо ТІЛЬКИ праву панель
    
    // ПЛАВНА АНІМАЦІЯ: міняємо колір ока без перезавантаження сторінки
    const eyeIcons = document.querySelectorAll(`.eye-icon-${cleanSymbol}`);
    eyeIcons.forEach(icon => {
        icon.style.fill = added ? '#f0b90b' : '#848e9c';
    });
};

window.processWatchlist = function() {
    const wlGrid = document.getElementById('watchlist-grid');
    const wlCount = document.getElementById('wl-count');

    if (!settings.watchlist || settings.watchlist.length === 0) {
        wlCount.innerText = '0';
        wlGrid.innerHTML = `<div style="text-align: center; color: #848e9c; font-size: 0.9em; padding: 20px 0;">Натисніть на 👁️ біля монети, щоб додати її сюди.</div>`;
        return;
    }

    wlCount.innerText = settings.watchlist.length;
    let html = '';

    // Якщо дані з бірж ще не завантажились
    if (!isDataLoaded || !globalCrossData) {
        wlGrid.innerHTML = `<div style="text-align: center; color: #848e9c; font-size: 0.9em; padding: 20px 0;">⏳ Очікування даних ринку...</div>`;
        return;
    }

    settings.watchlist.forEach(item => {
        const symData = globalCrossData[item.cleanSymbol];
        
        // Перевіряємо, чи є зараз актуальні дані по цій монеті на обраних біржах
        if (symData && symData[item.buyEx] && symData[item.sellEx]) {
            const bData = symData[item.buyEx];
            const sData = symData[item.sellEx];

            // Вираховуємо спред у реальному часі
            const spread = ((sData.bid - bData.ask) / bData.ask) * 100;

            // --- ЛОГІКА ПОРІВНЯННЯ З ПАТЕРНОМ ---
            if (patternStats[item.cleanSymbol] && patternStats[item.cleanSymbol].isReady) {
                const pattern = patternStats[item.cleanSymbol];
                
                // Аномалія: Спред має бути мінімум 1%, і при цьому більшим за свій (Середній + 1.5%) АБО більшим за (Максимальний + 0.5%)
                const anomalyThreshold = Math.max(pattern.avg + 1.5, pattern.max + 0.5, 1.0);

                if (spread >= anomalyThreshold) {
                    const now = Date.now();
                    // Спамимо звуком не частіше ніж раз на 5 хвилин для однієї монети
                    if (!lastAnomalyAlerts[item.cleanSymbol] || (now - lastAnomalyAlerts[item.cleanSymbol] > 5 * 60 * 1000)) {
                        playAlert();
                        window.showToast(
                            `🚨 ПРОБІЙ ПАТЕРНУ: ${item.cleanSymbol} 🚨`,
                            `Спред різко виріс!<br>Поточний: <b style="color:#00d67c">${spread.toFixed(2)}%</b><br>Історичний макс: <b>${pattern.max.toFixed(2)}%</b>`
                        );
                        lastAnomalyAlerts[item.cleanSymbol] = now;
                    }
                }
            }
            // ------------------------------------

            html += generateArbCardHtml(
                item.cleanSymbol, spread,
                item.buyEx, { symbol: bData.symbol, ask: bData.ask, rate: bData.rate, vol: bData.vol },
                item.sellEx, { symbol: sData.symbol, bid: sData.bid, rate: sData.rate, vol: sData.vol },
                true // Передаємо true, щоб відмалювати іконку "хрестика" замість "ока"
            );
        } else {
            // Якщо монета зараз не підходить під фільтри об'єму або біржа не відповідає
            html += `
            <div class="arb-card" style="opacity: 0.6; text-align:center; padding: 20px;">
                <div style="font-weight:bold; margin-bottom:10px;">${item.cleanSymbol}</div>
                <div style="font-size:0.85em; color:#848e9c;">Немає актуальних даних або не проходить по фільтру ліквідності.</div>
                <button class="btn-submit" style="background:#e74c3c; color:#fff; width:auto; padding:5px 15px; margin-top:10px;" onclick="toggleWatchlist('${item.cleanSymbol}')">Видалити</button>
            </div>`;
        }
    });

    wlGrid.innerHTML = html;
};

// === ЛОГІКА ОНОВЛЕНЬ ===
// Слухаємо сигнал від main.js, що оновлення завантажене
ipcRenderer.on('update_downloaded', () => {
    // Показуємо банер
    document.getElementById('update-banner').style.display = 'flex';
});

// Функція, яка викликається при кліку на кнопку "Перезапустити та Оновити"
window.installUpdate = function() {
    ipcRenderer.send('restart_app');
};

setInterval(() => {
    const isAct1 = document.getElementById('tab-1').classList.contains('active');
    const isAct2 = document.getElementById('tab-2').classList.contains('active');
    const isAct0 = document.getElementById('tab-0').classList.contains('active');
    const isModal = document.querySelectorAll('.modal-overlay.active').length > 0;
    
    if ((isAct1 || isAct2) && !isModal) fetchMarketData();
    
    // Оновлюємо позиції рідше (раз на 15 сек, якщо відкрита вкладка)
    if (isAct0 && !isModal) renderPositionsTab();

}, 15000);