const axios = require('axios');

// 1. Отримуємо параметри
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

function formatPrice(p) {
    if (!p || isNaN(p)) return '---';
    const num = parseFloat(p);
    if (num < 0.0001) return num.toFixed(10).replace(/\.?0+$/, ''); 
    if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
    return num.toFixed(4).replace(/\.?0+$/, '');
}

// 2. Ініціалізація графіка
const chartOptions = {
    layout: { textColor: '#d1d4dc', background: { type: 'solid', color: '#0b0e11' } },
    grid: { vertLines: { color: '#2b3139', style: 1 }, horzLines: { color: '#2b3139', style: 1 } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b3139' },
    rightPriceScale: { borderColor: '#2b3139' },
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

// Керування кольорами (через випадаючий список)
window.setColorMode = function(mode) {
    if (mode === 'solid') {
        series1.applyOptions({ upColor: '#00d67c', downColor: '#00d67c', wickUpColor: '#00d67c', wickDownColor: '#00d67c' });
        series2.applyOptions({ upColor: '#2962FF', downColor: '#2962FF', wickUpColor: '#2962FF', wickDownColor: '#2962FF' });
    } else {
        series1.applyOptions({ upColor: '#26a69a', downColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
        series2.applyOptions({ upColor: '#2962FF', downColor: '#FF6D00', wickUpColor: '#2962FF', wickDownColor: '#FF6D00' });
    }
};

let lastCandle1 = null;
let lastCandle2 = null;
let currentIntervalMins = 1;

// Змінні для живого спреду
let currentP1 = null;
let currentP2 = null;

function updateLiveSpread() {
    if (currentP1 && currentP2 && currentP1 > 0) {
        const spread = ((currentP2 - currentP1) / currentP1) * 100;
        document.getElementById('live-spread').innerText = spread.toFixed(2) + '%';
    }
}

// Перемикання таймфреймів з перезавантаженням історії
window.changeInterval = async function(mins, btnElement) {
    document.querySelectorAll('.btn-interval').forEach(btn => btn.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');
    
    currentIntervalMins = mins;
    
    series1.setData([]);
    series2.setData([]);
    document.getElementById('price-ex1').innerText = 'Завантаження...';
    document.getElementById('price-ex2').innerText = 'Завантаження...';

    const [hist1, hist2] = await Promise.all([
        fetchHistory(rawEx1Name, symbol, mins),
        fetchHistory(rawEx2Name, symbol, mins)
    ]);

    if (hist1.length > 0) {
        series1.setData(hist1);
        lastCandle1 = hist1[hist1.length - 1];
        currentP1 = lastCandle1.close;
        document.getElementById('price-ex1').innerText = formatPrice(currentP1);
    }
    if (hist2.length > 0) {
        series2.setData(hist2);
        lastCandle2 = hist2[hist2.length - 1];
        currentP2 = lastCandle2.close;
        document.getElementById('price-ex2').innerText = formatPrice(currentP2);
    }
    
    updateLiveSpread();
};

// ==========================================
// ОТРИМАННЯ ІСТОРІЇ (REST API)
// ==========================================
async function fetchHistory(exName, symbol, intervalMins) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    const isSpot = exName.endsWith(' Spot');
    const ex = exName.replace(' Spot', '');
    const limit = 240; 
    
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
        const uniqueData = [];
        let lastTime = 0;
        for (let d of data) {
            if (d.time > lastTime && !isNaN(d.time) && !isNaN(d.close)) {
                uniqueData.push(d);
                lastTime = d.time;
            }
        }
        return uniqueData;
    } catch(e) { return []; }
}

// ==========================================
// ЛОГІКА ДОДАВАННЯ ТІКУ (ВРАХУВАННЯ ТАЙМФРЕЙМУ)
// ==========================================
function updateLiveCandle(exIndex, price) {
    const intervalMs = currentIntervalMins * 60 * 1000;
    const currentCandleTime = Math.floor(Date.now() / intervalMs) * (intervalMs / 1000);
    
    let lastCandle = exIndex === 1 ? lastCandle1 : lastCandle2;
    let series = exIndex === 1 ? series1 : series2;

    document.getElementById(`price-ex${exIndex}`).innerText = formatPrice(price);

    if (!lastCandle) {
        lastCandle = { time: currentCandleTime, open: price, high: price, low: price, close: price };
    } else if (lastCandle.time === currentCandleTime) {
        lastCandle.close = price;
        if (price > lastCandle.high) lastCandle.high = price;
        if (price < lastCandle.low) lastCandle.low = price;
    } else if (currentCandleTime > lastCandle.time) {
        lastCandle = { time: currentCandleTime, open: lastCandle.close, high: Math.max(lastCandle.close, price), low: Math.min(lastCandle.close, price), close: price };
    }

    if (exIndex === 1) {
        lastCandle1 = lastCandle;
        currentP1 = price;
    } else {
        lastCandle2 = lastCandle;
        currentP2 = price;
    }
    
    updateLiveSpread(); // Оновлюємо віджет спреду

    try { series.update(lastCandle); } catch(e) {}
}

// ==========================================
// СТАТУС WEBSOCKETS ТА ПІДКЛЮЧЕННЯ
// ==========================================
let ws1 = null, ws2 = null;
let ws1Active = false, ws2Active = false;

function updateStatusDot() {
    const dot = document.getElementById('ws-status-dot');
    if (ws1Active && ws2Active) {
        dot.className = 'status-dot dot-green';
    } else {
        dot.className = 'status-dot dot-red';
    }
}

function connectExchange(exIndex, exName, symbol) {
    const cleanSym = symbol.replace('_', '').toUpperCase(); 
    let wsUrl = '';
    
    if (exName === 'Binance') wsUrl = `wss://fapi-stream.binance.com/ws/${cleanSym.toLowerCase()}@ticker`;
    else if (exName === 'Binance Spot') wsUrl = `wss://stream.binance.com:9443/ws/${cleanSym.toLowerCase()}@ticker`;
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

        if (exName.startsWith('Bybit')) ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${cleanSym}`] }));
        else if (exName === 'Gate.io') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'futures.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        else if (exName === 'Gate.io Spot') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'spot.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        else if (exName === 'MEXC') ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
        else if (exName === 'MEXC Spot') ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [`spot@public.deals.v3.api@${cleanSym}`] }));
        else if (exName.startsWith('Bitget')) ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: exName.includes('Spot') ? 'SP' : 'USDT-FUTURES', channel: 'ticker', instId: cleanSym }] }));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            let price = null;

            if (exName.startsWith('Binance') && data.c) price = parseFloat(data.c); 
            else if (exName.startsWith('Bybit') && data.data && data.data.lastPrice) price = parseFloat(data.data.lastPrice);
            else if (exName === 'Gate.io' && data.event === 'update' && data.result && data.result.length > 0) price = parseFloat(data.result[0].last);
            else if (exName === 'Gate.io Spot' && data.event === 'update' && data.result && data.result.last) price = parseFloat(data.result.last);
            else if (exName === 'MEXC' && data.channel === 'push.ticker' && data.data) price = parseFloat(data.data.lastPrice);
            else if (exName === 'MEXC Spot' && data.c === `spot@public.deals.v3.api@${cleanSym}` && data.d && data.d.deals) price = parseFloat(data.d.deals[0].p); 
            else if (exName.startsWith('Bitget') && data.data && data.data.length > 0 && data.data[0].lastPr) price = parseFloat(data.data[0].lastPr);

            if (price) updateLiveCandle(exIndex, price);
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
// ЗАПУСК (Виклик стартових налаштувань)
// ==========================================
async function initLive() {
    // Вказуємо id кнопки, щоб вона коректно підсвітилась при старті
    await window.changeInterval(1, document.getElementById('btn-1m'));
    ws1 = connectExchange(1, rawEx1Name, symbol);
    ws2 = connectExchange(2, rawEx2Name, symbol);
}

initLive();

// Ping
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