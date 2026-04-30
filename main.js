const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
let minimizeToTray = false;
let isQuitting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: "Crypto Arbitrage Scanner",
        icon: path.join(__dirname, 'assets', 'icon3.ico'),
        autoHideMenuBar: true, // Ховаємо верхнє меню Файл/Редагувати для краси
        webPreferences: {
            nodeIntegration: true,     // Дозволяємо використовувати Node.js прямо в інтерфейсі
            contextIsolation: false,   // Спрощує роботу
            backgroundThrottling: false    
        }
    });

    // Завантажуємо наш візуальний інтерфейс
    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Закоментуйте для фінального білду

    mainWindow.once('ready-to-show', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });

    // Обробка закриття вікна (Згортання в трей)
    mainWindow.on('close', function (event) {
        if (minimizeToTray && !isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// Коли Electron готовий
app.whenReady().then(() => {
    createWindow();

    // 1. Вказуємо шлях до вашої реальної іконки
    // path.join(__dirname, ...) гарантує, що шлях буде правильним і при розробці, і після збірки
    const iconPath = path.join(__dirname, 'assets', 'icon3.ico');
    
    // 2. Створюємо об'єкт іконки з файлу
    const trayIcon = nativeImage.createFromPath(iconPath);

    // 3. Ініціалізуємо трей з новою іконкою
    tray = new Tray(trayIcon);
    
    // Оновлюємо назву в підказці (ToolTip)
    tray.setToolTip('Crypto Arbitrage Scanner');
    
    // Клік по трею розгортає вікно
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Контекстне меню трею
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Відкрити', click: () => { if (mainWindow) mainWindow.show(); } },
        { label: 'Вийти', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// Слухаємо налаштування з інтерфейсу (автозапуск і трей)
ipcMain.on('update-launch-settings', (event, settings) => {
    minimizeToTray = settings.minimizeToTray;
    
    // Встановлюємо автозапуск
    app.setLoginItemSettings({
        openAtLogin: settings.autoStart,
        path: app.getPath("exe")
    });
});

// === ЛОГІКА АВТООНОВЛЕННЯ ===

// Коли програма знайшла і тихо завантажила оновлення з GitHub
autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
        // Відправляємо сигнал в renderer.js, щоб той показав приховану плашку
        mainWindow.webContents.send('update_downloaded');
    }
});

// Слухаємо команду від кнопки "Перезапустити та Оновити" з інтерфейсу
ipcMain.on('restart_app', () => {
    isQuitting = true; // Дозволяємо програмі закритися, а не згорнутися в трей
    autoUpdater.quitAndInstall(); // Встановлюємо оновлення і перезапускаємось
});

// --- ЛОГІКА ДЛЯ LIVE ВІКНА (WEBSOCKETS) ---
ipcMain.on('open-live-window', (event, data) => {
    const { symbol, ex1, ex2 } = data;
    
    let liveWin = new BrowserWindow({
        width: 1200,
        height: 700,
        title: `Live: ${symbol} (${ex1} vs ${ex2})`,
        icon: path.join(__dirname, 'assets', 'icon3.ico'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Формуємо URL з параметрами, щоб передати назви монет і бірж у нове вікно
    const liveUrl = new URL(`file://${path.join(__dirname, 'live.html')}`);
    liveUrl.searchParams.append('symbol', symbol);
    liveUrl.searchParams.append('ex1', ex1);
    liveUrl.searchParams.append('ex2', ex2);

    liveWin.loadURL(liveUrl.href);
    liveWin.maximize();
    liveWin.webContents.openDevTools();

    liveWin.on('closed', () => {
        liveWin = null;
    });
});