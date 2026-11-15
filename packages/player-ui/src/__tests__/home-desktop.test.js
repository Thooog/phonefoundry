import { describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick } from 'vue'
import { DECORATIVE_APPS, createProject, importHomeApps, removeHomeItem } from '@phone-sim/shared'
import HomeDesktop from '../kernel/HomeDesktop.vue'

// HTML sanitization requires a browser DOM; this suite exercises the surrounding icon button.
vi.mock('../kernel/StaticHomeHtml.vue', () => ({ default: { render: () => h('iframe') } }))

// Render the real Vue components without a browser; retain their native event handlers.
function mount(work) {
  const node = type => ({ type, props: {}, children: [], parent: null })
  const renderer = createRenderer({
    createElement: node,
    createText: text => ({ ...node('text'), text }),
    createComment: text => ({ ...node('comment'), text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, previous, value) => { node.props[key] = value },
    insertStaticContent(content, parent, anchor) {
      const child = { ...node('static'), text: content, parent }
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
      return [child, child]
    },
    insert(child, parent, anchor = null) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
      child.parent = parent
    },
    remove(child) { child.parent?.children.splice(child.parent.children.indexOf(child), 1) },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const root = node('root')
  const opened = []
  const app = renderer.createApp({ render: () => h(HomeDesktop, { work, onOpen: id => opened.push(id) }) })
  app.mount(root)
  function find(testId, parent = root) {
    if (parent.props['data-testid'] === testId) return parent
    return parent.children.map(child => find(testId, child)).find(Boolean)
  }
  function all(parent = root) {
    return [parent, ...parent.children.flatMap(child => all(child))]
  }
  return { find, all, opened, unmount: () => app.unmount() }
}

describe('desktop interactions', () => {
  it('keeps empty apps pressable in the legacy desktop while only content apps and settings open', async () => {
    const work = createProject({ name: '空桌面' })
    work.appData.notes.notes.push({ id: 'note', title: '内容' })
    const view = mount(work)
    try {
      const empty = view.find('home-app-photos')
      expect(empty.type).toBe('button')
      empty.props.onKeydown({ key: 'Enter' })
      await nextTick()
      expect(empty.props.class).toContain('pui-home__app--pressed')
      empty.props.onClick()
      empty.props.onKeyup()
      expect(view.opened).toEqual([])
      view.find('home-app-notes').props.onClick()
      view.find('home-dock-settings').props.onClick()
      expect(view.opened).toEqual(['notes', 'settings'])
    } finally { view.unmount() }
  })

  it('renders custom layout decoration and HTML icons as pressable buttons with no navigation', async () => {
    const work = createProject({ name: '应用包' })
    work.workSettings.homeLayout = importHomeApps(work, DECORATIVE_APPS.map(app => app.id))
    work.workSettings.homeLayout.items.push({ id: 'custom', kind: 'html-app', name: '自定义', html: '<b>x</b>', area: 'grid', slot: 20 })
    work.workSettings.homeLayout = removeHomeItem(work, 'phone')
    const view = mount(work)
    try {
      expect(view.find('home-dock-phone')).toBeUndefined()
      for (const id of [...DECORATIVE_APPS.map(app => app.id), 'custom', 'photos']) {
        const icon = view.find(`home-app-${id}`)
        expect(icon.type).toBe('button')
        expect(icon.props['aria-label']).toBeTruthy()
        icon.props.onPointerdown()
        await nextTick()
        expect(icon.props.class).toContain('pui-home-board__tile--pressed')
        icon.props.onPointerup()
        icon.props.onClick()
      }
      const nodes = view.all()
      const ids = nodes.map(node => node.props.id).filter(Boolean)
      expect(new Set(ids).size).toBe(ids.length)
      const references = nodes.flatMap(node => Object.values(node.props))
        .filter(value => typeof value === 'string' && value.startsWith('url(#'))
        .map(value => value.slice(5, -1))
      expect(references.length).toBeGreaterThan(0)
      for (const reference of references) expect(ids).toContain(reference)
      expect(view.opened).toEqual([])
      view.find('home-dock-settings').props.onClick()
      expect(view.opened).toEqual(['settings'])
    } finally { view.unmount() }
  })
})

