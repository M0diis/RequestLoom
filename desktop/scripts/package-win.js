const path = require('path');
const packager = require('electron-packager');

const appName = process.env.ELECTRON_APP_NAME || 'RequestLoom-Desktop';
const arch = process.env.ELECTRON_ARCH || 'x64';
const electronZipDir = process.env.ELECTRON_ZIP_DIR || undefined;
// When packaging from WSL, the default temp dir (/tmp) is on the WSL
// filesystem, which Windows binaries like rcedit.exe cannot access. Point it
// at a Windows-visible path (e.g. a /mnt/... dir) via ELECTRON_TMPDIR.
const tmpdir = process.env.ELECTRON_TMPDIR || undefined;

const download = {};
if (process.env.ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED) {
  download.rejectUnauthorized = process.env.ELECTRON_DOWNLOAD_REJECT_UNAUTHORIZED !== 'false';
}
if (process.env.ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS) {
  download.unsafelyDisableChecksums = process.env.ELECTRON_DOWNLOAD_DISABLE_CHECKSUMS === 'true';
}
if (process.env.ELECTRON_DOWNLOAD_CACHE_ROOT) {
  download.cacheRoot = process.env.ELECTRON_DOWNLOAD_CACHE_ROOT;
}
if (process.env.ELECTRON_MIRROR) {
  download.mirrorOptions = {
    mirror: process.env.ELECTRON_MIRROR,
  };
}

(async () => {
  try {
    if (electronZipDir) {
      console.log(`Using local Electron ZIP directory: ${electronZipDir}`);
    }

    await packager({
      dir: path.resolve(__dirname, '..'),
      out: path.resolve(__dirname, '..', 'dist'),
      overwrite: true,
      prune: true,
      asar: false,
      platform: 'win32',
      arch,
      name: appName,
      executableName: appName,
      appVersion: '1.0.0',
      tmpdir,
      electronZipDir,
      download: Object.keys(download).length > 0 ? download : undefined,
      ignore: [
        /^\/dist($|\/)/,
      ],
    });

    console.log(`Electron package created for win32-${arch}`);
  } catch (err) {
    console.error('Failed to package desktop app:', err);
    process.exit(1);
  }
})();
