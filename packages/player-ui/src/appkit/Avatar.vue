<!--
  头像。
  作品里的头像来自资产（可能缺、可能还没加载完），缺图时用"首字 + 稳定色"兜底 ——
  绝不能出现灰方块或裂图图标，那会让整屏看起来像坏了。
  稳定色由名字哈希决定：同一个人每次进来颜色一致，不会闪来闪去。
-->
<script setup>
import { computed, inject } from 'vue'

const props = defineProps({
  /** 资产 id；有则通过 resolveAsset 换成 url */
  assetId: { type: String, default: null },
  /** 名字（用于首字与兜底色） */
  name: { type: String, default: '' },
  /** 直径 px */
  size: { type: Number, default: 44 },
  /** 圆角：'full' 圆形 | 'squircle' 连续圆角方形 */
  shape: { type: String, default: 'full' },
  /** 是否显示在线/未读小圆点（截图里常见，保留接口） */
  badge: { type: Boolean, default: false },
  /**
   * 指定底色（CSS background 值）。留空则按名字哈希生成稳定色。
   * 通讯录/电话这类系统应用需要统一的淡蓝紫头像，不能一人一个颜色。
   */
  background: { type: String, default: '' },
})

const resolveAsset = inject('phoneResolveAsset', null)

const url = computed(() => {
  if (!props.assetId || typeof resolveAsset !== 'function') return null
  try {
    return resolveAsset(props.assetId) || null
  } catch {
    // 资产解析失败不能连累整屏渲染
    return null
  }
})

const initial = computed(() => {
  const name = (props.name || '').trim()
  if (!name) return '?'
  // 中文取首字，英文取首字母
  return [...name][0].toUpperCase()
})

/** 名字 → 色相。固定饱和/明度，保证白字可读。 */
const background = computed(() => {
  if (props.background) return props.background
  const name = props.name || '?'
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return `hsl(${hash} 42% 58%)`
})
</script>

<template>
  <span
    class="pui-avatar"
    :class="[`pui-avatar--${shape}`, { 'pui-avatar--bordered': !url }]"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      '--pui-avatar-bg': background,
    }"
    :data-has-image="url ? 'true' : 'false'"
    aria-hidden="true"
  >
    <img v-if="url" class="pui-avatar__img" :src="url" alt="" draggable="false" />
    <span v-else class="pui-avatar__initial" :style="{ fontSize: `${Math.round(size * 0.4)}px` }">
      {{ initial }}
    </span>
    <span v-if="badge" class="pui-avatar__badge"></span>
  </span>
</template>

<style>
.pui-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  background: var(--pui-avatar-bg, var(--pui-gray-4));
  overflow: hidden;
  user-select: none;
}

.pui-avatar--full {
  border-radius: 50%;
}

.pui-avatar--squircle {
  border-radius: 30%;
}

.pui-avatar--bordered {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.pui-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pui-avatar__initial {
  color: #fff;
  font-weight: var(--pui-weight-semibold);
  line-height: 1;
  /* 首字在圆里视觉重心略偏下，往上顶 1px */
  transform: translateY(-1px);
}

.pui-avatar__badge {
  position: absolute;
  inset: auto 0 0 auto;
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background: var(--pui-green);
  box-shadow: 0 0 0 2px #fff;
}
</style>
