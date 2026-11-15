import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createAppRouter } from './router/index.js'
import { requestPersistence } from './db/connection.js'
import './styles/base.css'
import './styles/creator-design.css'

void requestPersistence()

const app = createApp(App)

app.use(createPinia())
app.use(createAppRouter())

app.mount('#app')
