const electron = require('electron');
const fs = require('fs');
const path = require('path');

const {
  app, // Module to control application life.
  protocol, // Module to control protocol handling
  BaseWindow, // Module to create native browser window.
  BrowserWindow,
  webContents,
  session,
  ipcMain: ipc,
  Menu, MenuItem,
  crashReporter,
  dialog,
  nativeTheme,
  shell,
  net,
  WebContentsView
} = electron;

// 定义 getWindowWebContents 函数
function getWindowWebContents(window) {
  if (window instanceof BaseWindow) {
    return window.contentView.webContents;
  }
  return window.webContents;
}

crashReporter.start({
  submitURL: 'https://minbrowser.org/',
  uploadToServer: false,
  compress: true
});

if (process.argv.some(arg => arg === '-v' || arg === '--version')) {
  console.log('Min: ' + app.getVersion());
  console.log('Chromium: ' + process.versions.chrome);
  process.exit();
}

let isInstallerRunning = false;
const isDevelopmentMode = process.argv.some(arg => arg === '--development-mode');
const isDebuggingEnabled = process.argv.some(arg => arg === '--debug-browser');

function clamp(n, min, max) {
  return Math.max(Math.min(n, max), min);
}

if (process.platform === 'win32') {
  (async function () {
    var squirrelCommand = process.argv[1];
    if (squirrelCommand === '--squirrel-install' || squirrelCommand === '--squirrel-updated') {
      isInstallerRunning = true;
      await registryInstaller.install();
    }
    if (squirrelCommand === '--squirrel-uninstall') {
      isInstallerRunning = true;
      await registryInstaller.uninstall();
    }
    if (require('electron-squirrel-startup')) {
      app.quit();
    }
  })();
}

if (isDevelopmentMode) {
  app.setPath('userData', app.getPath('userData') + '-development');
}

// workaround for flicker when focusing app (https://github.com/electron/electron/issues/17942)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');

var userDataPath = app.getPath('userData');

settings.initialize(userDataPath);

if (settings.get('userSelectedLanguage')) {
  app.commandLine.appendSwitch('lang', settings.get('userSelectedLanguage'));
}

const browserPage = 'min://app/index.html';

var mainMenu = null;
var secondaryMenu = null;
var isFocusMode = false;
var appIsReady = false;

const isFirstInstance = app.requestSingleInstanceLock();

if (!isFirstInstance) {
  app.quit();
  return;
}

var saveWindowBounds = function () {
  if (windows.getCurrent()) {
    var bounds = Object.assign(windows.getCurrent().getBounds(), {
      maximized: windows.getCurrent().isMaximized()
    });
    fs.writeFileSync(path.join(userDataPath, 'windowBounds.json'), JSON.stringify(bounds));
  }
};

function sendIPCToWindow(window, action, data) {
  if (window && window.isDestroyed()) {
    console.warn('ignoring message ' + action + ' sent to destroyed window');
    return;
  }

  if (window && getWindowWebContents(window).isLoadingMainFrame()) {
    // immediately after a did-finish-load event, isLoading can still be true,
    // so wait a bit to confirm that the page is really loading
    setTimeout(function () {
      if (getWindowWebContents(window).isLoadingMainFrame()) {
        getWindowWebContents(window).once('did-finish-load', function () {
          getWindowWebContents(window).send(action, data || {});
        });
      } else {
        getWindowWebContents(window).send(action, data || {});
      }
    }, 0);
  } else if (window) {
    getWindowWebContents(window).send(action, data || {});
  } else {
    var window = createWindow();
    getWindowWebContents(window).once('did-finish-load', function () {
      getWindowWebContents(window).send(action, data || {});
    });
  }
}

function openTabInWindow(url) {
  sendIPCToWindow(windows.getCurrent(), 'addTab', {
    url: url
  });
}

function handleCommandLineArguments(argv) {
  // the "ready" event must occur before this function can be used
  if (argv) {
    argv.forEach(function (arg, idx) {
      if (arg && arg.toLowerCase() !== __dirname.toLowerCase()) {
        // URL
        if (arg.indexOf('://') !== -1) {
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          });
        } else if (idx > 0 && argv[idx - 1] === '-s') {
          // search
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          });
        } else if (/\.(m?ht(ml)?|pdf)$/.test(arg) && fs.existsSync(arg)) {
          // local files (.html, .mht, mhtml, .pdf)
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: 'file://' + path.resolve(arg)
          });
        }
      }
    });
  }
}

function createWindow(customArgs = {}) {
  var bounds;

  try {
    var data = fs.readFileSync(path.join(userDataPath, 'windowBounds.json'), 'utf-8');
    bounds = JSON.parse(data);
  } catch (e) {}

  if (!bounds) { // there was an error, probably because the file doesn't exist
    var size = electron.screen.getPrimaryDisplay().workAreaSize;
    bounds = {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      maximized: true
    };
  }

  // make the bounds fit inside a currently-active screen
  // (since the screen Min was previously open on could have been removed)
  // see: https://github.com/minbrowser/min/issues/904
  var containingRect = electron.screen.getDisplayMatching(bounds).workArea;

  bounds = {
    x: clamp(bounds.x, containingRect.x, (containingRect.x + containingRect.width) - bounds.width),
    y: clamp(bounds.y, containingRect.y, (containingRect.y + containingRect.height) - bounds.height),
    width: clamp(bounds.width, 0, containingRect.width),
    height: clamp(bounds.height, 0, containingRect.height),
    maximized: bounds.maximized
  };

  return createWindowWithBounds(bounds, customArgs);
}

function createWindowWithBounds(bounds, customArgs) {
  const newWin = new BaseWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: (process.platform === 'win32' ? 400 : 320), // controls take up more horizontal space on Windows
    minHeight: 350,
    titleBarStyle: settings.get('useSeparateTitlebar') ? 'default' : 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    icon: __dirname + '/icons/icon256.png',
    frame: settings.get('useSeparateTitlebar'),
    alwaysOnTop: settings.get('windowAlwaysOnTop'),
    backgroundColor: '#fff', // the value of this is ignored, but setting it seems to work around https://github.com/electron/electron/issues/10559
  });

  // windows and linux always use a menu button in the upper-left corner instead
  // if frame: false is set, this won't have any effect, but it does apply on Linux if "use separate titlebar" is enabled
  if (process.platform !== 'darwin') {
    newWin.setMenuBarVisibility(false);
  }

  const mainView = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: true, // used by ProcessSpawner
      additionalArguments: [
        '--user-data-path=' + userDataPath,
        '--app-version=' + app.getVersion(),
        '--app-name=' + app.getName(),
        ...((isDevelopmentMode ? ['--development-mode'] : [])),
        '--window-id=' + windows.nextId,
        ...((windows.getAll().length === 0 ? ['--initial-window'] : [])),
        ...(windows.hasEverCreatedWindow ? [] : ['--launch-window']),
        ...(customArgs.initialTask ? ['--initial-task=' + customArgs.initialTask] : [])
      ]
    }
  });
  mainView.webContents.loadURL(browserPage);

  if (bounds.maximized) {
    newWin.maximize();

    mainView.webContents.once('did-finish-load', function () {
      sendIPCToWindow(newWin, 'maximize');
    });
  }

  const winBounds = newWin.getContentBounds();

  mainView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
  newWin.contentView.addChildView(mainView);

  // sometimes getContentBounds doesn't provide correct bounds until after the window has finished loading
  mainView.webContents.once('did-finish-load', function () {
    const winBounds = newWin.getContentBounds();
    mainView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
  });

  newWin.on('resize', function () {
    // The result of getContentBounds doesn't update until the next tick
    setTimeout(function () {
      const winBounds = newWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
    }, 0);
  });

  newWin.on('close', function () {
    // save the window size for the next launch of the app
    saveWindowBounds();
  });

  newWin.on('focus', function () {
    if (!windows.getState(newWin).isMinimized) {
      sendIPCToWindow(newWin, 'windowFocus');
    }
  });

  newWin.on('minimize', function () {
    sendIPCToWindow(newWin, 'minimize');
    windows.getState(newWin).isMinimized = true;
  });

  newWin.on('restore', function () {
    windows.getState(newWin).isMinimized = false;
  });

  newWin.on('maximize', function () {
    sendIPCToWindow(newWin, 'maximize');
  });

  newWin.on('unmaximize', function () {
    sendIPCToWindow(newWin, 'unmaximize');
  });

  newWin.on('focus', function () {
    sendIPCToWindow(newWin, 'focus');
  });

  newWin.on('blur', function () {
    // if the devtools for this window are focused, this check will be false, and we keep the focused class on the window
    if (BaseWindow.getFocusedWindow() !== newWin) {
      sendIPCToWindow(newWin, 'blur');
    }
  });

  newWin.on('enter-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-full-screen');
  });

  newWin.on('leave-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-full-screen');
    // https://github.com/minbrowser/min/issues/1093
    newWin.setMenuBarVisibility(false);
  });

  newWin.on('enter-html-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-html-full-screen');
  });

  newWin.on('leave-html-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-html-full-screen');
    // https://github.com/minbrowser/min/issues/952
    newWin.setMenuBarVisibility(false);
  });

  // 新增处理设置标题栏样式的逻辑
  ipc.handle('setTitleBarStyle', (event, style) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.setTitleBarStyle(style);
  });

  return newWin;
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
