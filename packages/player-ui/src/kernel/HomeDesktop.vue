<script setup>
import { computed } from 'vue'
import { HOME_COLUMNS, HOME_DOCK_IDS, HOME_ROWS, hasAppContent, normalizeHomeLayout, resolveHomeLayout, visibleHomeApps } from '@phone-sim/shared'
import HomeLayoutBoard from './HomeLayoutBoard.vue'
import AppIcon from '../symbols/AppIcons.vue'
import { resolveWallpaper } from '../work/wallpaper.js'
import { useTapFeedback } from './use-tap-feedback.js'

const props = defineProps({
  work: { type: Object, default: null },
  resolveAsset: { type: Function, default: null },
  entering: { type: Boolean, default: false },
  editor: { type: Boolean, default: false },
  launchable: { type: Boolean, default: true },
})
const emit = defineEmits(['open'])
const { pinged, pingDown, pingUp, ping } = useTapFeedback()
function open(id) {
  if (!canOpen.value) return
  ping(id)
  if (hasAppContent(props.work, id)) emit('open', id)
}

const workSettings = computed(() => props.work?.workSettings ?? {})
const canOpen = computed(() => props.launchable && !props.editor)
const visibleApps = computed(() => visibleHomeApps(props.work))
const customLayout = computed(() => {
  const layout = normalizeHomeLayout(workSettings.value.homeLayout)
  return layout ? resolveHomeLayout(props.work, layout) : null
})

const dockApps = computed(() =>
  HOME_DOCK_IDS.map((id) => visibleApps.value.find((app) => app.id === id)).filter(Boolean),
)

const gridApps = computed(() => {
  const docked = new Set(HOME_DOCK_IDS)
  return visibleApps.value.filter((app) => !docked.has(app.id))
})

const wallpaper = computed(() => resolveWallpaper(workSettings.value, props.resolveAsset))
</script>

<template>
  <HomeLayoutBoard
    v-if="customLayout"
    data-testid="home-screen"
    :data-columns="HOME_COLUMNS"
    :items="customLayout.items"
    :wallpaper="wallpaper.backgroundImage"
    :story-date="workSettings.storyDate"
    :editor="editor"
    :launchable="launchable"
    @open="hasAppContent(work, $event) && $emit('open', $event)"
  >
    <template v-if="$slots.cells" #cells="scope">
      <slot name="cells" v-bind="scope" />
    </template>
  </HomeLayoutBoard>
  <div
    v-else
    class="pui-home"
    :class="{ 'pui-home--editor': editor }"
    data-testid="home-screen"
    :data-columns="HOME_COLUMNS"
    :data-entering="entering ? 'true' : 'false'"
    :style="{ backgroundImage: wallpaper.backgroundImage, '--pui-home-rows': HOME_ROWS }"
  >
    <div class="pui-home__grid" :role="editor ? undefined : 'grid'" aria-label="应用">
      <component
        :is="canOpen ? 'button' : 'div'"
        v-for="(app, index) in gridApps"
        :key="app.id"
        :type="canOpen ? 'button' : undefined"
        :aria-label="editor ? undefined : app.name"
        :aria-hidden="editor ? 'true' : undefined"
        class="pui-home__app"
        :class="{ 'pui-home__app--pressed': pinged === app.id }"
        :role="editor ? undefined : 'gridcell'"
        :data-testid="`home-app-${app.id}`"
        :style="{ '--pui-i': index }"
        @pointerdown="canOpen && pingDown(app.id)"
        @pointerup="pingUp"
        @pointercancel="pingUp"
        @pointerleave="pingUp"
        @keydown="['Enter', ' '].includes($event.key) && canOpen && pingDown(app.id)"
        @keyup="pingUp"
        @blur="pingUp"
        @click="open(app.id)"
      >
        <span class="pui-home__icon">
          <AppIcon :icon-key="app.iconKey" :accent="app.accent" :size="60" />
        </span>
        <span class="pui-home__label">{{ app.name }}</span>
      </component>
      <div v-if="$slots.cells" class="pui-home__targets">
        <slot name="cells" area="grid" />
      </div>
    </div>

    <div class="pui-home__dock" data-testid="home-dock">
      <component
        :is="canOpen ? 'button' : 'div'"
        v-for="(app, index) in dockApps"
        :key="app.id"
        :type="canOpen ? 'button' : undefined"
        :aria-label="editor ? undefined : app.name"
        :aria-hidden="editor ? 'true' : undefined"
        class="pui-home__app pui-home__app--dock"
        :class="{ 'pui-home__app--pressed': pinged === app.id }"
        :data-testid="`home-dock-${app.id}`"
        :style="{ '--pui-i': gridApps.length + index }"
        @pointerdown="canOpen && pingDown(app.id)"
        @pointerup="pingUp"
        @pointercancel="pingUp"
        @pointerleave="pingUp"
        @keydown="['Enter', ' '].includes($event.key) && canOpen && pingDown(app.id)"
        @keyup="pingUp"
        @blur="pingUp"
        @click="open(app.id)"
      >
        <span class="pui-home__icon">
          <AppIcon :icon-key="app.iconKey" :accent="app.accent" :size="60" />
        </span>
      </component>
      <div v-if="$slots.cells" class="pui-home__targets">
        <slot name="cells" area="dock" />
      </div>
    </div>
  </div>
</template>

<style>
.pui-home {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: calc(var(--pui-statusbar-h) + 26px) 22px calc(var(--pui-homebar-h) + 10px);
  background-position: center;
  background-size: cover;
  overflow: hidden;
}

.pui-home__grid {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: min-content;
  column-gap: 10px;
  row-gap: 22px;
  align-content: start;
}

.pui-home__targets {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 10px;
}

.pui-home__grid > .pui-home__targets {
  grid-template-rows: repeat(var(--pui-home-rows), minmax(0, 1fr));
}

.pui-home__dock > .pui-home__targets {
  inset: 12px 14px;
  gap: 12px;
}

.pui-home--editor .pui-home__app { pointer-events: none; }

.pui-home__app {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fff;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-home__icon {
  display: inline-flex;
  /* 松手回弹：有过渡 */
  transition: transform 220ms var(--pui-ease-out);
}

/*
 * 按下：把过渡时长压到 0，指针按下当帧就缩，
 * 不是"200ms 后缩到 0.9"。这一条决定了桌面像不像真的。
 */
.pui-home__app:active .pui-home__icon,
.pui-home__app--pressed .pui-home__icon {
  transform: scale(0.9);
  transition-duration: 0ms;
}

.pui-home__label {
  max-width: 100%;
  font-size: var(--pui-font-caption1);
  letter-spacing: 0.01em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-home__dock {
  position: relative;
  flex: 0 0 auto;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 32px;
  /* 玻璃拟态 Dock：复用 material tokens，透出壁纸 */
  background: var(--pui-material-regular);
  -webkit-backdrop-filter: blur(var(--pui-blur-regular)) saturate(170%);
  backdrop-filter: blur(var(--pui-blur-regular)) saturate(170%);
  box-shadow:
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 10px 28px rgba(0, 0, 0, 0.2);
}

.pui-home__app--dock {
  flex: 0 0 auto;
}

/*
 * 开机入场：解锁后图标按顺序浮起（每个延迟 38ms）。
 * 只播一次，由 data-entering 控制 —— 每次回桌面都抖一遍会显得廉价。
 * 动的是 opacity + transform，不触发布局。
 */
.pui-home[data-entering='true'] .pui-home__app {
  animation: pui-home-enter 340ms var(--pui-ease-out) both;
  animation-delay: calc(var(--pui-i, 0) * 38ms);
}

@keyframes pui-home-enter {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.94);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

/* 降级：不位移，只淡入 */
@media (prefers-reduced-motion: reduce) {
  .pui-home[data-entering='true'] .pui-home__app {
    animation: pui-home-fade 200ms linear both;
    animation-delay: 0ms;
  }

  @keyframes pui-home-fade {
    from {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }
}
</style>
