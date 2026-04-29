const axios = require('axios');

// 1. Отримуємо параметри
const urlParams = new URLSearchParams(window.location.search);
const symbol = urlParams.get('symbol'); 
const ex1Name = urlParams.get('ex1');   
const ex2Name = urlParams.get('ex2');   

document.getElementById('pair-title').innerText = `Live: ${symbol}`;
document.getElementById('name-ex1').innerText = ex1Name.replace(' Spot', '');
document.getElementById('name-ex2').innerText = ex2Name.replace(' Spot', '');

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
    wickUpColor: '#26a69a', wickDownColor: '#ef5350', title: ex1Name.replace(' Spot', '')
});

const series2 = chart.addCandlestickSeries({
    upColor: '#2962FF', downColor: '#FF6D00', borderVisible: false, 
    wickUpColor: '#2962FF', wickDownColor: '#FF6D00', title: ex2Name.replace(' Spot', '')
});

window.addEventListener('resize', () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
});

let lastCandle1 = null;
let lastCandle2 = null;

// Виправлена функція перемикання часу
window.setTimeframe = function(hours, btnElement = null) {
    document.querySelectorAll('.btn-tf').forEach(btn => btn.classList.remove('active'));
    
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // Якщо викликано кодом, шукаємо потрібну кнопку
        const btns = document.querySelectorAll('.btn-tf');
        if(hours === 1) btns[0].classList.add('active');
        else if(hours === 4) btns[1].classList.add('active');
        else if(hours === 12) btns[2].classList.add('active');
    }
    
    const now = Math.floor(Date.now() / 1000);
    const fromTime = now - (hours * 60 * 60);
    chart.timeScale().setVisibleRange({ from: fromTime, to: now });
};

// ==========================================
// ОТРИМАННЯ ІСТОРІЇ (REST API) - ЛІМІТ 4 ГОДИНИ
// ==========================================
async function fetchHistory(exName, symbol) {
    const cleanSym = symbol.replace('_', '').toUpperCase();
    const isSpot = exName.endsWith(' Spot');
    const ex = exName.replace(' Spot', '');
    const limit = 240; // 240 хвилин = 4 години
    
    try {
        let url = '';
        if (ex === 'Binance') url = isSpot ? `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=1m&limit=${limit}` : `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=1m&limit=${limit}`;
        else if (ex === 'Bybit') url = `https://api.bybit.com/v5/market/kline?category=${isSpot ? 'spot' : 'linear'}&symbol=${cleanSym}&interval=1&limit=${limit}`;
        else if (ex === 'Gate.io') url = isSpot ? `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${cleanSym.replace('USDT','_USDT')}&interval=1m&limit=${limit}` : `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${cleanSym.replace('USDT','_USDT')}&interval=1m&limit=${limit}`;
        else if (ex === 'Bitget') url = isSpot ? `https://api.bitget.com/api/v2/spot/market/candles?symbol=${cleanSym}&granularity=1min&limit=${limit}` : `https://api.bitget.com/api/v2/mix/market/candles?symbol=${cleanSym}&productType=USDT-FUTURES&granularity=1m&limit=${limit}`;
        else if (ex === 'MEXC') url = isSpot ? `https://api.mexc.com/api/v3/klines?symbol=${cleanSym}&interval=1m&limit=${limit}` : `https://contract.mexc.com/api/v1/contract/kline/${cleanSym.replace('USDT','_USDT')}?interval=Min1`;

        if (!url) return [];
        const r = await axios.get(url, { timeout: 5000 });
        let data = [];

        // Парсинг дат (всі дати переводимо строго в секунди!)
        if (ex === 'Binance') {
            data = r.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
        } else if (ex === 'Bybit') {
            data = r.data.result.list.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) })).reverse();
        } else if (ex === 'Gate.io') {
            if (isSpot) {
                data = r.data.map(k => ({ time: parseInt(k[0]), open: parseFloat(k[5]), high: parseFloat(k[3]), low: parseFloat(k[4]), close: parseFloat(k[2]) }));
            } else {
                data = r.data.map(k => ({ time: parseInt(k.t), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) }));
            }
        } else if (ex === 'Bitget') {
            data = r.data.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
        } else if (ex === 'MEXC') {
            if (isSpot) {
                data = r.data.map(k => ({ time: Math.floor(k[0]/1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) }));
            } else {
                const d = r.data.data;
                if (d && d.time) {
                    for(let i=0; i<d.time.length; i++) {
                        data.push({ time: parseInt(d.time[i]), open: parseFloat(d.open[i]), high: parseFloat(d.high[i]), low: parseFloat(d.low[i]), close: parseFloat(d.close[i]) });
                    }
                    data = data.slice(-limit); // Беремо останні 240
                }
            }
        }

        // Очищаємо від дублікатів та сортуємо (Lightweight charts падає від дублікатів)
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

    } catch(e) {
        console.log(`Помилка історії ${exName}:`, e.message);
        return [];
    }
}

// ==========================================
// ЛОГІКА ДОДАВАННЯ ТІКУ ДО СВІЧКИ
// ==========================================
function updateLiveCandle(exIndex, price) {
    const now = new Date();
    now.setSeconds(0, 0); 
    const currentMinute = Math.floor(now.getTime() / 1000);
    
    let lastCandle = exIndex === 1 ? lastCandle1 : lastCandle2;
    let series = exIndex === 1 ? series1 : series2;

    document.getElementById(`price-ex${exIndex}`).innerText = price.toFixed(4);

    if (!lastCandle) {
        lastCandle = { time: currentMinute, open: price, high: price, low: price, close: price };
    } else if (lastCandle.time === currentMinute) {
        lastCandle.close = price;
        if (price > lastCandle.high) lastCandle.high = price;
        if (price < lastCandle.low) lastCandle.low = price;
    } else if (currentMinute > lastCandle.time) {
        lastCandle = { time: currentMinute, open: lastCandle.close, high: Math.max(lastCandle.close, price), low: Math.min(lastCandle.close, price), close: price };
    }

    if (exIndex === 1) lastCandle1 = lastCandle;
    else lastCandle2 = lastCandle;

    try {
        series.update(lastCandle);
    } catch(e) {
        // Захист від запізнілих тіків
    }
}

// ==========================================
// WEBSOCKETS
// ==========================================
let ws1 = null, ws2 = null;

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
        if (exName.startsWith('Bybit')) ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${cleanSym}`] }));
        else if (exName === 'Gate.io') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'futures.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        else if (exName === 'Gate.io Spot') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'spot.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')] }));
        else if (exName === 'MEXC') ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
        else if (exName === 'MEXC Spot') ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [`spot@public.bookTicker.v3.api@${cleanSym}`] }));
        else if (exName.startsWith('Bitget')) ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: exName.includes('Spot') ? 'SP' : 'USDT-FUTURES', channel: 'ticker', instId: cleanSym }] }));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            let price = null;

            if (exName.startsWith('Binance') && data.c) price = parseFloat(data.c); 
            else if (exName.startsWith('Bybit') && data.data && data.data.lastPrice) price = parseFloat(data.data.lastPrice);
            else if (exName === 'Gate.io' && data.event === 'update' && data.result && data.result.length > 0) price = parseFloat(data.result[0].last);
            else if (exName === 'Gate.io Spot' && data.event === 'update' && data.result) price = parseFloat(data.result.last);
            else if (exName === 'MEXC' && data.channel === 'push.ticker' && data.data) price = parseFloat(data.data.lastPrice);
            else if (exName === 'MEXC Spot' && data.c === `spot@public.bookTicker.v3.api@${cleanSym}` && data.d) price = parseFloat(data.d.a ? data.d.a : data.d.b); 
            else if (exName.startsWith('Bitget') && data.data && data.data.length > 0 && data.data[0].lastPr) price = parseFloat(data.data[0].lastPr);

            if (price) updateLiveCandle(exIndex, price);
        } catch (err) {}
    };

    ws.onclose = () => {
        setTimeout(() => connectExchange(exIndex, exName, symbol), 3000);
    };

    return ws;
}

// ==========================================
// ЗАПУСК (Ініціалізація історії + Лайв)
// ==========================================
async function initLive() {
    document.getElementById('price-ex1').innerText = 'Завантаження...';
    document.getElementById('price-ex2').innerText = 'Завантаження...';

    // 1. Отримуємо 4 години історії
    const [hist1, hist2] = await Promise.all([
        fetchHistory(ex1Name, symbol),
        fetchHistory(ex2Name, symbol)
    ]);

    // 2. Відмальовуємо історію
    if (hist1.length > 0) {
        series1.setData(hist1);
        lastCandle1 = hist1[hist1.length - 1];
        document.getElementById('price-ex1').innerText = lastCandle1.close.toFixed(4);
    } else {
        document.getElementById('price-ex1').innerText = 'Немає історії';
    }
    
    if (hist2.length > 0) {
        series2.setData(hist2);
        lastCandle2 = hist2[hist2.length - 1];
        document.getElementById('price-ex2').innerText = lastCandle2.close.toFixed(4);
    } else {
        document.getElementById('price-ex2').innerText = 'Немає історії';
    }

    // Встановлюємо дефолтний вигляд на 4 години
    window.setTimeframe(4, null);

    // 3. Підключаємо WebSockets для тіків
    ws1 = connectExchange(1, ex1Name, symbol);
    ws2 = connectExchange(2, ex2Name, symbol);
}

initLive();

// Ping для утримання з'єднання
setInterval(() => {
    const sendPing = (ws, exName) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (exName.startsWith('Bybit')) ws.send(JSON.stringify({ op: 'ping' }));
        else if (exName === 'Gate.io') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'futures.ping' }));
        else if (exName === 'Gate.io Spot') ws.send(JSON.stringify({ time: Math.floor(Date.now()/1000), channel: 'spot.ping' }));
        else if (exName.startsWith('MEXC')) ws.send(JSON.stringify({ method: 'ping' }));
        else if (exName.startsWith('Bitget')) ws.send('ping');
    };
    sendPing(ws1, ex1Name);
    sendPing(ws2, ex2Name);
}, 15000);