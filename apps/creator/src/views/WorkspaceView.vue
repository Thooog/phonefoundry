<script setup>

import { ref, computed, watch, onBeforeUnmount, provide, nextTick } from 'vue'
import { useRouter, useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { APPS } from '@phone-sim/shared'
import { useProjectStore } from '../stores/project.js'
import { useUiStore } from '../stores/ui.js'
import { useMediaQuery } from '../composables/use-media-query.js'
import { useScrollContainment } from '../composables/use-scroll-containment.js'
import { buildPreviewQuery } from '../preview/preview-target.js'
import AppIcon from '../components/ui/AppIcon.vue'
import SaveStatus from '../components/workspace/SaveStatus.vue'
import ViewportDiagnostics from '../components/workspace/ViewportDiagnostics.vue'
import ReadOnlyBanner from '../components/workspace/ReadOnlyBanner.vue'
import ExportPanel from '../components/workspace/ExportPanel.vue'
import AppButton from '../components/ui/AppButton.vue'
import { formatBytes } from '@exporter'

const props = defineProps({
  projectId: { type: String, required: true },
})

useScrollContainment()
const router = useRouter()
const route = useRoute()
const editor = useProjectStore()
const ui = useUiStore()
const draftRegistry = new Map()
provide('creator-drafts', draftRegistry)
function warnUnsavedDrafts(event) {
  if (!editor.isDirty && !Array.from(draftRegistry.values()).some(draft => draft.value)) return
  event.preventDefault()
  event.returnValue = ''
}
window.addEventListener('beforeunload', warnUnsavedDrafts)
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnUnsavedDrafts))

/** ≥1100px 视为宽屏；小于此宽度把左侧导航收进抽屉 */
const isWide = useMediaQuery('(min-width: 1024px)')

/** <720px 视为手机宽度：顶栏按钮换短文案，否则「预览「KakaoTalk」+ 导出作品」必然溢出被裁 */
const isNarrow = useMediaQuery('(max-width: 767px)')

let discardOnLeave = false
const ready = ref(false)
/** 关闭抽屉的时机由路由变化驱动，不用手动管理 */
const drawerOpen = ref(false)
const navDialog = ref(null)
let navTrigger
watch([drawerOpen,isWide], async ([open,wide]) => { await nextTick();if(open && !wide){navTrigger=document.activeElement; if(!navDialog.value?.open) navDialog.value?.showModal()}else if(navDialog.value?.open){navDialog.value.close();navTrigger?.focus?.()} },{flush:'post'})
/** 导出是异步的（取产物 + 压缩），期间禁用按钮，避免连点出两个包 */
const exporting = ref(false)
/** 三种形态的选择面板 */
const exportPanelOpen = ref(false)

const project = computed(() => editor.project)

/** 手机"设置"应用的数据归 workSettings 管，编辑端不单独列它 */
const CONTENT_APPS = ['photos', 'kakaotalk', 'messages', 'x', 'phone', 'instagram', 'notes'].map(id => APPS.find(app => app.id === id)).filter(Boolean)

const navGroups = computed(() => [
  { title: '', items: [
    { key: 'overview', label: '作品首页', to: { name: 'overview', params: { projectId: props.projectId } } },
    { key: 'characters', label: '人物', to: { name: 'characters', params: { projectId: props.projectId } } },
  ] },
  { title: '内容', items: CONTENT_APPS.map(app => ({ key: 'app-' + app.id, label: app.name, to: { name: 'apps', params: { projectId: props.projectId, app: app.id } } })) },
  { title: '', items: [
    { key: 'home-layout', label: '桌面美化', to: { name: 'home-layout', params: { projectId: props.projectId } } },
    { key: 'settings', label: '手机设定', to: { name: 'settings', params: { projectId: props.projectId } } },
  ] },
])

function isActive(item) {
  if (route.name !== item.to.name) return false
  if (route.name === 'apps') return route.params.app === item.to.params.app
  return true
}

// ───────────────────── 打开 / 关闭项目 ─────────────────────

/**
 * 打开项目并给出失败出口。
 *
 * 项目不存在必须回列表，不能停在一个空壳工作区：
 * 用户刚删掉自己正在看的项目（另一个标签页）时，
 * 停在这里写任何东西都是在往一个不存在的 id 上写。
 */
async function boot(id) {
  ready.value = false
  const result = await editor.open(id)

  if (!result?.ok) {
    if (result?.reason === 'missing') {
      ui.toast('这个作品不存在，可能已被删除。', { tone: 'error' })
      router.replace({ name: 'projects' })
      return
    }
    ui.toast(editor.loadError?.message ?? '打开作品失败。', { tone: 'error' })
    return
  }

  ready.value = true
}

watch(
  () => props.projectId,
  async (id, prev) => {
    // 同一个工作区组件被复用到另一个项目（改了 URL）：先把旧的交还掉，否则旧锁一直挂着
    if (prev && prev !== id) await editor.close({ discard: discardOnLeave })
    discardOnLeave = false
    await boot(id)
  },
  { immediate: true },
)

// 切子路由时关掉抽屉，否则窄屏下导航会一直盖在内容上
watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  },
)

onBeforeUnmount(() => {
  void editor.close({ discard: discardOnLeave }).catch(() => { /* Preserve failed edits in the store. */ })
})
async function leaveProject() {
  discardOnLeave = false
  try {
    await editor.flush()
    return true
  } catch (error) {
    const discard = await ui.confirm({
      title: '改动尚未保存',
      message: `${error?.message ?? '保存失败。'}\n留在这里可以重试或另存为新项目。继续离开将丢弃未保存的改动。`,
      confirmText: '放弃改动并离开',
      cancelText: '留在这里',
      tone: 'danger',
    })
    if (!discard) return false
    discardOnLeave = true
    return true
  }
}
onBeforeRouteLeave(leaveProject)
onBeforeRouteUpdate((to, from) =>
  to.params.projectId !== from.params.projectId ? leaveProject() : true,
)

// ───────────────────── 顶栏动作 ─────────────────────

function goProjects() {
  router.push({ name: 'projects' })
}

function backToEdit() {
  // 从编辑页进来的就原路返回，保留刚才停留的位置；直接输 URL 打开时回概览。
  if (window.history.state?.back) router.back()
  else router.push({ name: 'overview', params: { projectId: props.projectId } })
}

/**
 * 预览定位：在某个应用的编辑页点预览，就直接落到那个应用。
 *
 * 只有应用页带定位。概览 / 角色 / 设置页点预览仍从锁屏开始 ——
 * 那里问的是"读者打开这部作品第一眼看到什么"，跳过锁屏反而看不到答案。
 */
const previewQuery = computed(() =>
  route.name === 'apps' ? buildPreviewQuery({ app: route.params.app }) : {},
)

async function openPreview() {
  try {
    await editor.flush()
  } catch (err) {
    ui.toast(err?.message ?? '当前改动还没保存，先解决保存问题再预览。', { tone: 'error' })
    return
  }
  router.push({
    name: 'preview',
    params: { projectId: props.projectId },
    query: previewQuery.value,
  })
}

/**
 * 打开导出面板。
 *
 * 顺序是刻意的：先 flush 再开面板。架构红线第 4 条 —— 保存失败即中止。
 * 面板上的预估体积也是基于磁盘内容算的，拿旧数据算出来的数字
 * 和最后导出的文件对不上，比没有预估更糟。
 *
 * 真正的导出动作在面板里（三种形态各有一次点击），这里只负责把门打开：
 * 用户往往要在面板上比较体积再决定用哪种，不该替他一键定死。
 */
async function openExportPanel() {
  if (exporting.value || !editor.project || exportPanelOpen.value) return
  exporting.value = true

  try {
    await editor.flush()
  } catch (err) {
    ui.toast(err?.message ?? '当前改动还没保存，先解决保存问题再导出。', { tone: 'error' })
    return
  } finally {
    exporting.value = false
  }

  exportPanelOpen.value = true
}

function onExported(result) {
  ui.toast(`已导出 ${result.fileName}（${formatBytes(result.size)}）`, { tone: 'success' })
  // 体积提示与缺失资源是两件不同的事，分开说，避免合成一句话没人看得懂
  if (result.missing.length) {
    ui.toast(`有 ${result.missing.length} 个资源取不到文件，作品里会显示占位。`, { tone: 'error' })
  } else if (result.hint) {
    ui.toast(result.hint, { tone: 'info' })
  }
}
</script>

<template>
  <div class="ws" :data-wide="isWide">
    <ViewportDiagnostics v-if="route.query.viewportDebug === '1'" />
    <header class="ws__topbar">
      <div class="ws__left">
        <AppButton
          v-if="!isWide"
          size="sm"
          variant="ghost"
          class="ws__menu"
          aria-label="打开导航"
          data-testid="nav-toggle"
          @click="drawerOpen = !drawerOpen"
        >
          ☰
        </AppButton>
        <span class="ws__brand">捡手机模拟器</span><span class="ws__name" :title="project?.name">
          {{ project?.name ?? '载入中…' }}
        </span>
      </div>

      <div class="ws__right">
        <SaveStatus v-if="ready" />
        <AppButton
          v-if="route.name === 'preview'"
          size="sm"
          :disabled="!ready"
          data-testid="back-to-edit"
          @click="backToEdit"
        >
          返回编辑
        </AppButton>
        <AppButton
          v-else
          size="sm"
          :disabled="!ready"
          data-testid="open-preview"
          @click="openPreview"
        >
          {{ isNarrow ? '预览' : '预览作品' }}
        </AppButton>
        <!--
          只读（失锁）时不允许导出：内存里的内容写不进原项目，
          导出的会是"一个别人的作品 + 我的改动"混在一起的版本。
        -->
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!ready || exporting || Boolean(editor.readOnlyReason)"
          data-testid="export-work"
          @click="openExportPanel"
        >
          {{ exporting ? '准备中…' : isNarrow ? '导出' : '导出作品' }}
        </AppButton>
      </div>
    </header>

    <ReadOnlyBanner />

    <div class="ws__body">
      <aside v-if="isWide" class="ws__nav" data-testid="workspace-nav">
        <div class="ws__nav-groups">
          <nav v-for="group in navGroups" :key="group.title" class="nav-group">
            <p class="nav-group__title">{{ group.title }}</p>
            <RouterLink
              v-for="item in group.items"
              :key="item.key"
              :to="item.to"
              class="nav-item"
              :class="{ 'nav-item--active': isActive(item) }"
            >
              <AppIcon :name="item.key.replace('app-', '')" />
              <span class="nav-item__label">{{ item.label }}</span>
            </RouterLink>
          </nav>
        </div>
        <button class="ws__back" type="button" @click="goProjects">
          返回作品列表
        </button>
      </aside>

      <dialog
        v-if="!isWide"
        ref="navDialog"
        class="ws__drawer"
        aria-label="工作区导航"
        data-testid="nav-drawer"
        @cancel="drawerOpen=false"
        @close="drawerOpen=false"
        @click.self="drawerOpen = false"
      >
        <div class="ws__drawer-panel">
          <div class="ws__nav-groups">
            <nav v-for="group in navGroups" :key="group.title" class="nav-group">
              <p class="nav-group__title">{{ group.title }}</p>
              <RouterLink
                v-for="item in group.items"
                :key="item.key"
                :to="item.to"
                class="nav-item"
                :class="{ 'nav-item--active': isActive(item) }"
                @click="drawerOpen = false"
              >
                <AppIcon :name="item.key.replace('app-', '')" />
                <span class="nav-item__label">{{ item.label }}</span>
              </RouterLink>
            </nav>
          </div>
          <button class="ws__back" type="button" @click="goProjects">
            返回作品列表
          </button>
        </div>
      </dialog>

      <main class="ws__main">
        <p v-if="!ready" class="ws__loading">正在打开作品…</p>
        <RouterView v-else />
      </main>
    </div>

    <ExportPanel
      :open="exportPanelOpen"
      :project="project"
      @close="exportPanelOpen = false"
      @exported="onExported"
      @failed="(message) => ui.toast(message, { tone: 'error' })"
    />
  </div>
</template>

<style scoped>
.ws{height:var(--creator-viewport-height,100%);overflow:hidden;display:flex;flex-direction:column;background:var(--c-bg)}
.ws__topbar{min-height:64px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 28px;border-bottom:1px solid var(--c-border);background:white}
.ws__left,.ws__right{display:flex;align-items:center;gap:20px;min-width:0}.ws__left{flex:1}.ws__right{flex:none}
.ws__brand{font-weight:650;font-size:16px;white-space:nowrap;padding-right:28px;border-right:1px solid var(--c-border)}.ws__name{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.ws__menu{width:36px;padding:0;font-size:22px}
.ws__body{flex:1;display:flex;min-height:0}.ws__nav{width:var(--layout-nav-w);flex:none;display:flex;flex-direction:column;padding:28px 14px 16px;border-right:1px solid var(--c-border);background:var(--c-white)}
.ws__nav-groups{flex:1;min-height:0;overflow:auto;scrollbar-width:none}.ws__nav-groups::-webkit-scrollbar{display:none}.nav-group+.nav-group{margin-top:30px}.nav-group__title{padding:0 18px 12px;font-size:13px;font-weight:600}
.nav-item{display:flex;align-items:center;gap:14px;min-height:46px;padding:9px 16px;color:var(--c-text-2);border-radius:13px;position:relative}.nav-item svg{width:20px;height:20px;flex:none}.nav-item:hover{background:var(--c-bg-raised);color:var(--c-text)}.nav-item--active{background:var(--c-selected);color:var(--c-text);font-weight:600}.nav-item--active svg{background:white;box-sizing:content-box;padding:7px;margin:-7px;border-radius:10px;box-shadow:var(--shadow-sm)}.nav-item__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws__back{width:100%;min-height:46px;flex:none;margin-top:24px;padding:0 16px;display:flex;align-items:center;justify-content:center;border:1px solid var(--c-border);border-radius:13px;background:transparent;color:var(--c-text-2);font-size:13px;transition:background var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease)}.ws__back:hover{background:var(--c-bg-raised);border-color:var(--c-border-strong);color:var(--c-text)}
.ws__main{flex:1;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain}.ws__loading{padding:32px;color:var(--c-text-3)}
.ws__drawer{border:0;padding:0;margin:0;width:min(240px,88vw);height:var(--creator-viewport-height,100dvh);max-height:none;color:var(--c-text);background:var(--c-white)}.ws__drawer::backdrop{background:rgb(41 44 41 / 28%)}.ws__drawer-panel{height:100%;display:flex;flex-direction:column;padding:16px 12px}
@media(max-width:1023px){.ws__brand{padding-right:16px}.ws__topbar{padding:12px 18px}.ws__left,.ws__right{gap:12px}}
@media(max-width:767px){.ws__topbar{display:flex;gap:8px;padding:8px 12px;min-height:60px}.ws__left{flex:1;min-width:0;gap:6px}.ws__brand{display:none}.ws__name{flex:1;font-size:14px}.ws__right{flex:none;gap:8px}.ws__right :deep(.save-status){flex:none;margin:0;padding:0;font-size:12px;height:auto;min-height:44px;gap:4px}.ws__right :deep(.save-status__retry){min-width:44px;min-height:44px;font-size:12px}.ws__right :deep(.save-status__hint){display:none}.ws__right>.ui-btn{min-width:44px;min-height:44px;padding:8px;font-size:12px;white-space:nowrap}.ws__menu{width:44px;min-width:44px;min-height:44px;padding:0}}
@media(max-width:359px){.ws__topbar{padding:8px;gap:4px}.ws__left{gap:0}.ws__right{gap:4px}}
</style>
