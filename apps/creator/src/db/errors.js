

import { StorageError } from '@phone-sim/shared'

export const STORAGE_ERROR_CODE = Object.freeze({
  QUOTA: 'storage_quota',
  UNAVAILABLE: 'storage_unavailable',
  CLOSED: 'storage_closed',
  CORRUPT: 'storage_corrupt',
  UNKNOWN: 'storage_unknown',
  /** 多标签页：本页已不是该项目的锁持有者，写入必须被拒 */
  LOCK_LOST: 'lock_lost',
})

/**
 * 拿不到编辑权时的错误。
 *
 * 单列一个构造器，是因为这条错误的行为与"磁盘写失败"不同：
 * 它不会因重试而好转（重试一万次也还是没锁），必须引导用户走"另存为副本"。
 *
 * 但 `lock_unreadable` 是例外 —— 那是"暂时读不到锁状态"，重试是有意义的。
 * 两种情况的文案必须分开：说错了会让用户以为内容已经被抢走，白白另存一份。
 *
 * @param {string} [reason] not_owner | stale_fence | missing | lock_unreadable | guard_failed
 */
export function lockLostError(reason = 'unknown') {
  const unreadable = reason === 'lock_unreadable'
  const missing = reason === 'missing'
  const err = new StorageError(
    unreadable
      ? '暂时无法确认这个作品的编辑权，本次修改没有保存。稍后重试即可。'
      : missing
        ? '项目已删除或编辑锁已失效，本页的修改没有写入。可以把它另存为新项目，以免丢失。'
        : '该项目已在另一个标签页被接管，本页的修改不会再保存。可以把它另存为新项目，以免丢失。',
    STORAGE_ERROR_CODE.LOCK_LOST,
  )
  err.lockReason = reason
  return err
}

/**
 * @param {unknown} err
 * @param {number} [usedBytes] 用于配额提示的已用量（可选）
 * @returns {StorageError}
 */
export function toStorageError(err, usedBytes = null) {
  // 已经是可读错误，原样返回
  if (err instanceof StorageError) return err

  const name = err?.name ?? ''
  const message = String(err?.message ?? '')

  if (name === 'LockLostError') return lockLostError(err?.lockReason)

  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(message)) {
    const used = usedBytes != null ? `当前已用约 ${formatMB(usedBytes)}。` : ''
    return new StorageError(
      `浏览器存储空间不足，本次保存失败。${used}可以试试：删除不用的项目、把图片改成压缩模式，或者先导出项目备份再清理。`,
      STORAGE_ERROR_CODE.QUOTA,
      err,
    )
  }

  if (name === 'InvalidStateError' || /closed/i.test(message)) {
    return new StorageError(
      '数据库连接已失效（可能在另一个标签页升级过）。请刷新页面后重试。',
      STORAGE_ERROR_CODE.CLOSED,
      err,
    )
  }

  if (name === 'VersionError') {
    return new StorageError(
      '浏览器里存有更新版本的数据库，当前页面版本较旧。请刷新页面。',
      STORAGE_ERROR_CODE.CLOSED,
      err,
    )
  }

  if (name === 'DataError' || name === 'DataCloneError') {
    return new StorageError(
      '要保存的数据里有无法存储的内容（例如函数或 DOM 节点），这是程序缺陷，请联系开发者。',
      STORAGE_ERROR_CODE.CORRUPT,
      err,
    )
  }

  if (name === 'SecurityError' || name === 'NotAllowedError' || name === 'UnknownError') {
    return new StorageError(
      '浏览器拒绝了本地存储访问。可能处于隐私模式，或站点数据被禁用。请检查浏览器设置后重试。',
      STORAGE_ERROR_CODE.UNAVAILABLE,
      err,
    )
  }

  return new StorageError(`保存到本地数据库失败：${message || '未知错误'}`, STORAGE_ERROR_CODE.UNKNOWN, err)
}

/** 判定是否值得自动重试一次（连接失效类可以，配额类不能） */
export function isRetryable(err) {
  const code = err?.code ?? ''
  return code === STORAGE_ERROR_CODE.CLOSED
}

export function formatMB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}
