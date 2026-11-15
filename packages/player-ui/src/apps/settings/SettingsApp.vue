

<script setup>
import { computed, ref } from 'vue'
import { buildSettingsOwner, resolveWifiName } from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import Avatar from '../../appkit/Avatar.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'

const searchQuery = ref('')
const switches = ref({ airplane: false, hotspot: true, dnd: false })
const runtime = usePhoneRuntime()
const { getWork } = useWorkData()

const work = computed(() => getWork())

/** 没有作品数据时的空壳：卡片与行照常渲染，只是卡片显示占位文案 */
const EMPTY_OWNER = {
  hasOwner: false,
  name: '',
  subtitle: '',
  avatarAssetId: null,
}

const owner = computed(() => (work.value ? buildSettingsOwner(work.value) : EMPTY_OWNER))

/**
 * 行图标：白字形 + 彩色圆角方底，与 iOS 设置一致。
 * 每个字形就是 1–3 条 path，靠 `fill` 决定描边还是填充（模板里统一渲染）。
 */
const GLYPHS = {
  airplane: { paths: [{ d: 'M22 2l-7 20-4-9-9-4z', fill: true }] },
  wifi: {
    paths: [
      { d: 'M4.6 11.2a10.8 10.8 0 0114.8 0' },
      { d: 'M7.8 14.6a6 6 0 018.4 0' },
      { d: 'M12 15.8a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z', fill: true },
    ],
  },
  bluetooth: { paths: [{ d: 'M8.4 7.6l7.2 7.2-3.6 3.6V5.6l3.6 3.6-7.2 7.2' }] },
  cellular: {
    paths: [
      {
        d: 'M3.4 14.4h2.6v5.2h-2.6zM8.5 11.6h2.6v8h-2.6zM13.6 8.8h2.6v10.8h-2.6zM18.7 6h2.6v13.6h-2.6z',
        fill: true,
      },
    ],
  },
  link: {
    paths: [
      { d: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7' },
      { d: 'M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7' },
    ],
  },
  bell: {
    paths: [
      {
        d: 'M7.2 16.8c-.8-1-1.2-2.2-1.2-3.5v-2c0-2.6 2.1-4.7 4.7-4.7h3.8c2.6 0 4.7 2.1 4.7 4.7v2c0 1.3-.4 2.5-1.2 3.5z',
        fill: true,
      },
      { d: 'M10.4 18.8a2.2 2.2 0 003.2 0' },
    ],
  },
  sound: {
    paths: [
      { d: 'M6 14.6V9.4h2.8l4.2-3.6v12.4l-4.2-3.6z', fill: true },
      { d: 'M15.6 9.4a4.4 4.4 0 010 5.2' },
      { d: 'M18 7.2a7.6 7.6 0 010 9.6' },
    ],
  },
  moon: { paths: [{ d: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z', fill: true }] },
  sun: {
    paths: [
      { d: 'M12 8.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z', fill: true },
      {
        d: 'M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M5.9 5.9l1.4 1.4M18.1 18.1l-1.4-1.4M18.1 5.9l-1.4 1.4M5.9 18.1l1.4-1.4',
      },
    ],
  },
  photo: {
    paths: [
      { d: 'M4.6 7.4a1.8 1.8 0 011.8-1.8h11.2a1.8 1.8 0 011.8 1.8v9.2a1.8 1.8 0 01-1.8 1.8H6.4a1.8 1.8 0 01-1.8-1.8z' },
      { d: 'M6.8 15.6l3.3-3.9 2.3 2.7 2-2.3 3.1 3.5z', fill: true },
      { d: 'M16.2 9.4a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6z', fill: true },
    ],
  },
  gear: {
    paths: [
      { d: 'M12 6.8a5.2 5.2 0 100 10.4 5.2 5.2 0 000-10.4z' },
      {
        d: 'M12 3.8v1.6M12 18.6v1.6M3.8 12h1.6M18.6 12h1.6M6.2 6.2l1.1 1.1M16.7 16.7l1.1 1.1M6.2 17.8l1.1-1.1M16.7 7.3l1.1-1.1',
      },
    ],
  },
  info: {
    paths: [
      { d: 'M12 4.2a7.8 7.8 0 100 15.6 7.8 7.8 0 000-15.6z' },
      { d: 'M12 11.2v5.2' },
      { d: 'M12 7a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z', fill: true },
    ],
  },
}

/** 四组 12 行骨架 —— 除 Wi-Fi 名外全是死值 */
function makeGroups(wifiName) {
  return [
    {
      id: 'wireless',
      rows: [
        { id: 'airplane', icon: 'airplane', tint: '#ff9500', title: '飞行模式', kind: 'switch', on: false },
        { id: 'wifi', icon: 'wifi', tint: '#007aff', title: 'Wi-Fi', value: wifiName },
        { id: 'bluetooth', icon: 'bluetooth', tint: '#007aff', title: '蓝牙', value: '打开' },
        { id: 'cellular', icon: 'cellular', tint: '#34c759', title: '蜂窝网络' },
      ],
    },
    {
      id: 'personal',
      rows: [
        { id: 'hotspot', icon: 'link', tint: '#34c759', title: '个人热点', kind: 'switch', on: true },
        { id: 'notify', icon: 'bell', tint: '#ff3b30', title: '通知' },
        { id: 'sound', icon: 'sound', tint: '#ff3b30', title: '声音与触感' },
      ],
    },
    {
      id: 'general',
      rows: [
        { id: 'dnd', icon: 'moon', tint: '#5e5ce6', title: '勿扰模式', kind: 'switch', on: false },
        { id: 'display', icon: 'sun', tint: '#007aff', title: '显示与亮度' },
        { id: 'wallpaper', icon: 'photo', tint: '#5856d6', title: '壁纸' },
      ],
    },
    {
      id: 'about',
      rows: [
        { id: 'general', icon: 'gear', tint: '#8e8e93', title: '通用' },
        { id: 'about', icon: 'info', tint: '#8e8e93', title: '关于本机' },
      ],
    },
  ]
}

const groups = computed(() => makeGroups(resolveWifiName(work.value?.workSettings)))

function glyph(iconKey) {
  return GLYPHS[iconKey] ?? { paths: [] }
}

/** 回桌面：点顶栏大标题（与 备忘录 / 电话 / X 同一套出口约定） */
function goHome() {
  runtime.goHome()
}
</script>

<template>
  <div class="pui-st" data-testid="settings-app">
    <header class="pui-st__nav">
      <button
        type="button"
        class="pui-st__home"
        data-testid="settings-title"
        aria-label="回桌面"
        @click="goHome"
      >
        设置
      </button>
    </header>

    <!-- 搜索输入仅保留本地文字。 -->
    <div class="pui-st__search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="M15.6 15.6L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <input v-model="searchQuery" type="search" placeholder="搜索" aria-label="搜索设置" data-testid="settings-search" />
    </div>

    <ScrollArea
      class="pui-st__scroll"
      scroll-key="settings:root"
      :fade="false"
      :padding-bottom="16"
      data-testid="settings-list-screen"
    >
      <!-- ══ 机主卡片 ══ -->
      <section class="pui-st__card pui-st__owner" data-testid="settings-owner-card">
        <template v-if="owner.hasOwner">
          <Avatar :asset-id="owner.avatarAssetId" :name="owner.name" :size="58" />
          <span class="pui-st__owner-main">
            <span class="pui-st__owner-name" data-testid="settings-owner-name">
              {{ owner.name }}
            </span>
            <span class="pui-st__owner-sub" data-testid="settings-owner-sub">{{ owner.subtitle }}</span>
          </span>
        </template>
        <template v-else>
          <span class="pui-st__owner-empty" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8.2" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path
                d="M4.8 20.2a7.2 7.2 0 0114.4 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="pui-st__owner-main">
            <span class="pui-st__owner-name pui-st__owner-name--muted" data-testid="settings-owner-name">
              没有设置机主
            </span>
          </span>
        </template>
        <!-- 箭头：真机点卡片进 Apple ID，这里只是外观 -->
        <svg class="pui-st__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 5l7 7-7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </section>

      <!-- ══ 四组静态骨架 ══ -->
      <section
        v-for="group in groups"
        :key="group.id"
        class="pui-st__card"
        data-testid="settings-group"
      >
        <div
          v-for="(row, i) in group.rows"
          :key="row.id"
          class="pui-st__row"
          :class="{ 'pui-st__row--last': i === group.rows.length - 1 }"
          data-testid="settings-row"
        >
          <span class="pui-st__tile" :style="{ background: row.tint }" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                v-for="p in glyph(row.icon).paths"
                :key="p.d"
                :d="p.d"
                :fill="p.fill ? 'currentColor' : 'none'"
                :stroke="p.fill ? 'none' : 'currentColor'"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>

          <span class="pui-st__label">{{ row.title }}</span>

          <span
            v-if="row.value"
            class="pui-st__value"
          >
            {{ row.value }}
          </span>

          <!-- 开关状态仅用于当前阅读会话。 -->
          <button
            v-if="row.kind === 'switch'"
            type="button"
            role="switch"
            :aria-label="row.title"
            :aria-checked="switches[row.id]"
            class="pui-st__switch"
            :class="{ 'pui-st__switch--on': switches[row.id] }"
            data-testid="settings-switch"
            :data-on="switches[row.id] ? 'true' : 'false'"
            @click="switches[row.id] = !switches[row.id]"
          >
            <span class="pui-st__knob" aria-hidden="true"></span>
          </button>
          <svg v-else class="pui-st__chevron pui-st__chevron--row" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 5l7 7-7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </section>
    </ScrollArea>
  </div>
</template>

<style>
.pui-st {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* iOS 分组列表底色：卡片是白的，页面是浅灰，层级才分得开 */
  background: var(--pui-bg-grouped);
  color: var(--pui-label);
}

/* ── 顶栏：大标题 + 不画分隔线 ── */
.pui-st__nav {
  flex: none;
  padding: calc(var(--pui-statusbar-h) + 4px) var(--pui-space-5) 2px;
}

.pui-st__home {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pui-label);
  font-family: inherit;
  font-size: var(--pui-font-large-title);
  font-weight: var(--pui-weight-bold);
  letter-spacing: var(--pui-tracking-large);
  line-height: var(--pui-leading-large);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── 搜索框 ── */
.pui-st__search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px var(--pui-space-5) 4px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--pui-fill);
  color: var(--pui-label-2);
  font-size: var(--pui-font-footnote);
}

.pui-st__search input { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--pui-label); font: inherit; line-height: inherit; }
.pui-st__search input::placeholder { color: var(--pui-label-2); }
.pui-st__search input:focus { outline: none; box-shadow: none; }
.pui-st__search:focus-within { outline: none; }
.pui-st__search svg {
  width: 15px;
  height: 15px;
}

.pui-st__scroll {
  flex: 1 1 auto;
  min-height: 0;
}

/* ── 卡片：白底 + 圆角，卡片之间留 22px ── */
.pui-st__card {
  margin: 0 var(--pui-space-5) 22px;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

/* ── 机主卡片：头像 + 名字 + 账号副标题 + 箭头 ── */
.pui-st__owner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px var(--pui-space-4) 14px 18px;
}

.pui-st__owner-empty {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--pui-fill);
  color: var(--pui-label-3);
}

.pui-st__owner-empty svg {
  width: 30px;
  height: 30px;
}

.pui-st__owner-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pui-st__owner-name {
  font-size: var(--pui-font-title3);
  font-weight: var(--pui-weight-semibold);
  letter-spacing: var(--pui-tracking-title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pui-st__owner-name--muted {
  color: var(--pui-label-2);
}

/* Apple ID 副标题较长时允许折到两行（真机同样会折行） */
.pui-st__owner-sub {
  font-size: var(--pui-font-footnote);
  color: var(--pui-label-2);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 行：图标块 + 标题 + 右侧值/开关/箭头 ── */
.pui-st__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 6px var(--pui-space-4) 6px 16px;
}

/* 行线缩进到标题左沿（16 内边距 + 29 图标 + 12 间距），组内最后一行不画 */
.pui-st__row::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 57px;
  height: 0.5px;
  background: var(--pui-separator);
  transform: scaleY(0.5);
  transform-origin: bottom;
}

.pui-st__row--last::after {
  content: none;
}

.pui-st__tile {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 29px;
  height: 29px;
  border-radius: 7px;
  color: #fff;
}

.pui-st__tile svg {
  width: 18px;
  height: 18px;
}

.pui-st__label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--pui-font-body);
  letter-spacing: var(--pui-tracking-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pui-st__value {
  flex: 0 0 auto;
  font-size: var(--pui-font-body);
  color: var(--pui-label-2);
}

.pui-st__chevron {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: var(--pui-label-3);
}

/* ── 冻结的开关：iOS 尺寸 51×31，滑块 27 ── */
.pui-st__switch {
  padding: 0;
  border: 0;
  cursor: pointer;
  flex: 0 0 auto;
  position: relative;
  width: 51px;
  height: 31px;
  border-radius: 15.5px;
  background: #e9e9ea;
  transition: none;
}

.pui-st__switch--on {
  background: var(--pui-green);
}

.pui-st__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.pui-st__switch--on .pui-st__knob {
  left: 22px;
}
</style>
