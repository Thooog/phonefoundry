/**
 * ID 生成。
 *
 * 不引 uuid 包：作品端产物必须零第三方依赖，且 ID 只需在单个项目内唯一。
 * 用时间戳前缀 + 随机后缀，保证同一毫秒内批量生成也不撞车。
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomSuffix(length) {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

/**
 * @param {string} prefix 实体前缀，如 'char' / 'conv' / 'msg'
 * @returns {string} 形如 char_lq3x8k_a7f2
 */
export function createId(prefix) {
  const time = Date.now().toString(36)
  return `${prefix}_${time}_${randomSuffix(4)}`
}

export const ID_PREFIX = Object.freeze({
  PROJECT: 'prj',
  CHARACTER: 'char',
  ACCOUNT: 'acct',
  ASSET: 'ast',
  CONVERSATION: 'conv',
  MESSAGE: 'msg',
  POST: 'post',
  COMMENT: 'cmt',
  CONTACT: 'contact',
  CALL: 'call',
  NOTE: 'note',
  PHOTO: 'photo',
  ALBUM: 'album',
  STORY: 'stry',
})
