import { createRoot } from 'react-dom/client'
import { App } from './App'
import { EditorRoot } from './editor/EditorWindow'
import '@fontsource/patrick-hand/latin-400.css'
import './styles.css'

// A file editor window loads the same page with the file in the hash.
const editor = /^#editor=(.+)$/.exec(location.hash)

createRoot(document.getElementById('root')!).render(editor ? <EditorRoot path={decodeURIComponent(editor[1])} /> : <App />)
