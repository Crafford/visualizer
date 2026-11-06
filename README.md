# VZ-01 Visualizer

A browser audio-reactive visualizer with two effects (Ink and Smoke) and a Teenage Engineering style control panel. Static site: TypeScript, Vite, three.js (WebGL2), Web Audio.

Originally created by Jaco Crafford (https://github.com/Crafford/visualizer).
Live: https://crafford.github.io/visualizer/

## Run

```sh
npm install
npm run dev       # http://localhost:5173
```

## Build

```sh
npm run check     # type-check
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ locally
```

`dist/` is fully static and uses relative paths, so it can be hosted from any folder.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

Copyright (C) 2026 Jaco Crafford.

Licensed under the GNU Affero General Public License v3.0 only ([LICENSE](LICENSE)), with additional terms under section 7 ([NOTICE](NOTICE)). In short:

- You may use, study, change and share this code, including commercially.
- Keep the NOTICE file, the copyright lines in the source files, and the line "Originally created by Jaco Crafford (https://github.com/Crafford/visualizer)" in your README.
- Mark modified versions as modified, and don't present them as the original or as your own original work.
- Don't use the names "Jaco Crafford" or "VZ-01" to promote a modified version.
- If you host a modified version as a website or other network service, offer its complete source code to its users under this same license.

The LICENSE and NOTICE files are the binding text; this summary is not.
