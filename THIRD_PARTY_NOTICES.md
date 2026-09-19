# Third-party notices

This application is an internal, Cloudflare Access-protected game. The
following third-party software and services are used by the source tree or by
the deployed application. Direct dependency ranges are declared in
`package.json`; the resolved dependency graph is fixed by `pnpm-lock.yaml`.

## Runtime JavaScript

| Component            | Version | License | Upstream notice                                                                             |
| -------------------- | ------: | ------- | ------------------------------------------------------------------------------------------- |
| React / React DOM    |  19.2.8 | MIT     | [react.dev](https://react.dev/)                                                             |
| `@react-three/fiber` |   9.7.0 | MIT     | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber/blob/master/LICENSE) |
| `@react-three/drei`  |  10.7.8 | MIT     | [pmndrs/drei](https://github.com/pmndrs/drei/blob/master/LICENSE)                           |
| Three.js             | 0.186.0 | MIT     | [three.js LICENSE](https://github.com/mrdoob/three.js/blob/dev/LICENSE)                     |
| Zustand              |  5.0.15 | MIT     | [pmndrs/zustand](https://github.com/pmndrs/zustand/blob/main/LICENSE)                       |

The source tree does not copy third-party source files into `src/`. The
production build can bundle direct and transitive dependencies, so this table
is only an index. Vite's generated manifest for detected bundle dependencies is
available at [`/licenses.md`](https://jev-kitchen.egahika.dev/licenses.md);
the supplementary fiber and vendored reconciler notices are available at
[`/third-party-notices.md`](https://jev-kitchen.egahika.dev/third-party-notices.md).

## Build and deployment tools

| Component              | Version | License           | Upstream notice                                                                                  |
| ---------------------- | ------: | ----------------- | ------------------------------------------------------------------------------------------------ |
| Vite+                  |   0.3.2 | MIT               | [vite-plus.dev](https://viteplus.dev/guide)                                                      |
| `@vitejs/plugin-react` |   6.1.1 | MIT               | [vite-plugin-react](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react) |
| TypeScript             |     5.x | Apache-2.0        | [microsoft/TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)            |
| Wrangler               |     4.x | MIT OR Apache-2.0 | [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk)                              |

## Fonts

The interface uses fonts installed on the device through a system font stack.
No font binaries are bundled and no external font service is requested.

## External services and data flow

- Cloudflare Workers serves the static build and enforces the existing
  Cloudflare Access member boundary.
- `/api/decide` sends the game state, legal action candidates, and the user's
  collaboration-policy text to the configured Jev provider. The current
  production route uses the TypeSafe API when `TYPESAFE_API_KEY` is present;
  Workers AI is the documented fallback.
- `/api/decide-llm` is an optional comparison route backed by the configured
  Workers AI model. It is not needed for the core game.
- Client aborts and timeouts bound waiting and discard stale responses; they do
  not guarantee that upstream model processing or billing has stopped.

Do not enter names, contact details, secrets, or other personal/confidential
information into the free-text collaboration policy. This notice records the
observed data flow; it is not legal advice or a substitute for the provider
terms and privacy review.

## Review boundary

This file is an engineering inventory, not a grant of rights beyond the
upstream licenses. Before a public, unauthenticated release, re-check the
provider terms, privacy notice, font delivery choice, and the complete
production dependency inventory (including transitive packages).
