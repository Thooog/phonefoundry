<script setup>

import { ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '../stores/projects.js'
import { useUiStore } from '../stores/ui.js'
import { describeImport } from '../import/import-backup.js'
import { formatRelativeTime, formatDateTime } from '../utils/time.js'
import { useMediaQuery } from '../composables/use-media-query.js'
const mobileLibrary=useMediaQuery('(max-width:767px)')
import AppButton from '../components/ui/AppButton.vue'
import AppInput from '../components/ui/AppInput.vue'

const router = useRouter()
const projects = useProjectsStore()
const ui = useUiStore()

const creating = ref(false)
const busyId = ref(null)

/** 导入中：文件可能几十 MB，解析 + 写库要几百毫秒，期间按钮要禁用 */
const importing = ref(false)
/** 隐藏的文件选择框，由「导入项目」按钮代点 */
const importFileInput = ref(null)

const renamingId = ref(null)
const renameDraft = ref('')

/**
 * 重命名输入框的 DOM 引用。
 *
 * 不能用 `ref="x"`：这些卡片在 v-for 里，Vue 3 会把 ref 收集成数组，
 * 拿到的不是元素而是数组，focus() 直接报错。
 * 用回调 ref 只保留最后一个挂载的元素 —— 同一时刻最多只有一个重命名输入框。
 */
let renameEl = null
function captureRenameInput(elOrComponent) {
  renameEl = elOrComponent
}

function dismissCardMenus(event) {
  if (event.type === 'keydown' && event.key !== 'Escape') return
  document.querySelectorAll('.card__menu[open]').forEach(menu => {
    if (event.type === 'keydown' || !menu.contains(event.target)) menu.removeAttribute('open')
  })
}
onMounted(() => {
  loadList()
  document.addEventListener('pointerdown', dismissCardMenus)
  document.addEventListener('keydown', dismissCardMenus)
})

async function loadList() {
  try {
    await projects.load()
  } catch (err) {
    // store 已经把错误转成可读文案；没有缓存时才会抛到这里
    ui.toast(err?.message ?? '读取项目失败。', { tone: 'error' })
  }
}

// ───────────────────── 新建 ─────────────────────

async function createProject() {
  if (creating.value) return
  creating.value = true
  try {
    const project = await projects.create({})
    ui.toast('已新建作品。', { tone: 'success' })
    router.push({ name: 'overview', params: { projectId: project.id } })
  } catch (err) {
    ui.toast(err?.message ?? '新建项目失败。', { tone: 'error' })
  } finally {
    creating.value = false
  }
}

async function createSample() {
  if (creating.value) return
  creating.value = true
  try {
    const project = await projects.createSample({})
    ui.toast('已载入示例作品，可以随意改动。', { tone: 'success' })
    router.push({ name: 'overview', params: { projectId: project.id } })
  } catch (err) {
    ui.toast(err?.message ?? '载入示例失败。', { tone: 'error' })
  } finally {
    creating.value = false
  }
}

// ───────────────────── 打开 ─────────────────────

function openProject(item) {
  if (renamingId.value === item.id) return
  router.push({ name: 'overview', params: { projectId: item.id } })
}

// ───────────────────── 重命名 ─────────────────────

async function startRename(item) {
  renamingId.value = item.id
  renameDraft.value = item.name
  await nextTick()
  // AppInput 是组件，回调 ref 拿到组件实例，要取 $el 才是 input 元素
  const el = renameEl?.$el ?? renameEl
  el?.focus?.()
  el?.select?.()
}

function cancelRename() {
  renamingId.value = null
  renameDraft.value = ''
}

async function commitRename(item) {
  const next = renameDraft.value.trim()
  // 名字没变或清空：等同取消。清空不落盘 —— 空名字会让用户找不到这个项目
  if (!next || next === item.name) {
    cancelRename()
    return
  }

  busyId.value = item.id
  try {
    await projects.rename(item.id, next)
    ui.toast('已重命名。', { tone: 'success' })
  } catch (err) {
    ui.toast(err?.message ?? '重命名失败。', { tone: 'error' })
  } finally {
    busyId.value = null
    cancelRename()
  }
}

// ───────────────────── 复制 / 删除 ─────────────────────

async function duplicateProject(item) {
  busyId.value = item.id
  try {
    const copy = await projects.duplicate(item.id)
    ui.toast(`已复制为「${copy.name}」。`, { tone: 'success' })
  } catch (err) {
    ui.toast(err?.message ?? '复制失败。', { tone: 'error' })
  } finally {
    busyId.value = null
  }
}

async function removeProject(item) {
  const ok = await ui.confirm({
    title: `删除「${item.name}」？`,
    message:
      '这个项目里的角色、平台账号、所有内容与图片都会从这台电脑上删除，无法恢复。\n如果需要保留，可以先复制一份。',
    confirmText: '删除',
    tone: 'danger',
  })
  if (!ok) return

  busyId.value = item.id
  try {
    await projects.remove(item.id)
    ui.toast('已删除。', { tone: 'success' })
  } catch (err) {
    ui.toast(err?.message ?? '删除失败。', { tone: 'error' })
  } finally {
    busyId.value = null
  }
}

/**
 * 导入项目。
 *
 * 用一个隐藏的 `<input type="file">` 而不是拖拽区：
 * 拖拽看着高级，但在"从微信/邮件存下来的文件"这个真实场景里，
 * 用户下一步动作永远是打开文件管理器点"共享到浏览器" —— 那是文件选择器，不是拖拽。
 *
 * 选完立刻把 input 的值清空：不清的话，同一个文件选第二次不会触发 change，
 * 表现为"点导入没反应"（用户刚导入过一次，又点了一次）。
 */
function pickImportFile() {
  if (importing.value) return
  importFileInput.value?.click()
}

async function onImportFileChosen(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (importing.value) return

  importing.value = true
  try {
    const result = await projects.importProject(file)
    // 缺图是"成功但不完整"，用 info 而不是 success —— 绿色对勾会让用户以为一切完美
    ui.toast(describeImport(result), {
      tone: result.missingAssets.length ? 'info' : 'success',
    })
    router.push({ name: 'overview', params: { projectId: result.project.id } })
  } catch (err) {
    ui.toast(err?.message ?? '导入失败。', { tone: 'error' })
  } finally {
    importing.value = false
  }
}
const projectActions = ref(null)
const actionsDialog = ref(null)
let actionsTrigger = null
async function openProjectActions(item, event) {
  actionsTrigger = event.currentTarget
  projectActions.value = item
  await nextTick()
  if (mobileLibrary.value && !actionsDialog.value.open) actionsDialog.value.showModal()
}
function closeProjectActions() {
  actionsDialog.value?.close()
  projectActions.value = null
  if (actionsTrigger?.isConnected) actionsTrigger.focus()
}
function runProjectAction(action) {
  const item = projectActions.value
  closeProjectActions()
  if (item) return action(item)
}
watch(mobileLibrary, mobile => { if (!mobile) closeProjectActions() })
onBeforeUnmount(() => {
  actionsDialog.value?.close()
  document.removeEventListener('pointerdown', dismissCardMenus)
  document.removeEventListener('keydown', dismissCardMenus)
})

</script>

<template>
  <div class="projects">
    <div class="projects__brand">捡手机模拟器</div>
    <header class="projects__head">
      <div class="projects__heading">
        <h1 class="projects__title">我的作品</h1>
        <span v-if="projects.count > 0" class="projects__count">{{ projects.count }} 部作品</span>
      </div>
      <div class="projects__actions">
        <!--
          accept 只列 .zip / .json 两种扩展名；解析层其实按内容判断，
          但让系统文件选择器先帮着过滤一遍，用户少翻一半目录。
        -->
        <input
          ref="importFileInput"
          class="projects__file"
          type="file"
          accept=".zip,.json,application/zip,application/json"
          data-testid="import-file"
          @change="onImportFileChosen"
        />
        <AppButton
          size="sm"
          :disabled="importing"
          data-testid="import-project"
          @click="pickImportFile"
        >
          {{ importing ? '导入中…' : '导入备份' }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="creating"
          data-testid="new-project"
          @click="createProject"
        >
          <span aria-hidden="true">＋</span> 新建作品
        </AppButton>
      </div>
    </header>

    <main class="projects__body">
      <p v-if="projects.loading && projects.count === 0" class="projects__loading">
        正在读取项目…
      </p>

      <div v-else-if="projects.error && projects.count === 0" class="projects__error">
        <p>{{ projects.error.message }}</p>
        <AppButton size="sm" @click="loadList">重试</AppButton>
      </div>

      <div v-else-if="projects.isEmpty" class="empty" data-testid="projects-empty">
        <h2 class="empty__title">还没有任何作品</h2>
        <p class="empty__desc">
          一部作品就是一部"被别人捡到的手机"。先建一个空项目从零开始，
          或者载入示例看看结构长什么样。
        </p>
        <div class="empty__actions">
          <AppButton variant="primary" :disabled="creating" @click="createProject">
            新建空项目
          </AppButton>
          <AppButton :disabled="creating" @click="createSample">
            载入示例作品
          </AppButton>
        </div>
      </div>

      <ul v-else class="grid" data-testid="projects-grid">
        <li
          v-for="item in projects.items"
          :key="item.id"
          class="card"
          :data-busy="busyId === item.id"
          tabindex="0"
          @click="openProject(item)"
          @keydown.enter.self="openProject(item)"
        >
          <p class="card__meta" :title="formatDateTime(item.updatedAt)">{{ formatRelativeTime(item.updatedAt) || '刚创建' }}</p>
          <div class="card__body">
            <div class="card__head">
              <AppInput
                v-if="renamingId === item.id"
                :ref="captureRenameInput"
                v-model="renameDraft"
                :maxlength="80"
                @keydown.enter.prevent="commitRename(item)"
                @keydown.esc.prevent="cancelRename"
                @click.stop
              />
              <div v-if="renamingId === item.id" class="rename-actions" @click.stop><AppButton size="sm" @click="commitRename(item)">确认</AppButton><AppButton size="sm" variant="ghost" @click="cancelRename">取消</AppButton></div><h2 v-else class="card__name" :title="item.name">{{ item.name }}</h2>
            </div>

            <p class="card__description" :class="{ 'is-empty': !item.description }">{{ item.description || '尚未填写作品简介。' }}</p>
          </div>
          <button v-if="mobileLibrary" type="button" class="card__menu-trigger" aria-label="项目操作" aria-haspopup="dialog" data-testid="project-actions-open" @click.stop="openProjectActions(item, $event)"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
          <details v-else class="card__menu" @click.stop @keydown.esc.prevent="$event.currentTarget.removeAttribute('open')">
            <summary aria-label="作品操作"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></summary>
            <div class="card__ops">
              <AppButton size="sm" variant="ghost" @click="$event.currentTarget.closest('details').removeAttribute('open'); startRename(item)">重命名</AppButton>
              <AppButton size="sm" variant="ghost" @click="$event.currentTarget.closest('details').removeAttribute('open'); duplicateProject(item)">复制</AppButton>
              <AppButton size="sm" variant="ghost" @click="$event.currentTarget.closest('details').removeAttribute('open'); removeProject(item)">删除</AppButton>
            </div>
          </details>
          <button type="button" class="card__continue" @click.stop="openProject(item)">继续创作</button>
        </li>
      </ul>
      <footer class="projects__footer">
        <p class="projects__backup">作品保存在当前浏览器本地。建议定期打开项目，导出项目备份包。</p>
        <AppButton variant="ghost" :disabled="creating" data-testid="new-sample" @click="createSample"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v15M12 5C8 2 4 3 3 4v15c3-2 6-1 9 1 3-2 6-3 9-1V4c-3-2-6-1-9 1Z" /></svg>载入示例作品</AppButton>
      </footer>
    </main>
    <Teleport to="body">
      <dialog ref="actionsDialog" class="project-actions-sheet" aria-labelledby="project-actions-title" data-testid="project-actions-sheet" @cancel.prevent="closeProjectActions" @click.self="closeProjectActions">
        <template v-if="projectActions">
          <h2 id="project-actions-title">{{ projectActions.name }}</h2>
          <div class="project-actions-sheet__items">
            <AppButton :disabled="busyId===projectActions.id" data-testid="project-action-open" @click="runProjectAction(openProject)">打开</AppButton>
            <AppButton :disabled="busyId===projectActions.id" data-testid="project-action-rename" @click="runProjectAction(startRename)">重命名</AppButton>
            <AppButton :disabled="busyId===projectActions.id" data-testid="project-action-copy" @click="runProjectAction(duplicateProject)">复制</AppButton>
            <AppButton variant="danger" :disabled="busyId===projectActions.id" data-testid="project-action-delete" @click="runProjectAction(removeProject)">删除</AppButton>
          </div>
          <AppButton class="project-actions-sheet__cancel" data-testid="project-actions-close" @click="closeProjectActions">取消</AppButton>
        </template>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>

.projects{height:100%;display:flex;flex-direction:column;background:var(--c-white);overflow:hidden}
.projects__brand{height:56px;padding:0 28px;display:flex;align-items:center;font-size:16px;font-weight:600;border-bottom:1px solid var(--c-border);flex:none}
.projects__head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:48px 32px 40px;width:100%;max-width:1240px;margin:0 auto;flex:none}
.projects__heading{display:flex;align-items:baseline;gap:18px;min-width:0}.projects__title{font:600 28px/1.5 var(--font-story)}.projects__count{font-size:12px;color:var(--c-text-3);white-space:nowrap}
.projects__actions{display:flex;gap:12px}.projects__actions .ui-btn{min-height:36px;font-size:13px;padding:0 14px}.projects__file{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}
.projects__body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;width:100%;max-width:1240px;margin:auto;padding:0 32px 24px;overscroll-behavior:contain}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;list-style:none;padding:0;margin:0}
.card{position:relative;display:flex;flex-direction:column;min-width:0;min-height:240px;padding:20px;border:1px solid var(--c-border);border-radius:18px;background:var(--c-white);cursor:pointer;transition:border-color var(--dur-fast)}
.card:hover{border-color:var(--c-border-strong)}.card[data-busy=true]{opacity:.6;pointer-events:none}
.card__meta{font-size:12px;line-height:24px;color:var(--c-text-3);padding-right:36px;margin-bottom:12px}.card__body{min-width:0;flex:1}.card__head{min-width:0}.card__name{font:600 22px/1.5 var(--font-story);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card__description{font:400 14px/1.8 var(--font-sans);margin-top:10px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.card__description.is-empty{color:var(--c-text-3)}
.card__continue{align-self:flex-end;display:flex;align-items:center;gap:12px;border:0;background:transparent;font:400 13px/1.5 var(--font-sans);color:#9b5140;padding:12px 0 0;min-height:36px;margin-top:20px;cursor:pointer}
.card__menu,.card__menu-trigger{position:absolute;right:12px;top:12px}.card__menu{width:36px;height:36px}.card__menu summary,.card__menu-trigger{padding:0;line-height:1;letter-spacing:normal}.card__menu summary,.card__menu-trigger{display:grid;place-items:center;list-style:none;width:36px;height:36px;border:0;border-radius:6px;background:transparent;color:var(--c-text);font-size:18px;cursor:pointer}.card__menu summary::-webkit-details-marker{display:none}.card__menu summary:hover,.card__menu-trigger:hover{background:var(--c-bg-sunken)}
.card__ops{position:absolute;z-index:3;right:0;top:40px;display:grid;min-width:130px;padding:6px;border:1px solid var(--c-border);border-radius:10px;background:var(--c-white);box-shadow:var(--shadow-md)}.card__ops .ui-btn{justify-content:start}.card__ops .ui-btn:last-child{color:var(--c-danger)}
.rename-actions{display:flex;gap:6px;margin-top:8px}.projects__footer{margin-top:auto;padding-top:48px;display:flex;align-items:center;justify-content:space-between;gap:24px}.projects__backup{font-size:12px;line-height:1.8;color:var(--c-text-3)}.projects__footer .ui-btn{font-size:12px;flex:none}
.empty{padding:64px 24px;text-align:center}.empty__title{font:600 24px var(--font-story)}.empty__desc{max-width:480px;margin:16px auto 24px;color:var(--c-text-2)}.empty__actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}.projects__loading,.projects__error{padding:40px 0}.projects__error{color:var(--c-danger)}
@media(max-width:1023px){.projects__head{padding-top:36px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}}
@media(max-width:767px){.projects__brand{padding:0 20px}.projects__head{padding:28px 20px;flex-wrap:wrap;gap:20px}.projects__title{font-size:26px}.projects__actions{gap:10px}.projects__body{padding:0 20px 20px}.grid{grid-template-columns:minmax(0,1fr);gap:16px}.card{min-height:220px}.projects__footer{align-items:flex-start;flex-direction:column;gap:14px;padding-top:32px}.projects__footer .ui-btn{align-self:flex-end}.card__menu-trigger{width:44px;height:44px}.card__continue{min-height:44px}.empty{padding:40px 0}}
@media(any-pointer:coarse){.card__menu,.card__menu summary{width:44px;height:44px}}
.project-actions-sheet{position:fixed;width:min(520px,100%);max-width:100%;max-height:90dvh;margin:auto auto 0;padding:22px 18px max(22px,env(safe-area-inset-bottom));border:1px solid var(--c-border);border-radius:18px 18px 0 0;background:white;color:var(--c-text);box-shadow:var(--shadow-lg);overflow:auto}.project-actions-sheet::backdrop{background:rgb(41 44 41 / 32%)}.project-actions-sheet h2{font-size:18px;font-weight:600;overflow-wrap:anywhere;margin:0 0 18px}.project-actions-sheet__items{display:grid;gap:8px}.project-actions-sheet__items>.ui-btn{width:100%;min-height:48px;border-color:transparent;justify-content:start;padding:10px 14px}.project-actions-sheet__cancel{width:100%;min-height:48px;margin-top:18px}
</style>
