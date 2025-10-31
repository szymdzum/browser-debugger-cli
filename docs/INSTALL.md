# Quick Installation Guide

## 1. Extract the Archive

```bash
tar -xzf bdg-project.tar.gz
cd bdg-project
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Build the Project

```bash
npm run build
```

## 4. Link for Global Use (Optional)

```bash
npm link
```

Now you can use `bdg` from anywhere!

## 5. Start Chrome with Debugging

### Linux
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg \
  --no-first-run \
  --no-default-browser-check
```

### macOS
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg \
  --no-first-run \
  --no-default-browser-check
```

### Windows
```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\temp\chrome-bdg ^
  --no-first-run ^
  --no-default-browser-check
```

## 6. Test It

Open a page in Chrome (e.g., `http://localhost:3000`) and run:

```bash
bdg localhost:3000
```

You should see:
```
Connected to http://localhost:3000
Collecting network, console, and DOM... (Ctrl+C to stop and output)
```

Interact with the page, then press `Ctrl+C` to get the JSON output.

## Troubleshooting

See [CHROME_SETUP.md](CHROME_SETUP.md) for detailed Chrome configuration and troubleshooting.

## Next Steps

- Read [README.md](README.md) for full documentation
- Check [CHROME_SETUP.md](CHROME_SETUP.md) for Chrome configuration details
- Try different commands: `bdg dom`, `bdg network`, `bdg console`
