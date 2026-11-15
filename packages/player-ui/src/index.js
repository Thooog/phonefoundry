

export { default as PhoneShell } from './PhoneShell.vue'
export { default as PhoneSimulator } from './PhoneSimulator.vue'
export { useShellFit } from './use-shell-fit.js'

export { default as LockScreen } from './kernel/LockScreen.vue'
export { default as PasscodePad } from './kernel/PasscodePad.vue'
export { default as HomeScreen } from './kernel/HomeScreen.vue'
export { default as StatusBar } from './kernel/StatusBar.vue'
export { default as AppHost } from './kernel/AppHost.vue'
export {
  createPhoneRuntime,
  providePhoneRuntime,
  usePhoneRuntime,
  useWorkData,
  PHONE_RUNTIME,
  ROOT_SCREEN,
} from './kernel/create-runtime.js'

/** 通用原语（各应用复用同一套） */
export { default as NavBar } from './appkit/NavBar.vue'
export { default as ScrollArea } from './appkit/ScrollArea.vue'
export { default as ListCell } from './appkit/ListCell.vue'
export { default as Avatar } from './appkit/Avatar.vue'
export { default as EmptyState } from './appkit/EmptyState.vue'
export { default as SegmentedControl } from './appkit/SegmentedControl.vue'

/** 动效 */
export {
  SPRING_PRESETS,
  animateSpring,
  projectMomentum,
  shouldComplete,
  stepSpring,
  isAtRest,
} from './motion/spring.js'
export {
  attachDrag,
  rubberband,
  createVelocityTracker,
  toSpringVelocity,
  TAP_SLOP,
} from './motion/gesture.js'
export { prefersReducedMotion, useReducedMotion } from './motion/reduced-motion.js'

/** 作品端样式入口（由使用方自行 import，便于控制顺序） */
export const PLAYER_STYLE_ENTRY = './styles/entry.css'
