/**
 * 版本迁移。
 *
 * 规则：
 *  1. 每个 migration 只处理"从 n 升到 n+1"，不跳级。
 *  2. 迁移函数必须是纯函数，返回新对象，不改入参。
 *  3. 无法识别的版本一律抛 SchemaError，绝不静默清空用户数据。
 *
 * 当前状态：
 *   SCHEMA_VERSION === 2。v1 → v2（mergePhoneAccountsIntoMessages）是第一个
 *   真实迁移：把旧的独立 phone 账号并进同角色的 messages 账号。
 *   再出现新格式时，往 MIGRATIONS 加一条并补一条迁移测试即可，框架不用改。
 */

import { SCHEMA_VERSION } from '../constants/defaults.js'
import { SchemaError } from '../schema/errors.js'

function mergePhoneAccountsIntoMessages(project) {
  const accounts = (project.platformAccounts ?? []).map((a) => ({ ...a }))
  const messagesByCharacter = new Map()
  for (const account of accounts) {
    if (account.platform === 'messages') {
      messagesByCharacter.set(account.characterId, account)
    }
  }
  const merged = []
  for (const account of accounts) {
    if (account.platform === 'phone') {
      const target = messagesByCharacter.get(account.characterId)
      if (target) {
        for (const key of ['displayName', 'handle', 'avatarAssetId', 'bio', 'phoneNumber', 'note']) {
          const value = account[key]
          if (target[key] == null || target[key] === '') target[key] = value ?? (key === 'avatarAssetId' ? null : '')
        }
        continue
      }
      account.platform = 'messages' // 只有电话账号的角色：整体改挂信息平台
    }
    merged.push(account)
  }
  return { ...project, platformAccounts: merged, schemaVersion: 2 }
}

/**
 * @type {Record<number, (project: object) => object>}
 * key = 源版本，函数把 n 版本升到 n+1
 */
const MIGRATIONS = {
  1: mergePhoneAccountsIntoMessages,
}

/**
 * 把项目数据升到当前 schema 版本。
 *
 * @param {object} project
 * @param {object} [options] 仅测试使用，生产代码不要传
 * @param {number} [options.targetVersion] 目标版本，默认取 SCHEMA_VERSION
 * @param {Record<number, Function>} [options.migrations] 迁移表，默认取内置的
 * @returns {object} 迁移后的新对象（版本已是最新时原样返回）
 * @throws {SchemaError}
 */
export function migrateProject(project, options = {}) {
  if (!project || typeof project !== 'object') {
    throw new SchemaError('项目数据为空或格式不正确。')
  }

  const targetVersion = options.targetVersion ?? SCHEMA_VERSION
  const migrations = options.migrations ?? MIGRATIONS

  const from = project.schemaVersion
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new SchemaError(
      '项目数据缺少有效的版本号（schemaVersion），无法判断兼容性。该文件可能不是本工具导出的项目。',
    )
  }

  if (from > targetVersion) {
    throw new SchemaError(
      `项目版本为 v${from}，高于当前工具支持的 v${targetVersion}。请升级工具后再导入，直接导入可能丢失字段。`,
    )
  }

  let current = project
  let version = from
  while (version < targetVersion) {
    const step = migrations[version]
    if (!step) {
      throw new SchemaError(`缺少从 v${version} 到 v${version + 1} 的迁移规则。`)
    }
    current = step(current)
    version += 1
    if (current.schemaVersion !== version) {

      throw new SchemaError(`迁移规则 v${version - 1} → v${version} 未正确更新版本号。`)
    }
  }

  return current
}
