

<script setup>
import { computed, ref } from 'vue'
import { buildNotesList, buildNoteDetail } from '@phone-sim/shared'
import ScrollArea from '../../appkit/ScrollArea.vue'
import EmptyState from '../../appkit/EmptyState.vue'
import { usePhoneRuntime, useWorkData } from '../../kernel/create-runtime.js'
import { useTapFeedback } from '../../kernel/use-tap-feedback.js'

const runtime = usePhoneRuntime()
const { getWork } = useWorkData()

const work = computed(() => getWork())
const notes = computed(() => (work.value ? buildNotesList(work.value) : []))

/* ── 装饰控件的按压反馈 ─────────────────────────────
   顶栏「新建 / 分享 / 更多」、底栏四颗工具、列表页的圆圈省略号与两端工具，
   在作品里都没有对应页面，所以只做一次按压高亮：不 push/pop、不改屏。 */
const { pinged, pingDown, pingUp, ping } = useTapFeedback()

/** 模板里 v-on="tapFx('k')" 一次挂上四件套（按下亮 / 抬起·取消·移出灭 / click 兜底）。
 *  ⚠️ v-on 对象的键是**事件名**（pointerdown），不是 onPointerdown —— 后者是 v-bind 的写法，
 *  挂上去等于监听一个叫 onpointerdown 的事件，永远不触发（踩过一次）。 */
function tapFx(name) {
  return {
    pointerdown: () => pingDown(name),
    pointerup: pingUp,
    pointercancel: pingUp,
    pointerleave: pingUp,
    click: () => ping(name),
  }
}

/* ── 搜索：只在本地过滤列表，不写回作品数据 ───────── */
const searchQuery = ref('')
const isSearching = computed(() => searchQuery.value.trim().length > 0)
const filteredNotes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return notes.value
  return notes.value.filter((note) => note.searchText.toLowerCase().includes(q))
})

function clearSearch() {
  searchQuery.value = ''
}

/* ── 导航 ─────────────────────────────────────────── */
const screen = computed(() => runtime.currentScreen.value)
const isDetail = computed(() => (screen.value?.name ?? 'root') === 'note')
const direction = computed(() => (runtime.state.transition === 'pop' ? 'pop' : 'push'))

function openNote(noteId) {
  runtime.push('note', noteId)
}

function goBack() {
  runtime.pop()
}

/** 回桌面：点列表顶栏的"备忘录"字标（与 电话/X 同一套出口约定） */
function goHome() {
  runtime.goHome()
}

const activeNoteId = computed(() =>
  isDetail.value && screen.value?.name === 'note' ? (screen.value?.params ?? null) : null,
)
const activeNote = computed(() =>
  activeNoteId.value && work.value ? buildNoteDetail(work.value, activeNoteId.value) : null,
)

/** 正文按行分段渲染；空行产生空段，用 min-height 撑出段距 */
const paragraphs = computed(() =>
  (activeNote.value?.content ?? '').split(/\r?\n/),
)
</script>

<template>
  <div class="pui-nt" data-testid="notes-app">
    <div class="pui-nt__stack">
      <Transition :name="`pui-nt-screen-${direction}`">
        <!-- ══ 备忘录详情 ══ -->
        <section
          v-if="isDetail"
          key="note"
          class="pui-nt__screen"
          data-testid="notes-detail-screen"
        >
          <header class="pui-nt__nav">
            <button
              type="button"
              class="pui-nt__back"
              data-testid="nav-back"
              aria-label="返回备忘录列表"
              @click="goBack"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M14.5 5.5L8 12l6.5 6.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>备忘录</span>
            </button>
            <!-- 新建 / 分享 / 更多：作品端没有落地页，只做按压反馈 -->
            <span class="pui-nt__actions">
              <button
                type="button"
                class="pui-nt__act"
                :class="{ 'pui-nt__act--ping': pinged === 'note-new' }"
                data-testid="note-act-new"
                aria-label="新建备忘录"
                v-on="tapFx('note-new')"
              ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5H7.2A2.2 2.2 0 005 7.2v9.6A2.2 2.2 0 007.2 19h9.6a2.2 2.2 0 002.2-2.2V13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><path d="M16.8 4.6a1.9 1.9 0 012.7 2.7l-6.1 6.1-3 .6.6-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg></button>
              <button
                type="button"
                class="pui-nt__act"
                :class="{ 'pui-nt__act--ping': pinged === 'note-share' }"
                data-testid="note-act-share"
                aria-label="分享"
                v-on="tapFx('note-share')"
              ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14V4.5M12 4.5L8.6 7.9M12 4.5l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /><path d="M7.5 10.5H6.2A1.7 1.7 0 004.5 12.2v6.1A1.7 1.7 0 006.2 20h11.6a1.7 1.7 0 001.7-1.7v-6.1a1.7 1.7 0 00-1.7-1.7h-1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg></button>
              <button
                type="button"
                class="pui-nt__act"
                :class="{ 'pui-nt__act--ping': pinged === 'note-more' }"
                data-testid="note-act-more"
                aria-label="更多"
                v-on="tapFx('note-more')"
              ><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="8.4" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /><circle cx="15.6" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /></svg></button>
            </span>
          </header>

          <ScrollArea v-if="activeNote" scroll-key="notes:detail" :padding-bottom="24">
            <div class="pui-nt__body">
              <p v-for="(line, i) in paragraphs" :key="i" class="pui-nt__line">{{ line }}</p>
            </div>
          </ScrollArea>

          <EmptyState
            v-else
            title="备忘录不存在"
            description="它可能已经被删除，返回列表看看。"
          />

          <!-- 底部工具栏：清单 / 样式笔 / 相机 / 新建 —— 只做按压反馈 -->
          <div class="pui-nt__toolbar">
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'note-tool-checklist' }"
              data-testid="note-tool-checklist"
              aria-label="清单"
              v-on="tapFx('note-tool-checklist')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5.3" cy="7" r="3.2" fill="currentColor" />
                <circle cx="5.3" cy="16.6" r="2.25" fill="none" stroke="currentColor" stroke-width="1.9" />
                <path d="M11.2 7h8.4M11.2 16.6h8.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
              </svg>
            </button>
            <!-- 样式笔：圆内的 A（两条斜边 + 横杠），不是三角尖，避免看成时钟 -->
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'note-tool-style' }"
              data-testid="note-tool-style"
              aria-label="样式"
              v-on="tapFx('note-tool-style')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path d="M7.8 17.6 12 8.5l4.2 9.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M9.5 14.3h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
            <!-- 相机：圆润取景凸起 + 镜头 + 右上闪光灯方块 -->
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'note-tool-camera' }"
              data-testid="note-tool-camera"
              aria-label="拍照"
              v-on="tapFx('note-tool-camera')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.3 17.4V10.8a2.2 2.2 0 012.2-2.2h2.2c.3-1.3 1.2-2.2 2.5-2.2h1.6c1.3 0 2.2.9 2.5 2.2h2.2a2.2 2.2 0 012.2 2.2v6.6a2.2 2.2 0 01-2.2 2.2H6.5a2.2 2.2 0 01-2.2-2.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                <circle cx="12" cy="14" r="3.3" fill="none" stroke="currentColor" stroke-width="1.8" />
                <rect x="16.2" y="10.7" width="2" height="2" rx="0.5" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'note-tool-edit' }"
              data-testid="note-tool-edit"
              aria-label="编辑"
              v-on="tapFx('note-tool-edit')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5H7.2A2.2 2.2 0 005 7.2v9.6A2.2 2.2 0 007.2 19h9.6a2.2 2.2 0 002.2-2.2V13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><path d="M16.8 4.6a1.9 1.9 0 012.7 2.7l-6.1 6.1-3 .6.6-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
            </button>
          </div>
        </section>

        <!-- ══ 列表根屏（真机版式：大标题 + 两端工具栏，不是详情那套） ══ -->
        <section
          v-else
          key="root"
          class="pui-nt__screen"
          data-testid="notes-list-screen"
        >
          <header class="pui-nt__nav pui-nt__nav--root">
            <button
              type="button"
              class="pui-nt__home"
              data-testid="notes-title"
              aria-label="回桌面"
              @click="goHome"
            >
              备忘录
            </button>
            <!-- 圆圈省略号（查看选项）：作品里没有这个弹层，只做按压反馈 -->
            <button
              type="button"
              class="pui-nt__nav-more"
              :class="{ 'pui-nt__nav-more--ping': pinged === 'options' }"
              data-testid="notes-options"
              aria-label="查看选项"
              v-on="tapFx('options')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7" /><circle cx="8.4" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /><circle cx="15.6" cy="12" r="0.6" fill="currentColor" stroke="currentColor" /></svg>
            </button>
          </header>

          <template v-if="notes.length">
            <!-- 搜索框：真输入，按正文全文本地过滤列表（不写回作品数据） -->
            <div class="pui-nt__search">
              <svg class="pui-nt__search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M15.6 15.6L20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
              <input
                v-model="searchQuery"
                type="text"
                class="pui-nt__search-input"
                placeholder="搜索"
                inputmode="search"
                enterkeyhint="search"
                aria-label="搜索备忘录"
                data-testid="notes-search-input"
              >
              <button
                v-if="isSearching"
                type="button"
                class="pui-nt__search-clear"
                aria-label="清除搜索"
                data-testid="notes-search-clear"
                @click="clearSearch"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /><path d="M8.9 8.9l6.2 6.2M15.1 8.9l-6.2 6.2" stroke="#fff" stroke-width="1.9" stroke-linecap="round" /></svg>
              </button>
            </div>
            <p class="pui-nt__count">{{ filteredNotes.length }} 个备忘录</p>

            <div v-if="filteredNotes.length" class="pui-nt__list">
              <button
                v-for="(note, i) in filteredNotes"
                :key="note.id"
                type="button"
                class="pui-nt__row"
                :class="{ 'pui-nt__row--last': i === filteredNotes.length - 1 }"
                data-testid="notes-row"
                @click="openNote(note.id)"
              >
                <span class="pui-nt__row-title">{{ note.title }}</span>
                <span class="pui-nt__row-sub">
                  <span v-if="note.snippet" class="pui-nt__row-snippet">{{ note.snippet }}</span>
                  <span class="pui-nt__row-time">{{ note.timeLabel }}</span>
                </span>
              </button>
            </div>

            <!-- 搜索无命中：区别于"一条都没有"，文案不能说成没有备忘录 -->
            <div v-else class="pui-nt__empty">
              <EmptyState
                icon="search"
                title="没有找到备忘录"
                description="换个关键词试试。"
              />
            </div>
          </template>

          <EmptyState
            v-else
            title="没有备忘录"
            description="这部手机还没有写过备忘录。"
          />

          <!-- 列表底部工具栏：左「新建文件夹」右「写备忘录」（真机版式，只做按压反馈） -->
          <div class="pui-nt__toolbar pui-nt__toolbar--ends">
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'new-folder' }"
              data-testid="notes-new-folder"
              aria-label="新建文件夹"
              v-on="tapFx('new-folder')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.4a1.8 1.8 0 011.8-1.8h3.3l1.6 1.8h7.5A1.8 1.8 0 0120 10.2v6.2a1.8 1.8 0 01-1.8 1.8H5.8A1.8 1.8 0 014 16.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /><path d="M12 11.2v4.2M9.9 13.3h4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            </button>
            <button
              type="button"
              class="pui-nt__tool"
              :class="{ 'pui-nt__tool--ping': pinged === 'new-note' }"
              data-testid="notes-new-note"
              aria-label="写备忘录"
              v-on="tapFx('new-note')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5H7.2A2.2 2.2 0 005 7.2v9.6A2.2 2.2 0 007.2 19h9.6a2.2 2.2 0 002.2-2.2V13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><path d="M16.8 4.6a1.9 1.9 0 012.7 2.7l-6.1 6.1-3 .6.6-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
            </button>
          </div>
        </section>
      </Transition>
    </div>
  </div>
</template>

<style>
.pui-nt {
  /* 备忘录唯一的主题色：金橙。图标、顶栏、底栏工具、搜索都从它取 */
  --pui-nt-tint: #f2a33c;
  /* hairline 与电话同源：0.5px rgba(60,60,67,0.29) */
  --pui-nt-rule: rgba(60, 60, 67, 0.29);
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #fff;
  color: var(--pui-label);
}

.pui-nt__stack {
  position: absolute;
  inset: 0;
}

.pui-nt__screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* ── 顶栏：chevron + 字标 一侧，三个描边图标一侧，各自由空间撑开 ── */
.pui-nt__nav {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--pui-statusbar-h) + 8px) 16px 6px;
  background: #fff;
}

.pui-nt__back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pui-nt-tint);
  font-family: inherit;
  font-size: var(--pui-font-body);
  font-weight: var(--pui-weight-regular);
  cursor: pointer;
}

.pui-nt__back svg {
  width: 20px;
  height: 20px;
}

.pui-nt__nav--root {
  display: block;
  position: relative;
}

.pui-nt__home {
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

.pui-nt__nav-more {
  position: absolute;
  top: calc(var(--pui-statusbar-h) + 10px);
  right: 16px;
  display: inline-flex;
  align-items: center;
  /* span → button 的复位：不重置的话会多出 UA 的灰底、内边距和字体 */
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pui-nt-tint);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-nt__nav-more svg {
  width: 22px;
  height: 22px;
}

.pui-nt__actions {
  display: inline-flex;
  align-items: center;
  gap: 22px;
  color: var(--pui-nt-tint);
}

.pui-nt__actions svg {
  width: 22px;
  height: 22px;
}

/* ── 「点得动、但哪也不去」的按钮 ──
   顶栏三颗、底栏四颗、列表页省略号与两端工具共用一套复位。
   线条图标没有底色可压，按下整体下沉透明度（与真机按钮被压暗同一观感）。 */
.pui-nt__act,
.pui-nt__tool {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 双类：特异性压过任何单类的 hover/默认态 */
.pui-nt__act.pui-nt__act--ping,
.pui-nt__tool.pui-nt__tool--ping,
.pui-nt__nav-more.pui-nt__nav-more--ping {
  opacity: 0.35;
}

/* 这些按钮只有按压反馈，键盘焦点环会画出"这里有输入框"的错觉 */
.pui-nt__act:focus-visible,
.pui-nt__tool:focus-visible,
.pui-nt__nav-more:focus-visible,
.pui-nt__search-clear:focus-visible {
  outline: none;
}

/* ── 搜索框 ── */
.pui-nt__search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 8px 16px 0;
  padding: 7px 10px;
  border-radius: 10px;
  background: rgba(118, 118, 128, 0.12);
  color: rgba(60, 60, 67, 0.6);
  font-size: var(--pui-font-footnote);
}

.pui-nt__search-icon {
  flex: none;
  width: 15px;
  height: 15px;
}

.pui-nt__search-input {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--pui-label);

  line-height: 1.2;
  -webkit-appearance: none;
  appearance: none;
}

.pui-nt__search-input::placeholder {
  color: rgba(60, 60, 67, 0.6);
  opacity: 1;
}

.pui-nt__search-input:focus {
  outline: none;
}

/* 输入框不该有焦点环：真机上点搜索框只是光标出现，不描边 */
.pui-nt__search-input:focus-visible {
  outline: none;
}

.pui-nt__search-clear {
  flex: none;
  display: flex;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: rgba(60, 60, 67, 0.42);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pui-nt__search-clear svg {
  width: 16px;
  height: 16px;
}

.pui-nt__count {
  flex: none;
  margin: 14px 16px 4px;
  font-size: var(--pui-font-subhead);
  color: rgba(60, 60, 67, 0.6);
}

/* ── 列表 ── */
.pui-nt__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 16px;
  overflow-y: auto;
}

/* 搜索无命中：占满列表区（EmptyState 自身 height:100%，这里只需要给个可伸缩的坑） */
.pui-nt__empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow-y: auto;
}

.pui-nt__empty > * {
  flex: 1 1 auto;
  min-width: 0;
}

.pui-nt__row {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 10px 0 11px;
  border: 0;
  background: none;
  text-align: left;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
}

/* 行线：与电话同一 hairline，从文字左沿画到右内边距；列表最后一行不画 */
.pui-nt__row::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 0.5px;
  background: var(--pui-nt-rule);
  transform: scaleY(0.5);
  transform-origin: bottom;
}

.pui-nt__row--last::after {
  content: none;
}

.pui-nt__row-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pui-font-body);
  font-weight: var(--pui-weight-semibold);
}

.pui-nt__row-sub {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 3px;
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--pui-font-footnote);
  color: rgba(60, 60, 67, 0.6);
}

.pui-nt__row-snippet {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pui-nt__row-time {
  flex: none;
  margin-left: auto;
}

/* ── 详情正文 ── */
.pui-nt__body {
  padding: 0 16px 8px;
}

.pui-nt__line {
  min-height: 1.1em;
  margin: 0;
  font-size: var(--pui-font-body);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* ── 底部工具栏：四图标等距 ── */
.pui-nt__toolbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-around;

  padding: 14px 8px var(--pui-homebar-h, 34px);
  background: #fff;
  color: var(--pui-nt-tint);
}

.pui-nt__toolbar svg {
  width: 25px;
  height: 25px;
}

/* 列表页工具栏：两图标分列两端（详情页才是四图标等距） */
.pui-nt__toolbar--ends {
  justify-content: space-between;
  padding: 14px 24px var(--pui-homebar-h, 34px);
}

/* ── 屏间推拉（与电话同一套手感） ── */
.pui-nt-screen-push-enter-from {
  transform: translateX(100%);
}

.pui-nt-screen-push-leave-to {
  transform: translateX(-22%);
  opacity: 0.6;
}

.pui-nt-screen-pop-enter-from {
  transform: translateX(-22%);
  opacity: 0.6;
}

.pui-nt-screen-pop-leave-to {
  transform: translateX(100%);
}

.pui-nt-screen-push-enter-active,
.pui-nt-screen-push-leave-active,
.pui-nt-screen-pop-enter-active,
.pui-nt-screen-pop-leave-active {
  transition:
    transform 260ms var(--pui-ease-out),
    opacity 260ms var(--pui-ease-out);
  will-change: transform;
}
</style>
