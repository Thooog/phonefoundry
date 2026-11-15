

<script setup>
import { computed, useId } from 'vue'
import { DECORATIVE_APPS } from '@phone-sim/shared'
import DecorativeAppGlyph from './DecorativeAppGlyph.vue'

const props = defineProps({
  iconKey: { type: String, required: true },
  /** 边长 px */
  size: { type: Number, default: 60 },
  /** 底色；为空时按内置表取 */
  accent: { type: String, default: '' },
})

const ACCENTS = {
  photos: '#FFFFFF',
  kakaotalk: '#FEE500',
  messages: '#34C759',
  instagram: 'linear-gradient(160deg, #F9CE34 0%, #EE2A7B 55%, #6228D7 100%)',
  x: '#000000',
  notes: '#FFFFFF',
  phone: '#34C759',
  settings: 'linear-gradient(180deg, #B9BCC4 0%, #8E8E93 100%)',
}

const background = computed(() => {
  // 品牌色优先。
  // 调用方传进来的 accent 是编辑端分组用的**单色**（APPS 里那个），
  // 直接用它当图标底色会把 Instagram 的渐变拍成一块纯粉红 —— 一眼就假。
  const brand = ACCENTS[props.iconKey]
  if (brand) return brand
  return props.accent || '#8E8E93'
})
const isDecorative = computed(() => DECORATIVE_APPS.some(app => app.iconKey === props.iconKey))
/** KakaoTalk 的黄底必须配深色图形，白图形在 #FEE500 上几乎看不见 */
const glyphColor = computed(() => (props.iconKey === 'kakaotalk' ? '#3C1E1E' : '#FFFFFF'))

/**
 * 图形统一缩到 82% 居中 —— 底色本身也是图标的一部分。
 *
 * 为什么是 82%：各 path 在 48×48 viewBox 里本来就只占 46%~77%，
 * 早期用 0.62 等于两次留白，设置/X 的可见图形只剩方块的 28%~31%，
 * 和"整张便签铺满"的备忘录摆在一起明显偏小。0.82 把最小的图形抬到约 40%，
 * 又不会让照片风车、X 的笔画顶到 22.4% 的圆角上。
 *
 * 这一层是全体共用的唯一缩放。照片 / Instagram / 设置 / 电话曾因 path 在 viewBox 里
 * 只占 46%~63%（照片例外，画到了 81% 但花瓣细、中心留白多），两层留白后显得
 * 比信息、X 小一圈；已把它们的几何画大并收拢到 67%~93%，
 * 而不是给它们单独开一份 scale —— 八枚图标仍然只有一个缩放常量。
 *
 * 缩放放在 SVG 内部的 transform 上，而不是 svg 元素的 width/height：
 * svg 必须永远铺满圆角方块，否则外层容器（自定义桌面布局会把 span 压到格子大小）
 * 一压，图形就跟丢，四周露出一圈白底，看起来像"里面还套了一张小卡片"。
 * 备忘录不参与缩放：它画的是整张便签纸，抬头要贴顶边，纸面要铺满整格。
 */
const GLYPH_SCALE = 0.82
const glyphTransform = computed(() => {
  if (props.iconKey === 'notes') return undefined
  const offset = (1 - GLYPH_SCALE) * 24
  return `translate(${offset} ${offset}) scale(${GLYPH_SCALE})`
})

const PHONE_PATH =
  'M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512' +
  'c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6' +
  'L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z'
/** 512 坐标系 → 48 viewBox：0.0697 倍后左上角平移到 6.15，形状正好居中于 (24,24) */
const PHONE_TRANSFORM = 'translate(6.15 6.15) scale(0.0697)'

/** 备忘录抬头渐变的 id 必须唯一，否则多份图标同存时后面的会取到前面的 defs */
const bandId = `pui-notes-band-${useId()}`

/**
 * 照片的八色风车。
 *
 * 真机图标是八片彩色花瓣绕中心转 —— 这是"照片"唯一可识别的形状，
 * 换成相机、山、太阳都认不出来。八片花瓣共用一条图形，只按 45° 递增旋转，
 * 所以这里只需要一个颜色数组，不需要八段 path。
 * 花瓣要够宽，细了会在八片之间留下大块白洞，整枚看着"空、小"；
 * 但也不能太宽，相邻花瓣半透明叠色会糊成一团，rx 5.6 是两者的折中。
 */
const PHOTO_PETALS = [
  '#F9C74F',
  '#F3722C',
  '#F94144',
  '#E56399',
  '#9B5DE5',
  '#4D96FF',
  '#43AA8B',
  '#90BE6D',
]
</script>

<template>
  <span
    class="pui-appicon"
    :style="{
      '--pui-appicon-size': `${size}px`,
      background,
      '--pui-appicon-glyph': glyphColor,
    }"
    :data-icon="iconKey"
    aria-hidden="true"
  >
    <svg viewBox="0 0 48 48" :width="size" :height="size">
      <!--
        备忘录：整张便签纸（黄抬头 + 白纸面 + 虚点分隔 + 两条行线）。
        抬头贴到图标顶边、纸面铺满整格，所以这一支不套缩放 g。
      -->
      <g v-if="iconKey === 'notes'">
        <defs>
          <linearGradient :id="bandId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FBDC63" />
            <stop offset="1" stop-color="#F6BE23" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" fill="#FFFFFF" />
        <rect width="48" height="13.6" :fill="`url(#${bandId})`" />
        <!-- 抬头下的虚点分隔（点小、间距大，否则缩到 60px 会糊成一条虚线） -->
        <path
          d="M2.6 17.2h42.8"
          fill="none"
          stroke="#C9C9D1"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-dasharray="0.1 2.6"
        />
        <!-- 两条行线；最后一段留白，和便签纸"写到一半"的观感一致 -->
        <path
          d="M2.6 26.6h42.8M2.6 36h42.8"
          fill="none"
          stroke="#D2D2DA"
          stroke-width="1.6"
        />
      </g>

      <DecorativeAppGlyph v-else-if="isDecorative" :icon-key="iconKey" />
      <!-- 其余内容应用图标：共用这一层 82% 居中缩放 -->
      <g v-else :transform="glyphTransform">
        <!-- 照片：八色风车。花瓣细、尖端之间留豁口，同样的包围盒看起来比实心图标瘦，
             所以在 48 框里按 1.16 倍画大一圈（cy 13.2→11.47、rx 5.6→6.5、ry 8.6→9.98，
             仍绕 (24,24) 对称），缩放后外接圆占方块约 77%，视觉重量和电话/信息齐平。
             这里是直接改几何数值，不是给单枚加缩放系数。 -->
        <g v-if="iconKey === 'photos'">
          <g v-for="(tint, i) in PHOTO_PETALS" :key="tint" :transform="`rotate(${i * 45} 24 24)`">
            <ellipse cx="24" cy="11.47" rx="6.5" ry="9.98" :fill="tint" opacity="0.9" />
          </g>
        </g>

        <!-- KakaoTalk / 信息：气泡。原 path 在 48 框里仅占 ~55%，比电话/X 的 ~61% 偏小，
             按 siblings 的口径以 (24,24) 为中心放大 1.15 倍（不另开组件、不另写 CSS，
             只是把这份几何在共用 48 框里画大，与照片/IG/电话同一条路）。 -->
        <g
          v-else-if="iconKey === 'kakaotalk' || iconKey === 'messages'"
          transform="translate(24 24) scale(1.15) translate(-24 -24)"
        >
          <path
            d="M24 10c-8.8 0-16 5.4-16 12 0 3.8 2.4 7.2 6.1 9.4l-1.5 5.4c-.2.7.5 1.2 1.1.8l6.4-4.2c1.3.2 2.6.3 3.9.3 8.8 0 16-5.4 16-12S32.8 10 24 10z"
            :fill="iconKey === 'kakaotalk' ? 'var(--pui-appicon-glyph)' : '#fff'"
          />
        </g>

        <!-- Instagram：相机轮廓（外框画满 36/48，和 X 的 60% 视觉占比对齐） -->
        <g
          v-else-if="iconKey === 'instagram'"
          fill="none"
          stroke="#fff"
          stroke-width="3.1"
          stroke-linejoin="round"
        >
          <rect x="6" y="6" width="36" height="36" rx="10.8" />
          <circle cx="24" cy="24" r="9" />
          <circle cx="35.5" cy="12.5" r="2" fill="#fff" stroke="none" />
        </g>

        <g v-else-if="iconKey === 'x'">
          <path
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
            fill="#fff"
            transform="translate(4.3 4.45) scale(1.63)"
          />
        </g>

        <!-- 电话：iOS 听筒（品牌图标集的成熟几何，来历见 PHONE_PATH 注释） -->
        <path
          v-else-if="iconKey === 'phone'"
          :d="PHONE_PATH"
          :transform="PHONE_TRANSFORM"
          fill="#fff"
        />

        <!--
          设置：三条滑杆。
          试过画齿轮，但在这个尺寸下齿只会变成"一圈小刺"，看起来像太阳。
          滑杆笔画更省、识别度更高。
        -->
        <g v-else fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">
          <path d="M8 13.5h32M8 24h32M8 34.5h32" opacity="0.92" />
          <g fill="#fff" stroke="none">
            <circle cx="18" cy="13.5" r="4" />
            <circle cx="31" cy="24" r="4" />
            <circle cx="16.5" cy="34.5" r="4" />
          </g>
        </g>
      </g>
    </svg>
  </span>
</template>

<style>
.pui-appicon {
  position: relative;
  width: var(--pui-appicon-size, 60px);
  height: auto;
  aspect-ratio: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  /* iOS 图标圆角约为边长的 22.4%（squircle 近似） */
  border-radius: 22.4%;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  user-select: none;
}
/* svg 永远铺满方块；图形大小由 viewBox 内的 transform 决定。
   外层容器只能改方块尺寸，不要再压缩 svg —— 那会露出一圈底色（白边）。 */
.pui-appicon > svg {
  width: 100%;
  height: 100%;
}
</style>
