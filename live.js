const axios = require('axios');

// ==========================================
// 1. БАЗОВІ НАЛАШТУВАННЯ
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const symbol = urlParams.get('symbol');
const rawEx1Name = urlParams.get('ex1');
const rawEx2Name = urlParams.get('ex2');

function formatExName(name) {
    return name.endsWith(' Spot') ? name.replace(' Spot', ' (Spot)') : name + ' (Fut)';
}

const ex1NameFormat = formatExName(rawEx1Name);
const ex2NameFormat = formatExName(rawEx2Name);

document.getElementById('pair-title').innerText = symbol;
document.getElementById('name-ex1').innerText = ex1NameFormat;
document.getElementById('name-ex2').innerText = ex2NameFormat;
document.getElementById('ob-title-1').innerText = ex1NameFormat;
document.getElementById('ob-title-2').innerText = ex2NameFormat;

function formatPrice(p) {
    if (!p || isNaN(p)) return '---';
    const num = parseFloat(p);
    if (num < 0.0001) return num.toFixed(10).replace(/\.?0+$/, '');
    if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
    return num.toFixed(4).replace(/\.?0+$/, '');
}

// ==========================================
// 2. ГРАФІК (Lightweight Charts)
// ==========================================
const chartOptions = {
    layout: { textColor: '#d1d4dc', background: { type: 'solid', color: '#0b0e11' } },
    grid: { vertLines: { color: '#2b3139', style: 1 }, horzLines: { color: '#2b3139', style: 1 } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b3139' },
    rightPriceScale: { borderColor: '#2b3139', autoScale: true },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
};

const chartContainer = document.getElementById('chart-container');
const chart = LightweightCharts.createChart(chartContainer, chartOptions);
const series1 = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', title: ex1NameFormat });
const series2 = chart.addCandlestickSeries({ upColor: '#2962FF', downColor: '#FF6D00', borderVisible: false, wickUpColor: '#2962FF', wickDownColor: '#FF6D00', title: ex2NameFormat });

window.addEventListener('resize', () => { chart.resize(chartContainer.clientWidth, chartContainer.clientHeight); });

const resizer = document.getElementById('resizer');
const chartWrapper = document.getElementById('chart-wrapper');
let isResizing = false;

resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.userSelect = 'none'; });
document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    let newWidthPct = (e.clientX / document.body.clientWidth) * 100;
    if (newWidthPct < 20) newWidthPct = 20; if (newWidthPct > 80) newWidthPct = 80;
    chartWrapper.style.width = newWidthPct + '%';
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
});
document.addEventListener('mouseup', () => { isResizing = false; document.body.style.userSelect = 'auto'; });

window.setColorMode = function(mode) {
    if (mode === 'solid') {
        series1.applyOptions({ upColor: '#00d67c', downColor: '#00d67c', wickUpColor: '#00d67c', wickDownColor: '#00d67c' });
        series2.applyOptions({ upColor: '#2962FF', downColor: '#2962FF', wickUpColor: '#2962FF', wickDownColor: '#2962FF' });
    } else {
        series1.applyOptions({ upColor: '#26a69a', downColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
        series2.applyOptions({ upColor: '#2962FF', downColor: '#FF6D00', wickUpColor: '#2962FF', wickDownColor: '#FF6D00' });
    }
};

let lastCandle1 = null, lastCandle2 = null;
let currentIntervalMins = 1;
let currentP1 = null, currentP2 = null;

function updateLiveSpread() {
    if (currentP1 && currentP2 && currentP1 > 0) {
        document.getElementById('header-spread').innerText = (((currentP2 - currentP1) / currentP1) * 100).toFixed(2) + '%';
    }
}

// ==========================================
// 3. НАЛАШТУВАННЯ СТАКАНА
// ==========================================
let domConfig = { scale: 100, precision: 'auto', volType: 'USDT' };

try {
    const saved = localStorage.getItem('domConfig');
    if (saved) domConfig = JSON.parse(saved);
    document.getElementById('dom-scale').value = domConfig.scale;
    document.getElementById('dom-scale-val').innerText = domConfig.scale + '%';
    document.getElementById('dom-precision').value = domConfig.precision;
    document.getElementById('dom-vol-type').value = domConfig.volType;
} catch(e) {}

window.updateDomSettings = function() {
    domConfig.scale = parseInt(document.getElementById('dom-scale').value);
    document.getElementById('dom-scale-val').innerText = domConfig.scale + '%';
    domConfig.precision = document.getElementById('dom-precision').value;
    domConfig.volType = document.getElementById('dom-vol-type').value;
    localStorage.setItem('domConfig', JSON.stringify(domConfig));
    renderOrderBook(1); renderOrderBook(2);
};

// ==========================================
// 4. ІСТОРІЯ ТА ОНОВЛЕННЯ ТАЙМФРЕЙМІВ
// ==========================================
window.changeInterval = async function(mins, btnElement) {
    document.querySelectorAll('.btn-interval').forEach(btn => btn.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');
    currentIntervalMins = mins;

    series1.setData([]); series2.setData([]);
    document.getElementById('price-ex1').innerText = 'Завантаження...';
    document.getElementById('price-ex2').innerText = 'Завантаження...';

    const [hist1, hist2] = await Promise.all([
        fetchHistory(rawEx1Name, symbol, mins),
        fetchHistory(rawEx2Name, symbol, mins)
    ]);

    const formatParams = { type: 'custom', minMove: 0.00000001, formatter: p => formatPrice(p) };
    series1.applyOptions({ priceFormat: formatParams });
    series2.applyOptions({ priceFormat: formatParams });

    if (hist1.length > 0) { series1.setData(hist1); lastCandle1 = hist1[hist1.length - 1]; currentP1 = lastCandle1.close; document.getElementById('price-ex1').innerText = formatPrice(currentP1); }
    if (hist2.length > 0) { series2.setData(hist2); lastCandle2 = hist2[hist2.length - 1]; currentP2 = lastCandle2.close; document.getElementById('price-ex2').innerText = formatPrice(currentP2); }
    updateLiveSpread();
};

async function fetchHistory(exName, symbol, intervalMins) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    const isSpot = exName.endsWith(' Spot');
    const ex = exName.replace(' Spot', '');
    const limit = 720; 
    const bInterval = `${intervalMins}m`; const bybInterval = `${intervalMins}`; const bitgetSpotInt = `${intervalMins}min`; const mexcFutInt = `Min${intervalMins}`;

    try {
        let url = '';
        if (ex === 'Binance') url = isSpot ? `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=${bInterval}&limit=${limit}` : `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${bInterval}&limit=${limit}`;
        else if (ex === 'Bybit') url = `https://api.bybit.com/v5/market/kline?category=${isSpot ? 'spot' : 'linear'}&symbol=${cleanSym}&interval=${bybInterval}&limit=${limit}`;
        else if (ex === 'Gate.io') url = isSpot ? `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${cleanSym.replace('USDT','_USDT')}&interval=${bInterval}&limit=${limit}` : `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${cleanSym.replace('USDT','_USDT')}&interval=${bInterval}&limit=${limit}`;
        else if (ex === 'Bitget') url = isSpot ? `https://api.bitget.com/api/v2/spot/market/candles?symbol=${cleanSym}&granularity=${bitgetSpotInt}&limit=${limit}` : `https://api.bitget.com/api/v2/mix/market/candles?symbol=${cleanSym}&productType=USDT-FUTURES&granularity=${bInterval}&limit=${limit}`;
        else if (ex === 'MEXC') url = isSpot ? `https://api.mexc.com/api/v3/klines?symbol=${cleanSym}&interval=${bInterval}&limit=${limit}` : `https://contract.mexc.com/api/v1/contract/kline/${cleanSym.replace('USDT','_USDT')}?interval=${mexcFutInt}`;

        if (!url) return [];
        const r = await axios.get(url, { timeout: 5000 });
        let data = [];
        if (ex === 'Binance') data = r.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
        else if (ex === 'Bybit') data = r.data.result.list.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) })).reverse();
        else if (ex === 'Gate.io') { if (isSpot) data = r.data.map(k => ({ time: parseInt(k[0]), open: parseFloat(k[5]), high: parseFloat(k[3]), low: parseFloat(k[4]), close: parseFloat(k[2]) })); else data = r.data.map(k => ({ time: parseInt(k.t), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) })); }
        else if (ex === 'Bitget') data = r.data.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
        else if (ex === 'MEXC') { if (isSpot) data = r.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) })); else if (r.data.data && r.data.data.time) { const d = r.data.data; for(let i=0; i<d.time.length; i++) data.push({ time: parseInt(d.time[i]), open: parseFloat(d.open[i]), high: parseFloat(d.high[i]), low: parseFloat(d.low[i]), close: parseFloat(d.close[i]) }); data = data.slice(-limit); } }

        data.sort((a, b) => a.time - b.time);
        const uniqueData = []; let lastTime = 0;
        for (let d of data) { if (d.time > lastTime && !isNaN(d.time) && !isNaN(d.close)) { uniqueData.push(d); lastTime = d.time; } }
        return uniqueData;
    } catch(e) { return []; }
}

function updateLiveCandle(exIndex, price) {
    const intervalMs = currentIntervalMins * 60 * 1000;
    const currentCandleTime = Math.floor(Date.now() / intervalMs) * (intervalMs / 1000);

    let lastCandle = exIndex === 1 ? lastCandle1 : lastCandle2;
    let series = exIndex === 1 ? series1 : series2;

    document.getElementById(`price-ex${exIndex}`).innerText = formatPrice(price);
    document.getElementById(`ob-mid-${exIndex}`).innerText = formatPrice(price);

    if (!lastCandle) lastCandle = { time: currentCandleTime, open: price, high: price, low: price, close: price };
    else if (lastCandle.time === currentCandleTime) {
        lastCandle.close = price;
        if (price > lastCandle.high) lastCandle.high = price;
        if (price < lastCandle.low) lastCandle.low = price;
    } else if (currentCandleTime > lastCandle.time) {
        lastCandle = { time: currentCandleTime, open: lastCandle.close, high: Math.max(lastCandle.close, price), low: Math.min(lastCandle.close, price), close: price };
    }

    if (exIndex === 1) { lastCandle1 = lastCandle; currentP1 = price; } else { lastCandle2 = lastCandle; currentP2 = price; }
    updateLiveSpread(); try { series.update(lastCandle); } catch(e) {}
}

// ==========================================
// 5. ДВИЖОК СТАКАНА ТА АГРЕГАЦІЯ
// ==========================================
let obState = { 1: { asks: [], bids: [] }, 2: { asks: [], bids: [] } };
let tickHistory = { 1: [], 2: [] }; 

function handleTrade(exIndex, price, qty, isBuy) {
    const volUsdt = price * qty;
    const hist = tickHistory[exIndex];
    
    if (hist.length > 0) {
        const last = hist[0]; 
        if (last.p === parseFloat(price) && last.isBuy === isBuy) {
            last.v += volUsdt;
            last.q += qty;
            return;
        }
    }
    
    hist.unshift({ p: parseFloat(price), q: parseFloat(qty), v: volUsdt, isBuy: isBuy });
    if (hist.length > 200) hist.pop(); 
}

function normalizeObData(arr) {
    if (!arr) return [];
    return arr.map(item => {
        if (Array.isArray(item)) return { p: parseFloat(item[0]), q: parseFloat(item[1]) };
        let p = item.p !== undefined ? item.p : (item.price !== undefined ? item.price : 0);
        let q = item.q !== undefined ? item.q : (item.quantity !== undefined ? item.quantity : (item.s !== undefined ? item.s : (item.v !== undefined ? item.v : (item.size !== undefined ? item.size : (item.amount !== undefined ? item.amount : 0)))));
        return { p: parseFloat(p), q: parseFloat(q) };
    });
}

function updateObState(exIndex, type, asksRaw, bidsRaw) {
    const asks = normalizeObData(asksRaw);
    const bids = normalizeObData(bidsRaw);

    if (type === 'snapshot') {
        obState[exIndex].asks = asks;
        obState[exIndex].bids = bids;
    } else if (type === 'delta') {
        asks.forEach(a => {
            let idx = obState[exIndex].asks.findIndex(x => x.p === a.p);
            if (idx > -1) { if (a.q === 0) obState[exIndex].asks.splice(idx, 1); else obState[exIndex].asks[idx].q = a.q; }
            else if (a.q > 0) obState[exIndex].asks.push(a);
        });
        bids.forEach(b => {
            let idx = obState[exIndex].bids.findIndex(x => x.p === b.p);
            if (idx > -1) { if (b.q === 0) obState[exIndex].bids.splice(idx, 1); else obState[exIndex].bids[idx].q = b.q; }
            else if (b.q > 0) obState[exIndex].bids.push(b);
        });
    }

    obState[exIndex].asks.sort((a, b) => a.p - b.p);
    obState[exIndex].bids.sort((a, b) => b.p - a.p);

    renderOrderBook(exIndex);
}

function aggregateDOM(levels, isAsk, precisionStr) {
    if (!precisionStr || precisionStr === 'auto') return levels;
    const p = parseFloat(precisionStr);
    const agg = {};
    levels.forEach(lvl => {
        const val = lvl.p / p;
        let ap = isAsk ? Math.ceil(val) * p : Math.floor(val) * p;
        ap = parseFloat(ap.toFixed(8)); 
        if (!agg[ap]) agg[ap] = { p: ap, q: 0 };
        agg[ap].q += lvl.q;
    });
    const res = Object.values(agg);
    res.sort((a, b) => isAsk ? a.p - b.p : b.p - a.p);
    return res;
}

function renderOrderBook(exIndex) {
    const asksContainer = document.getElementById(`ob-asks-${exIndex}`);
    const bidsContainer = document.getElementById(`ob-bids-${exIndex}`);
    if (!asksContainer || !bidsContainer) return;

    const asks = aggregateDOM(obState[exIndex].asks, true, domConfig.precision).slice(0, 15).reverse();
    const bids = aggregateDOM(obState[exIndex].bids, false, domConfig.precision).slice(0, 15);

    let maxVal = 0;
    const processQty = (lvl) => {
        lvl.displayVal = domConfig.volType === 'USDT' ? lvl.q * lvl.p : lvl.q;
        if (lvl.displayVal > maxVal) maxVal = lvl.displayVal;
    };
    asks.forEach(processQty); bids.forEach(processQty);

    const scaleMult = domConfig.scale / 100;
    const fontSize = 0.85 * scaleMult;

    let asksHtml = '';
    const emptyAsksCount = 15 - asks.length;
    for (let i = 0; i < emptyAsksCount; i++) {
        asksHtml += `<div class="ob-row empty" style="font-size: ${fontSize}em;"><div class="ob-bg ob-bg-ask" style="width: 0%;"></div><span class="ob-price c-ask">-</span><span class="ob-qty">-</span></div>`;
    }
    asks.forEach(a => {
        const width = maxVal > 0 ? (a.displayVal / maxVal) * 100 : 0;
        let txt = a.displayVal >= 1000 ? (a.displayVal/1000).toFixed(1) + 'k' : a.displayVal.toFixed(2);
        asksHtml += `<div class="ob-row" style="font-size: ${fontSize}em;"><div class="ob-bg ob-bg-ask" style="width: ${width}%;"></div><span class="ob-price c-ask">${formatPrice(a.p)}</span><span class="ob-qty">${txt}</span></div>`;
    });
    asksContainer.innerHTML = asksHtml;

    let bidsHtml = '';
    bids.forEach(b => {
        const width = maxVal > 0 ? (b.displayVal / maxVal) * 100 : 0;
        let txt = b.displayVal >= 1000 ? (b.displayVal/1000).toFixed(1) + 'k' : b.displayVal.toFixed(2);
        bidsHtml += `<div class="ob-row" style="font-size: ${fontSize}em;"><div class="ob-bg ob-bg-bid" style="width: ${width}%;"></div><span class="ob-price c-bid">${formatPrice(b.p)}</span><span class="ob-qty">${txt}</span></div>`;
    });
    const emptyBidsCount = 15 - bids.length;
    for (let i = 0; i < emptyBidsCount; i++) {
        bidsHtml += `<div class="ob-row empty" style="font-size: ${fontSize}em;"><div class="ob-bg ob-bg-bid" style="width: 0%;"></div><span class="ob-price c-bid">-</span><span class="ob-qty">-</span></div>`;
    }
    bidsContainer.innerHTML = bidsHtml;
}

// ==========================================
// 6. ВІДМАЛЬОВКА ШАРІКІВ УГОД
// ==========================================
function drawTicksLoop() {
    const scaleMult = domConfig.scale / 100;
    const stepX = 35 * scaleMult; 
    const paddingRight = 15 * scaleMult; 

    [1, 2].forEach(exIndex => {
        const canvas = document.getElementById(`ticks-canvas-${exIndex}`);
        if (!canvas) return;

        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);

        const hist = tickHistory[exIndex];
        if (hist.length === 0) return;

        const asks = aggregateDOM(obState[exIndex].asks, true, domConfig.precision).slice(0, 15).reverse();
        const bids = aggregateDOM(obState[exIndex].bids, false, domConfig.precision).slice(0, 15);
        if (asks.length === 0 || bids.length === 0) return;

        const maxP = asks.length > 0 ? asks[0].p : currentP1; 
        const minP = bids.length > 0 ? bids[bids.length - 1].p : currentP1; 
        if (maxP === minP) return;

        const rowH = h / 31; 

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(132, 142, 156, 0.6)';
        ctx.lineWidth = 2 * scaleMult;
        
        let validPoints = 0;
        for (let i = 0; i < hist.length; i++) {
            const tick = hist[i];
            const x = w - paddingRight - (i * stepX);
            
            if (x < -100) { hist.splice(i); break; }

            const emptyAsksOffset = (15 - asks.length) * rowH;
            const y = emptyAsksOffset + (rowH / 2) + ((maxP - tick.p) / (maxP - minP)) * (h - emptyAsksOffset - ((15 - bids.length) * rowH));

            if (validPoints === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            validPoints++;
        }
        ctx.stroke();

        for (let i = hist.length - 1; i >= 0; i--) {
            const tick = hist[i];
            const x = w - paddingRight - (i * stepX);
            
            const emptyAsksOffset = (15 - asks.length) * rowH;
            const y = emptyAsksOffset + (rowH / 2) + ((maxP - tick.p) / (maxP - minP)) * (h - emptyAsksOffset - ((15 - bids.length) * rowH));
            
            if (y < -20 || y > h + 20) continue; 

            let r = 10 * scaleMult; 
            if (tick.v >= 50000) r = 45 * scaleMult;      
            else if (tick.v >= 15000) r = 30 * scaleMult; 
            else if (tick.v >= 5000) r = 20 * scaleMult;  
            else if (tick.v >= 1000) r = 15 * scaleMult;  
            
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = tick.isBuy ? 'rgba(0, 214, 124, 0.7)' : 'rgba(231, 76, 60, 0.7)';
            ctx.fill();
            
            ctx.strokeStyle = tick.isBuy ? '#00d67c' : '#e74c3c';
            ctx.lineWidth = 2 * scaleMult;
            ctx.stroke();
            
            const val = domConfig.volType === 'USDT' ? tick.v : tick.q;
            let txt = '';
            if (val >= 1000000) txt = (val/1000000).toFixed(2) + 'M';
            else if (val >= 1000) txt = (val/1000).toFixed(1) + 'k';
            else if (val >= 10) txt = val.toFixed(0);
            else txt = val.toFixed(1);

            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(10, r * 0.7)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, x, y);
        }
    });

    requestAnimationFrame(drawTicksLoop);
}

requestAnimationFrame(drawTicksLoop);


// ==========================================
// 7. WEBSOCKETS (Підключення та Логування)
// ==========================================
let ws1 = null, ws2 = null;
let ws1Active = false, ws2Active = false;

// Змінні для множника контрактів ф'ючерсів MEXC
let mexcFutMultiplier1 = 1;
let mexcFutMultiplier2 = 1;

async function fetchMexcMultiplier(exIndex, exName, symbol) {
    if (exName !== 'MEXC') return; // Виконуємо тільки для ф'ючерсів MEXC
    try {
        const s = symbol.replace('_', '').toUpperCase().replace('USDT', '_USDT');
        const r = await axios.get(`https://contract.mexc.com/api/v1/contract/detail?symbol=${s}`);
        if (r.data && r.data.data && r.data.data.contractSize) {
            const size = parseFloat(r.data.data.contractSize);
            if (exIndex === 1) mexcFutMultiplier1 = size;
            else mexcFutMultiplier2 = size;
            console.log(`[MEXC Fut] Множник для ${s}: ${size}`);
        }
    } catch(e) {
        console.error("[MEXC Fut] Помилка завантаження множника:", e);
    }
}

function updateStatusDot() {
    const dot = document.getElementById('ws-status-dot');
    dot.className = (ws1Active && ws2Active) ? 'status-dot dot-green' : 'status-dot dot-red';
}

function connectExchange(exIndex, exName, symbol) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    let wsUrl = '';
    
    let subSym = cleanSym;
    if (exName.includes('Spot') && subSym.startsWith('1000') && !subSym.includes('SATS')) {
        subSym = subSym.replace(/^10000?/, '');
    }

    if (exName === 'Binance') wsUrl = `wss://fapi-stream.binance.com/stream?streams=${subSym.toLowerCase()}@ticker/${subSym.toLowerCase()}@depth20@100ms/${subSym.toLowerCase()}@aggTrade`;
    else if (exName === 'Binance Spot') wsUrl = `wss://stream.binance.com:9443/stream?streams=${subSym.toLowerCase()}@ticker/${subSym.toLowerCase()}@depth20@100ms/${subSym.toLowerCase()}@aggTrade`;
    else if (exName === 'Bybit') wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    else if (exName === 'Bybit Spot') wsUrl = 'wss://stream.bybit.com/v5/public/spot';
    else if (exName === 'Gate.io') wsUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
    else if (exName === 'Gate.io Spot') wsUrl = 'wss://api.gateio.ws/ws/v4/';
    else if (exName === 'MEXC') wsUrl = 'wss://contract.mexc.com/edge';
    else if (exName === 'MEXC Spot') wsUrl = 'wss://wbs-api.mexc.com/ws'; 
    else if (exName === 'Bitget') wsUrl = 'wss://ws.bitget.com/mix/v1/stream';
    else if (exName === 'Bitget Spot') wsUrl = 'wss://ws.bitget.com/spot/v1/stream';

    if (!wsUrl) return null;
    console.log(`[WS Ініціалізація] Спроба підключення до ${exName} за адресою: ${wsUrl} (Символ: ${subSym})`);
    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log(`✅ [WS Успіх] Підключено до ${exName}`);
        if (exIndex === 1) ws1Active = true; else ws2Active = true;
        updateStatusDot();

        if (exName.startsWith('Bybit')) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${subSym}`, `orderbook.50.${subSym}`, `publicTrade.${subSym}`] }));
        } else if (exName === 'Gate.io') {
            const time = Math.floor(Date.now()/1000);
            ws.send(JSON.stringify({ time: time, channel: 'futures.tickers', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT')] }));
            ws.send(JSON.stringify({ time: time, channel: 'futures.order_book', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT'), "20", "0"] }));
            ws.send(JSON.stringify({ time: time, channel: 'futures.trades', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT')] }));
        } else if (exName === 'Gate.io Spot') {
            const time = Math.floor(Date.now()/1000);
            ws.send(JSON.stringify({ time: time, channel: 'spot.tickers', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT')] }));
            ws.send(JSON.stringify({ time: time, channel: 'spot.order_book', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT'), "20", "100ms"] }));
            ws.send(JSON.stringify({ time: time, channel: 'spot.trades', event: 'subscribe', payload: [subSym.replace('USDT', '_USDT')] }));
        } else if (exName === 'MEXC') {
            ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: subSym.replace('USDT', '_USDT') } }));
            ws.send(JSON.stringify({ method: 'sub.depth', param: { symbol: subSym.replace('USDT', '_USDT') } }));
            ws.send(JSON.stringify({ method: 'sub.deal', param: { symbol: subSym.replace('USDT', '_USDT') } }));
        } else if (exName === 'MEXC Spot') {
            const spotSubs = [
                `spot@public.deals.v3.api@${subSym}`,
                `spot@public.limit.depth.v3.api@${subSym}@5`, 
                `spot@public.bookTicker.v3.api@${subSym}` 
            ];
            
            spotSubs.forEach((subChannel, i) => {
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        console.log(`[WS Відправка підписки] MEXC Spot:`, subChannel);
                        ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [subChannel] }));
                    }
                }, i * 150);
            });
        } else if (exName.startsWith('Bitget')) {
            const instType = exName.includes('Spot') ? 'SP' : 'USDT-FUTURES';
            ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: instType, channel: 'ticker', instId: subSym }, { instType: instType, channel: 'books15', instId: subSym }, { instType: instType, channel: 'trade', instId: subSym }] }));
        }
    };

    ws.onerror = (error) => {
        console.error(`❌ [WS Помилка З'єднання] ${exName}:`, error);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
                console.error(`⚠️ [API Помилка] ${exName} повернула помилку:`, data);
            }

            // ==========================================
            // ФОЛЛБЕК ДЛЯ ЗАБЛОКОВАНИХ МОНЕТ MEXC SPOT
            // ==========================================
            if (exName === 'MEXC Spot' && data.msg && typeof data.msg === 'string' && data.msg.includes('Blocked')) {
                if (!window[`mexc_rest_fallback_${exIndex}`]) {
                    window[`mexc_rest_fallback_${exIndex}`] = true;
                    console.warn(`🚨 [MEXC WS БЛОКУВАННЯ] MEXC відхилив WebSocket підписку для ${subSym}. Переходимо на надійний REST API...`);
                    
                    const midContainer = document.getElementById(`ob-mid-${exIndex}`);
                    if (midContainer) midContainer.style.color = '#f1c40f'; 
                    
                    ws.close(); 

                    let isRateLimited = false;

                    const pollMexcRest = async () => {
                        if (isRateLimited) return;

                        try {
                            const [depthRes, tradesRes, tickerRes] = await Promise.all([
                                axios.get(`https://api.mexc.com/api/v3/depth?symbol=${subSym}&limit=15`),
                                axios.get(`https://api.mexc.com/api/v3/trades?symbol=${subSym}&limit=15`),
                                axios.get(`https://api.mexc.com/api/v3/ticker/price?symbol=${subSym}`)
                            ]);

                            if (depthRes.data && depthRes.data.asks) {
                                updateObState(exIndex, 'snapshot', depthRes.data.asks, depthRes.data.bids);
                            }
                            
                            if (tradesRes.data && tradesRes.data.length > 0) {
                                window[`mexc_last_time_${exIndex}`] = window[`mexc_last_time_${exIndex}`] || 0;
                                window[`mexc_keys_${exIndex}`] = window[`mexc_keys_${exIndex}`] || new Set();
                                
                                let lastT = window[`mexc_last_time_${exIndex}`];
                                let keys = window[`mexc_keys_${exIndex}`];
                                let newMax = lastT;

                                tradesRes.data.forEach(t => {
                                    const key = `${t.time}_${t.price}_${t.qty}`; 
                                    if (t.time >= lastT && !keys.has(key)) {
                                        handleTrade(exIndex, parseFloat(t.price), parseFloat(t.qty), !t.isBuyerMaker);
                                        keys.add(key);
                                        if (t.time > newMax) newMax = t.time;
                                    }
                                });

                                window[`mexc_last_time_${exIndex}`] = newMax;
                                if (keys.size > 150) window[`mexc_keys_${exIndex}`] = new Set(Array.from(keys).slice(-50));
                            }
                            
                            if (tickerRes.data && tickerRes.data.price) {
                                updateLiveCandle(exIndex, parseFloat(tickerRes.data.price));
                            }
                        } catch (err) {
                            if (err.response && (err.response.status === 429 || err.response.status === 418)) {
                                console.warn(`⏳ [MEXC API LIMIT] Біржа просить збавити темп. Пауза REST запитів на 10 секунд...`);
                                isRateLimited = true;
                                setTimeout(() => {
                                    console.log(`▶️ [MEXC API LIMIT] Пауза закінчилась, продовжуємо завантаження.`);
                                    isRateLimited = false;
                                }, 10000);
                            }
                        }
                    };

                    pollMexcRest(); 
                    setInterval(pollMexcRest, 1500); 
                }
            }

            if (exName.includes('MEXC') && !window[`mexc_debug_${exIndex}`]) { window[`mexc_debug_${exIndex}`] = 0; }
            if (exName.includes('MEXC') && window[`mexc_debug_${exIndex}`] < 4) {
                console.log(`[Дебаг Дані ${exName}] Повідомлення #${window[`mexc_debug_${exIndex}`] + 1}:`, data);
                window[`mexc_debug_${exIndex}`]++;
            }

            // 1. ТІКЕРИ
            let price = null;
            if (exName.startsWith('Binance') && data.data && data.data.c) price = parseFloat(data.data.c); 
            else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('tickers') && data.data.lastPrice) price = parseFloat(data.data.lastPrice);
            else if (exName === 'Gate.io' && data.channel === 'futures.tickers' && data.result && data.result.length > 0) price = parseFloat(data.result[0].last);
            else if (exName === 'Gate.io Spot' && data.channel === 'spot.tickers' && data.result && data.result.last) price = parseFloat(data.result.last);
            else if (exName === 'MEXC' && data.channel === 'push.ticker' && data.data) price = parseFloat(data.data.lastPrice);
            else if (exName === 'MEXC Spot' && data.c && data.c.includes('bookTicker') && data.d) price = parseFloat(data.d.a || data.d.b); 
            else if (exName === 'MEXC Spot' && data.c && data.c.includes('deals.v3.api') && data.d && data.d.deals) price = parseFloat(data.d.deals[0].p);
            else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'ticker' && data.data) price = parseFloat(data.data[0].lastPr);

            if (price) updateLiveCandle(exIndex, price);

            // 2. СТАКАН
            if (exName.startsWith('Binance') && data.stream && data.stream.includes('depth20')) {
                updateObState(exIndex, 'snapshot', data.data.asks, data.data.bids);
            } else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('orderbook')) {
                updateObState(exIndex, data.type === 'snapshot' ? 'snapshot' : 'delta', data.data.a, data.data.b);
            } else if (exName.startsWith('Gate.io') && data.channel && data.channel.includes('order_book') && data.result && data.event !== 'subscribe') {
                updateObState(exIndex, 'snapshot', data.result.asks || data.result.a || [], data.result.bids || data.result.b || []); 
            } else if (exName === 'MEXC' && data.channel === 'push.depth') {
                // ВИПРАВЛЕНО: Використовуємо snapshot замість delta та множимо контракти на їх розмір
                const mult = exIndex === 1 ? mexcFutMultiplier1 : mexcFutMultiplier2;
                const adjust = (arr) => arr ? arr.map(a => [a[0], parseFloat(a[1]) * mult]) : [];
                updateObState(exIndex, 'snapshot', adjust(data.data.asks), adjust(data.data.bids));
            } else if (exName === 'MEXC Spot' && data.c && data.c.includes('limit.depth.v3.api') && data.d) {
                updateObState(exIndex, 'snapshot', data.d.asks || [], data.d.bids || []);
            } else if (exName === 'MEXC Spot' && data.c && data.c.includes('increase.depth.v3.api') && data.d) {
                updateObState(exIndex, 'delta', data.d.asks || [], data.d.bids || []);
            } else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'books15' && data.data) {
                updateObState(exIndex, data.action === 'snapshot' ? 'snapshot' : 'delta', data.data[0].asks, data.data[0].bids);
            }

            // 3. УГОДИ (ШАРІКИ)
            if (exName.startsWith('Binance') && data.stream && data.stream.includes('aggTrade')) {
                handleTrade(exIndex, parseFloat(data.data.p), parseFloat(data.data.q), !data.data.m); 
            }
            else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('publicTrade') && data.data) {
                data.data.forEach(t => handleTrade(exIndex, parseFloat(t.p), parseFloat(t.v), t.S === 'Buy'));
            }
            else if (exName.startsWith('Gate.io') && data.channel && data.channel.includes('trades') && data.result) {
                const tradesData = Array.isArray(data.result) ? data.result : [data.result];
                tradesData.forEach(t => handleTrade(exIndex, parseFloat(t.price), Math.abs(parseFloat(t.size || t.amount)), t.size ? t.size > 0 : t.side === 'buy'));
            }
            else if (exName === 'MEXC' && data.channel === 'push.deal' && data.data) {
                // ВИПРАВЛЕНО: Множимо об'єм у контрактах на розмір контракту
                const mult = exIndex === 1 ? mexcFutMultiplier1 : mexcFutMultiplier2;
                const deals = Array.isArray(data.data) ? data.data : [data.data];
                deals.forEach(t => handleTrade(exIndex, parseFloat(t.p), parseFloat(t.v) * mult, t.T === 1));
            }
            else if (exName === 'MEXC Spot' && data.c && data.c.includes('deals.v3.api') && data.d && data.d.deals) {
                data.d.deals.forEach(t => handleTrade(exIndex, parseFloat(t.p), parseFloat(t.v), t.S === 1));
            }
            else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'trade' && data.data) {
                data.data.forEach(t => handleTrade(exIndex, parseFloat(t[1]), parseFloat(t[2]), t[3] === 'buy'));
            }

        } catch (err) {}
    };

    ws.onclose = (event) => {
        console.warn(`🔌 [WS Закрито] ${exName} - Код: ${event.code}.`);
        if (exIndex === 1) ws1Active = false; else ws2Active = false;
        updateStatusDot();
        
        if (!window[`mexc_rest_fallback_${exIndex}`]) {
            setTimeout(() => connectExchange(exIndex, exName, symbol), 3000);
        } else {
            console.log(`[WS] Реконект скасовано, працює надійний REST Fallback.`);
        }
    };

    return ws;
}

// ==========================================
// 8. ЗАПУСК ТА PING
// ==========================================
async function initLive() {
    // Спочатку завантажуємо правильні множники контрактів для MEXC
    await fetchMexcMultiplier(1, rawEx1Name, symbol);
    await fetchMexcMultiplier(2, rawEx2Name, symbol);
    
    await window.changeInterval(1, document.getElementById('btn-1m'));
    ws1 = connectExchange(1, rawEx1Name, symbol);
    ws2 = connectExchange(2, rawEx2Name, symbol);
}

initLive();

setInterval(() => {
    const sendPing = (ws, exName) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (exName.startsWith('Bybit')) ws.send(JSON.stringify({ op: 'ping' }));
        else if (exName === 'Gate.io') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'futures.ping' }));
        else if (exName === 'Gate.io Spot') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'spot.ping' }));
        else if (exName === 'MEXC') ws.send(JSON.stringify({ method: 'ping' }));
        else if (exName === 'MEXC Spot') ws.send(JSON.stringify({ method: 'PING' }));
        else if (exName.startsWith('Bitget')) ws.send('ping');
    };
    sendPing(ws1, rawEx1Name);
    sendPing(ws2, rawEx2Name);
}, 15000);