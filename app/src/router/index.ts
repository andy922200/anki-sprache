import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { i18n } from '@/i18n'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/pages/DashboardPage.vue'),
  },
  {
    path: '/review',
    name: 'review',
    component: () => import('@/pages/ReviewPage.vue'),
  },
  {
    path: '/logbook',
    name: 'logbook',
    component: () => import('@/pages/LogbookPage.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/SettingsPage.vue'),
  },
  {
    path: '/settings/api-keys',
    name: 'api-keys',
    component: () => import('@/pages/ApiKeysPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { public: true },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to, from) => {
  const ui = useUiStore()
  if (ui.isBusy && to.fullPath !== from.fullPath) {
    ui.toast('info', i18n.global.t('generation.blockingNav'))
    return false
  }
  const auth = useAuthStore()
  await auth.hydrate()
  const isPublic = to.meta.public === true
  if (!isPublic && !auth.IS_AUTHENTICATED) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.IS_AUTHENTICATED) {
    return { name: 'dashboard' }
  }
})
