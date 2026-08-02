const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const { existsSync, copyFileSync, mkdirSync, writeFileSync, appendFileSync } = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { createServer } = require('net');

if (process.env.BOSS_STARTUP_SMOKE === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function findFreePort(start) {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise(resolve => {
      const server = createServer();
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
      server.once('error', () => resolve(false));
    });
    if (free) return port;
  }
  throw new Error(`端口 ${start}-${start + 99} 均被占用`);
}

async function waitForReady(
  url,
  maxRetries = 30,
  accept = status => status >= 200 && status < 300,
  headersOnly = false,
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const request = http.get(url, response => {
          if (headersOnly) {
            const result = { status: response.statusCode || 0, body: '' };
            response.destroy();
            resolve(result);
            return;
          }
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { body = `${body}${chunk}`.slice(-16000); });
          response.on('end', () => resolve({ status: response.statusCode || 0, body }));
        });
        request.setTimeout(1500, () => request.destroy(new Error('timeout')));
        request.once('error', reject);
      });
      if (accept(result.status, result.body)) return true;
    } catch { /* 服务尚未就绪 */ }
    await sleep(1000);
  }
  return false;
}

let backendProcess = null;
let browserwingProcess = null;
let mainWindow = null;
let startupLogPath = null;

app.setName('HR筛选简历助手');
app.setAppUserModelId('com.hrassistant.standalone');
app.setPath(
  'userData',
  process.env.HR_ASSISTANT_USER_DATA_DIR || path.join(app.getPath('appData'), 'HR筛选简历助手'),
);

function writeStartupLog(level, message) {
  const text = String(message).trim();
  if (!text) return;
  const line = `[${new Date().toISOString()}] [${level}] ${text}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (startupLogPath) {
    try { appendFileSync(startupLogPath, `${line}\n`, 'utf8'); }
    catch (error) { console.error('[electron] failed to write startup log:', error); }
  }
}

function initializeStartupLog() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  mkdirSync(logDir, { recursive: true });
  startupLogPath = path.join(logDir, 'startup.log');
  writeFileSync(startupLogPath, '', 'utf8');
  writeStartupLog('INFO', `starting v${app.getVersion()} (${app.isPackaged ? 'packaged' : 'development'})`);
}

function pipeLogs(child, name, stderrLevel = 'ERROR') {
  let tail = '';
  const record = (level, data) => {
    const message = data.toString().trim();
    if (!message) return;
    tail = `${tail}\n${message}`.slice(-4000);
    writeStartupLog(level, `[${name}] ${message}`);
  };
  child.stdout?.on('data', data => record('INFO', data));
  child.stderr?.on('data', data => record(stderrLevel, data));
  child.on('error', error => record('ERROR', `process error: ${error.message}`));
  return () => tail.trim();
}

async function waitForProcessReady(
  child,
  url,
  name,
  getLogTail,
  maxRetries = 60,
  accept = status => status >= 200 && status < 300,
  headersOnly = false,
) {
  let failure = null;
  child.once('error', error => { failure = `${name} 进程无法启动：${error.message}`; });
  child.once('exit', (code, signal) => {
    failure = `${name} 进程提前退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`;
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (failure) {
      const tail = getLogTail();
      throw new Error(tail ? `${failure}\n${tail}` : failure);
    }
    if (await waitForReady(url, 1, accept, headersOnly)) {
      await sleep(500);
      if (failure) {
        const tail = getLogTail();
        throw new Error(tail ? `${failure}\n${tail}` : failure);
      }
      return;
    }
  }

  const tail = getLogTail();
  const detail = tail ? `\n最近输出：\n${tail}` : '';
  throw new Error(`${name} 在 ${maxRetries} 秒内未就绪${detail}`);
}

function runtimePaths() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'app-root') : path.join(__dirname, '..');
  const userRoot = app.getPath('userData');
  const configDir = path.join(userRoot, 'config');
  const dataDir = path.join(userRoot, 'data');
  const browserwingDir = path.join(userRoot, 'browserwing');
  const browserwingConfig = path.join(browserwingDir, 'config.toml');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(browserwingDir, { recursive: true });
  writeFileSync(browserwingConfig, `assets_dir = "./data"\n\n[server]\nhost = "127.0.0.1"\nport = "7777"\n\n[auth]\nenabled = false\ndefault_username = "admin"\ndefault_password = "admin"\napi_key = ""\n\n[database]\npath = "./data/browserwing.db"\n\n[browser]\nbin_path = ""\ncontrol_url = ""\nuser_data_dir = "./.browserwing/default-profile"\nheadless = false\n\n[log]\nlevel = "info"\nfile = "./logs/browserwing.log"\nmax_size = 100\nmax_backups = 3\nmax_age = 7\ncompress = false\n`, 'utf8');
  for (const file of ['keywords.json', 'settings.json']) {
    const source = path.join(root, 'config', file);
    const target = path.join(configDir, file);
    if (!existsSync(target) && existsSync(source)) copyFileSync(source, target);
  }

  return { root, configDir, dataDir, browserwingDir, browserwingConfig };
}

function getBrowserWingBinary() {
  if (process.platform !== 'win32') throw new Error('当前桌面安装包仅支持 Windows');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'browserwing', 'browserwing.exe')
    : path.join(__dirname, 'node_modules', 'browserwing', 'bin', 'browserwing.exe');
}

async function startBrowserWing(paths) {
  const preferredPort = Number.parseInt(process.env.BROWSERWING_PORT || '7777', 10);
  const endpoint = port => `http://127.0.0.1:${port}/api/v1/mcp/message`;
  const acceptsBrowserWing = status => status > 0 && status < 500;
  const binary = getBrowserWingBinary();
  if (!existsSync(binary)) {
    throw new Error(`安装包缺少 BrowserWing 运行时：${binary}\n请重新安装最新版应用。`);
  }

  let nextPort = preferredPort;
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const port = await findFreePort(nextPort);
    writeStartupLog('INFO', `starting bundled BrowserWing from ${binary} on port ${port} (attempt ${attempt}/5)`);
    const child = spawn(binary, ['--config', paths.browserwingConfig, '--port', String(port)], {
      cwd: paths.browserwingDir,
      env: {
        ...process.env,
        // BrowserWing 1.1.0 always checks its public script registry at startup.
        // Route those backend-only requests to a closed loopback endpoint so the
        // standalone app cannot contact anything except sites opened by Chrome.
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        NO_PROXY: '127.0.0.1,localhost',
        // Its first-run default profile is derived from USERPROFILE rather than
        // browser.user_data_dir, so scope the derived path to this app as well.
        USERPROFILE: paths.browserwingDir,
        HOME: paths.browserwingDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    browserwingProcess = child;
    const getLogTail = pipeLogs(child, 'browserwing', 'INFO');
    try {
      await waitForProcessReady(child, endpoint(port), 'BrowserWing', getLogTail, 60, acceptsBrowserWing, true);
      writeStartupLog('INFO', `BrowserWing ready on port ${port}`);
      return port;
    } catch (error) {
      lastError = error;
      child.kill();
      if (browserwingProcess === child) browserwingProcess = null;

      writeStartupLog('WARN', `BrowserWing failed on port ${port}; retrying on another port`);
      nextPort = port + 1;
    }
  }
  throw lastError || new Error('BrowserWing 连续 5 次启动失败');
}

async function startBackend(paths, browserwingPort) {
  // 桌面本机后端从 3001 起自动选择空闲回环端口。
  const preferredPort = Number.parseInt(process.env.LOCAL_APP_PORT || '3001', 10);
  const port = await findFreePort(preferredPort);
  const instanceId = randomUUID();
  const entry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'server.mjs')
    : path.join(paths.root, 'dist-backend', 'server.mjs');
  if (!existsSync(entry)) throw new Error('桌面包缺少后端运行文件，请先执行 npm run build:backend');

  backendProcess = spawn(process.execPath, [entry], {
    cwd: paths.root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SERVER_PORT: String(port),
      BROWSERWING_PORT: String(browserwingPort),
      BACKEND_INSTANCE_ID: instanceId,
      APP_ROOT_DIR: paths.root,
      APP_CONFIG_DIR: paths.configDir,
      APP_DATA_DIR: paths.dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const getLogTail = pipeLogs(backendProcess, 'backend');
  await waitForProcessReady(
    backendProcess,
    `http://127.0.0.1:${port}/api/status`,
    '后端',
    getLogTail,
    60,
    (status, body) => {
      if (status !== 200) return false;
      try { return JSON.parse(body).backendInstanceId === instanceId; }
      catch { return false; }
    },
  );
  writeStartupLog('INFO', `backend ready on port ${port}`);
  return port;
}

async function createWindow() {
  try {
    initializeStartupLog();
    const paths = runtimePaths();
    const browserwingPort = await startBrowserWing(paths);
    const serverPort = await startBackend(paths, browserwingPort);

    if (process.env.BOSS_STARTUP_SMOKE === '1') {
      writeStartupLog('INFO', 'startup smoke check passed');
      stopChildren();
      app.exit(0);
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: 'HR筛选简历助手',
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    mainWindow.on('closed', () => { mainWindow = null; });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || message : message;
    writeStartupLog('ERROR', `startup failed: ${stack}`);
    stopChildren();
    if (process.env.BOSS_STARTUP_SMOKE === '1') {
      app.exit(1);
      return;
    }
    const diagnostic = startupLogPath ? `\n\n诊断日志：${startupLogPath}` : '';
    dialog.showErrorBox('HR筛选简历助手启动失败', `${message}${diagnostic}`);
    app.quit();
  }
}

function stopChildren() {
  backendProcess?.kill();
  browserwingProcess?.kill();
  backendProcess = null;
  browserwingProcess = null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    writeStartupLog('INFO', 'second application launch redirected to the existing window');
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { stopChildren(); app.quit(); });
  app.on('before-quit', stopChildren);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}
