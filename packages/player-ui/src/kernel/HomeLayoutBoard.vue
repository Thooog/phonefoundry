<script setup>
import { computed } from 'vue'
import { HOME_COLUMNS, HOME_ROWS, homeAppDefinition, homeItemName, homeItemSize, isHomeWidget } from '@phone-sim/shared'
import AppIcon from '../symbols/AppIcons.vue'
import StaticHomeHtml from './StaticHomeHtml.vue'
import HomePresetWidget from './HomePresetWidget.vue'
import { useTapFeedback } from './use-tap-feedback.js'

const props = defineProps({
  items: { type: Array, required: true },
  wallpaper: { type: String, required: true },
  storyDate: { type: String, default: null },
  editor: { type: Boolean, default: false },
  launchable: { type: Boolean, default: true },
})
const emit = defineEmits(['open'])
const { pinged, pingDown, pingUp, ping } = useTapFeedback()
function open(item) {
  if (!canOpen(item)) return
  ping(item.id)
  if (item.kind === 'app') emit('open', item.id)
}

const areas = ['grid', 'dock']
const tiles = computed(() => Object.fromEntries(areas.map(area => [area, props.items
  .filter(item => item.area === area)
  .sort((a, b) => a.slot - b.slot)])))
function placement(item) {
  const { columns, rows } = homeItemSize(item)
  return {
    gridColumn: `${item.slot % HOME_COLUMNS + 1}${columns > 1 ? ` / span ${columns}` : ''}`,
    gridRow: `${Math.floor(item.slot / HOME_COLUMNS) + 1}${rows > 1 ? ` / span ${rows}` : ''}`,
  }
}

function canOpen(item) {
  return !isHomeWidget(item) && props.launchable && !props.editor
}
</script>

<template>
  <div class="pui-home-board" :class="{ 'pui-home-board--editor': editor }" :style="{ backgroundImage: wallpaper, '--pui-home-rows': HOME_ROWS }">
    <div v-for="area in areas" :key="area" :class="`pui-home-board__${area}`" :data-testid="area === 'dock' && !editor ? 'home-dock' : undefined">
      <component
        :is="canOpen(item) ? 'button' : 'div'"
        v-for="item in tiles[area]"
        :key="item.id"
        :type="canOpen(item) ? 'button' : undefined"
        :aria-label="editor ? undefined : homeItemName(item)"
        :aria-hidden="editor ? 'true' : undefined"
        :role="canOpen(item) ? undefined : 'img'"
        class="pui-home-board__tile"
        :class="{ 'pui-home-board__tile--widget': isHomeWidget(item), 'pui-home-board__tile--preset': item.kind === 'preset', 'pui-home-board__tile--pressed': pinged === item.id }"
        :style="placement(item)"
        :data-testid="editor ? undefined : `home-${isHomeWidget(item) ? 'widget' : area === 'dock' ? 'dock' : 'app'}-${item.id}`"
        @pointerdown="canOpen(item) && pingDown(item.id)"
        @pointerup="pingUp"
        @pointercancel="pingUp"
        @pointerleave="pingUp"
        @keydown="['Enter', ' '].includes($event.key) && canOpen(item) && pingDown(item.id)"
        @keyup="pingUp"
        @blur="pingUp"
        @click="open(item)"
      >
        <span v-if="!isHomeWidget(item)" class="pui-home-board__icon">
          <AppIcon v-if="homeAppDefinition(item.id)" :icon-key="homeAppDefinition(item.id).iconKey" :accent="homeAppDefinition(item.id).accent" />
          <StaticHomeHtml v-else :html="item.html" :title="item.name" />
        </span>
        <span v-if="area === 'grid' && !isHomeWidget(item)" class="pui-home-board__label">{{ homeItemName(item) }}</span>
        <StaticHomeHtml v-if="item.kind === 'html-widget'" :html="item.html" :title="item.name" />
        <HomePresetWidget v-else-if="item.kind === 'preset'" :preset-id="item.presetId" :story-date="storyDate" :content="item.content" />
      </component>
      <slot name="cells" :area="area" />
    </div>
  </div>
</template>

<style>
.pui-home-board {
  position: absolute;
  inset: 0;
  container-type: size;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: calc(var(--pui-statusbar-h, 24px) + 20px) 18px calc(var(--pui-homebar-h, 16px) + 10px);
  background-position: center;
  background-size: cover;
  overflow: hidden;
}
.pui-home-board__grid,
.pui-home-board__dock {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.pui-home-board__grid {
  flex: 1;
  min-height: 0;
  grid-template-rows: repeat(var(--pui-home-rows), minmax(0, 1fr));
}
.pui-home-board__dock {
  grid-template-rows: minmax(0, min(60px, 12cqh));
  padding: 10px;
  border-radius: 26px;
  background: var(--pui-material-regular, rgb(255 255 255 / 30%));
  backdrop-filter: blur(16px);
}
.pui-home-board__tile {
  display: grid;
  grid-template-rows: minmax(0, clamp(0px, 100% - 18px, 60px)) auto;
  align-content: start;
  justify-items: center;
  gap: 3px;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  color: white;
  font: inherit;
}
.pui-home-board__dock .pui-home-board__tile { grid-template-rows: minmax(0, 1fr); }
button.pui-home-board__tile { cursor: pointer; }
.pui-home-board__tile:focus-visible { outline: 2px solid white; outline-offset: 2px; border-radius: 12px; }
.pui-home-board__tile:active .pui-home-board__icon,
.pui-home-board__tile--pressed .pui-home-board__icon { transform: scale(0.92); }
.pui-home-board__icon {
  /* All apps use Instagram's square frame, independent of label length. */
  width: min(60px, 100%);
  height: auto;
  aspect-ratio: 1;
  max-height: 100%;
  display: grid;
  place-items: center;
}
.pui-home-board__icon > * {
  width: 100% !important;
  height: auto !important;
  aspect-ratio: 1;
  max-width: 100%;
  max-height: 100%;
  border-radius: 22.4%;
  overflow: hidden;
}
.pui-home-board__icon > .pui-static-home-html { border-radius: 22.4%; }

.pui-home-board__label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.2;
  text-shadow: 0 1px 4px #000;
}
.pui-home-board__tile--widget {
  display: block;
  justify-items: stretch;
  border-radius: 20px;
  overflow: hidden;
  background: #fff;
}
.pui-home-board__tile--preset {
  border-radius: 18%;
  background: transparent;
}
.pui-home-board__tile--preset > .pui-home-preset { border-radius: inherit; }
.pui-home-board--editor .pui-home-board__tile { pointer-events: none; }
</style>
