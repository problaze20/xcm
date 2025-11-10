const { app, Tray, Menu, clipboard, globalShortcut, nativeImage } = require("electron");
const path = require("path");
const md5 = require("md5");
const Datastore = require("nedb");
const { createCanvas } = require("canvas");

// --- Settings ---
const settings = new Datastore({
  filename: path.join(app.getPath("userData"), "settings.db"),
  autoload: true
});

const settingsGet = key => new Promise(resolve =>
  settings.findOne({ key }, (err, doc) => resolve(doc ? doc.value : undefined))
);

const settingsSet = (key, value) => new Promise(resolve =>
  settings.update({ key }, { key, value }, { upsert: true }, () => resolve())
);

// --- Clipboard database ---
const db = new Datastore({
  filename: path.join(app.getPath("userData"), "clipboard.db"),
  autoload: true
});

// --- App info ---
const appName = "XCM";
const version = "1.1.0";
const description = "A Clipboard Manager For MacOS Made By @problaze20 on Github";

// --- Tray ---
let tray = null;
let trayMenuItems = [];

// --- Helper: normalize color ---
function normalizeColor(input) {
  input = input.trim().toLowerCase();
  if (input.startsWith('#')) input = input.slice(1);
  if (input.length === 3) input = input.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(input)) return '#' + input;
  const rgbMatch = input.match(/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return null;
}

// --- Helper: create colored dot icon ---
function createColorDot(color, size = 12) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
  return nativeImage.createFromDataURL(canvas.toDataURL());
}

// --- Clipboard functions ---
async function fetchClipboardHistory(limit) {
  return new Promise((resolve, reject) => {
    db.find({}).sort({ updated_at: -1 }).limit(limit)
      .exec((err, items) => (err ? reject(err) : resolve(items)));
  });
}

async function addClipboardEntry(text) {
  if (!text) return;
  const entry = { hash: md5(text), text, updated_at: new Date() };
  db.update({ hash: entry.hash }, entry, { upsert: true }, async err => {
    if (!err) await refreshTray();
  });
}

function copyToClipboard(item) {
  if (item.text) clipboard.writeText(item.text);
}

// --- Settings functions ---
async function getClipboardLimit() {
  return (await settingsGet("clipboardLimit")) || 50;
}

async function setClipboardLimit(item) {
  await settingsSet("clipboardLimit", item.value);
  await refreshTray();
}

async function getAutoStart() {
  return !!(await settingsGet("autoStart"));
}

async function toggleAutoStart() {
  const value = !(await getAutoStart());
  await settingsSet("autoStart", value);
  app.setLoginItemSettings({ openAtLogin: value });
  await refreshTray();
}

function truncateWithEllipsis(text, maxLength = 50) {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

// --- Tray menu ---
async function buildTrayMenu() {
  const limit = await getClipboardLimit();
  const history = await fetchClipboardHistory(limit);

  trayMenuItems = [
    { label: `${appName} v${version}`, enabled: false },
    { label: `Clipboard History (${history.length})`, enabled: false },
    { type: "separator" }
  ];

  if (!history.length) {
    trayMenuItems.push({ label: "Clipboard is empty", enabled: false });
  } else {
    history.forEach((entry, i) => {
      let colorIcon = null;
      const normalized = normalizeColor(entry.text);
      if (normalized) colorIcon = createColorDot(normalized);

      trayMenuItems.push({
        label: truncateWithEllipsis(entry.text.replace(/&/g, "&&"), 50),
        icon: colorIcon,
        click: () => copyToClipboard(entry),
        accelerator: `CmdOrCtrl+${i + 1}`
      });
    });
  }

  trayMenuItems.push({ type: "separator" });

  const autoStartItem = {
    label: "Launch on System Startup",
    type: "checkbox",
    checked: await getAutoStart(),
    click: toggleAutoStart
  };

  const limitSubmenu = [30, 50, 100, 200, 400].map(val => ({
    label: `${val}`,
    type: "radio",
    value: val,
    checked: val === limit,
    click: setClipboardLimit
  }));

  const settingsMenu = {
    label: "Settings",
    submenu: [autoStartItem, { label: "Clipboard Limit", submenu: limitSubmenu }]
  };

  const clearAll = {
    label: "Clear All",
    click: async () => {
      await db.remove({}, { multi: true });
      await refreshTray();
    }
  };

  const quit = { label: "Quit", click: () => app.quit() };

  trayMenuItems.push(settingsMenu, clearAll, quit);

  const contextMenu = Menu.buildFromTemplate(trayMenuItems);
  tray.setContextMenu(contextMenu);
}

async function refreshTray() {
  if (!tray) return;
  await buildTrayMenu();
}

async function createTray() {
  tray = new Tray(path.join(__dirname, "IMG", "XCMTemplate.png"));
  tray.setToolTip(description);
  tray.on("right-click", () => tray.popUpContextMenu());
  await refreshTray();
}

// --- Clipboard watcher ---
function startClipboardWatcher() {
  let lastValue = clipboard.readText();
  setInterval(async () => {
    const current = clipboard.readText();
    if (current && current !== lastValue) {
      lastValue = current;
      await addClipboardEntry(current);
    }
  }, 300);
}

// --- App lifecycle ---
app.on("ready", async () => {
  await createTray();
  startClipboardWatcher();

  globalShortcut.register("CmdOrCtrl+Alt+H", () => {
    if (tray) tray.popUpContextMenu();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

if (process.platform === "darwin" && process.env.NODE_ENV !== "development") {
  app.dock.hide();
}
