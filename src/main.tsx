import { render } from 'preact';
import './styles/theme.css';
import './styles/app.css';
import './styles/rooms.css';
import { App } from './App';

render(<App />, document.getElementById('root')!);
