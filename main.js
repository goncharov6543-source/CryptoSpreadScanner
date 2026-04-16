const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray = null;
let minimizeToTray = false;
let isQuitting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: "Crypto Arb Pro",
        autoHideMenuBar: true, // Ховаємо верхнє меню Файл/Редагувати для краси
        webPreferences: {
            nodeIntegration: true,     // Дозволяємо використовувати Node.js прямо в інтерфейсі
            contextIsolation: false    // Спрощує роботу
        }
    });

    // Завантажуємо наш візуальний інтерфейс
    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools(); // Закоментуйте для фінального білду

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

    // Створюємо базову системну іконку для трею, щоб уникнути помилок відсутності файлу
    const iconBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAABtJREFUOE9jZKAQMKI1+B81gGE0mEcNIEMAAgBMAA4x2xL2AAAAAElFTkSuQmCC', 'base64');
    const trayIcon = nativeImage.createFromBuffer(iconBuffer);

    tray = new Tray(trayIcon);
    tray.setToolTip('Crypto Arb Pro');
    
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