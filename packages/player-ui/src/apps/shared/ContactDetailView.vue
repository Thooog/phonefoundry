

<script setup>
import Avatar from '../../appkit/Avatar.vue'
import ScrollArea from '../../appkit/ScrollArea.vue'
import { useTapFeedback } from '../../kernel/use-tap-feedback.js'

defineProps({
  /** buildContacts 产出的联系人对象 */
  contact: { type: Object, required: true },
  /** 呼叫钮是否可点（父级判断号码/会话是否存在） */
  realCall: { type: Boolean, default: false },
  /** 信息钮是否可点 */
  realMessage: { type: Boolean, default: false },
  /** 滚动位置记忆键（与各应用的 ScrollArea 约定一致；不传则不记忆） */
  scrollKey: { type: String, default: '' },
})

const emit = defineEmits(['back', 'call', 'message', 'edit'])

/** 详情页大头像 / 头卡小头像：比通讯录列表更深一档的灰蓝，压得住渐变头卡 */
const AVATAR_HERO_BG = 'linear-gradient(180deg, #8b8fa2 0%, #6f7386 100%)'

/**
 * 按压反馈（kernel/use-tap-feedback.js）：pointerdown 点亮 / pointerup 熄灭（跟手），
 * 轻点补 90ms，click 只作键盘 Enter/空格与脚本 .click() 的兜底。
 *
 * 这里一颗实例同时服务这一屏所有控件 —— 同一时刻只可能按下一个，
 * 共用一份 `pinged` 反而省掉了「两颗同时亮」的串扰。
 *
 * ⚠️ 动作钮分两类，别搞混：
 *   · 「信息 / 呼叫」可能是真的（父级传 realMessage / realCall，且有会话 / 号码），
 *     这一类点击必须继续 emit 出去，导航逻辑不能动；只有 real=false 时才纯反馈。
 *   · 「视频 / 邮件」以及下面几张卡片里的行（照片与海报、电话、电子邮件、备注）
 *     在作品数据里没有对应页面，永远只做反馈、不跳转。
 */
const { pinged, pingDown, pingUp, ping } = useTapFeedback()

/** 动作钮点击：先给兜底反馈，real 才把动作交给父级（'call' / 'message'） */
function actClick(name, real) {
  ping(name)
  if (!real) return
  if (name === 'call') emit('call')
  else if (name === 'message') emit('message')
}

/** 右上「编辑」：作品端只读，进不了编辑页，但必须是一颗能按的按钮 */
function pingEdit() {
  ping('edit')
  emit('edit')
}
</script>

<template>
  <div class="pui-cd">
    <header class="pui-cd__nav">
      <button
        type="button"
        class="pui-cd__glassbtn pui-cd__glassbtn--round"
        data-testid="nav-back"
        aria-label="返回"
        @click="emit('back')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M14.5 5.5L8 12l6.5 6.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="pui-cd__glassbtn pui-cd__glassbtn--wide"
        :class="{ 'pui-cd__glassbtn--ping': pinged === 'edit' }"
        data-testid="contact-detail-edit"
        @pointerdown="pingDown('edit')"
        @pointerup="pingUp"
        @pointercancel="pingUp"
        @pointerleave="pingUp"
        @click="pingEdit"
      >
        编辑
      </button>
    </header>

    <ScrollArea :scroll-key="scrollKey" :padding-bottom="24">
      <!-- 渐变头卡：头像 + 姓名 + 动作钮都压在同一段渐变上 -->
      <div class="pui-cd__hero">
        <Avatar
          :asset-id="contact.avatarAssetId"
          :name="contact.name"
          :size="104"
          :background="AVATAR_HERO_BG"
        />
        <h1 class="pui-cd__name">{{ contact.name }}</h1>

        <div class="pui-cd__actions">
          <!-- 信息：父级有会话时是真的（点进去回到那个聊天），否则只做反馈 -->
          <button
            type="button"
            class="pui-cd__act"
            :class="{ 'pui-cd__act--ping': pinged === 'message' }"
            :data-testid="realMessage ? 'contact-act-message' : 'contact-act-message-idle'"
            @pointerdown="pingDown('message')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="actClick('message', realMessage)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 4.6c-4.6 0-8.3 3-8.3 6.7 0 2.1 1.2 4 3.1 5.2l-.8 3 3.3-1.7c.9.2 1.8.3 2.7.3 4.6 0 8.3-3 8.3-6.8s-3.7-6.7-8.3-6.7z"
                fill="currentColor"
              />
            </svg>
            <i>信息</i>
          </button>
          <!-- 呼叫：有号码时真的进通话屏 -->
          <button
            type="button"
            class="pui-cd__act"
            :class="{ 'pui-cd__act--ping': pinged === 'call' }"
            :data-testid="realCall ? 'contact-act-call' : 'contact-act-call-idle'"
            @pointerdown="pingDown('call')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="actClick('call', realCall)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
                fill="currentColor"
              />
            </svg>
            <i>呼叫</i>
          </button>
          <!-- 视频：作品里没有视频通话，永远只做反馈 -->
          <button
            type="button"
            class="pui-cd__act"
            :class="{ 'pui-cd__act--ping': pinged === 'video' }"
            data-testid="contact-act-video"
            @pointerdown="pingDown('video')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('video')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="6.5" width="12.6" height="11" rx="3" fill="currentColor" />
              <path d="M16.8 10.6l4.2-2.5v7.8l-4.2-2.5z" fill="currentColor" />
            </svg>
            <i>视频</i>
          </button>
          <button
            v-if="contact.email"
            type="button"
            class="pui-cd__act"
            :class="{ 'pui-cd__act--ping': pinged === 'email' }"
            data-testid="contact-act-email"
            @pointerdown="pingDown('email')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('email')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7" />
              <path d="M4.4 7.4l7.6 6 7.6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            <i>邮件</i>
          </button>
        </div>
      </div>

      <div class="pui-cd__cards">
        <!-- 联系人照片与海报：iOS 18 的系统功能，作品无对应数据 —— 只做按压反馈 -->
        <div class="pui-cd__cardbox">
          <button
            type="button"
            class="pui-cd__crow"
            :class="{ 'pui-cd__crow--ping': pinged === 'photo' }"
            data-testid="contact-row-photo"
            @pointerdown="pingDown('photo')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('photo')"
          >
            <Avatar
              :asset-id="contact.avatarAssetId"
              :name="contact.name"
              :size="38"
              :background="AVATAR_HERO_BG"
            />
            <span class="pui-cd__crow-main">
              <span class="pui-cd__crow-t">联系人照片与海报</span>
              <span class="pui-cd__crow-s">已启用</span>
            </span>
            <span class="pui-cd__chev" aria-hidden="true"></span>
          </button>
        </div>

        <div class="pui-cd__cardbox">
          <button
            type="button"
            class="pui-cd__crow"
            :class="{ 'pui-cd__crow--ping': pinged === 'phone' }"
            data-testid="contact-row-phone"
            @pointerdown="pingDown('phone')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('phone')"
          >
            <span class="pui-cd__crow-main">
              <span class="pui-cd__crow-t">电话</span>
              <span class="pui-cd__crow-s">{{ contact.phoneNumber || '未填写' }}</span>
            </span>
            <span class="pui-cd__chev" aria-hidden="true"></span>
          </button>
          <button
            v-if="contact.email"
            type="button"
            class="pui-cd__crow"
            :class="{ 'pui-cd__crow--ping': pinged === 'mailrow' }"
            data-testid="contact-row-email"
            @pointerdown="pingDown('mailrow')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('mailrow')"
          >
            <span class="pui-cd__crow-main">
              <span class="pui-cd__crow-t">电子邮件</span>
              <span class="pui-cd__crow-s">{{ contact.email }}</span>
            </span>
            <span class="pui-cd__chev" aria-hidden="true"></span>
          </button>
        </div>

        <div class="pui-cd__cardbox">
          <button
            type="button"
            class="pui-cd__crow"
            :class="{ 'pui-cd__crow--ping': pinged === 'note' }"
            data-testid="contact-row-note"
            @pointerdown="pingDown('note')"
            @pointerup="pingUp"
            @pointercancel="pingUp"
            @pointerleave="pingUp"
            @click="ping('note')"
          >
            <span class="pui-cd__crow-main">
              <span class="pui-cd__crow-t">备注</span>
              <span class="pui-cd__crow-s">{{ contact.note || '未填写' }}</span>
            </span>
            <span class="pui-cd__chev" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<style>
/* ── 联系人详情（iOS 18 风格）──
 * 整屏底色是分组列表的浅灰，顶部一大段灰蓝渐变头卡。
 * 变量自带（--pui-cd-rule）：电话与信息两个应用都要用，不能依赖 .pui-ph 作用域。
 * 根节点自己铺满父屏（父屏都是 absolute inset 0 的应用屏），
 * 导航玻璃钮悬浮在外层、内容在 ScrollArea 里滚。 */
.pui-cd {
  --pui-cd-rule: rgba(60, 60, 67, 0.29);
  position: absolute;
  inset: 0;
  background: #f2f2f7;
}

/* 导航：悬浮在渐变头卡上（绝对定位、无底色），左右两颗玻璃圆钮 */
.pui-cd__nav {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--pui-statusbar-h) + 6px) 14px 2px;
  background: none;
}

/* 玻璃圆钮：半透明灰底白字，压在渐变上 */
.pui-cd__glassbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 38px;
  padding: 0 13px;
  border: 0;
  border-radius: 19px;
  background: rgba(113, 115, 128, 0.42);
  color: #fff;
  font: inherit;
  font-size: 0.9375rem;
}

.pui-cd__glassbtn svg {
  width: 18px;
  height: 18px;
  display: block;
}

/* 返回钮：只有箭头，圆形 */
.pui-cd__glassbtn--round {
  width: 38px;
  padding: 0;
  cursor: pointer;
}

button.pui-cd__glassbtn--round:active {
  background: rgba(94, 96, 110, 0.55);
}

.pui-cd__glassbtn--wide {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform var(--pui-dur-fast) var(--pui-ease-out),
    background-color var(--pui-dur-fast) linear,
    color var(--pui-dur-fast) linear;
}

button.pui-cd__glassbtn--wide:active {
  transform: scale(0.92);
}

.pui-cd__glassbtn--wide.pui-cd__glassbtn--ping {
  background: rgba(255, 255, 255, 0.86);
  color: #1c1c1e;
}

@media (prefers-reduced-motion: reduce) {
  button.pui-cd__glassbtn--wide:active {
    transform: none;
  }
}

.pui-cd__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: calc(var(--pui-statusbar-h) + 52px) 16px 14px;
  background: linear-gradient(180deg, #cdcfd6 0%, #a9abb8 62%, #8f92a3 100%);
}

.pui-cd__name {
  margin: 0;
  color: #fff;
  font-size: 1.875rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
}

/* 信息 / 呼叫 / 视频 / 邮件：四种都渲染成真按钮，外观完全一致。
   信息与呼叫可能「真的」接端（按父级给的 real* 决定），视频与邮件永远只做反馈。 */
.pui-cd__actions {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 16px 2px 0;
}

.pui-cd__act {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 0 8px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.26);
  color: #fff;
  font: inherit;
  transition:
    background-color var(--pui-dur-fast) linear,
    transform var(--pui-dur-fast) var(--pui-ease-out);
}

button.pui-cd__act {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button.pui-cd__act:active {
  background: rgba(255, 255, 255, 0.42);
}

/* 按下态：底色提亮 + 轻微回缩（跟手，抬起立刻复原） */
.pui-cd__act.pui-cd__act--ping {
  background: rgba(255, 255, 255, 0.42);
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .pui-cd__act.pui-cd__act--ping {
    transform: none;
  }
}

.pui-cd__act svg {
  width: 21px;
  height: 21px;
  display: block;
}

.pui-cd__act i {
  font-size: 0.6875rem;
  font-style: normal;
  line-height: 1;
}

.pui-cd__cards {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px 16px 24px;
}

.pui-cd__cardbox {
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
}

.pui-cd__crow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
}

button.pui-cd__crow {
  width: 100%;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--pui-dur-fast) linear;
}

/* 整行按下：铺一层浅浅的灰（iOS 列表按下色），抬起立刻复原 */
.pui-cd__crow.pui-cd__crow--ping {
  background: rgba(120, 120, 128, 0.14);
}

/* 同一张卡里的第二行起：左端 14px 的内嵌细分线 */
.pui-cd__crow + .pui-cd__crow::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14px;
  right: 0;
  height: 0.5px;
  background: var(--pui-cd-rule);
}

.pui-cd__crow-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pui-cd__crow-t {
  color: var(--pui-label);
  font-size: 0.9375rem;
  line-height: 1.35;
}

.pui-cd__crow-s {
  overflow: hidden;
  color: rgba(60, 60, 67, 0.6);
  font-size: 0.8125rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行尾灰色箭头：纯外观（行可点，但作品里没有下级页面） */
.pui-cd__chev {
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-top: 2px solid #c4c4c8;
  border-right: 2px solid #c4c4c8;
  transform: rotate(45deg);
}
</style>
