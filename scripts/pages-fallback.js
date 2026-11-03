import { copyFileSync } from 'node:fs'

// GitHub Pages only knows the files it was given. For any other address it serves 404.html,
// so that file must be the app itself for links like /tickets to open on their own.
copyFileSync('dist/index.html', 'dist/404.html')
