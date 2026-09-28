import { mount } from 'svelte';
import './app/styles/b28-clay.css';
import './app/styles/app.css';
import App from './app/App.svelte';

export default mount(App, { target: document.getElementById('app')! });
