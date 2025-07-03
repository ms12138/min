const electron = require('electron');
const fs = require('fs');
const path = require('path');
// 去掉引入 windows 模块的代码
// const windows = require('./windowManagement.js');

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

// ... 其他代码保持不变 ...
