<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import {
  createId, DEFAULT_HOME_WIDGET_SIZE, findHomeSpace, fitsHomeHtml, HOME_COLUMNS, HOME_HTML_LIMIT,
  HOME_PRESETS, HOME_ROWS, homeItemCells, homeItemName, homeItemSize,
  HOME_WEATHER, homeWeather, homeSchedules,
  moveHomeItem, resolveHomeLayout,
  DECORATIVE_APPS, canRemoveHomeItem, hasHomeRestoreCapacity, homeAppDefinition, importHomeApps, removeHomeItem,
} from '@phone-sim/shared'
import HomeDesktop from '@phone-sim/player-ui/kernel/HomeDesktop.vue'
import HomePresetWidget from '@phone-sim/player-ui/kernel/HomePresetWidget.vue'
import AppIcon from '@phone-sim/player-ui/symbols/AppIcons.vue'
import DevicePreview from '../components/workspace/DevicePreview.vue'
import { useProjectStore } from '../stores/project.js'
import { useUiStore } from '../stores/ui.js'
import { useAssetUrls } from '../composables/use-asset-urls.js'
import AppButton from '../components/ui/AppButton.vue'
import AppField from '../components/ui/AppField.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppSelect from '../components/ui/AppSelect.vue'
import AppUploadButton from '../components/ui/AppUploadButton.vue'

const editor = useProjectStore()
const ui = useUiStore()
const settings = computed(() => editor.project?.workSettings ?? {})
const layout = computed(() => resolveHomeLayout(editor.project))
const items = computed(() => layout.value.items)
const packageOpen = ref(false)
const presetDialog = ref(null)
const presetEditing = ref(null)
const presetContent = ref({})
const presetFields = computed(() => presetEditing.value?.presetId === 'note'
  ? [{ key: 'title', label: '标题' }, { key: 'detail', label: '备忘录文字', multiline: true }, { key: 'time', label: '时间' }]
  : presetEditing.value?.presetId === 'weather'
    ? [{ key: 'value', label: '温度' }, { key: 'detail', label: '天气描述' }, { key: 'high', label: '最高温度' }, { key: 'low', label: '最低温度' }]
    : [])
function editPreset() {
  if (editor.isReadOnly || selected.value?.kind !== 'preset') return
  presetEditing.value = selected.value
  const defaults = selected.value.presetId === 'note' ? { title: '新备忘录', detail: '手写备忘录', time: '20:52' }
    : selected.value.presetId === 'weather' ? { value: '34°', detail: '晴', high: '34°', low: '25°' }
      : { schedules: [] }
  presetContent.value = { ...defaults, ...selected.value.content }
  if (selected.value.presetId === 'weather') presetContent.value.detail = homeWeather(presetContent.value.detail)
  if (selected.value.presetId === 'date') presetContent.value = { schedules: homeSchedules(selected.value.content) }
  presetDialog.value.showModal()
}
function savePreset() {
  if (editor.isReadOnly || !presetEditing.value) return
  commit(items.value.map(item => item.id === presetEditing.value.id ? { ...item, content: { ...presetContent.value } } : item))
  presetDialog.value.close()
  presetEditing.value = null
}
const packageSelection = ref([])
const packageMessage = ref('')
const packageEntries = computed(() => [
  ...DECORATIVE_APPS.map(app => ({ id: app.id, name: app.name })),
  ...(layout.value.removedItems ?? []).filter(item => item.kind !== 'decorative-app')
    .map(item => ({ id: item.id, name: homeItemName(item) })),
])

function openPackage() {
  packageSelection.value = DECORATIVE_APPS.filter(app => !items.value.some(item => item.id === app.id)).map(app => app.id)
  packageMessage.value = ''
  packageOpen.value = true
}

function importPackage() {
  if (editor.isReadOnly) return
  const result = importHomeApps(editor.project, packageSelection.value)
  if (result.error) {
    packageMessage.value = result.error
    return
  }
  commit(result.items, result.removedItems ?? [])
  packageSelection.value = []
  packageMessage.value = '所选应用已添加到桌面。'
}
const { urls } = useAssetUrls(editor, () => [settings.value.wallpaper?.assetId].filter(Boolean))
const resolveWallpaperAsset = id => urls.value.get(id) ?? null

const selectedId = ref(null)
const draggedId = ref(null)
const selected = computed(() => items.value.find(item => item.id === selectedId.value))
const boardMessage = ref('')
const occupied = computed(() => {
  const cells = { grid: [], dock: [] }
  for (const item of items.value) {
    for (const slot of homeItemCells(item)) cells[item.area][slot] = item
  }
  return cells
})

const form = ref(blankForm())
const widgetDimensionOptions = ['1', '2', '3', '4']
const widgetDimensions = computed(() => form.value.size.split('x'))
const widgetWidth = computed({
  get: () => widgetDimensions.value[0],
  set: width => { form.value.size = `${width}x${widgetDimensions.value[1]}` },
})
const originalHeight = computed(() => widgetDimensionOptions.includes(widgetDimensions.value[1])
  ? ''
  : `原高度 ${widgetDimensions.value[1]} 格`)
const widgetHeight = computed({
  get: () => originalHeight.value ? '' : widgetDimensions.value[1],
  set: height => {
    if (height) form.value.size = `${widgetDimensions.value[0]}x${height}`
  },
})
const formMessage = ref('')
const reading = ref(false)
let formVersion = 0
const hasDraft = computed(() => {
  const { id, name, html, size } = form.value
  const saved = items.value.find(item => item.id === id)
  return reading.value || name !== (saved?.name ?? '') || html !== (saved?.html ?? '') ||
    (Boolean(saved) && size !== htmlItemSize(saved))
})
const drafts = inject('creator-drafts', null)
const draftKey = Symbol('home-html')
drafts?.set(draftKey, hasDraft)
onBeforeUnmount(() => {
  drafts?.delete(draftKey)
  formVersion += 1
})

function confirmDiscard() {
  return !hasDraft.value || ui.confirm({
    title: '还有未保存的 HTML',
    message: '继续会丢弃当前表单中的修改。',
    confirmText: '丢弃修改',
    cancelText: '继续编辑',
  })
}

onBeforeRouteLeave(confirmDiscard)
onBeforeRouteUpdate((to, from) => to.params.projectId === from.params.projectId || confirmDiscard())

function blankForm() {
  return { id: null, name: '', html: '', size: DEFAULT_HOME_WIDGET_SIZE }
}

function htmlItemSize(item) {
  return item.kind === 'html-app' ? '1x1' : item.size ?? DEFAULT_HOME_WIDGET_SIZE
}

function resetForm() {
  formVersion += 1
  reading.value = false
  form.value = blankForm()
  formMessage.value = ''
}

watch(() => editor.project?.id, () => {
  selectedId.value = null
  draggedId.value = null
  boardMessage.value = ''
  packageOpen.value = false
  resetForm()
})

function commit(next, removedItems = layout.value.removedItems ?? []) {
  if (editor.isReadOnly || !editor.project) return
  editor.patch({ workSettings: { ...settings.value, homeLayout: { items: next, ...(removedItems.length && { removedItems }) } } })
}

async function restoreDefaultLayout() {
  if (editor.isReadOnly || !editor.project || selected.value) return
  const confirmed = await ui.confirm({
    title: '恢复默认桌面？',
    message: '内置应用将恢复初始位置，新增的装饰应用和小组件将从桌面移除。自定义图标可从应用包恢复。当前未保存的 HTML 编辑也会清空。',
    confirmText: '恢复默认',
    cancelText: '取消',
  })
  if (!confirmed || editor.isReadOnly || selected.value) return
  const removedIcons = [...items.value, ...(layout.value.removedItems ?? [])]
    .filter(item => item.kind === 'html-app')
  commit(resolveHomeLayout(editor.project, null).items, removedIcons)
  resetForm()
  packageOpen.value = false
  boardMessage.value = '已恢复默认桌面布局。'
}

function cellPosition(area, slot) {
  return area === 'dock' ? `Dock 第 ${slot + 1} 格` :
    `桌面第 ${Math.floor(slot / HOME_COLUMNS) + 1} 行第 ${slot % HOME_COLUMNS + 1} 列`
}

function move(id, area, slot) {
  if (editor.isReadOnly) return
  const result = moveHomeItem(items.value, id, area, slot)
  if (result.error) {
    boardMessage.value = result.error
    return
  }
  if (result.items !== items.value) {
    commit(result.items)
    boardMessage.value = `已移到${cellPosition(area, slot)}。`
  }
  selectedId.value = null
}

function selectCell(area, slot) {
  const item = occupied.value[area][slot]
  boardMessage.value = ''
  if (selected.value) {
    move(selected.value.id, area, slot)
  } else if (item) {
    selectedId.value = item.id
  }
}

function startDrag(event, item) {
  if (!item || editor.isReadOnly) return
  draggedId.value = item.id
  selectedId.value = item.id
  boardMessage.value = ''
  event.dataTransfer.setData('text/plain', item.id)
  event.dataTransfer.effectAllowed = 'move'
}

function drop(area, slot) {
  if (draggedId.value) move(draggedId.value, area, slot)
  draggedId.value = null
}

function noSpaceMessage(item) {
  if (!homeItemSize(item) || homeItemSize(item).columns === 1 && homeItemSize(item).rows === 1) return '桌面和 Dock 已满。'
  const { columns, rows } = homeItemSize(item)
  return `桌面没有空余的 ${columns} × ${rows} 格。`
}

function add(item, message) {
  const position = findHomeSpace(items.value, item)
  if (!position || !hasHomeRestoreCapacity(editor.project, [...items.value, { ...item, ...position }])) {
    if (position) {
      message.value = '需为已移除的内置应用保留恢复空间，请先腾出位置。'
      return false
    }
    message.value = noSpaceMessage(item)
    return false
  }
  commit([...items.value, { ...item, ...position }])
  selectedId.value = item.id
  boardMessage.value = `已添加「${homeItemName(item)}」。选择目标格可移动。`
  return true
}

function addPreset(presetId) {
  add({ id: createId('home'), kind: 'preset', presetId }, boardMessage)
}

async function editSelected() {
  const item = selected.value
  if (!item?.kind.startsWith('html-')) return
  if (form.value.id === item.id || !(await confirmDiscard()) || selected.value !== item || editor.isReadOnly) return
  resetForm()
  form.value = { id: item.id, name: item.name, html: item.html, size: htmlItemSize(item) }
  document.getElementById('home-item-name')?.focus()
}

function removeSelected() {
  const item = selected.value
  if (!item || editor.isReadOnly) return
  const result = removeHomeItem(editor.project, item.id)
  if (result.error) {
    boardMessage.value = result.error
    return
  }
  commit(result.items, result.removedItems ?? [])
  if (form.value.id === item.id) resetForm()
  selectedId.value = null
  boardMessage.value = `已移除「${homeItemName(item)}」。`
}

async function importHtml([file]) {
  if (!file || editor.isReadOnly || reading.value) return
  formMessage.value = ''
  if (!/\.html$/i.test(file.name) || file.size > HOME_HTML_LIMIT) {
    formMessage.value = '请选择 256 KiB 以内的 .html 文件。'
    return
  }
  const version = formVersion
  reading.value = true
  try {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    if (version !== formVersion || editor.isReadOnly) return
    form.value.html = html
    if (!form.value.name.trim()) form.value.name = file.name.slice(0, -5).slice(0, 30)
  } catch {
    if (version === formVersion) formMessage.value = '无法读取文件，请检查文件是否使用 UTF-8 编码。'
  } finally {
    if (version === formVersion) reading.value = false
  }
}

function saveHtml() {
  if (editor.isReadOnly || reading.value) return
  const { id, name, html, size } = form.value
  if (!name.trim() || !html.trim()) {
    formMessage.value = '请填写名称和 HTML。'
    return
  }
  if (!fitsHomeHtml(html)) {
    formMessage.value = 'HTML 源码不能超过 256 KiB。'
    return
  }
  const kind = size === '1x1' ? 'html-app' : 'html-widget'
  const draft = { id: id ?? createId('home'), kind, name: name.trim(), html }
  if (kind === 'html-widget') draft.size = size
  if (!homeItemSize(draft)) {
    formMessage.value = '请选择有效的小组件尺寸。'
    return
  }
  if (id) {
    const original = items.value.find(item => item.id === id)
    if (!original) return
    const position = findHomeSpace(items.value.filter(item => item.id !== id), draft, original)
    if (!position) {
      formMessage.value = noSpaceMessage(draft)
      return
    }
    if (!hasHomeRestoreCapacity(editor.project, [...items.value.filter(item => item.id !== id), { ...draft, ...position }])) {
      formMessage.value = '需为已移除的内置应用保留恢复空间，请先腾出位置。'
      return
    }
    commit(items.value.map(item => item.id === id ? { ...draft, ...position } : item))
    boardMessage.value = position.slot === original.slot && position.area === original.area
      ? `已更新「${draft.name}」。`
      : `已更新「${draft.name}」并移到${cellPosition(position.area, position.slot)}。`
  } else if (!add(draft, formMessage)) {
    return
  }
  resetForm()
}
</script>

<template>
  <section class="home-editor" data-testid="home-layout-editor">
    <div class="home-editor__workspace">
      <div class="home-editor__tools">
        <section v-if="!editor.isReadOnly" class="home-editor__section" aria-labelledby="home-presets-heading">
          <h2 id="home-presets-heading">预设小组件</h2>
          <div class="home-editor__presets">
            <button v-for="preset in HOME_PRESETS" :key="preset.id" type="button" class="home-editor__preset" :aria-label="`添加${preset.name}小组件，2 × 2 格`" @click="addPreset(preset.id)">
              <span class="home-editor__preset-frame" aria-hidden="true">
                <HomePresetWidget class="home-editor__preset-art" :preset-id="preset.id" :story-date="settings.storyDate" />
              </span>
              <span>{{ preset.name }} · 2×2</span>
            </button>
            <button type="button" class="home-editor__preset" aria-label="打开应用包，2 × 2 文件夹" :aria-expanded="packageOpen" aria-controls="home-package" @click="packageOpen ? packageOpen = false : openPackage()">
              <span class="home-editor__preset-frame" aria-hidden="true">
                <span class="home-editor__preset-art home-editor__folder">
                  <AppIcon v-for="app in DECORATIVE_APPS.slice(0, 9)" :key="app.id" :icon-key="app.iconKey" :accent="app.accent" :size="24" />
                </span>
              </span>
              <span>应用包 · 2×2</span>
            </button>
          </div>
          <div v-if="packageOpen" id="home-package" class="home-editor__package" role="group" aria-label="选择导入或恢复的应用">
            <p class="home-editor__hint">常用应用仅作桌面装饰。移除的空应用和自定义图标也可在这里恢复。</p>
            <label v-for="entry in packageEntries" :key="entry.id" class="home-editor__package-entry">
              <input v-model="packageSelection" type="checkbox" :value="entry.id" :disabled="items.some(item => item.id === entry.id)">
              <AppIcon v-if="homeAppDefinition(entry.id)" :icon-key="homeAppDefinition(entry.id).iconKey" :accent="homeAppDefinition(entry.id).accent" :size="28" />
              <span>{{ entry.name }}</span>
              <span v-if="items.some(item => item.id === entry.id)" class="home-editor__hint">已在桌面</span>
            </label>
            <AppButton size="sm" variant="primary" :disabled="!packageSelection.length" @click="importPackage">添加到桌面（{{ packageSelection.length }}）</AppButton>
            <p v-if="packageMessage" class="home-editor__hint" role="status">{{ packageMessage }}</p>
          </div>
        </section>

        <form v-if="!editor.isReadOnly" class="home-editor__section home-editor__form" aria-labelledby="home-html-heading" @submit.prevent="saveHtml">
          <div>
            <h2 id="home-html-heading">{{ form.id ? '编辑自定义项目' : '导入 HTML' }}</h2>
            <p id="home-html-help" class="home-editor__hint">支持 HTML、内联 CSS 和嵌入的位图，最大 256 KiB。作品中仅作静态展示。</p>
          </div>
          <div class="home-editor__fields">
            <div class="home-editor__dimensions">
              <AppField label="宽度（格）" field-id="home-item-width">
                <AppSelect id="home-item-width" v-model="widgetWidth" :options="widgetDimensionOptions" :disabled="reading" />
              </AppField>
              <AppField label="高度（格）" field-id="home-item-height">
                <AppSelect id="home-item-height" v-model="widgetHeight" :options="widgetDimensionOptions" :placeholder="originalHeight" :disabled="reading" />
              </AppField>
            </div>
            <AppField label="名称" field-id="home-item-name">
              <AppInput id="home-item-name" v-model="form.name" :maxlength="30" :disabled="reading" />
            </AppField>
          </div>
          <AppField class="home-editor__source" label="HTML 源码" field-id="home-item-html">
            <textarea id="home-item-html" v-model="form.html" rows="6" spellcheck="false" :disabled="reading" aria-describedby="home-html-help" />
          </AppField>
          <div class="home-editor__actions">
            <AppUploadButton size="sm" accept=".html,text/html" :multiple="false" :disabled="reading" test-id="home-html-file" @files="importHtml">{{ reading ? '正在读取' : '选择 HTML 文件' }}</AppUploadButton>
            <AppButton size="sm" variant="primary" native-type="submit" :disabled="reading">{{ form.id ? '保存修改' : '添加到桌面' }}</AppButton>
            <AppButton v-if="form.id" size="sm" variant="ghost" @click="resetForm">取消编辑</AppButton>
          </div>
          <p v-if="formMessage" class="home-editor__error" role="alert">{{ formMessage }}</p>
        </form>
      </div>

      <section class="home-editor__preview" aria-labelledby="home-board-heading" @keydown.esc="selectedId = null">
        <h2 id="home-board-heading">桌面布局</h2>
        <div class="home-editor__device-slot">
          <div class="home-editor__phone" role="group" aria-labelledby="home-board-heading">
            <DevicePreview :time-format="settings.timeFormat">
              <HomeDesktop :work="editor.project" :resolve-asset="resolveWallpaperAsset" :editor="!editor.isReadOnly" :launchable="false">
                <template v-if="!editor.isReadOnly" #cells="{ area }">
                  <button
                    v-for="(_, slot) in (area === 'grid' ? HOME_COLUMNS * HOME_ROWS : HOME_COLUMNS)"
                    :key="slot"
                    type="button"
                    class="home-editor__cell"
                    :class="{ 'home-editor__cell--empty': !occupied[area][slot] }"
                    :style="{ gridColumn: slot % HOME_COLUMNS + 1, gridRow: Math.floor(slot / HOME_COLUMNS) + 1 }"
                    :aria-label="`${cellPosition(area, slot)}，${occupied[area][slot] ? homeItemName(occupied[area][slot]) : '空'}`"
                    :aria-pressed="Boolean(selectedId && occupied[area][slot]?.id === selectedId)"
                    :data-testid="`home-slot-${area}-${slot}`"
                    :draggable="Boolean(occupied[area][slot])"
                    @click="selectCell(area, slot)"
                    @dragstart="startDrag($event, occupied[area][slot])"
                    @dragend="draggedId = null"
                    @dragover.prevent
                    @drop.prevent="drop(area, slot)"
                  />
                </template>
              </HomeDesktop>
            </DevicePreview>
          </div>
        </div>
        <div v-if="!editor.isReadOnly" class="home-editor__selection">
          <p class="home-editor__status" role="status">{{ boardMessage || (selected ? `已选中「${homeItemName(selected)}」，请选择目标格。` : '') }}</p>
          <div class="home-editor__actions">
            <template v-if="selected">
              <AppButton v-if="selected.kind === 'preset' && selected.presetId !== 'clock'" size="sm" variant="ghost" @click="editPreset">修改 HTML</AppButton>
              <AppButton v-if="selected.kind.startsWith('html-')" size="sm" variant="ghost" @click="editSelected">编辑</AppButton>
              <AppButton v-if="canRemoveHomeItem(editor.project, selected)" size="sm" variant="danger" @click="removeSelected">移除</AppButton>
              <span v-else class="home-editor__hint">有作品内容的应用和设置不能移除。</span>
              <AppButton size="sm" variant="ghost" @click="selectedId = null; boardMessage = ''">取消选择</AppButton>
            </template>
            <AppButton v-else size="sm" variant="ghost" @click="restoreDefaultLayout">恢复默认</AppButton>
          </div>
        </div>
      </section>
    </div>
    <dialog ref="presetDialog" :class="{ 'home-editor__preset-dialog--weather': presetEditing?.presetId === 'weather' }" class="home-editor__preset-dialog" aria-labelledby="preset-edit-heading" @close="presetEditing = null">
      <form class="home-editor__preset-fields" @submit.prevent="savePreset">
        <h2 id="preset-edit-heading">修改小组件内容</h2>
        <p class="home-editor__hint">填写小组件上显示的内容，样式保持不变。</p>
        <AppField v-for="field in presetFields" :key="field.key" :class="{ 'home-editor__temperature-field': presetEditing?.presetId === 'weather' && ['high', 'low'].includes(field.key) }" :label="field.label" :for="`preset-${field.key}`">
          <div v-if="presetEditing?.presetId === 'weather' && field.key === 'detail'" :id="`preset-${field.key}`" class="home-editor__weather-options" role="radiogroup" aria-label="天气描述">
            <label v-for="weather in HOME_WEATHER" :key="weather"><input v-model="presetContent.detail" type="radio" name="preset-weather" :value="weather" /><span>{{ weather }}</span></label>
          </div>
          <textarea v-else-if="field.multiline" :id="`preset-${field.key}`" v-model="presetContent[field.key]" rows="5" maxlength="500" />
          <AppInput v-else :id="`preset-${field.key}`" v-model="presetContent[field.key]" :maxlength="field.key === 'value' ? 12 : 60" />
        </AppField>
        <section v-if="presetEditing?.presetId === 'date'" class="home-editor__schedule-editor" aria-label="日程安排">
          <p class="home-editor__hint">日期跟随系统设置中的事件发生日期。同一时段的日程会合并显示，不同时段显示独立卡片。</p>
          <div v-for="(row, index) in presetContent.schedules" :key="index" class="home-editor__schedule-row">
            <AppField label="日程名称" :for="`schedule-title-${index}`"><AppInput :id="`schedule-title-${index}`" v-model="row.title" :maxlength="100" /></AppField>
            <AppField label="开始时间" :for="`schedule-start-${index}`"><AppInput :id="`schedule-start-${index}`" v-model="row.start" type="time" /></AppField>
            <AppField label="结束时间" :for="`schedule-end-${index}`"><AppInput :id="`schedule-end-${index}`" v-model="row.end" type="time" /></AppField>
            <button type="button" class="home-editor__schedule-delete" :aria-label="`删除日程${row.title ? `：${row.title}` : index + 1}`" title="删除日程" @click="presetContent.schedules.splice(index, 1)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></svg>
            </button>
          </div>
          <AppButton size="sm" :disabled="presetContent.schedules.length >= 30" @click="presetContent.schedules.push({ title: '', start: '09:00', end: '10:00' })">添加日程</AppButton>
        </section>
        <div class="home-editor__preset-actions">
          <AppButton @click="presetDialog.close()">取消</AppButton>
          <AppButton native-type="submit" variant="primary">保存修改</AppButton>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.home-editor__schedule-editor { display: grid; gap: 16px; }
.home-editor__schedule-row { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; border: 1px solid var(--c-border); border-radius: 8px; }
.home-editor__schedule-delete { position: absolute; top: 5px; right: 7px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--c-text-3); cursor: pointer; }
.home-editor__schedule-delete:hover { background: var(--c-danger-weak); color: var(--c-danger); }
.home-editor__schedule-delete:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px; }
.home-editor__schedule-row > :first-child :deep(label) { padding-right: 30px; }
.home-editor__schedule-row > :first-child { grid-column: 1 / -1; }
.home-editor__weather-options { display: flex; flex-wrap: wrap; gap: 12px 24px; }
.home-editor__weather-options label { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; cursor: pointer; font-size: var(--fs-base); }
.home-editor__weather-options input { margin: 0; width: 18px; height: 18px; accent-color: var(--c-accent); }
.home-editor__preset-dialog { box-sizing: border-box; width: min(440px, calc(100vw - 40px)); max-height: 85vh; overflow: auto; padding: 24px 24px 20px; border: 1px solid var(--c-border); border-radius: 10px; background: var(--c-white); color: var(--c-text); box-shadow: var(--shadow-md); }
.home-editor__preset-dialog::backdrop { background: rgba(32, 35, 33, 0.22); }
.home-editor__preset-fields { display: grid; gap: 16px; }
@media (min-width: 768px) {
  .home-editor__preset-dialog--weather { width: min(560px, calc(100vw - 40px)); }
  .home-editor__preset-dialog--weather .home-editor__preset-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-editor__preset-dialog--weather .home-editor__preset-fields > * { grid-column: 1 / -1; }
  .home-editor__preset-dialog--weather .home-editor__preset-fields > .home-editor__temperature-field { grid-column: span 1; }
  .home-editor__preset-dialog--weather .home-editor__weather-options { flex-wrap: nowrap; justify-content: space-between; gap: 12px; }
}
.home-editor__preset-fields h2 { font-size: 22px; line-height: 1.35; }
.home-editor__preset-fields .home-editor__hint { margin: 0; font-size: var(--fs-sm); line-height: 1.65; }
.home-editor__preset-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); margin-top: 20px; }
.home-editor__preset-actions :deep(.ui-btn) { min-height: 34px; padding: 0 14px; border-radius: 6px; font-size: var(--fs-sm); }
@media (max-width: 767px) { .home-editor__preset-actions :deep(.ui-btn) { min-height: 44px; } }
.home-editor__preset-fields textarea { width: 100%; box-sizing: border-box; padding: 10px; font: inherit; border: 1px solid var(--c-border); border-radius: 8px; resize: vertical; }
:global(.ws__main:has(.home-editor)) { background: var(--c-white); }
.home-editor { max-width: 1280px; margin: 0 auto; padding: 36px 48px 24px; }
.home-editor h2 { margin: 0; font: 600 21px/1.5 var(--font-story); }
.home-editor__hint, .home-editor__status, .home-editor__error {
  margin: 6px 0 0;
  color: var(--c-text-3);
  font-size: 12px;
  line-height: 1.6;
}
.home-editor__workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 280px);
  align-items: start;
  gap: clamp(32px, 5vw, 88px);
}
.home-editor__section + .home-editor__section { margin-top: 16px; }
.home-editor__package { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin-top: 12px; }
.home-editor__package > .ui-btn, .home-editor__package > p { grid-column: 1 / -1; }
.home-editor__package-entry { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; }
.home-editor__package-entry input { width: 18px; height: 18px; accent-color: var(--c-accent); }
.home-editor__presets {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px 12px;
  margin-top: 6px;
}
.home-editor__preset {
  display: grid;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-text-3);
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
}
.home-editor__preset-frame {
  display: grid;
  place-items: center;
  aspect-ratio: 14 / 9;
  container-type: size;
}
.home-editor__preset-art {
  width: 100cqh;
  height: 100%;
  border-radius: 18%;
}
.home-editor__folder {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 7%;
  padding: 12%;
  box-sizing: border-box;
  background: linear-gradient(145deg, #e9eaf0, #d7dbe6);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 70%);
}
.home-editor__folder :deep(.pui-appicon) { width: 100% !important; height: 100% !important; }
.home-editor__preset:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 4px; border-radius: var(--radius-md); }
.home-editor__preset:active .home-editor__folder { transform: scale(0.96); }
@media (hover: hover) {
  .home-editor__preset:hover .home-editor__preset-art { filter: brightness(0.96); }
}
.home-editor__preview { min-width: 0; padding-top: 0; }
.home-editor__phone {
  width: 100%;
  max-width: 280px;
  margin: 8px 0 0;
}
.home-editor__cell {
  z-index: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
}
.home-editor__cell--empty { border-color: rgb(255 255 255 / 45%); border-style: dashed; }
.home-editor__cell[aria-pressed='true'] { border-color: white; background: rgb(255 255 255 / 17%); }
.home-editor__cell:focus-visible { outline: 2px solid white; outline-offset: -4px; box-shadow: inset 0 0 0 4px #23305e; }
@media (hover: hover) { .home-editor__cell:hover { border-color: white; } }
.home-editor__status:not(:empty) { margin-top: 10px; }
.home-editor__form { display: grid; gap: 16px; }
.home-editor__fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 12px; }
.home-editor__dimensions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.home-editor__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.home-editor__form .home-editor__actions { margin-top: 0; }
.home-editor__form textarea {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-white);
  color: var(--c-text);
  font: 400 13px/1.6 var(--font-mono);
  resize: vertical;
}
.home-editor__form textarea:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-weak);
}
.home-editor__form textarea:disabled { background: var(--c-bg-sunken); color: var(--c-text-3); }
.home-editor__error { color: var(--c-danger); margin: 0; }
@media (min-width: 768px) {
  :global(.ws__main:has(.home-editor)) { overflow: hidden; }
  .home-editor__preview > h2 { text-align: right; }
  .home-editor, .home-editor__workspace { height: 100%; }
  .home-editor { padding-block: clamp(16px, 4dvh, 36px) 16px; margin-right: 72px; }
  .home-editor__workspace { align-items: stretch; }
  .home-editor__tools, .home-editor__preview {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* 滚动视口四面各让 4px（负 margin 抵消，内容位置不变）：
     字段与文本域贴着滚动面，:focus-visible 的 3px 焦点环会被裁掉 */
  .home-editor__tools { overflow: auto; padding: 4px; margin: -4px; }
  .home-editor__form { display: flex; flex: 1; flex-direction: column; }
  .home-editor__source { flex: 1; min-height: 86px; }
  .home-editor__source :deep(.ui-field__control) { flex: 1; min-height: 0; }
  .home-editor__form textarea { height: 100%; min-height: 0; resize: none; }
  .home-editor__device-slot { flex: 0 1 598px; min-height: 0; container-type: size; margin-top: 20px; }
  .home-editor__phone { width: min(100%, 47cqh); margin: 0 0 0 auto; }
  .home-editor__selection { flex: none; }
  .home-editor__selection .home-editor__status { min-height: 0; margin-top: 6px; }
  .home-editor__selection { width: min(100%, 47cqh); margin-left: auto; }
  .home-editor__selection .home-editor__actions { justify-content: flex-end; margin-top: 4px; }
}
@media (max-width: 1100px) {
  .home-editor { padding: 28px 32px 24px; }
  .home-editor__workspace { gap: 32px; }
}
@media (max-width: 767px) {
  .home-editor { padding: 24px 20px; }
  .home-editor h2 { font-size: 20px; }
  .home-editor__workspace { grid-template-columns: minmax(0, 1fr); }
  .home-editor__presets { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .home-editor__preview { padding-top: 24px; }
  .home-editor__phone { margin-inline: auto; }
  .home-editor__actions :deep(.ui-btn) { min-height: 44px; }
  .home-editor__form textarea { font-size: 16px; }
}
@media (max-width: 359px) {
  .home-editor__fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
