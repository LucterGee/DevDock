const {
  isAvailable,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  setMemorySecret,
  getMemorySecret,
  clearMemorySecret,
} = require('./secretStore');

// 读取：优先解密；无法解密时回落到本次运行内存中的临时值
const openAiConfigList = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const stored = String((item && item.apiKey) || '');
    const plain = decryptSecret(stored) || getMemorySecret(item && item.id);
    return { ...item, apiKey: plain };
  });
};

// 保存：
// - 可加密：正常写入密文，清空则擦除
// - 不可加密：新密钥只留内存；磁盘上的原值保持不动，
//   否则前端读到的空值会把已有密钥误擦掉
const sealAiConfigList = (list, previousList = []) => {
  if (!Array.isArray(list)) return [];
  const previous = new Map(
    (Array.isArray(previousList) ? previousList : []).map((item) => [item && item.id, item])
  );

  return list.map((item) => {
    const id = item && item.id;
    const key = String((item && item.apiKey) || '').trim();
    const prevKey = String((previous.get(id) || {}).apiKey || '');

    if (!isAvailable()) {
      if (key) setMemorySecret(id, key);
      else clearMemorySecret(id);
      return { ...item, apiKey: prevKey };
    }

    clearMemorySecret(id);
    return { ...item, apiKey: key ? encryptSecret(key) : '' };
  });
};

// 启动时把历史明文密钥加密；不可加密时保持原样（读取时会被视为空）
const migratePlaintextSecrets = (list) => {
  if (!Array.isArray(list) || !isAvailable()) return { list, changed: false };
  let changed = false;
  const next = list.map((item) => {
    const stored = String((item && item.apiKey) || '');
    if (!stored || isEncrypted(stored)) return item;
    changed = true;
    return { ...item, apiKey: encryptSecret(stored) };
  });
  return { list: next, changed };
};

module.exports = { openAiConfigList, sealAiConfigList, migratePlaintextSecrets };
