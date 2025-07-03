const electron = require('electron');
const fs = require('fs');
const path = require('path');
const windows = require('./windowManagement.js'); // 引入 windowManagement.js

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

// ... 其他代码保持不变 ...

function sendIPCToWindow (window, action, data) {
  if (window && window.isDestroyed()) {
    console.warn('ignoring message ' + action + ' sent to destroyed window');
    return;
  }

  if (window && getWindowWebContents(window).isLoadingMainFrame()) {
    // immediately after a did-finish-load event, isLoading can still be true,
    // so wait a bit to confirm that the page is really loading
    setTimeout(function() {
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

// ... 其他代码保持不变 ...

var saveWindowBounds = function () {
  if (windows.getCurrent()) {
    var bounds = Object.assign(windows.getCurrent().getBounds(), {
      maximized: windows.getCurrent().isMaximized()
    })
    fs.writeFileSync(path.join(userDataPath, 'windowBounds.json'), JSON.stringify(bounds))
  }
}
