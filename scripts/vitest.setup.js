/**
 * vitest 全局准备。
 *
 * 只做一件事：给 Node 环境装上 IndexedDB 实现。
 * 这是测试基础设施，不进任何生产产物。
 */

import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'

// Node 18+ 自带 Blob，但部分环境下全局没有，兜一下
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = NodeBlob
}

// fake-indexeddb 的结构化克隆不支持 File，测试里统一用 Blob
