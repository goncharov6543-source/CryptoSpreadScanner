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

function getMinMove(price) {
    if (!price) return 0.01;
    if (price < 0.00001) return 0.000000001;
    if (price < 0.001) return 0.0000001;
    if (price < 1) return 0.0001;
    if (price < 100) return 0.01;
    return 0.1;
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

const series1 = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350', title: ex1NameFormat
});

const series2 = chart.addCandlestickSeries({
    upColor: '#2962FF', downColor: '#FF6D00', borderVisible: false,
    wickUpColor: '#2962FF', wickDownColor: '#FF6D00', title: ex2NameFormat
});

window.addEventListener('resize', () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
});

const resizer = document.getElementById('resizer');
const chartWrapper = document.getElementById('chart-wrapper');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.userSelect = 'none'; 
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const totalWidth = document.body.clientWidth;
    let newWidthPct = (e.clientX / totalWidth) * 100;
    if (newWidthPct < 20) newWidthPct = 20;
    if (newWidthPct > 80) newWidthPct = 80;
    chartWrapper.style.width = newWidthPct + '%';
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
});

document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.userSelect = 'auto';
});

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
        const spread = ((currentP2 - currentP1) / currentP1) * 100;
        document.getElementById('header-spread').innerText = spread.toFixed(2) + '%';
    }
}

// ==========================================
// 3. ІСТОРІЯ ТА ОНОВЛЕННЯ ТАЙМФРЕЙМІВ
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

    let minMove = 0.01;
    if (hist1.length > 0) minMove = getMinMove(hist1[0].close);
    else if (hist2.length > 0) minMove = getMinMove(hist2[0].close);

    const customPriceFormat = { type: 'custom', minMove: minMove, formatter: p => formatPrice(p) };
    series1.applyOptions({ priceFormat: customPriceFormat });
    series2.applyOptions({ priceFormat: customPriceFormat });

    if (hist1.length > 0) {
        series1.setData(hist1); lastCandle1 = hist1[hist1.length - 1];
        currentP1 = lastCandle1.close; document.getElementById('price-ex1').innerText = formatPrice(currentP1);
    }
    if (hist2.length > 0) {
        series2.setData(hist2); lastCandle2 = hist2[hist2.length - 1];
        currentP2 = lastCandle2.close; document.getElementById('price-ex2').innerText = formatPrice(currentP2);
    }
    updateLiveSpread();
};

async function fetchHistory(exName, symbol, intervalMins) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    const isSpot = exName.endsWith(' Spot');
    const ex = exName.replace(' Spot', '');
    const limit = 720; // Рівно 12 годин історії для 1-хвилинного графіка

    const bInterval = `${intervalMins}m`;
    const bybInterval = `${intervalMins}`;
    const bitgetSpotInt = `${intervalMins}min`;
    const mexcFutInt = `Min${intervalMins}`;

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
        else if (ex === 'Gate.io') {
            if (isSpot) data = r.data.map(k => ({ time: parseInt(k[0]), open: parseFloat(k[5]), high: parseFloat(k[3]), low: parseFloat(k[4]), close: parseFloat(k[2]) }));
            else data = r.data.map(k => ({ time: parseInt(k.t), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) }));
        }
        else if (ex === 'Bitget') data = r.data.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
        else if (ex === 'MEXC') {
            if (isSpot) data = r.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
            else if (r.data.data && r.data.data.time) {
                const d = r.data.data;
                for(let i=0; i<d.time.length; i++) data.push({ time: parseInt(d.time[i]), open: parseFloat(d.open[i]), high: parseFloat(d.high[i]), low: parseFloat(d.low[i]), close: parseFloat(d.close[i]) });
                data = data.slice(-limit);
            }
        }

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

    if (exIndex === 1) { lastCandle1 = lastCandle; currentP1 = price; } 
    else { lastCandle2 = lastCandle; currentP2 = price; }

    updateLiveSpread();
    try { series.update(lastCandle); } catch(e) {}
}

// ==========================================
// 4. ДВИЖОК СТАКАНА ТА ПРИНТИ УГОД
// ==========================================
let obState = { 1: { asks: [], bids: [] }, 2: { asks: [], bids: [] } };
let recentTrades = { 1: {}, 2: {} }; // Зберігаємо шаріки

function handleTrade(exIndex, price, qty, isBuy) {
    const volUsdt = price * qty;
    if (volUsdt < 10) return; // Відсікаємо спам дрібними угодами

    const pStr = parseFloat(price).toString(); // Ключем є ціна
    if (!recentTrades[exIndex][pStr]) recentTrades[exIndex][pStr] = [];
    recentTrades[exIndex][pStr].push({ vol: volUsdt, isBuy: isBuy, time: Date.now() });
    
    // Перемальовуємо стакан одразу, щоб шарік з'явився миттєво
    renderOrderBook(exIndex);
}

function normalizeObData(arr) {
    if (!arr) return [];
    return arr.map(item => {
        if (Array.isArray(item)) return { p: parseFloat(item[0]), q: parseFloat(item[1]) };
        if (item.p !== undefined && item.s !== undefined) return { p: parseFloat(item.p), q: parseFloat(item.s) }; 
        if (item.price !== undefined && item.size !== undefined) return { p: parseFloat(item.price), q: parseFloat(item.size) };
        return { p: 0, q: 0 };
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

function renderOrderBook(exIndex) {
    const asksContainer = document.getElementById(`ob-asks-${exIndex}`);
    const bidsContainer = document.getElementById(`ob-bids-${exIndex}`);

    // Видаляємо старі шаріки (старші за 1.5 сек)
    const now = Date.now();
    for (let p in recentTrades[exIndex]) {
        recentTrades[exIndex][p] = recentTrades[exIndex][p].filter(t => now - t.time < 1500); 
        if (recentTrades[exIndex][p].length === 0) delete recentTrades[exIndex][p];
    }

    const asks = obState[exIndex].asks.slice(0, 15).reverse();
    const bids = obState[exIndex].bids.slice(0, 15);

    let maxQty = 0;
    asks.forEach(a => { if(a.q > maxQty) maxQty = a.q; });
    bids.forEach(b => { if(b.q > maxQty) maxQty = b.q; });

    const generateRow = (item, isAsk) => {
        const width = maxQty > 0 ? (item.q / maxQty) * 100 : 0;
        const pStr = item.p.toString();
        let bubblesHtml = '';
        
        // Якщо по цій ціні щойно була угода — малюємо шаріки
        if (recentTrades[exIndex][pStr]) {
            bubblesHtml = '<div class="trade-bubbles">';
            recentTrades[exIndex][pStr].forEach(t => {
                let s = 4; // Мінімальний розмір
                if (t.vol > 20000) s = 12;      // Кит
                else if (t.vol > 5000) s = 9;   // Великий
                else if (t.vol > 1000) s = 7;   // Середній
                else if (t.vol > 100) s = 5;    // Малий
                
                const c = t.isBuy ? 'bubble-buy' : 'bubble-sell';
                bubblesHtml += `<div class="bubble ${c}" style="width:${s}px; height:${s}px;"></div>`;
            });
            bubblesHtml += '</div>';
        }

        const bgClass = isAsk ? 'ob-bg-ask' : 'ob-bg-bid';
        const textClass = isAsk ? 'c-ask' : 'c-bid';
        return `<div class="ob-row"><div class="ob-bg ${bgClass}" style="width: ${width}%;"></div><span class="ob-price ${textClass}">${formatPrice(item.p)}</span>${bubblesHtml}<span class="ob-qty">${item.q.toFixed(2)}</span></div>`;
    };

    let asksHtml = '';
    asks.forEach(a => { asksHtml += generateRow(a, true); });
    asksContainer.innerHTML = asksHtml;

    let bidsHtml = '';
    bids.forEach(b => { bidsHtml += generateRow(b, false); });
    bidsContainer.innerHTML = bidsHtml;
}

// Примусове оновлення стаканів, щоб шаріки плавно зникали, навіть якщо ринок стоїть
setInterval(() => {
    renderOrderBook(1);
    renderOrderBook(2);
}, 500); 

// ==========================================
// 5. WEBSOCKETS (Графік + Стакани + Угоди)
// ==========================================
let ws1 = null, ws2 = null;
let ws1Active = false, ws2Active = false;

function updateStatusDot() {
    const dot = document.getElementById('ws-status-dot');
    dot.className = (ws1Active && ws2Active) ? 'status-dot dot-green' : 'status-dot dot-red';
}

function connectExchange(exIndex, exName, symbol) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    let wsUrl = '';

    if (exName === 'Binance') wsUrl = `wss://fapi-stream.binance.com/stream?streams=${cleanSym.toLowerCase()}@ticker/${cleanSym.toLowerCase()}@depth20@100ms/${cleanSym.toLowerCase()}@aggTrade`;
    else if (exName === 'Binance Spot') wsUrl = `wss://stream.binance.com:9443/stream?streams=${cleanSym.toLowerCase()}@ticker/${cleanSym.toLowerCase()}@depth20@100ms/${cleanSym.toLowerCase()}@aggTrade`;
    else if (exName === 'Bybit') wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    else if (exName === 'Bybit Spot') wsUrl = 'wss://stream.bybit.com/v5/public/spot';
    else if (exName === 'Gate.io') wsUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
    else if (exName === 'Gate.io Spot') wsUrl = 'wss://api.gateio.ws/ws/v4/';
    else if (exName === 'MEXC') wsUrl = 'wss://contract.mexc.com/edge';
    else if (exName === 'MEXC Spot') wsUrl = 'wss://wbs.mexc.com/ws';
    else if (exName === 'Bitget') wsUrl = 'wss://ws.bitget.com/mix/v1/stream';
    else if (exName === 'Bitget Spot') wsUrl = 'wss://ws.bitget.com/spot/v1/stream';

    if (!wsUrl) return null;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        if (exIndex === 1) ws1Active = true; else ws2Active = true;
        updateStatusDot();

        if (exName.startsWith('Bybit')) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${cleanSym}`, `orderbook.50.${cleanSym}`, `publicTrade.${cleanSym}`] }));
        } else if (exName === 'Gate.io') {
            const time = Math.floor(Date.now()/1000);
            ws.send(JSON.stringify({ time: time, channel: 'futures.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
            ws.send(JSON.stringify({ time: time, channel: 'futures.order_book', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT'), "20", "0"] }));
            ws.send(JSON.stringify({ time: time, channel: 'futures.trades', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        } else if (exName === 'Gate.io Spot') {
            const time = Math.floor(Date.now()/1000);
            ws.send(JSON.stringify({ time: time, channel: 'spot.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
            ws.send(JSON.stringify({ time: time, channel: 'spot.order_book', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT'), "20", "100ms"] }));
            ws.send(JSON.stringify({ time: time, channel: 'spot.trades', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        } else if (exName === 'MEXC') {
            ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
            ws.send(JSON.stringify({ method: 'sub.depth', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
            ws.send(JSON.stringify({ method: 'sub.deal', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
        } else if (exName === 'MEXC Spot') {
            ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [`spot@public.deals.v3.api@${cleanSym}`, `spot@public.limit.depth.v3.api@${cleanSym}`] }));
        } else if (exName.startsWith('Bitget')) {
            const instType = exName.includes('Spot') ? 'SP' : 'USDT-FUTURES';
            ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: instType, channel: 'ticker', instId: cleanSym }, { instType: instType, channel: 'books15', instId: cleanSym }, { instType: instType, channel: 'trade', instId: cleanSym }] }));
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // --- ПАРСИНГ ТІКЕРА ---
            let price = null;
            if (exName.startsWith('Binance') && data.data && data.data.c) price = parseFloat(data.data.c); 
            else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('tickers') && data.data.lastPrice) price = parseFloat(data.data.lastPrice);
            else if (exName === 'Gate.io' && data.channel === 'futures.tickers' && data.result && data.result.length > 0) price = parseFloat(data.result[0].last);
            else if (exName === 'Gate.io Spot' && data.channel === 'spot.tickers' && data.result && data.result.last) price = parseFloat(data.result.last);
            else if (exName === 'MEXC' && data.channel === 'push.ticker' && data.data) price = parseFloat(data.data.lastPrice);
            else if (exName === 'MEXC Spot' && data.c === `spot@public.deals.v3.api@${cleanSym}` && data.d && data.d.deals) price = parseFloat(data.d.deals[0].p);
            else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'ticker' && data.data) price = parseFloat(data.data[0].lastPr);

            if (price) updateLiveCandle(exIndex, price);

            // --- ПАРСИНГ СТАКАНА ---
            if (exName.startsWith('Binance') && data.stream && data.stream.includes('depth20')) updateObState(exIndex, 'snapshot', data.data.asks, data.data.bids);
            else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('orderbook')) updateObState(exIndex, data.type === 'snapshot' ? 'snapshot' : 'delta', data.data.a, data.data.b);
            else if (exName.startsWith('Gate.io') && data.channel && data.channel.includes('order_book') && data.result) updateObState(exIndex, 'snapshot', data.result.asks || data.result.a || [], data.result.bids || data.result.b || []);
            else if (exName === 'MEXC' && data.channel === 'push.depth') updateObState(exIndex, 'delta', data.data.asks, data.data.bids);
            else if (exName === 'MEXC Spot' && data.c === `spot@public.limit.depth.v3.api@${cleanSym}`) updateObState(exIndex, 'delta', data.d.asks, data.d.bids);
            else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'books15' && data.data) updateObState(exIndex, data.action === 'snapshot' ? 'snapshot' : 'delta', data.data[0].asks, data.data[0].bids);

            // --- ПАРСИНГ УГОД (ШАРІКИ) ---
            if (exName.startsWith('Binance') && data.stream && data.stream.includes('aggTrade')) handleTrade(exIndex, parseFloat(data.data.p), parseFloat(data.data.q), !data.data.m);
            else if (exName.startsWith('Bybit') && data.topic && data.topic.startsWith('publicTrade') && data.data) data.data.forEach(t => handleTrade(exIndex, parseFloat(t.p), parseFloat(t.v), t.S === 'Buy'));
            else if (exName.startsWith('Gate.io') && data.channel && data.channel.includes('trades') && data.result) data.result.forEach(t => handleTrade(exIndex, parseFloat(t.price), Math.abs(parseFloat(t.size || t.amount)), t.size ? t.size > 0 : t.side === 'buy'));
            else if (exName === 'MEXC' && data.channel === 'push.deal' && data.data) handleTrade(exIndex, parseFloat(data.data.p), parseFloat(data.data.v), data.data.T === 1);
            else if (exName === 'MEXC Spot' && data.c === `spot@public.deals.v3.api@${cleanSym}` && data.d && data.d.deals) data.d.deals.forEach(t => handleTrade(exIndex, parseFloat(t.p), parseFloat(t.v), t.S === 1));
            else if (exName.startsWith('Bitget') && data.arg && data.arg.channel === 'trade' && data.data) data.data.forEach(t => handleTrade(exIndex, parseFloat(t[1]), parseFloat(t[2]), t[3] === 'buy'));

        } catch (err) {}
    };

    ws.onclose = () => {
        if (exIndex === 1) ws1Active = false; else ws2Active = false;
        updateStatusDot();
        setTimeout(() => connectExchange(exIndex, exName, symbol), 3000);
    };

    return ws;
}

// ==========================================
// 6. ЗАПУСК ТА PING
// ==========================================
async function initLive() {
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
        else if (exName.startsWith('MEXC')) ws.send(JSON.stringify({ method: 'ping' }));
        else if (exName.startsWith('Bitget')) ws.send('ping');
    };
    sendPing(ws1, rawEx1Name);
    sendPing(ws2, rawEx2Name);
}, 15000);