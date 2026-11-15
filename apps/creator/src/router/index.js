/**
 * 创作端路由
 *
 * 为什么用 hash 模式：
 *   vite.config 里 `base: './'` 是刻意的 —— dist 允许双击 index.html 直接打开。
 *   而 history 模式在 file:// 下 pushState 会直接抛错，整站不可用。
 *   hash 也不需要对静态服务器配置 rewrite，部署到任意子路径都能跑。
 *   代价是 URL 里有个 #，对一个本地创作工具无所谓。
 *
 * 路由职责边界（重要）：
 *   路由**不负责**打开项目。项目生命周期归 WorkspaceView（见该文件的说明）。
 *   原因：路由守卫会在多种时机触发（刷新、前进后退、直接输 URL），
 *   在守卫里做异步 IO 会让"失败后跳哪儿"变得难以推理。
 */

import { createRouter, createWebHashHistory } from 'vue-router'

import ProjectsView from '../views/ProjectsView.vue'
import WorkspaceView from '../views/WorkspaceView.vue'
import OverviewView from '../views/OverviewView.vue'
import CharactersView from '../views/CharactersView.vue'
import AppsView from '../views/AppsView.vue'
import HomeLayoutView from '../views/HomeLayoutView.vue'
import SettingsView from '../views/SettingsView.vue'
import PreviewView from '../views/PreviewView.vue'

export const routes = [
  { path: '/', redirect: '/projects' },

  {
    path: '/projects',
    name: 'projects',
    component: ProjectsView,
    meta: { title: '我的作品' },
  },

  {
    path: '/p/:projectId',
    component: WorkspaceView,
    props: true,
    children: [
      {
        path: '',
        redirect: (to) => ({ name: 'overview', params: { projectId: to.params.projectId } }),
      },
      {
        path: 'overview',
        name: 'overview',
        component: OverviewView,
        meta: { title: '作品首页' },
      },
      {
        path: 'characters',
        name: 'characters',
        component: CharactersView,
        meta: { title: '人物' },
      },
      {
        path: 'apps/:app',
        name: 'apps',
        component: AppsView,
        props: true,
        meta: { title: '应用内容' },
      },
      {
        path: 'home-layout',
        name: 'home-layout',
        component: HomeLayoutView,
        meta: { title: '桌面美化' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
        meta: { title: '作品设置' },
      },
      {
        path: 'preview',
        name: 'preview',
        component: PreviewView,
        meta: { title: '预览作品' },
      },
    ],
  },

  { path: '/:pathMatch(.*)*', redirect: '/projects' },
]

export function createAppRouter(history = createWebHashHistory()) {
  const router = createRouter({ history, routes })

  router.afterEach((to) => {
    const title = to.meta?.title
    document.title = title ? `${title} · 捡手机模拟器` : '捡手机模拟器'
  })

  return router
}
