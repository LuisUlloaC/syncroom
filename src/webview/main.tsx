import {render} from 'preact'
import {App} from './app'
import './styles.css'

const root = document.getElementById('root')
if (root !== null) render(<App />, root)
