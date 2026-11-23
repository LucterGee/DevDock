const os = require('os');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(os.homedir(), '.devdock');

// 统一把配置收进 ~/.devdock；首次访问时把旧位置的同名文件迁移过来
const resolveConfigPath = (fileName, legacyName) => {
  const target = path.join(APP_DIR, fileName);
  if (!legacyName) return target;

  const legacy = path.join(os.homedir(), legacyName);
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return target;

  try {
    fs.mkdirSync(APP_DIR, { recursive: true });
    try {
      fs.renameSync(legacy, target);
    } catch (error) {
      // 跨设备等情况 rename 会失败，退回复制后删除
      fs.copyFileSync(legacy, target);
      fs.unlinkSync(legacy);
    }
  } catch (error) {
    // 迁移失败时保持旧文件可用，读取方仍能正常工作
    return legacy;
  }

  return target;
};

module.exports = { APP_DIR, resolveConfigPath };
