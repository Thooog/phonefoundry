

import fs from 'node:fs'

/** 导航切换瞬间，evaluate 可能抛「执行上下文已销毁」—— 属正常现象，忽略重试 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function reloadAndWait(ctx, expression, label, timeoutMs = 15000) {
  // 1. 在旧文档上打标记。新文档是全新的 window，它不存在。
  await ctx.evaluate(`window.__probeDocStamp = String(Date.now()), true`)

  // 2. 触发导航
  await ctx.reload()

  // 3. 等「新文档」与「目标条件」同时成立
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    let ok = false
    try {
      ok = await ctx.evaluate(
        `typeof window.__probeDocStamp === 'undefined' && Boolean(${expression})`,
      )
    } catch (err) {
      // 导航切换期间 evaluate 可能失败，那是过渡态，不是真失败
      lastError = err
    }
    if (ok) return true
    await sleep(150)
  }
  throw new Error(
    `等待超时：${label}` + (lastError ? `（最后一次求值失败：${lastError.message}）` : ''),
  )
}

export async function removeTempDir(dir, { retries = 6, delayMs = 250 } = {}) {
  if (!dir) return false
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    } catch (err) {
      const retriable = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY'
      if (!retriable) return false
      await sleep(delayMs)
    }
  }
  console.log(`  （临时目录仍被占用，跳过删除：${dir}）`)
  return false
}
