/**
 * 可读错误类型。
 *
 * 所有面向用户的错误都带中文 message，调用方直接把 message 塞进 Toast 即可，
 * 不需要在 UI 层再翻译一遍。
 */

export class AppError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code = 'app_error', cause = null) {
    super(message)
    this.name = 'AppError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export class SchemaError extends AppError {
  constructor(message, code = 'schema_error') {
    super(message, code)
    this.name = 'SchemaError'
  }
}

export class StorageError extends AppError {
  constructor(message, code = 'storage_error', cause = null) {
    super(message, code, cause)
    this.name = 'StorageError'
  }
}

export class ExportError extends AppError {
  constructor(message, code = 'export_error', cause = null) {
    super(message, code, cause)
    this.name = 'ExportError'
  }
}

/** 把任意抛出物转成可读文案 */
export function toReadableMessage(err, fallback = '发生未知错误。') {
  if (!err) return fallback
  if (err instanceof AppError) return err.message
  if (typeof err === 'string') return err
  if (err.message) return err.message
  return fallback
}
