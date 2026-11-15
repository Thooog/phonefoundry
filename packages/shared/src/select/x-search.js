import { buildFeed, formatCount } from './feed.js'

export function formatXTrendCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? `${formatCount(value)} 帖子` : ''
}

/** Empty metadata follows the current first row, including after reordering. */
export function buildXTrends(work) {
  const rows = Array.isArray(work?.appData?.x?.trends) ? work.appData.x.trends : []
  const first = rows[0] ?? {}
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    title: String(row.title ?? ''),
    category: String(row.category ?? '').trim() || String(first.category ?? '').trim(),
    region: String(row.region ?? '').trim() || String(first.region ?? '').trim(),
    countLabel: formatXTrendCount(row.postCount),
  }))
}

export function xSearchAccounts(work) {
  return (work?.platformAccounts ?? []).filter(account => account.platform === 'x').map(account => {
    const character = work?.characters?.find(row => row.id === account.characterId)
    return {
      accountId: account.id,
      characterId: character?.id ?? null,
      name: account.displayName || character?.name || '未命名账号',
      handle: String(account.handle ?? '').replace(/^@/, ''),
      avatarAssetId: account.avatarAssetId || character?.avatarAssetId || null,
    }
  })
}

export function buildXSearchHistory(work) {
  const accounts = xSearchAccounts(work)
  const rows = Array.isArray(work?.appData?.x?.searchHistory) ? work.appData.x.searchHistory : []
  return rows.flatMap(row => {
    if (row.type === 'account') {
      const account = accounts.find(item => item.accountId === row.accountId)
      return account?.characterId ? [{ ...row, ...account, title: account.name }] : []
    }
    return typeof row.title === 'string' && row.title.trim() ? [{ ...row, type: 'keyword' }] : []
  })
}

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()

/** Search only the authored work. The returned posts share the normal feed presentation. */
export function searchX(work, query, options = {}) {
  const needle = normalize(query).replace(/^[#@]/, '')
  if (!needle) return { posts: [], accounts: [] }
  return {
    posts: buildFeed(work ?? {}, 'x', options).filter(row =>
      normalize(`${row.content} ${row.authorName} ${row.authorHandle}`).includes(needle),
    ),
    accounts: xSearchAccounts(work).filter(row => row.characterId && normalize(`${row.name} ${row.handle}`).includes(needle)),
  }
}
