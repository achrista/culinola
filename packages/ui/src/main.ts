import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/dosis/300.css';
import '@fontsource/dosis/400.css';
import '@fontsource/nunito/300.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './theme.css';
import { createApp } from 'vue';
import App from './App.vue';
import { i18n } from './i18n.ts';

createApp(App).use(i18n).mount('#app');
