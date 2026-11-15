/**
 * 「应用设定」——作品级、按应用划分的设置。
 *
 * 创作台 `SettingsView.vue` 的「应用设定」区块写进 workSettings.appSettings，
 * 作品端两个应用各自消费：
 *   · 照片 PhotoApp.vue   → photoLocks（打开「已隐藏」/「最近删除」前先校验密码）
 *   · 设置 SettingsApp.vue → wifiName（Wi-Fi 行右侧的名字，替代旧死值）
 *
 * 和锁屏密码同属一类「剧情道具」：不是安全凭据，作品数据就在页面里。
 * 因此不做哈希，只沿用那条安全约定 —— **开关关闭时不把密码串带进作品数据**，
 * 免得作者关掉锁之后，旧密码还明文躺在导出的 JSON 里。
 * 创作台项目里仍保留已输入的密码（关掉再打开不该白输一遍），裁剪只发生在 toWorkData。
 */

/** 没填 Wi-Fi 名称时的兜底：与作品端旧静态值一致，旧作品不会变样 */
export const DEFAULT_WIFI_NAME = 'HOME-2.4G'

/** 两把锁的稳定键名，同时也是「哪本相簿」的判别依据 */
export const PHOTO_LOCK_KINDS = Object.freeze(['hidden', 'trash'])

/** Wi-Fi 名称最长字数：iOS 的 SSID 上限是 32 字节，这里留一点余量给中文 */
export const WIFI_NAME_MAX_LENGTH = 32

/** 每次都返回全新对象：DEFAULT_WORK_SETTINGS 只是浅冻结 */
export function createDefaultAppSettings() {
  return {
    photoLocks: {
      hidden: { enabled: false, length: 4, passcode: '' },
      trash: { enabled: false, length: 4, passcode: '' },
    },
    wifiName: '',
  }
}

function normalizeLock(raw) {
  const length = Number(raw?.length) === 6 ? 6 : 4
  const enabled = Boolean(raw?.enabled)
  const digits = String(raw?.passcode ?? '').replace(/\D/g, '').slice(0, length)
  return {
    enabled,
    length,
    passcode: enabled ? digits : '',
  }
}

/**
 * 作品数据裁剪器用的归一化：脏值一律收敛成可用结构，
 * 未知字段直接丢掉（work 是纯 JSON，不该夹带编辑态草稿）。
 */
export function normalizeAppSettings(raw) {
  const locks = raw?.photoLocks ?? {}
  const wifiName = typeof raw?.wifiName === 'string'
    ? raw.wifiName.trim().slice(0, WIFI_NAME_MAX_LENGTH)
    : ''
  return {
    photoLocks: {
      hidden: normalizeLock(locks.hidden),
      trash: normalizeLock(locks.trash),
    },
    wifiName,
  }
}

/**
 * 作品端：某本内置相簿此刻是否真的需要密码。
 *
 * 开关开着但密码没填满 = **不上锁**。这条兜底和锁屏 `requestUnlock` 同源：
 * 否则作者勾了开关却只输了 2 位，读者会撞上「怎么输都进不去」的死局。
 *
 * @param {object} workSettings 作品数据里的 workSettings（已归一化，也容忍缺字段）
 * @param {'hidden'|'trash'} kind
 */
export function resolvePhotoLock(workSettings, kind) {
  const lock = normalizeAppSettings(workSettings?.appSettings).photoLocks[kind]
  if (!lock) return { enabled: false, length: 4, passcode: '', active: false }
  return {
    ...lock,
    active: lock.enabled && lock.passcode.length === lock.length,
  }
}

/** 作品端：设置应用 Wi-Fi 行显示的名字；留空回退到旧静态值 */
export function resolveWifiName(workSettings) {
  const name = String(workSettings?.appSettings?.wifiName ?? '').trim()
  return name || DEFAULT_WIFI_NAME
}
