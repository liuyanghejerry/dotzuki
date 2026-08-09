import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/edit' },
    {
      path: '/edit/:activity?',
      name: 'editor',
      component: App,
      props: (route) => ({
        routeActivity: route.params.activity as string | undefined,
      }),
    },
  ],
})

export default router
