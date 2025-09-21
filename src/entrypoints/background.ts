import BookmarkService from '../utils/services'
import { Setting } from '../utils/setting'
import iconLogo from '../assets/icon.png'
import { OperType, BookmarkInfo, SyncDataInfo, RootBookmarksType, BrowserType } from '../utils/models'
import { Bookmarks } from 'wxt/browser'
export default defineBackground(() => {

  browser.runtime.onInstalled.addListener(c => {
  });

  let curOperType = OperType.NONE;
  let curBrowserType = BrowserType.CHROME;
  // Auto-sync state
  let autoSyncTimer: any = undefined;
  const autoSyncDelayMs = 3000; // debounce multiple rapid changes
  let isAutoSyncing = false;
  let blockAutoSyncUntil = 0; // timestamp to temporarily block auto sync
  // Auto-download state
  const periodicDownloadAlarm = 'bookmarkhub_download_every_minute';
  let isAutoDownloading = false;

  function disableAutoSyncTemporarily(ms: number = 5000) {
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = undefined;
    }
    blockAutoSyncUntil = Date.now() + ms;
  }
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.name === 'upload') {
      if (curOperType !== OperType.NONE) { sendResponse(false); return true; }
      disableAutoSyncTemporarily();
      curOperType = OperType.SYNC
      uploadBookmarks().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });
    }
    if (msg.name === 'download') {
      if (curOperType !== OperType.NONE) { sendResponse(false); return true; }
      disableAutoSyncTemporarily();
      curOperType = OperType.SYNC
      downloadBookmarks().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });

    }
    if (msg.name === 'removeAll') {
      if (curOperType !== OperType.NONE) { sendResponse(false); return true; }
      disableAutoSyncTemporarily();
      curOperType = OperType.REMOVE
      clearBookmarkTree().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });

    }
    if (msg.name === 'setting') {
      browser.runtime.openOptionsPage().then(() => {
        sendResponse(true);
      });
    }
    return true;
  });
  browser.bookmarks.onCreated.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onCreated", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      scheduleAutoSync();
    }
  });
  browser.bookmarks.onChanged.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onChanged", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      scheduleAutoSync();
    }
  })
  browser.bookmarks.onMoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onMoved", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      scheduleAutoSync();
    }
  })
  browser.bookmarks.onRemoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onRemoved", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      scheduleAutoSync();
    }
  })

  // --- Periodic auto-download using alarms ---
  browser.runtime.onStartup.addListener(() => {
    // Attempt an immediate download and schedule periodic downloads
    initAutoDownload();
  });
  // Also initialize when the background loads (e.g., first install/open)
  initAutoDownload();

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== periodicDownloadAlarm) return;
    await runAutoDownload();
  });

  async function uploadBookmarks(notify: boolean = true) {
    try {
      let setting = await Setting.build()
      if (setting.githubToken == '') {
        throw new Error("Gist Token Not Found");
      }
      if (setting.gistID == '') {
        throw new Error("Gist ID Not Found");
      }
      if (setting.gistFileName == '') {
        throw new Error("Gist File Not Found");
      }
      let bookmarks = await getBookmarks();
      let syncdata = new SyncDataInfo();
      syncdata.version = browser.runtime.getManifest().version;
      syncdata.createDate = Date.now();
      syncdata.bookmarks = formatBookmarks(bookmarks);
      syncdata.browser = navigator.userAgent;
      await BookmarkService.update({
        files: {
          [setting.gistFileName]: {
            content: JSON.stringify(syncdata)
          }
        },
        description: setting.gistFileName
      });
      const count = getBookmarkCount(syncdata.bookmarks);
      await browser.storage.local.set({ remoteCount: count });
      if (notify && setting.enableNotify) {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('uploadBookmarks'),
          message: browser.i18n.getMessage('success')
        });
      }

    }
    catch (error: any) {
      console.error(error);
      if (notify) {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('uploadBookmarks'),
          message: `${browser.i18n.getMessage('error')}：${error.message}`
        });
      }
    }
  }
  async function scheduleAutoSync() {
    if (curOperType !== OperType.NONE) return; // respect manual operations
    if (isAutoSyncing) return; // avoid re-scheduling during active sync
    if (Date.now() < blockAutoSyncUntil) return; // temporary block around manual ops
    const setting = await Setting.build();
    if (!setting.autoSyncEnabled) return; // gated by user setting
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(async () => {
      await runAutoSync();
    }, autoSyncDelayMs);
  }
  async function runAutoSync() {
    if (isAutoSyncing) return;
    if (curOperType !== OperType.NONE) return; // don't run during manual upload/download/remove
    if (Date.now() < blockAutoSyncUntil) return; // still within temporary block
    isAutoSyncing = true;
    // Temporarily mark as SYNC to prevent any incidental handlers
    const prevOper = curOperType;
    curOperType = OperType.SYNC;
    try {
      await uploadBookmarks(false); // silent auto-sync
    } finally {
      curOperType = prevOper === OperType.NONE ? OperType.NONE : prevOper;
      isAutoSyncing = false;
      browser.action.setBadgeText({ text: "" });
    }
  }
  async function initAutoDownload() {
    try {
      const setting = await Setting.build();
      // Only proceed if configured to prevent noisy errors
      if (!setting.githubToken || !setting.gistID || !setting.gistFileName) return;
      // Immediate one-time download on load/startup
      await runAutoDownload();
      // Ensure a 1-minute periodic alarm is set
      try { await browser.alarms.clear(periodicDownloadAlarm); } catch { /* ignore */ }
      await browser.alarms.create(periodicDownloadAlarm, { delayInMinutes: 1, periodInMinutes: 1 });
    } catch (e) {
      // Swallow init errors to avoid breaking background script
      console.debug('initAutoDownload skipped:', e);
    }
  }
  async function runAutoDownload() {
    if (isAutoDownloading) return;
    if (curOperType !== OperType.NONE) return; // don't run during manual ops
    if (Date.now() < blockAutoSyncUntil) return; // respect temporary block around manual ops
    // Validate settings before attempting network calls to avoid repeated notifications
    const setting = await Setting.build();
    if (!setting.githubToken || !setting.gistID || !setting.gistFileName) return;
    isAutoDownloading = true;
    const prevOper = curOperType;
    curOperType = OperType.SYNC; // suppress bookmark change handlers during import
    try {
      await downloadBookmarks();
      await refreshLocalCount();
      browser.action.setBadgeText({ text: "" });
    } catch (err) {
      console.error('Auto download failed:', err);
    } finally {
      curOperType = prevOper === OperType.NONE ? OperType.NONE : prevOper;
      isAutoDownloading = false;
    }
  }
  async function downloadBookmarks() {
    try {
      let gist = await BookmarkService.get();
      let setting = await Setting.build()
      if (gist) {
        let syncdata: SyncDataInfo = JSON.parse(gist);
        if (syncdata.bookmarks == undefined || syncdata.bookmarks.length == 0) {
          if (setting.enableNotify) {
            await browser.notifications.create({
              type: "basic",
              iconUrl: iconLogo,
              title: browser.i18n.getMessage('downloadBookmarks'),
              message: `${browser.i18n.getMessage('error')}：Gist File ${setting.gistFileName} is NULL`
            });
          }
          return;
        }
        await clearBookmarkTree();
        await createBookmarkTree(syncdata.bookmarks);
        const count = getBookmarkCount(syncdata.bookmarks);
        await browser.storage.local.set({ remoteCount: count });
        if (setting.enableNotify) {
          await browser.notifications.create({
            type: "basic",
            iconUrl: iconLogo,
            title: browser.i18n.getMessage('downloadBookmarks'),
            message: browser.i18n.getMessage('success')
          });
        }
      }
      else {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('downloadBookmarks'),
          message: `${browser.i18n.getMessage('error')}：Gist File ${setting.gistFileName} Not Found`
        });
      }
    }
    catch (error: any) {
      console.error(error);
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: browser.i18n.getMessage('downloadBookmarks'),
        message: `${browser.i18n.getMessage('error')}：${error.message}`
      });
    }
  }

  async function getBookmarks() {
    let bookmarkTree: BookmarkInfo[] = await browser.bookmarks.getTree();
    if (bookmarkTree && bookmarkTree[0].id === "root________") {
      curBrowserType = BrowserType.FIREFOX;
    }
    else {
      curBrowserType = BrowserType.CHROME;
    }
    return bookmarkTree;
  }

  async function clearBookmarkTree() {
    try {
      let setting = await Setting.build()
      if (setting.githubToken == '') {
        throw new Error("Gist Token Not Found");
      }
      if (setting.gistID == '') {
        throw new Error("Gist ID Not Found");
      }
      if (setting.gistFileName == '') {
        throw new Error("Gist File Not Found");
      }
      let bookmarks = await getBookmarks();
      let tempNodes: BookmarkInfo[] = [];
      bookmarks[0].children?.forEach(c => {
        c.children?.forEach(d => {
          tempNodes.push(d)
        })
      });
      if (tempNodes.length > 0) {
        for (let node of tempNodes) {
          if (node.id) {
            await browser.bookmarks.removeTree(node.id)
          }
        }
      }
      if (curOperType === OperType.REMOVE && setting.enableNotify) {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('removeAllBookmarks'),
          message: browser.i18n.getMessage('success')
        });
      }
    }
    catch (error: any) {
      console.error(error);
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: browser.i18n.getMessage('removeAllBookmarks'),
        message: `${browser.i18n.getMessage('error')}：${error.message}`
      });
    }
  }

  async function createBookmarkTree(bookmarkList: BookmarkInfo[] | undefined) {
    if (!bookmarkList) return;
    // global created cache keyed by parentPath + key(title/url)
    const created = new Set<string>();
    const tasks: Array<Promise<void>> = [];
    for (const node of bookmarkList) {
      if (
        node.title == RootBookmarksType.MenuFolder ||
        node.title == RootBookmarksType.MobileFolder ||
        node.title == RootBookmarksType.ToolbarFolder ||
        node.title == RootBookmarksType.UnfiledFolder
      ) {
        const parentId = mapRootToTarget(node.title);
        tasks.push(processChildren(parentId, node.children, `/${parentId}`, created));
      }
    }
    for (const t of tasks) await t;
  }

  function normalizeTitle(title?: string) {
    return (title ?? '').trim().toLowerCase();
  }
  function makeKey(node: { title?: string; url?: string }) {
    if (node.url) return `B::${node.url}`; // dedupe by URL within same parent
    return `F::${normalizeTitle(node.title)}`; // folders dedupe by normalized title
  }

  function mapRootToTarget(title: string): string {
    if (curBrowserType == BrowserType.FIREFOX) {
      switch (title) {
        case RootBookmarksType.MenuFolder: return "menu________";
        case RootBookmarksType.MobileFolder: return "mobile______";
        case RootBookmarksType.ToolbarFolder: return "toolbar_____";
        case RootBookmarksType.UnfiledFolder: default: return "unfiled_____";
      }
    } else {
      switch (title) {
        case RootBookmarksType.MobileFolder: return "3";
        case RootBookmarksType.ToolbarFolder: return "1";
        case RootBookmarksType.UnfiledFolder:
        case RootBookmarksType.MenuFolder:
        default: return "2";
      }
    }
  }

  async function processChildren(parentId: string, children: BookmarkInfo[] | undefined, parentPath: string, created: Set<string>) {
    if (!children || children.length === 0) return;
    let existing: Bookmarks.BookmarkTreeNode[] = [];
    try {
      existing = await browser.bookmarks.getChildren(parentId);
    } catch { existing = []; }
    const existingMap = new Map<string, Bookmarks.BookmarkTreeNode>();
    for (const c of existing) {
      existingMap.set(makeKey(c), c);
    }
    for (const node of children) {
      const key = `${parentPath}|${makeKey(node)}`;
      if (created.has(key)) {
        // already created in this import run under this parentPath
        continue;
      }
      const lookupKey = makeKey(node);
      let res: Bookmarks.BookmarkTreeNode | undefined = existingMap.get(lookupKey);
      if (!res) {
        try {
          res = await browser.bookmarks.create({
            parentId,
            title: node.title,
            url: node.url,
          });
          if (res) existingMap.set(lookupKey, res);
          created.add(key);
        } catch (err) {
          console.error(err);
        }
      } else {
        created.add(key);
      }
      if (res && node.children && node.children.length > 0) {
        await processChildren(res.id!, node.children, `${parentPath}/${normalizeTitle(node.title)}`, created);
      }
    }
  }

  function getBookmarkCount(bookmarkList: BookmarkInfo[] | undefined) {
    let count = 0;
    if (bookmarkList) {
      bookmarkList.forEach(c => {
        if (c.url) {
          count = count + 1;
        }
        else {
          count = count + getBookmarkCount(c.children);
        }
      });
    }
    return count;
  }

  async function refreshLocalCount() {
    let bookmarkList = await getBookmarks();
    const count = getBookmarkCount(bookmarkList);
    await browser.storage.local.set({ localCount: count });
  }


  function formatBookmarks(bookmarks: BookmarkInfo[]): BookmarkInfo[] | undefined {
    if (bookmarks[0].children) {
      for (let a of bookmarks[0].children) {
        switch (a.id) {
          case "1":
          case "toolbar_____":
            a.title = RootBookmarksType.ToolbarFolder;
            break;
          case "menu________":
            a.title = RootBookmarksType.MenuFolder;
            break;
          case "2":
          case "unfiled_____":
            a.title = RootBookmarksType.UnfiledFolder;
            break;
          case "3":
          case "mobile______":
            a.title = RootBookmarksType.MobileFolder;
            break;
        }
      }
    }

    let a = format(bookmarks[0]);
    return a.children;
  }

  function format(b: BookmarkInfo): BookmarkInfo {
    b.dateAdded = undefined;
    b.dateGroupModified = undefined;
    b.id = undefined;
    b.index = undefined;
    b.parentId = undefined;
    b.type = undefined;
    b.unmodifiable = undefined;
    if (b.children && b.children.length > 0) {
      b.children?.map(c => format(c))
    }
    return b;
  }
  ///暂时不启用自动备份
  /*
  async function backupToLocalStorage(bookmarks: BookmarkInfo[]) {
      try {
          let syncdata = new SyncDataInfo();
          syncdata.version = browser.runtime.getManifest().version;
          syncdata.createDate = Date.now();
          syncdata.bookmarks = formatBookmarks(bookmarks);
          syncdata.browser = navigator.userAgent;
          const keyname = 'BookmarkHub_backup_' + Date.now().toString();
          await browser.storage.local.set({ [keyname]: JSON.stringify(syncdata) });
      }
      catch (error:any) {
          console.error(error)
      }
  }
  */

});
