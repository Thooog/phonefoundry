<script setup>

import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { formatBytes } from '@exporter'
import { EXPORT_KINDS, estimateSizes, exportProject } from '../../export/export-work-package.js'
import { loadPlayerBundle } from '../../export/load-player-bundle.js'
import AppButton from '../ui/AppButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  project: { type: Object, default: null },
})

const emit = defineEmits(['close', 'exported', 'failed'])

/**
 * 选项的静态描述。`sizeKey` 对应 estimateSizes 的返回字段 ——
 * 静态文案和体积数字分开维护，改文案不会碰到计算。
 */
const OPTIONS = [
  {
    group: 'reader',
    kind: EXPORT_KINDS.WORK_PACKAGE,
    title: '作品包',
    desc: 'ZIP 压缩包。解压后双击 index.html 就能看。',
    sizeKey: 'workPackage',
    badge: '推荐',
  },
  {
    group: 'reader',
    kind: EXPORT_KINDS.STANDALONE_HTML,
    title: '独立 HTML',
    desc: '单个 HTML 文件，直接打开，不用解压。图片内联，体积大约多三分之一。',
    sizeKey: 'standaloneHtml',
  },
  {
    group: 'self',
    kind: EXPORT_KINDS.CHARACTERS,
    title: '导出人物',
    desc: '仅含所有人物、平台账号配置及头像和横幅。通过「导入备份」创建新项目，继续创作。',
    sizeKey: 'characters',
  },
  {
    group: 'self',
    kind: EXPORT_KINDS.PROJECT_BACKUP,
    title: '项目备份包',
    desc: 'ZIP 压缩包。包含完整工程数据，可导入回来继续编辑。',
    sizeKey: 'projectBackup',
  },
]

const selectedKind=ref(EXPORT_KINDS.WORK_PACKAGE)
const dialog=ref(null)
let previousFocus
const sizes = ref(null)
const preparing = ref(false)
const prepareError = ref('')
const busyKind = ref('')

const inlineTooBig = computed(
  () => (sizes.value?.standaloneHtml ?? 0) > 25 * 1024 * 1024,
)

const busy = computed(() => Boolean(busyKind.value))
const needsPlayer = (kind) => [EXPORT_KINDS.WORK_PACKAGE, EXPORT_KINDS.STANDALONE_HTML].includes(kind)
const unavailable = (kind) => Boolean(prepareError.value && needsPlayer(kind)) || (kind === EXPORT_KINDS.CHARACTERS && !props.project?.characters?.length)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      previousFocus=document.activeElement
      dialog.value?.showModal()
      bindKeys()
      await prepare()
    } else {
      dialog.value?.close()
      previousFocus?.focus?.()
      unbindKeys()
      // 关掉就清干净，下次打开重新算（项目可能已经改了）
      sizes.value = null
      prepareError.value = ''
      busyKind.value = ''
    }
  },
)

/** 人物包与备份无需作品端产物，即使作品端加载失败也可导出。 */
async function prepare() {
  if (preparing.value || !props.project) return
  preparing.value = true
  prepareError.value = ''
  sizes.value = estimateSizes(props.project)
  try {
    const bundle = await loadPlayerBundle()
    sizes.value = estimateSizes(props.project, bundle)
  } catch (err) {
    // 最常见的原因是没构建作品端（dist 不存在），导出器会给出同样的提示
    prepareError.value = err?.message ?? '作品端产物加载失败，暂时无法导出。'
  } finally {
    preparing.value = false
  }
}

async function run(kind) {
  if (busy.value || preparing.value || unavailable(kind) || !props.project) return
  busyKind.value = kind
  try {
    const result = await exportProject(kind, props.project)
    emit('exported', result)
    emit('close')
  } catch (err) {
    emit('failed', err?.message ?? '导出失败。')
  } finally {
    busyKind.value = ''
  }
}

function requestClose() {
  // 导出中不允许关：关掉按钮会变回"导出作品"，用户会以为可以再点一次
  if (busy.value) return
  emit('close')
}

function sizeText(key) {
  if (preparing.value) return '计算中…'
  const value = sizes.value?.[key]
  return value ? `约 ${formatBytes(value)}` : ''
}

// ── Esc 关闭：挂在 window 上而不是面板上 ──
// 面板里没有初始焦点，靠 @keydown 收不到按键（ConfirmDialog 能这么写是因为它把焦点放到了按钮上）
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose()
  }
}
function bindKeys() {
  window.addEventListener('keydown', onKeydown)
}
function unbindKeys() {
  window.removeEventListener('keydown', onKeydown)
}
onBeforeUnmount(unbindKeys)
</script>

<template>
  <Teleport to="body">
    <dialog v-if="open" ref="dialog" class="xp__panel" aria-labelledby="xp-title" data-testid="export-panel" @cancel.prevent="requestClose" @click.self="requestClose">
      <header class="xp__head">
        <div>
          <h2 id="xp-title">导出作品</h2>
          <p class="xp__sub">{{ project?.name }}</p>
        </div>
        <AppButton class="xp__close" variant="ghost" size="sm" :disabled="busy" data-testid="export-cancel" aria-label="关闭导出面板" @click="requestClose">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </AppButton>
      </header>
      <p v-if="prepareError" class="xp__error" data-testid="export-error">{{ prepareError }} <button type="button" :disabled="preparing" @click="prepare">重试</button></p>
      <div class="xp__groups">
        <section v-for="group in [{id:'reader',title:'给读者'},{id:'self',title:'给自己'}]" :key="group.id" class="xp__group" role="group" :aria-labelledby="'xp-group-'+group.id">
          <h3 :id="'xp-group-'+group.id">{{ group.title }}</h3>
          <label v-for="opt in OPTIONS.filter(o=>o.group===group.id)" :key="opt.kind" class="xp__option" :class="{ 'xp__option--selected': selectedKind === opt.kind }">
            <input v-model="selectedKind" type="radio" name="export-kind" :value="opt.kind" :disabled="busy || preparing || unavailable(opt.kind)" :data-testid="'export-'+opt.kind" />
            <span class="xp__option-title"><strong>{{ opt.title }}</strong></span>
            <span class="xp__size">{{ sizeText(opt.sizeKey) }}</span>
            <small class="xp__desc">{{ opt.kind === EXPORT_KINDS.CHARACTERS && !project?.characters?.length ? '项目中还没有人物，请先创建人物再导出。' : opt.desc }}</small>
          </label>
        </section>
        <p v-if="inlineTooBig" class="xp__warn">独立 HTML 超过 25 MB，建议选择作品包。</p>
      </div>
      <footer class="xp__foot">
        <span v-if="busy" role="status">正在处理，请稍候…</span>
        <AppButton size="sm" :disabled="busy" @click="requestClose">取消</AppButton>
        <AppButton size="sm" variant="primary" :disabled="busy || preparing || unavailable(selectedKind)" data-testid="export-confirm" @click="run(selectedKind)">{{ busy ? '导出中…' : '导出' }}</AppButton>
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>

.xp__panel {
  width: min(520px, calc(100vw - 40px));
  max-height: calc(100dvh - 40px);
  margin: auto;
  padding: 24px 24px 20px;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-white);
  color: var(--c-text);
  overflow: auto;
  overscroll-behavior: contain;
  box-shadow: var(--shadow-md);
}
.xp__panel::backdrop { background: rgb(32 35 33 / 22%); }
.xp__head { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.xp__head > div { min-width: 0; }
.xp__head h2 { font: 600 22px/1.35 var(--font-story); }
.xp__sub { margin-top: 8px; color: var(--c-text-2); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.xp__close { flex: none; width: 34px; }
.xp__group + .xp__group { margin-top: 24px; }
.xp__group h3 { margin-bottom: 8px; color: var(--c-detail-text); font-size: var(--fs-xs); font-weight: 400; letter-spacing: 0.1em; }
.xp__option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.xp__option + .xp__option { margin-top: 4px; }
.xp__option:hover:not(:has(input:disabled)) { background: var(--c-bg-sunken); }
.xp__option--selected { background: var(--c-selected); border-color: var(--c-border); }
.xp__option:has(input:focus-visible) { outline: 1px solid var(--c-accent); outline-offset: 2px; }
.xp__option:has(input:disabled) { cursor: not-allowed; opacity: 0.6; }
.xp__option input { accent-color: var(--c-accent); width: 16px; height: 16px; margin: 0; }
.xp__option strong { font-size: 14px; font-weight: 600; }
.xp__desc { grid-column: 2 / -1; color: var(--c-text-2); font-size: var(--fs-xs); line-height: 1.65; overflow-wrap: anywhere; }
.xp__size { color: var(--c-text-3); font-size: var(--fs-xs); white-space: nowrap; font-variant-numeric: tabular-nums; }
.xp__foot { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 28px; }
.xp__foot :deep(.ui-btn) { min-height: 34px; padding: 0 14px; border-radius: 6px; font-size: var(--fs-sm); }
.xp__foot > span { margin-right: auto; color: var(--c-text-2); font-size: var(--fs-sm); }
.xp__error, .xp__warn { font-size: var(--fs-sm); line-height: 1.65; }
.xp__error { color: var(--c-danger); }
.xp__warn { margin-top: 16px; color: var(--c-warning); }
.xp__error button { background: transparent; border: 0; text-decoration: underline; padding: 8px; }
@media (max-width: 767px) {
  .xp__panel { width: calc(100vw - 32px); max-height: calc(100dvh - 32px); padding: 20px 16px; }
  .xp__close { width: 44px; }
  .xp__foot :deep(.ui-btn) { min-height: 44px; }
  .xp__size { grid-column: 2 / -1; grid-row: 2; }
  .xp__foot > span { flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .xp__option { transition: none; }
}

</style>
