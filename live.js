// 1. Отримуємо параметри з URL (яку монету і біржі ми відкрили)
const urlParams = new URLSearchParams(window.location.search);
const symbol = urlParams.get('symbol'); 
const ex1Name = urlParams.get('ex1');   // Біржа покупки
const ex2Name = urlParams.get('ex2');   // Біржа продажу

document.getElementById('pair-title').innerText = `Live: ${symbol}`;
document.getElementById('name-ex1').innerText = ex1Name.replace(' Spot', '');
document.getElementById('name-ex2').innerText = ex2Name.replace(' Spot', '');

// 2. Ініціалізація графіка Lightweight Charts
const chartOptions = {
    layout: { textColor: '#d1d4dc', background: { type: 'solid', color: '#0b0e11' } },
    grid: {
        vertLines: { color: '#2b3139', style: 1 },
        horzLines: { color: '#2b3139', style: 1 },
    },
    timeScale: { 
        timeVisible: true, 
        secondsVisible: true,
        borderColor: '#2b3139'
    },
    rightPriceScale: { borderColor: '#2b3139' },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
};

const chartContainer = document.getElementById('chart-container');
const chart = LightweightCharts.createChart(chartContainer, chartOptions);

// Створюємо дві лінії (одна для купівлі, інша для продажу)
const series1 = chart.addLineSeries({ color: '#00d67c', lineWidth: 2, title: ex1Name.replace(' Spot', '') });
const series2 = chart.addLineSeries({ color: '#e74c3c', lineWidth: 2, title: ex2Name.replace(' Spot', '') });

// Ресайз графіка при зміні розміру вікна
window.addEventListener('resize', () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
});

// 3. Універсальна функція для оновлення ціни
function updatePrice(exIndex, price) {
    const time = Math.floor(Date.now() / 1000); // Lightweight Charts працює з Unix timestamp в секундах
    
    if (exIndex === 1) {
        document.getElementById('price-ex1').innerText = price;
        series1.update({ time: time, value: parseFloat(price) });
    } else if (exIndex === 2) {
        document.getElementById('price-ex2').innerText = price;
        series2.update({ time: time, value: parseFloat(price) });
    }
}

console.log(`Підготовка до підключення ${symbol} на ${ex1Name} та ${ex2Name}`);

// ==========================================
// WEBSOCKETS (Адаптери бірж)
// ==========================================

// Глобальні змінні для WebSocket з'єднань, щоб можна було їх закривати при потребі
let ws1 = null;
let ws2 = null;

// Функція для ініціалізації з'єднання
function connectExchange(exIndex, exName, symbol) {
    const cleanSym = symbol.replace('_', '').toUpperCase(); // напр. AIAUSDT
    let wsUrl = '';
    
    // Формуємо URL залежно від біржі
    if (exName === 'Binance') {
        wsUrl = `wss://fapi-stream.binance.com/ws/${cleanSym.toLowerCase()}@ticker`;
    } else if (exName === 'Binance Spot') {
        wsUrl = `wss://stream.binance.com:9443/ws/${cleanSym.toLowerCase()}@ticker`;
    } else if (exName === 'Bybit') {
        wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    } else if (exName === 'Bybit Spot') {
        wsUrl = 'wss://stream.bybit.com/v5/public/spot';
    } else if (exName === 'Gate.io') {
        wsUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
    } else if (exName === 'Gate.io Spot') {
        wsUrl = 'wss://api.gateio.ws/ws/v4/';
    } else if (exName === 'MEXC') {
        wsUrl = 'wss://contract.mexc.com/edge';
    } else if (exName === 'MEXC Spot') {
        wsUrl = 'wss://wbs.mexc.com/ws';
    } else if (exName === 'Bitget') {
        wsUrl = 'wss://ws.bitget.com/mix/v1/stream';
    } else if (exName === 'Bitget Spot') {
        wsUrl = 'wss://ws.bitget.com/spot/v1/stream';
    } else {
        console.error(`Біржа ${exName} поки не підтримується для Live-режиму`);
        return;
    }

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log(`✅ Підключено до ${exName}`);
        
        // Деякі біржі вимагають відправки повідомлення для підписки (Subscribe)
        if (exName.startsWith('Bybit')) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${cleanSym}`] }));
        } else if (exName === 'Gate.io') {
            const time = Math.floor(Date.now() / 1000);
            ws.send(JSON.stringify({
                time: time, channel: 'futures.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')]
            }));
        } else if (exName === 'Gate.io Spot') {
            const time = Math.floor(Date.now() / 1000);
            ws.send(JSON.stringify({
                time: time, channel: 'spot.tickers', event: 'subscribe', payload: [cleanSym.replace('USDT', '_USDT')]
            }));
        } else if (exName === 'MEXC') {
            ws.send(JSON.stringify({ method: 'sub.ticker', param: { symbol: cleanSym.replace('USDT', '_USDT') } }));
        } else if (exName === 'MEXC Spot') {
            ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [`spot@public.bookTicker.v3.api@${cleanSym}`] }));
        } else if (exName.startsWith('Bitget')) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: exName.includes('Spot') ? 'SP' : 'USDT-FUTURES', channel: 'ticker', instId: cleanSym }] }));
        }
        // Binance починає сипати дані одразу після підключення до правильного URL
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            let price = null;

            // Парсинг відповіді залежно від біржі
            if (exName.startsWith('Binance') && data.c) {
                price = data.c; // c - last price
            } 
            else if (exName.startsWith('Bybit') && data.data && data.data.lastPrice) {
                price = data.data.lastPrice;
            } 
            else if (exName === 'Gate.io' && data.event === 'update' && data.result && data.result.length > 0) {
                price = data.result[0].last;
            } 
            else if (exName === 'Gate.io Spot' && data.event === 'update' && data.result) {
                price = data.result.last;
            } 
            else if (exName === 'MEXC' && data.channel === 'push.ticker' && data.data) {
                price = data.data.lastPrice;
            }
            else if (exName === 'MEXC Spot' && data.c === `spot@public.bookTicker.v3.api@${cleanSym}` && data.d) {
                // Для MEXC Spot беремо середнє між bid і ask як "останню ціну", якщо lastPrice немає в цьому стрімі
                price = data.d.a ? data.d.a : data.d.b; 
            }
            else if (exName.startsWith('Bitget') && data.data && data.data.length > 0 && data.data[0].lastPr) {
                price = data.data[0].lastPr;
            }

            // Якщо ціну знайдено — малюємо її!
            if (price) {
                updatePrice(exIndex, price);
            }
        } catch (err) {
            // Ігноруємо помилки парсингу системних повідомлень
        }
    };

    ws.onerror = (error) => {
        console.log(`❌ Помилка WebSocket ${exName}:`, error);
    };

    ws.onclose = () => {
        console.log(`🔌 Відключено від ${exName}. Спроба реконекту...`);
        setTimeout(() => connectExchange(exIndex, exName, symbol), 3000);
    };

    return ws;
}

// Запускаємо підключення!
ws1 = connectExchange(1, ex1Name, symbol);
ws2 = connectExchange(2, ex2Name, symbol);