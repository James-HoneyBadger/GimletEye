#!/usr/bin/env node
// Render the installer icon with the same Chromium that ships in the app, so the
// mark matches what users see in the window and there is no opaque binary that
// nobody can regenerate.
//
// Run it with the app's own Electron, not with node: the `electron` package
// exports a path to the binary, so a plain `node` run cannot import `app`.
//
//   npm run icon -w @gimlet-eye/desktop
//   npx electron scripts/make-icon.mjs          # the same thing, from the root
//
// Writes apps/desktop/build/icon.png at 512x512, which electron-builder picks up
// for every target (deb, AppImage, dmg, nsis). The same tokens and the same
// Chromium produce a byte-identical PNG, so a rebuilt release keeps its icon.
// On a headless machine run it under xvfb-run: Electron still wants a display
// server to start.
import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A 512 px icon means 512 px of pixels, not 512 px scaled by whatever DPI the
// machine running this happens to have.
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'apps/desktop/build/icon.png')
const size = 512

// The gradient and ink are the desktop tokens, so the icon cannot drift from the
// UI without someone changing both.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
  .mark {
    width: ${size}px; height: ${size}px; border-radius: ${Math.round(size * 0.22)}px;
    display: grid; place-items: center;
    background: linear-gradient(145deg, #f0bd61, #e3aa42);
    color: #1a1207;
    font: 800 ${Math.round(size * 0.6)}px/1 ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif;
  }
  /* The glyph sits a touch high in a square box; nudge it onto the optical centre. */
  .mark span { transform: translateY(-2%); }
</style></head><body><div class="mark"><span>G</span></div></body></html>`

// Not top-level await: Electron waits for the main module to finish evaluating
// before it starts the app, so an `await app.whenReady()` at the top level never
// resolves. The work therefore starts from a call rather than from the module.
async function main() {
    await app.whenReady()
    const win = new BrowserWindow({
        width: size,
        height: size,
        show: false,
        frame: false,
        transparent: true,
        // Offscreen rendering, because a hidden window does not paint on every
        // compositor: with the compositor drawing on demand, `capturePage` on a
        // window that is never shown waits for a frame that never arrives.
        webPreferences: { offscreen: true },
    })
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // One frame is not always enough for the web font stack to settle.
    await new Promise((resolve) => setTimeout(resolve, 400))
    // A missing display makes this wait forever rather than fail, and a hung
    // release job is the worst way to learn that.
    const image = await Promise.race([
        win.webContents.capturePage({ x: 0, y: 0, width: size, height: size }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('no frame captured in 20s; is there a display?')), 20_000),
        ),
    ])
    // A blank capture is still a valid PNG, so check the image, not the bytes.
    if (image.isEmpty()) throw new Error('captured an empty image')
    const png = image.toPNG()

    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, png)
    console.log(
        `${path.relative(root, out)}: ${image.getSize().width}x${image.getSize().height}, ${png.length} bytes`,
    )
    app.quit()
}

main().catch((error) => {
    console.error(error)
    app.exit(1)
})
