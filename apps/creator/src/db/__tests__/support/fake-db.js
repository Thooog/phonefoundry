/**
 * 测试辅助：每个用例一个干净的数据库。
 *
 * 不用 beforeEach 清表，而是每个用例自己 deleteDatabase + 重建 ——
 * 这样能顺带验证"首次建表"路径，也避免用例之间通过 IDB 互相污染。
 */

import { deleteDatabase } from '../../connection.js'

/** 生成一段确定性的假二进制，便于断言大小 */
export function makeBlob(size = 128, fill = 'a') {
  return new Blob([fill.repeat(size)], { type: 'image/webp' })
}

/**
 * 清空并重建数据库。
 * 所有 db 层测试在 beforeEach 里调用它。
 */
export async function resetDatabase() {
  await deleteDatabase()
}
