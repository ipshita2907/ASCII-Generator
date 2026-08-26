# ASCII Camera

Turn your webcam feed into live ASCII art, right in the browser. Pick a preset character set or bring your own, tune the density, toggle color, and export the result as text or an image — or record it.

**Live demo:** https://ascii-generator-virid.vercel.app/

## Features

- 🎥 **Real-time webcam-to-ASCII conversion**
- 🎨 **Character presets** — Punk, Y2K, Mantra, Red Pill, Tetris, Vapor
- ✏️ **Custom charset editor** — define your own dark-to-light character ramp
- 🔍 **Adjustable density** — control how coarse or fine the ASCII grid is
- 🖥️ **Fullscreen ASCII mode**
- 🌈 **Color mode** — render ASCII in a custom hex color or full color
- 📤 **Export** — save as plain text or as an image
- ⏺️ **Recording** — capture your ASCII session (Rec / Stop) with a countdown

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- A webcam-enabled browser (Chrome, Firefox, Edge, Safari)

### Installation

```bash
git clone https://github.com/<your-username>/ascii-camera.git
cd ascii-camera
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

## Usage

1. Open the app and grant webcam access when prompted.
2. Choose a **preset** character set, or type a custom charset (ordered dark → light) and hit **Apply**.
3. Adjust **Density** to change resolution/coarseness of the ASCII grid.
4. Toggle **Fullscreen ASCII** for an immersive view.
5. Enable **Color Mode** and pick a hex value to colorize the output.
6. Use **Export** to save your creation as **Text** or **Image**.
7. Hit **● Rec** to start recording and **■ Stop** to end it.

## Tech Stack

- Frontend: [add framework, e.g. React / Next.js]
- Deployment: [Vercel](https://vercel.com/)
- Camera capture: browser `MediaDevices` / `getUserMedia` API

> _Update this section with the actual stack used (Next.js, Canvas API, etc.)_

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request for new presets, export formats, or performance improvements.

## License

[MIT](LICENSE)
