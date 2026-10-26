import './ui/styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado');
void new App(root).start();
