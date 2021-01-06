import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, Settings, shell } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as admZip from "adm-zip";
import * as pLimit from "p-limit";
import * as nodeDiskInfo from "node-disk-info";
import { map } from "lodash";
import { readdir } from "fs";
import axios from "axios";
import * as log from "electron-log";

import {
  LIST_DIRECTORIES_CHANNEL,
  SHOW_DIRECTORY,
  PATH_EXISTS_CHANNEL,
  CURSE_GET_SCAN_RESULTS,
  WOWUP_GET_SCAN_RESULTS,
  UNZIP_FILE_CHANNEL,
  COPY_FILE_CHANNEL,
  DELETE_DIRECTORY_CHANNEL,
  READ_FILE_CHANNEL,
  WRITE_FILE_CHANNEL,
  GET_ASSET_FILE_PATH,
  DOWNLOAD_FILE_CHANNEL,
  CREATE_DIRECTORY_CHANNEL,
  STAT_FILES_CHANNEL,
  CREATE_TRAY_MENU_CHANNEL,
  LIST_DISKS_WIN32,
  CREATE_APP_MENU_CHANNEL,
  MINIMIZE_WINDOW,
  MAXIMIZE_WINDOW,
  CLOSE_WINDOW,
  RESTART_APP,
  QUIT_APP,
} from "./src/common/constants";
import { CurseScanResult } from "./src/common/curse/curse-scan-result";
import { CurseFolderScanner } from "./src/common/curse/curse-folder-scanner";

import { WowUpFolderScanner } from "./src/common/wowup/wowup-folder-scanner";
import { WowUpScanResult } from "./src/common/wowup/wowup-scan-result";
import { UnzipRequest } from "./src/common/models/unzip-request";
import { CopyFileRequest } from "./src/common/models/copy-file-request";
import { DownloadStatus } from "./src/common/models/download-status";
import { DownloadStatusType } from "./src/common/models/download-status-type";
import { DownloadRequest } from "./src/common/models/download-request";
import { SystemTrayConfig } from "./src/common/wowup/system-tray-config";
import { MenuConfig } from "./src/common/wowup/menu-config";
import { createTray } from "./system-tray";
import { createAppMenu } from "./app-menu";
import { RendererChannels } from "./src/common/wowup";

function handle(
  channel: RendererChannels,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<void> | any
) {
  ipcMain.handle(channel, listener);
}

export function initializeIpcHandlers(window: BrowserWindow) {
  handle(
    SHOW_DIRECTORY,
    async (evt, filePath: string): Promise<string> => {
      return await shell.openPath(filePath);
    }
  );

  handle(GET_ASSET_FILE_PATH, async (evt, fileName: string) => {
    return path.join(__dirname, "assets", fileName);
  });

  handle(
    CREATE_DIRECTORY_CHANNEL,
    async (evt, directoryPath: string): Promise<boolean> => {
      await fs.ensureDir(directoryPath);
      return true;
    }
  );

  handle("get-zoom-factor", (evt) => {
    return window?.webContents?.getZoomFactor();
  });

  handle("set-zoom-limits", (evt, minimumLevel: number, maximumLevel: number) => {
    return window.webContents?.setVisualZoomLevelLimits(minimumLevel, maximumLevel);
  });

  handle("set-zoom-factor", (evt, zoomFactor: number) => {
    if (window?.webContents) {
      window.webContents.zoomFactor = zoomFactor;
    }
  });

  handle("get-app-version", () => {
    return app.getVersion();
  });

  handle("get-locale", async () => {
    return `${app.getLocale()}`;
  });

  handle("get-launch-args", () => {
    return process.argv;
  });

  handle("get-login-item-settings", () => {
    return app.getLoginItemSettings();
  });

  handle("set-login-item-settings", (evt, settings: Settings) => {
    return app.setLoginItemSettings(settings);
  });

  handle(LIST_DIRECTORIES_CHANNEL, (evt, filePath: string) => {
    return new Promise((resolve, reject) => {
      readdir(filePath, { withFileTypes: true }, (err, files) => {
        if (err) {
          return reject(err);
        }

        const directories = files.filter((file) => file.isDirectory()).map((file) => file.name);

        resolve(directories);
      });
    });
  });

  handle(STAT_FILES_CHANNEL, async (evt, filePaths: string[]) => {
    const results: { [path: string]: fs.Stats } = {};
    const limit = pLimit(3);
    const tasks = map(filePaths, (path) =>
      limit(async () => {
        const stats = await fs.stat(path);
        return { path, stats };
      })
    );

    const taskResults = await Promise.all(tasks);
    taskResults.forEach((r) => (results[r.path] = r.stats));

    return results;
  });

  handle(PATH_EXISTS_CHANNEL, async (evt, filePath: string) => {
    try {
      await fs.access(filePath);
    } catch (e) {
      if (e.code !== "ENOENT") {
        log.error(e);
      }
      return false;
    }

    return true;
  });

  handle(
    CURSE_GET_SCAN_RESULTS,
    async (evt, filePaths: string[]): Promise<CurseScanResult[]> => {
      // Scan addon folders in parallel for speed!?
      try {
        const limit = pLimit(2);
        const tasks = map(filePaths, (folder) => limit(() => new CurseFolderScanner().scanFolder(folder)));
        return await Promise.all(tasks);
      } catch (e) {
        log.error("Failed during curse scan", e);
        throw e;
      }
    }
  );

  handle(
    WOWUP_GET_SCAN_RESULTS,
    async (evt, filePaths: string[]): Promise<WowUpScanResult[]> => {
      const limit = pLimit(2);
      const tasks = map(filePaths, (folder) => limit(() => new WowUpFolderScanner(folder).scanFolder()));
      return await Promise.all(tasks);
    }
  );

  handle(UNZIP_FILE_CHANNEL, async (evt, arg: UnzipRequest) => {
    const zip = new admZip(arg.zipFilePath);
    await new Promise((resolve, reject) => {
      zip.extractAllToAsync(arg.outputFolder, true, (err) => {
        return err ? reject(err) : resolve(true);
      });
    });

    return arg.outputFolder;
  });

  handle(
    COPY_FILE_CHANNEL,
    async (evt, arg: CopyFileRequest): Promise<boolean> => {
      await fs.copy(arg.sourceFilePath, arg.destinationFilePath);
      return true;
    }
  );

  handle(DELETE_DIRECTORY_CHANNEL, async (evt, filePath: string) => {
    await fs.remove(filePath);

    return true;
  });

  handle(READ_FILE_CHANNEL, async (evt, filePath: string) => {
    return await fs.readFile(filePath, { encoding: "utf-8" });
  });

  handle(WRITE_FILE_CHANNEL, async (evt, filePath: string, contents: string) => {
    return await fs.writeFile(filePath, contents, { encoding: "utf-8" });
  });

  handle(CREATE_TRAY_MENU_CHANNEL, async (evt, config: SystemTrayConfig) => {
    return createTray(window, config);
  });

  handle(CREATE_APP_MENU_CHANNEL, async (evt, config: MenuConfig) => {
    return createAppMenu(window, config);
  });

  handle(MINIMIZE_WINDOW, () => {
    if (window?.minimizable) {
      window.minimize();
    }
  });

  handle(MAXIMIZE_WINDOW, () => {
    if (window?.maximizable) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  handle(CLOSE_WINDOW, () => {
    window?.close();
  });

  handle(RESTART_APP, () => {
    app.relaunch();
    app.quit();
  });

  handle(QUIT_APP, () => {
    app.quit();
  });

  handle(LIST_DISKS_WIN32, async (evt, config: SystemTrayConfig) => {
    const diskInfos = await nodeDiskInfo.getDiskInfo();
    // Cant pass complex objects over the wire, make them simple
    return diskInfos.map((di) => {
      return {
        mounted: di.mounted,
        filesystem: di.filesystem,
      };
    });
  });

  ipcMain.on(DOWNLOAD_FILE_CHANNEL, async (evt, arg: DownloadRequest) => {
    try {
      const savePath = path.join(arg.outputFolder, arg.fileName);

      const { data, headers } = await axios({
        url: arg.url,
        method: "GET",
        responseType: "stream",
      });

      // const totalLength = headers["content-length"];
      // Progress is not shown anywhere
      // data.on("data", (chunk) => {
      //   log.info("DLPROG", arg.responseKey);
      // });

      const writer = fs.createWriteStream(savePath);
      data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      const status: DownloadStatus = {
        type: DownloadStatusType.Complete,
        savePath,
      };
      window.webContents.send(arg.responseKey, status);
    } catch (err) {
      log.error(err);
      const status: DownloadStatus = {
        type: DownloadStatusType.Error,
        error: err,
      };
      window.webContents.send(arg.responseKey, status);
    }
  });
}
