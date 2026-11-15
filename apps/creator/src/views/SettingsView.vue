<script setup>

import { computed, ref } from 'vue'
import { FRAME_MODE, TIME_FORMAT, WIFI_NAME_MAX_LENGTH, WALLPAPER_PRESETS } from '@phone-sim/shared'
import LockScreen from '@phone-sim/player-ui/kernel/LockScreen.vue'
import DevicePreview from '../components/workspace/DevicePreview.vue'
import { useProjectStore } from '../stores/project.js'
import { useUiStore } from '../stores/ui.js'
import { prepareImage } from '../media/compress-image.js'
import { useAssetUrls } from '../composables/use-asset-urls.js'
import AppButton from '../components/ui/AppButton.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppSelect from '../components/ui/AppSelect.vue'
import AppSwitch from '../components/ui/AppSwitch.vue'
import AppUploadButton from '../components/ui/AppUploadButton.vue'

const editor = useProjectStore()
const ui = useUiStore()
const uploading = ref(false)

const project = computed(() => editor.project)
const readOnly = computed(() => editor.isReadOnly)

const settings = computed(() => project.value?.workSettings ?? {})

const characters = computed(() => project.value?.characters ?? [])

const ownerOptions = computed(() =>
  characters.value.map((c) => ({ value: c.id, label: c.name || '未命名角色' })),
)

const wallpaperPresets = WALLPAPER_PRESETS

/** 壁纸底座：自定义图丢了（资源被清、读者删了 assets/）时按这个渐变兜底 */
const FALLBACK_PRESET_ID = WALLPAPER_PRESETS[0].id

const activePresetId = computed(() =>
  settings.value.wallpaper?.type === 'preset' ? settings.value.wallpaper.presetId : null,
)

/** 自定义壁纸的 assetId —— 只有真的在用自定义时才非空 */
const customWallpaperId = computed(() =>
  settings.value.wallpaper?.type === 'asset' ? settings.value.wallpaper.assetId ?? null : null,
)

/** 自定义壁纸缩略图地址。objectURL 的生命周期由 useAssetUrls 管，这里只读 */
const { urls: wallpaperUrls } = useAssetUrls(editor, () => [customWallpaperId.value])
const customWallpaperUrl = computed(() =>
  customWallpaperId.value ? wallpaperUrls.value.get(customWallpaperId.value) ?? null : null,
)

const resolveWallpaperAsset = id => wallpaperUrls.value.get(id) ?? null

const timeFormatOptions = [
  { value: TIME_FORMAT.H12, label: '12 小时制' },
  { value: TIME_FORMAT.H24, label: '24 小时制' },
]

const passcodeLengthOptions = [
  { value: 4, label: '4 位数字' },
  { value: 6, label: '6 位数字' },
]

/** 浅合并 workSettings：漏了展开会把同组其他字段清空 */
function patchSettings(patch) {
  if (readOnly.value) return
  editor.patch({
    workSettings: { ...settings.value, ...patch },
  })
}

const phoneNameModel = computed({
  get: () => settings.value.phoneName ?? '',
  set: (value) => patchSettings({ phoneName: value }),
})

const ownerModel = computed({
  get: () => settings.value.ownerCharacterId ?? '',
  set: (value) => patchSettings({ ownerCharacterId: value || null }),
})

const timeFormatModel = computed({
  get: () => settings.value.timeFormat ?? TIME_FORMAT.H24,
  set: (value) => patchSettings({ timeFormat: value }),
})

const autoFullscreenModel = computed({
  get: () => Boolean(settings.value.autoFullscreen),
  set: (value) => patchSettings({ autoFullscreen: Boolean(value) }),
})

const storyDateModel = computed({
  get: () => settings.value.storyDate ?? '',
  set: (value) => patchSettings({ storyDate: value || null }),
})

const passcodeEnabledModel = computed({
  get: () => Boolean(settings.value.passcodeEnabled),
  set: (value) => {
    // 关闭时保留已输入的密码：用户常常是"先关掉看看效果"，再打开时不该白输一遍
    patchSettings({ passcodeEnabled: value })
  },
})

const alwaysFrameModel = computed({
  get: () => settings.value.frameMode === FRAME_MODE.ALWAYS,
  set: (value) => patchSettings({ frameMode: value ? FRAME_MODE.ALWAYS : FRAME_MODE.AUTO }),
})

const passcodeLengthModel = computed({
  get: () => Number(settings.value.passcodeLength ?? 4),
  set: (value) => {
    const length = Number(value) === 6 ? 6 : 4
    // 换成更短的位数时截断密码，否则会出现"密码 6 位但界面只画 4 个点"
    const current = String(settings.value.passcode ?? '')
    patchSettings({ passcodeLength: length, passcode: current.slice(0, length) })
  },
})

const passcodeModel = computed({
  get: () => settings.value.passcode ?? '',
  set: (value) => {
    const digits = String(value).replace(/\D/g, '').slice(0, settings.value.passcodeLength ?? 4)
    patchSettings({ passcode: digits })
  },
})

const passcodeError = computed(() => {
  if (!settings.value.passcodeEnabled) return ''
  const want = settings.value.passcodeLength ?? 4
  const got = String(settings.value.passcode ?? '').length
  if (got === 0) return `还没输入密码，作品会直接进入桌面。`
  if (got < want) return `还差 ${want - got} 位。`
  return ''
})

/* ── 应用设定：照片两把相簿密码锁 + 设置应用的 Wi-Fi 名 ──────────────────
 * 数据挂在 workSettings.appSettings 下。注意 patchSettings 是**浅合并**，
 * 改里层字段必须自己把 appSettings、photoLocks 两层都展开，否则同组另一把锁
 * 会被整组抹掉（和直接 patch({ workSettings: { phoneName } }) 抹掉壁纸同一个坑）。
 */
const appSettings = computed(() => settings.value.appSettings ?? {})

function patchAppSettings(patch) {
  patchSettings({ appSettings: { ...appSettings.value, ...patch } })
}

/** 读一把锁，补齐默认值 —— 旧项目没有这个字段时不能让模板读到 undefined */
function readLock(kind) {
  return { enabled: false, length: 4, passcode: '', ...(appSettings.value.photoLocks?.[kind] ?? {}) }
}

function patchLock(kind, patch) {
  const locks = { ...(appSettings.value.photoLocks ?? {}) }
  patchAppSettings({ photoLocks: { ...locks, [kind]: { ...readLock(kind), ...patch } } })
}

/**
 * 给一把锁生成四个 model。和锁屏「解锁密码」完全同构：
 * 关开关不清密码（先关掉看看效果、再打开不该白输一遍）、换短位数截断密码、
 * 只留数字。解构到顶层常量是为了让模板能自动 unwrap ref ——
 * 直接写 `hiddenLock.enabled` 不会 unwrap（ref 藏在普通对象属性里）。
 */
function makeLockModels(kind) {
  const enabled = computed({
    get: () => Boolean(readLock(kind).enabled),
    set: (value) => patchLock(kind, { enabled: Boolean(value) }),
  })
  const length = computed({
    get: () => (Number(readLock(kind).length) === 6 ? 6 : 4),
    set: (value) => {
      const next = Number(value) === 6 ? 6 : 4
      patchLock(kind, { length: next, passcode: String(readLock(kind).passcode ?? '').slice(0, next) })
    },
  })
  const passcode = computed({
    get: () => String(readLock(kind).passcode ?? ''),
    set: (value) => patchLock(kind, {
      passcode: String(value).replace(/\D/g, '').slice(0, Number(readLock(kind).length) === 6 ? 6 : 4),
    }),
  })
  /** 开关开着但密码没填满 = 作品端不上锁，这里提前说清，免得作者以为设好了 */
  const error = computed(() => {
    if (!readLock(kind).enabled) return ''
    const want = Number(readLock(kind).length) === 6 ? 6 : 4
    const got = String(readLock(kind).passcode ?? '').length
    if (got === 0) return '还没输入密码，相簿不会上锁。'
    if (got < want) return `还差 ${want - got} 位，相簿不会上锁。`
    return ''
  })
  return { enabled, length, passcode, error }
}

const {
  enabled: hiddenEnabledModel,
  length: hiddenLengthModel,
  passcode: hiddenPasscodeModel,
  error: hiddenLockError,
} = makeLockModels('hidden')
const {
  enabled: trashEnabledModel,
  length: trashLengthModel,
  passcode: trashPasscodeModel,
  error: trashLockError,
} = makeLockModels('trash')

const wifiNameModel = computed({
  get: () => String(appSettings.value.wifiName ?? ''),
  set: (value) => patchAppSettings({ wifiName: String(value).slice(0, WIFI_NAME_MAX_LENGTH) }),
})

function selectWallpaper(presetId) {
  if (readOnly.value || uploading.value) return
  // 先记下旧图：patch 之后 customWallpaperId 会立刻变 null，晚一步就回收不到
  const previous = customWallpaperId.value
  patchSettings({
    wallpaper: { type: 'preset', presetId, assetId: null },
  })
  dropAsset(previous)
}

/**
 * 上传自定义壁纸。
 *
 * presetId 必须一并留下：它是图片缺失时的兜底。读者可能删了 assets 目录、
 * 也可能只把 index.html 发出去 —— 那种情况下白屏比"退回渐变"难看得多。
 */
async function onWallpaperFiles(files) {
  const file = files?.[0]
  if (!file || readOnly.value || uploading.value) return
  uploading.value = true
  try {
    const prepared = await prepareImage(file)
    const meta = await editor.addAsset(prepared)
    const previous = customWallpaperId.value
    patchSettings({
      wallpaper: {
        type: 'asset',
        assetId: meta.id,
        presetId: settings.value.wallpaper?.presetId ?? FALLBACK_PRESET_ID,
      },
    })
    await dropAsset(previous)
  } catch (error) {
    ui.toast(error?.message ?? '壁纸上传失败。', { tone: 'error' })
  } finally {
    uploading.value = false
  }
}

/** 回到渐变壁纸：先落回预设，再回收那张没人再引用的图 */
async function clearCustomWallpaper() {
  if (readOnly.value || uploading.value || !customWallpaperId.value) return
  if (!(await ui.confirm({ title: '清除自定义壁纸？', message: '将移除当前自定义壁纸，并恢复为预设壁纸。', confirmText: '清除', tone: 'danger' }))) return
  const previous = customWallpaperId.value
  patchSettings({
    wallpaper: {
      type: 'preset',
      assetId: null,
      presetId: settings.value.wallpaper?.presetId ?? FALLBACK_PRESET_ID,
    },
  })
  await dropAsset(previous)
}

/** 换成新图 / 切回预设之后，旧的那张就没人引用了 —— 不留着让项目慢慢变胖 */
async function dropAsset(assetId) {
  if (!assetId) return
  try {
    await editor.removeAsset(assetId)
  } catch {
    // 回收失败不算错误：图还在项目里，最坏情况只是多占一点空间
  }
}
</script>

<template>
  <div v-if="project" class="settings" data-testid="settings-editor">
    <h1 class="sr-only">作品设置</h1>
    <div class="settings-form">
      <section id="settings-identity" class="settings-group" aria-labelledby="identity-heading">
        <header class="settings-group__intro"><h2 id="identity-heading">手机身份</h2><p>设定手机的名称与所属人。</p></header>
        <div class="settings-group__body identity-fields">
          <div class="setting-row"><label for="phone-name">手机名称</label><AppInput id="phone-name" v-model="phoneNameModel" :maxlength="60" :disabled="readOnly" placeholder="例如：林夏的手机" data-testid="phone-name" /></div>
          <div class="setting-row"><label for="owner">所属人</label><AppSelect id="owner" v-model="ownerModel" :options="ownerOptions" :disabled="readOnly || characters.length === 0" placeholder="未指定" :aria-describedby="characters.length ? undefined : 'owner-hint'" /></div>
          <p v-if="!characters.length" id="owner-hint" class="setting-hint identity-fields__hint">还没有角色。先到「角色与账号」建一个，再回来选所属人。</p>
        </div>
      </section>

      <section id="settings-appearance" class="settings-group" aria-labelledby="appearance-heading">
        <header class="settings-group__intro"><h2 id="appearance-heading">外观</h2><p>设置手机壁纸的样式。</p></header>
        <div class="setting-row setting-row--top">
          <span id="wallpaper-label" class="setting-label">壁纸预设</span>
          <div class="wall-block">
            <div class="walls" role="radiogroup" aria-labelledby="wallpaper-label">
              <label v-for="preset in wallpaperPresets" :key="preset.id" class="wall" :class="{ 'wall--active': activePresetId === preset.id }">
                <input type="radio" name="wallpaper" :value="preset.id" :checked="activePresetId === preset.id" :disabled="readOnly || uploading" @change="selectWallpaper(preset.id)" />
                <span class="wall__swatch" :style="{ background: preset.css }"></span>
                <span class="wall__label">{{ preset.label }}</span>
              </label>
            </div>
            <div class="wall-custom">
              <figure v-if="customWallpaperUrl" class="wall-custom__status">
                <img class="wall__swatch" :src="customWallpaperUrl" alt="" />
                <figcaption>自定义</figcaption>
              </figure>
              <div class="wall-custom__actions">
                <AppUploadButton :multiple="false" :disabled="readOnly || uploading" test-id="wallpaper-upload" @files="onWallpaperFiles">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>
                  {{ uploading ? '处理中…' : '上传自定义' }}
                </AppUploadButton>
                <AppButton :disabled="readOnly || uploading || !customWallpaperId" data-testid="wallpaper-clear" @click="clearCustomWallpaper">清除自定义</AppButton>
              </div>
              <p v-if="customWallpaperId && !customWallpaperUrl" class="setting-hint wall-custom__missing" role="status">自定义图片不可用，将使用预设壁纸。</p>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-lock" class="settings-group" aria-labelledby="lock-heading">
        <header class="settings-group__intro"><h2 id="lock-heading">锁屏</h2><p>设置手机的解锁方式。</p></header>
        <div class="settings-group__body">
          <div class="setting-row">
            <span id="time-format-label" class="setting-label">时间格式</span>
            <div class="segments" role="radiogroup" aria-labelledby="time-format-label">
              <label v-for="(option, index) in timeFormatOptions" :key="option.value"><input :id="index === 0 ? 'time-format' : undefined" v-model="timeFormatModel" type="radio" name="time-format" :value="option.value" :disabled="readOnly" /><span>{{ option.label }}</span></label>
            </div>
          </div>
          <div class="setting-row setting-row--top">
            <label for="passcode-enabled">解锁密码</label>
            <div class="passcode-fields">
              <AppSwitch id="passcode-enabled" v-model="passcodeEnabledModel" :disabled="readOnly" :label="settings.passcodeEnabled ? '已开启' : '未开启'" />
              <div v-if="settings.passcodeEnabled" class="passcode-fields__entry">
                <div class="segments" role="radiogroup" aria-label="密码位数">
                  <label v-for="(option, index) in passcodeLengthOptions" :key="option.value"><input :id="index === 0 ? 'passcode-length' : undefined" v-model="passcodeLengthModel" type="radio" name="passcode-length" :value="option.value" :disabled="readOnly" /><span>{{ option.label }}</span></label>
                </div>
                <AppInput id="passcode" v-model="passcodeModel" :maxlength="settings.passcodeLength ?? 4" :disabled="readOnly" mono inputmode="numeric" placeholder="输入数字密码" aria-label="解锁密码" :aria-invalid="Boolean(passcodeError)" :aria-describedby="passcodeError ? 'passcode-error' : undefined" data-testid="passcode" />
              </div>
              <p v-if="passcodeError" id="passcode-error" class="setting-error" role="status">{{ passcodeError }}</p>
            </div>
          </div>
        </div>
      </section>

      <section id="settings-apps" class="settings-group" aria-labelledby="apps-heading" data-testid="settings-apps">
        <header class="settings-group__intro"><h2 id="apps-heading">应用设定</h2><p>设置应用内的访问限制与显示内容。</p></header>
        <div class="settings-group__body app-settings">
          <div class="app-locks">
            <div class="setting-row app-lock">
              <label for="hidden-lock-enabled">隐藏相册密码</label>
              <div class="passcode-fields">
                <AppSwitch id="hidden-lock-enabled" v-model="hiddenEnabledModel" :disabled="readOnly" :label="hiddenEnabledModel ? '已开启' : '未开启'" data-testid="hidden-lock-enabled" />
                <div v-if="hiddenEnabledModel" class="passcode-fields__entry">
                  <div class="segments" role="radiogroup" aria-label="隐藏相册密码位数">
                    <label v-for="option in passcodeLengthOptions" :key="option.value"><input v-model="hiddenLengthModel" type="radio" name="hidden-lock-length" :value="option.value" :disabled="readOnly" /><span>{{ option.label }}</span></label>
                  </div>
                  <AppInput id="hidden-lock-passcode" v-model="hiddenPasscodeModel" :maxlength="6" :disabled="readOnly" mono inputmode="numeric" placeholder="输入数字密码" aria-label="隐藏相册密码" data-testid="hidden-lock-passcode" />
                </div>
                <p v-if="hiddenLockError" class="setting-error" role="status">{{ hiddenLockError }}</p>
              </div>
            </div>

            <div class="setting-row app-lock">
              <label for="trash-lock-enabled">删除相册密码</label>
              <div class="passcode-fields">
                <AppSwitch id="trash-lock-enabled" v-model="trashEnabledModel" :disabled="readOnly" :label="trashEnabledModel ? '已开启' : '未开启'" data-testid="trash-lock-enabled" />
                <div v-if="trashEnabledModel" class="passcode-fields__entry">
                  <div class="segments" role="radiogroup" aria-label="删除相册密码位数">
                    <label v-for="option in passcodeLengthOptions" :key="option.value"><input v-model="trashLengthModel" type="radio" name="trash-lock-length" :value="option.value" :disabled="readOnly" /><span>{{ option.label }}</span></label>
                  </div>
                  <AppInput id="trash-lock-passcode" v-model="trashPasscodeModel" :maxlength="6" :disabled="readOnly" mono inputmode="numeric" placeholder="输入数字密码" aria-label="删除相册密码" data-testid="trash-lock-passcode" />
                </div>
                <p v-if="trashLockError" class="setting-error" role="status">{{ trashLockError }}</p>
              </div>
            </div>
          </div>

          <div class="app-wifi">
            <label for="wifi-name" class="setting-label">Wi-Fi 名称</label>
            <AppInput id="wifi-name" v-model="wifiNameModel" :maxlength="WIFI_NAME_MAX_LENGTH" :disabled="readOnly" placeholder="例如：Linxia Home" aria-describedby="wifi-name-hint" data-testid="wifi-name" />
            <span id="wifi-name-hint" class="setting-hint">将在「设置」应用的 Wi-Fi 界面中显示。</span>
          </div>
        </div>
      </section>

      <section id="settings-story" class="settings-group" aria-labelledby="story-heading">
        <header class="settings-group__intro"><h2 id="story-heading">故事时间</h2><p>设定故事发生的日期范围。</p></header>
        <div class="setting-row">
          <label for="story-date">故事日期</label>
          <div class="story-fields">
            <AppInput id="story-date" v-model="storyDateModel" type="date" :disabled="readOnly" aria-describedby="story-date-hint" />
            <AppButton :disabled="readOnly || !storyDateModel" data-testid="story-date-clear" @click="storyDateModel = ''">清空</AppButton>
            <span id="story-date-hint" class="setting-hint">留空使用当前日期。</span>
          </div>
        </div>
      </section>

      <section id="settings-display" class="settings-group" aria-labelledby="display-heading">
        <header class="settings-group__intro"><h2 id="display-heading">浏览方式</h2><p>设置作品在阅读时的呈现方式。</p></header>
        <div class="settings-group__body">
          <div class="setting-row setting-row--switch">
            <label for="frame-mode">始终显示手机外框</label>
            <AppSwitch id="frame-mode" v-model="alwaysFrameModel" :disabled="readOnly" aria-describedby="frame-hint" data-testid="frame-mode" />
            <p id="frame-hint" class="setting-hint">关闭后根据窗口自适应显示。</p>
          </div>
          <div class="setting-row setting-row--switch">
            <label for="auto-fullscreen">自动全屏</label>
            <AppSwitch id="auto-fullscreen" v-model="autoFullscreenModel" :disabled="readOnly" aria-describedby="fullscreen-hint" data-testid="auto-fullscreen" />
            <p id="fullscreen-hint" class="setting-hint">需读者首次点击后生效，创作端预览不生效。</p>
          </div>
        </div>
      </section>
    </div>
    <aside class="settings-preview" aria-label="锁屏预览">
      <DevicePreview class="settings-preview__phone" :time-format="settings.timeFormat" inert>
        <LockScreen :work-settings="settings" :resolve-asset="resolveWallpaperAsset" />
      </DevicePreview>
      <p>锁屏预览</p>
    </aside>
  </div>
</template>

<style scoped>
.settings{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:clamp(32px,5vw,88px);max-width:1420px;margin:0 auto;padding:40px 48px;min-width:0;align-items:start}
.settings-form{min-width:0}.settings-group{margin:0 0 28px;min-width:0}.settings-group:last-child{margin-bottom:0}
.settings-group__intro h2{font:600 21px/1.5 var(--font-story);margin:0 0 12px}.settings-group__intro p{display:none}
.settings-group__body{display:grid;gap:18px;min-width:0}.identity-fields,#settings-lock>.settings-group__body{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.setting-row{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0}.setting-row>label,.setting-label{font-size:13px;color:var(--c-text)}
.setting-row :deep(.ui-input),.setting-row :deep(.ui-select){min-height:36px;font-size:14px;padding:7px 10px;border-radius:6px;min-width:0}
.identity-fields__hint{grid-column:1/-1}.setting-hint,.setting-error{font-size:12px;line-height:1.6;color:var(--c-text-3);margin:0}.setting-error{color:var(--c-danger)}
#wallpaper-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.wall-block{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap;min-width:0}.walls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;flex:1;min-width:280px;max-width:480px}
.wall{position:relative;display:grid;gap:8px;text-align:center;cursor:pointer;font-size:12px;color:var(--c-text-2)}
.wall input,.segments input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.wall__swatch{display:block;width:100%;height:62px;border-radius:7px;border:1px solid var(--c-border)}
.wall input:checked+.wall__swatch{outline:1px solid var(--c-text);outline-offset:3px}.wall input:focus-visible+.wall__swatch{box-shadow:0 0 0 5px var(--c-accent-weak)}.wall:has(input:disabled){opacity:.5;cursor:not-allowed}
.wall-custom{display:grid;grid-template-columns:auto auto;align-items:start;gap:8px 20px;min-width:0}.wall-custom__actions{display:flex;flex-direction:column;gap:4px;align-items:stretch}.wall-custom__actions :deep(.ui-btn){min-height:32px;font-size:12px;padding:4px 12px}.wall-custom__actions :deep(.ui-upload .ui-btn){width:100%}.wall-custom__actions>.ui-btn{border-color:transparent;color:var(--c-text-3)}
.wall-custom__status{display:grid;gap:8px;width:52px;margin:0;text-align:center;font-size:12px;color:var(--c-text-2)}.wall-custom__status img{object-fit:cover}.wall-custom__missing{grid-column:1/-1}
.segments{display:flex;align-self:flex-start;min-width:0;border:1px solid var(--c-border);border-radius:6px;overflow:hidden}.segments label{position:relative;flex:1;cursor:pointer}.segments span{display:flex;align-items:center;justify-content:center;min-height:32px;padding:0 16px;font-size:13px;white-space:nowrap}.segments input:checked+span{background:var(--c-selected);border-radius:5px}.segments input:focus-visible+span{outline:2px solid var(--c-text-3);outline-offset:-3px}.segments label:has(input:disabled){opacity:.5;cursor:not-allowed}
.passcode-fields{display:grid;gap:12px;min-width:0}.passcode-fields>.ui-switch{min-height:32px}.passcode-fields :deep(.ui-switch__label){font-size:13px}.passcode-fields__entry{display:flex;gap:10px;flex-wrap:wrap;min-width:0}.passcode-fields__entry>.ui-input{width:110px;flex:1;min-width:90px}
/* 应用设定：两把相簿密码锁并排一行，各自照抄锁屏「解锁密码」的竖排版式；
   Wi-Fi 名称跟在下面一行。组内不画分隔线（细线把一组内容切碎了）。 */
.app-settings{display:grid;gap:24px;min-width:0}
.app-locks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;min-width:0}
.app-lock .passcode-fields__entry>.ui-input{max-width:150px}
.app-wifi{display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-width:0}
.app-wifi>.setting-label{flex:none;min-width:112px}
.app-wifi>.ui-input{flex:0 1 220px;min-width:120px;max-width:220px}
.app-wifi>.setting-hint{flex:1 1 180px;min-width:0}
@media(max-width:767px){.app-locks{grid-template-columns:1fr;gap:20px}.app-wifi>.ui-input{flex:1 1 100%;max-width:none}}
.story-fields{display:flex;align-items:center;gap:16px;flex-wrap:wrap;min-width:0}.story-fields>.ui-input{flex:none;width:210px;max-width:100%}.story-fields .ui-btn{font-size:12px;min-height:32px}
.setting-row--switch{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 20px;align-items:center}.setting-row--switch>.ui-switch{grid-column:2;grid-row:1/3}.setting-row--switch>.setting-hint{grid-column:1;grid-row:2}
.settings-preview{position:sticky;top:40px;align-self:start;padding-top:88px;text-align:center;min-width:0}.settings-preview>p{font-size:13px;color:var(--c-text-3);margin-top:18px}
/* 预览固定在视口里，不随表单滚动；右列用等宽占位撑住栅格，否则列会塌 */
@media(min-width:768px){
  .settings{--preview-col:270px}
  .settings::after{content:'';grid-column:2;grid-row:1;width:var(--preview-col);pointer-events:none}
  .settings-preview{position:fixed;top:40px;right:96px;width:var(--preview-col);z-index:2;padding-top:88px;pointer-events:none}
  .settings-preview__phone{pointer-events:auto}
}
@media(max-width:1439px){.settings{padding:32px;grid-template-columns:minmax(0,1fr) 230px;gap:36px;--preview-col:230px}.walls{gap:16px}.settings-preview{right:64px}}
@media(max-width:1100px){.settings{grid-template-columns:minmax(0,1fr) 200px;gap:28px;padding:28px;--preview-col:200px}.settings-preview{right:56px}.identity-fields,#settings-lock>.settings-group__body{grid-template-columns:1fr;gap:18px}}
@media(max-width:767px){.settings{display:flex;flex-direction:column;padding:28px 20px;gap:32px}.settings-form{width:100%}.settings-group{margin-bottom:28px}.settings-group__intro h2{font-size:20px}.identity-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.walls{min-width:0;width:100%;flex:none;gap:16px}.wall-block{gap:18px}.wall__swatch{height:58px}.settings-preview{position:static;align-self:center;padding:0;width:220px}.segments span{min-height:36px;padding:0 16px}.passcode-fields__entry>.ui-input{max-width:160px}.story-fields{gap:12px}.story-fields .setting-hint{flex-basis:100%}.setting-row--switch>.ui-switch{min-height:44px}.wall-custom__actions :deep(.ui-btn){min-height:44px}}
</style>
