const os = require('os');
const path = require('path');

// 用户输入的路径可能带 ~，统一在这里展开成绝对路径
const expandHome = (value) => {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
};

// 把 home 目录前缀换成 ~，仅用于界面展示
const toDisplayPath = (value) => {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';

  const home = os.homedir();
  if (raw === home) return '~';
  if (!raw.startsWith(home + path.sep) && !raw.startsWith(home + '/')) return raw;

  return '~/' + raw.slice(home.length + 1).split(path.sep).join('/');
};

module.exports = { expandHome, toDisplayPath };
