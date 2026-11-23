const { execFileSync } = require('child_process');
const path = require('path');

// electron-builder 在没有证书时产出的签名 identifier 是 "Electron"，
// Info.plist 也未绑定，codesign --verify 会失败，导致 macOS 通知中心
// 不认这个应用（系统设置里看不到，通知也发不出来）。
// 这里用正确的 bundle id 重新做一次 ad-hoc 签名。
exports.default = async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    context.packager.appInfo.productFilename + '.app'
  );
  const appId = context.packager.appInfo.id;

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', appId, appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  console.log('[afterSign] 已用 ' + appId + ' 重新签名并通过校验');
};
