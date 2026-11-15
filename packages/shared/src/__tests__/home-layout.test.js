import { describe, expect, it } from 'vitest'
import { createProject, toWorkData } from '../index.js'
import { findHomeSpace, fitsHomeHtml, HOME_COLUMNS, HOME_HTML_LIMIT, HOME_ROWS, HOME_WIDGET_SIZES, homeItemCells, moveHomeItem, resolveHomeLayout } from '../work/home-layout.js'

const widget = { id: 'widget_date', kind: 'preset', presetId: 'date', area: 'grid', slot: 4 }
const icon = { id: 'custom_app', kind: 'html-app', name: '自定义应用', html: '<b>Logo</b>' }

describe('home layout', () => {
  it('treats an imported 1 × 1 HTML widget as a movable static icon', () => {
    const project = createProject()
    const original = { ...icon, kind: 'html-widget', size: '1x1', area: 'grid', slot: 4 }
    project.workSettings.homeLayout = { items: [...resolveHomeLayout(project).items, original] }
    const { items } = resolveHomeLayout(toWorkData(project))
    expect(items.at(-1)).toEqual({ ...icon, area: 'grid', slot: 4 })
    expect(moveHomeItem(items, icon.id, 'dock', 0).items.at(-1)).toMatchObject({ area: 'dock', slot: 0 })
  })

  it('fits every supported rectangle and reserves room for built-in apps', () => {
    expect(HOME_WIDGET_SIZES).toHaveLength(27)
    for (const { value, columns, rows } of HOME_WIDGET_SIZES) {
      const slot = (HOME_ROWS - rows) * HOME_COLUMNS + HOME_COLUMNS - columns
      const item = { kind: 'html-widget', area: 'grid', slot, size: value }
      expect(homeItemCells(item)).toHaveLength(columns * rows)
      expect(homeItemCells(item).at(-1)).toBe(HOME_COLUMNS * HOME_ROWS - 1)
      expect(homeItemCells(item, 'dock', 0)).toEqual([])
    }
    expect(homeItemCells({ kind: 'html-widget', size: '4x7', area: 'grid', slot: 0 })).toEqual([])
  })

  it('preserves a custom size through work data and places a resize at the original anchor when possible', () => {
    const project = createProject()
    const apps = resolveHomeLayout(project).items
    const original = { ...icon, kind: 'html-widget', area: 'grid', slot: 5 }
    expect(homeItemCells(original)).toEqual([5, 6, 9, 10])
    const resized = { ...original, size: '4x6' }
    expect(findHomeSpace(apps, original, original)).toEqual({ area: 'grid', slot: 5 })
    expect(findHomeSpace(apps, resized, original)).toEqual({ area: 'grid', slot: 4 })
    project.workSettings.homeLayout = { items: [...apps, { ...resized, slot: 4 }] }
    const work = toWorkData(project)
    expect(work.workSettings.homeLayout.items.at(-1)).toMatchObject({ size: '4x6', slot: 4 })
    expect(moveHomeItem(resolveHomeLayout(work).items, icon.id, 'grid', 5).error).toContain('4 × 6')
  })

  it('keeps the legacy layout optional and supports swapping across the Dock', () => {
    const project = createProject()
    expect(toWorkData(project).workSettings).not.toHaveProperty('homeLayout')
    const initial = resolveHomeLayout(project).items
    const { items } = moveHomeItem(initial, 'phone', 'grid', 0)
    expect(items.find(item => item.id === 'phone')).toMatchObject({ area: 'grid', slot: 0 })
    expect(items.find(item => item.id === 'photos')).toMatchObject({ area: 'dock', slot: 0 })
    const moved = moveHomeItem(items, 'photos', 'grid', 19).items
    expect(moved.some(item => item.area === 'dock' && item.slot === 0)).toBe(false)
    project.workSettings.homeLayout = { items: moved }
    expect(resolveHomeLayout(toWorkData(project)).items).toEqual(moved)
  })

  it('rejects widget collisions and boundaries while allowing a move across its old footprint', () => {
    const items = [...resolveHomeLayout(createProject()).items, widget]
    expect(moveHomeItem(items, widget.id, 'dock', 0).error).toBeTruthy()
    expect(moveHomeItem(items, widget.id, 'grid', 7).error).toBeTruthy()
    expect(moveHomeItem(items, widget.id, 'grid', 24).error).toBeTruthy()
    expect(moveHomeItem(items, widget.id, 'grid', 20).items.at(-1)).toMatchObject({ slot: 20 })
    expect(moveHomeItem(items, widget.id, 'grid', 0).error).toBeTruthy()
    expect(moveHomeItem(items, 'phone', 'grid', 9).error).toBeTruthy()
    expect(moveHomeItem(items, widget.id, 'grid', 5).items.at(-1)).toMatchObject({ slot: 5 })
    const gridSize = HOME_COLUMNS * HOME_ROWS
    const full = Array.from({ length: gridSize + HOME_COLUMNS }, (_, slot) => ({
      ...icon, id: `custom_${slot}`, area: slot < gridSize ? 'grid' : 'dock', slot: slot % gridSize,
    }))
    expect(findHomeSpace(full, icon)).toBeNull()
    expect(findHomeSpace(full.slice(0, gridSize), icon)).toEqual({ area: 'dock', slot: 0 })
    expect(findHomeSpace(full.slice(0, gridSize), widget)).toBeNull()
  })

  it('preserves HTML and drops invalid entries when producing work data', () => {
    const project = createProject()
    const valid = { ...icon, area: 'grid', slot: 18 }
    project.workSettings.homeLayout = { items: [
      widget, valid, { ...valid, slot: 19 }, { ...valid, id: 'overlap', slot: 8 },
      { ...widget, id: 'outside', slot: 19 },
    ] }
    expect(toWorkData(project).workSettings.homeLayout).toEqual({ items: [widget, valid] })
    expect(fitsHomeHtml('x'.repeat(HOME_HTML_LIMIT))).toBe(true)
    expect(fitsHomeHtml('汉'.repeat(HOME_HTML_LIMIT / 2))).toBe(false)
  })
})
