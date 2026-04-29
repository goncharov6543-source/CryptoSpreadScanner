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

// ==========================================
// МІСЦЕ ДЛЯ WEBSOCKETS (Адаптери бірж)
// ==========================================
console.log(`Підготовка до підключення ${symbol} на ${ex1Name} та ${ex2Name}`);

// В наступному кроці ми напишемо сюди логіку, 
// яка буде брати WebSockets Binance, Bybit і т.д. 
// і просто викликати updatePrice(1, 65000.50) або updatePrice(2, 65002.10)